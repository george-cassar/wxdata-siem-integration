# Retrieving Executed SQL Details from Presto — Technical Reference

This document describes in detail how the **watsonx.data Presto ↔ SIEM Integration** project retrieves the details of all SQL statements executed on an IBM watsonx.data Presto/Trino coordinator, converts that raw query history into structured SIEM audit events, and exposes it through the backend API and WebSocket stream.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Authentication](#3-authentication)
4. [Query History Sources](#4-query-history-sources)
   - 4.1 [Source A — `system.runtime.queries`](#41-source-a--systemruntimequeries)
   - 4.2 [Source B — `wxd_system_data` persistent audit view](#42-source-b--wxd_system_data-persistent-audit-view)
5. [HTTP Transport — The Presto REST Protocol](#5-http-transport--the-presto-rest-protocol)
6. [Code Walkthrough](#6-code-walkthrough)
   - 6.1 [Configuration (`config.py`)](#61-configuration-configpy)
   - 6.2 [Token exchange (`presto_service.py`)](#62-token-exchange-presto_servicepy)
   - 6.3 [Submitting the history query (`_execute_via_httpx`)](#63-submitting-the-history-query-_execute_via_httpx)
   - 6.4 [Fetching and merging audit history (`fetch_live_audit_history`)](#64-fetching-and-merging-audit-history-fetch_live_audit_history)
   - 6.5 [Row-to-event conversion](#65-row-to-event-conversion)
   - 6.6 [Event enrichment pipeline](#66-event-enrichment-pipeline)
7. [SIEM Audit Event Schema](#7-siem-audit-event-schema)
8. [API Endpoints](#8-api-endpoints)
9. [WebSocket Incremental Polling](#9-websocket-incremental-polling)
10. [Risk Classification Logic](#10-risk-classification-logic)
11. [Mock-mode Fallback](#11-mock-mode-fallback)
12. [Limitations and Operational Notes](#12-limitations-and-operational-notes)

---

## 1. Overview

Every SQL statement executed on a Presto/Trino coordinator is recorded in two system-level locations:

| Location | Retention | Coverage |
|---|---|---|
| `system.runtime.queries` | In-memory; cleared on coordinator restart | Live and recently completed queries |
| `wxd_system_data.<diag_schema>.query_completed_event_view` | Persistent (object storage) | All completed queries, survives restarts |

The backend queries **both sources concurrently**, deduplicates by `query_id`, and converts each row into a canonical SIEM audit event. The event carries the original SQL text, the authenticated user, client IP, catalog, schema, row/byte counts, execution duration, status (`FINISHED` / `FAILED`), and computed risk classification.

---

## 2. Prerequisites

### 2.1 Presto / watsonx.data Connectivity

| Requirement | Notes |
|---|---|
| IBM watsonx.data instance | Cloud SaaS (IBM Cloud) or on-prem (IBM Cloud Pak for Data / CP4D) |
| Presto coordinator hostname | Find in the watsonx.data console under **Infrastructure → Connection details** |
| Port | `443` (IBM Cloud SaaS) or `8443` (on-prem CP4D) |
| TLS | All connections use HTTPS; set `PRESTO_SSL_VERIFY=false` for self-signed certificates |
| User account | Must have `SELECT` privilege on `system.runtime.queries` and `wxd_system_data.*` |

### 2.2 Python Environment

```
Python 3.9+
httpx >= 0.28          # always present (primary REST client)
trino >= 0.340         # optional; used for plain Trino without a CP4D token
```

Install from `backend/requirements.txt`:

```bash
pip install -r backend/requirements.txt
```

### 2.3 Environment Variables (`.env`)

Copy `.env.example` to `.env` and set at minimum:

```env
DEMO_MODE=live

PRESTO_HOST=<your-presto-coordinator-hostname>
PRESTO_PORT=443          # or 8443 for on-prem
PRESTO_USE_SSL=true
PRESTO_SSL_VERIFY=false  # false for self-signed certs

# Authentication — choose ONE:
PRESTO_USER=ibmacp
PRESTO_PASSWORD=<cp4d-password>
# --- OR ---
PRESTO_BEARER_TOKEN=<pre-obtained-jwt-token>

# Optional: separate CP4D console host if different from Presto coordinator
PRESTO_CPD_HOST=
```

`DEMO_MODE=mock` (the default) disables all live Presto calls. The `fetch_live_audit_history` function returns `[]` immediately in mock mode and the caller falls back to synthetic data.

---

## 3. Authentication

IBM watsonx.data CP4D **does not accept HTTP Basic Auth** for Presto REST calls. The only accepted method is `Authorization: Bearer <cpd-token>`.

The backend implements a two-step token resolution in [`backend/services/presto_service.py`](../backend/services/presto_service.py):

```
Priority 1 → PRESTO_BEARER_TOKEN env var (pre-obtained token, fastest path)
Priority 2 → Module-level cache (already exchanged in this process)
Priority 3 → Exchange PRESTO_USER + PRESTO_PASSWORD via /icp4d-api/v1/authorize
```

### Token Exchange (`_get_cpd_token`)

When `PRESTO_BEARER_TOKEN` is not set, the function makes a synchronous `POST` to:

```
POST https://<PRESTO_CPD_HOST>/icp4d-api/v1/authorize
Content-Type: application/json

{"username": "<PRESTO_USER>", "password": "<PRESTO_PASSWORD>"}
```

The response JSON contains a `token` (or `access_token`) field. The token is stored in the module-level `_cpd_token_cache` variable and reused for the lifetime of the process.

```python
# backend/services/presto_service.py — _get_cpd_token()
cpd_host = settings.PRESTO_CPD_HOST or settings.PRESTO_HOST
url = f"https://{cpd_host}/icp4d-api/v1/authorize"
resp = httpx.post(
    url,
    json={"username": settings.PRESTO_USER, "password": settings.PRESTO_PASSWORD},
    verify=settings.PRESTO_SSL_VERIFY,
    timeout=10.0,
)
token = resp.json().get("token") or resp.json().get("access_token")
```

To obtain a token manually for testing:

```bash
curl -k -X POST https://<cpd-host>/icp4d-api/v1/authorize \
  -H "Content-Type: application/json" \
  -d '{"username":"ibmacp","password":"<password>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
```

Paste the result as `PRESTO_BEARER_TOKEN=<token>` in `.env`.

---

## 4. Query History Sources

### 4.1 Source A — `system.runtime.queries`

The Presto/Trino `system` catalog exposes a `runtime.queries` virtual table that contains all queries held in the coordinator's in-memory store (running and recently completed).

**SQL used by the project** (defined in [`backend/services/watsonx_data_service.py`](../backend/services/watsonx_data_service.py) as `_RUNTIME_QUERIES_SQL`):

```sql
SELECT
    query_id,
    state,
    user,
    source,
    created,
    "end",
    query
FROM system.runtime.queries
ORDER BY created DESC
LIMIT {limit}
```

| Column | Type | Meaning |
|---|---|---|
| `query_id` | `varchar` | Unique identifier assigned by the coordinator |
| `state` | `varchar` | `RUNNING`, `FINISHED`, `FAILED`, `CANCELED` |
| `user` | `varchar` | Authenticated identity that submitted the query |
| `source` | `varchar` | Client tag (e.g. `watsonx-data-siem-demo`, `jdbc`) |
| `created` | `timestamp` | Wall-clock time the query was received |
| `end` | `timestamp` | Wall-clock time the query completed (NULL for running) |
| `query` | `varchar` | Full SQL statement text |

> **Retention note:** `system.runtime.queries` is held entirely in coordinator memory. Entries are evicted when the coordinator restarts or the internal cache fills. For persistent coverage use Source B.

The query is executed with `catalog="system"` and `schema="runtime"` overrides passed to `presto_executor.execute_query()` so the session header reflects the correct namespace regardless of the `PRESTO_CATALOG` / `PRESTO_SCHEMA` defaults.

### 4.2 Source B — `wxd_system_data` persistent audit view

IBM watsonx.data CP4D persists completed query events to object storage and exposes them through a catalog called `wxd_system_data`. The specific schema name within this catalog is environment-dependent (it contains the cluster or deployment identifier), so the backend **auto-discovers** it at startup with a single `SHOW SCHEMAS FROM wxd_system_data` call and caches the result in `_wxd_diag_schema_cache` for the lifetime of the process.

The discovered view name takes the form:

```
wxd_system_data."<diag_schema>".query_completed_event_view
```

**SQL used by the project** (`_WXD_HISTORY_SQL`):

```sql
SELECT
    query_id,
    query_state,
    user,
    source,
    create_time,
    end_time,
    wallTimeMillis,
    catalog,
    schema,
    query,
    total_rows,
    total_bytes,
    error_code,
    failure_message
FROM wxd_system_data."<diag_schema>".query_completed_event_view
LIMIT {fetch_limit}
```

| Column | Type | Meaning |
|---|---|---|
| `query_id` | `varchar` | Same coordinator-assigned ID as Source A |
| `query_state` | `varchar` | `FINISHED`, `FAILED` |
| `user` | `varchar` | Authenticated identity |
| `source` | `varchar` | Client tag |
| `create_time` | `timestamp` | Query start time |
| `end_time` | `timestamp` | Query end time |
| `wallTimeMillis` | `bigint` | Elapsed wall-clock time in milliseconds |
| `catalog` | `varchar` | Target catalog (may be NULL for DDL) |
| `schema` | `varchar` | Target schema |
| `query` | `varchar` | Full SQL statement text |
| `total_rows` | `bigint` | Rows produced by the query |
| `total_bytes` | `bigint` | Bytes read from object storage |
| `error_code` | `varchar` | Presto error name (e.g. `PERMISSION_DENIED`) |
| `failure_message` | `varchar` | Human-readable failure reason |

#### Why no `ORDER BY` in the SQL

`ORDER BY create_time DESC` on an unpartitioned ORC table of 10k+ rows forces Presto to sort the full dataset before returning any rows. In practice this takes 60+ seconds and exceeds the browser's connection timeout. The project instead:

1. Fetches `limit * 4` rows **without** `ORDER BY` (Presto emits the first page in ~3 seconds).
2. Converts all rows to events in Python.
3. Sorts newest-first in Python (`events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)`).
4. Trims to `limit` events.

---

## 5. HTTP Transport — The Presto REST Protocol

Both history queries and ad-hoc user queries are submitted using the **Presto HTTP REST protocol** implemented in `_execute_via_httpx` in [`backend/services/presto_service.py`](../backend/services/presto_service.py).

### Protocol Flow

```
POST /v1/statement          → coordinator returns first batch + nextUri
GET  <nextUri>              → poll for more data; repeat until no nextUri
                              or state ∈ {FINISHED, FAILED, CANCELED}
```

### Request Headers

Every request carries:

```http
X-Presto-User:    <PRESTO_USER>
X-Presto-Catalog: <catalog>
X-Presto-Schema:  <schema>
X-Presto-Source:  watsonx-data-siem-demo
Content-Type:     text/plain
Authorization:    Bearer <cpd-token>   ← omitted when no token available
```

### Poll Loop Details

```python
# Simplified from _execute_via_httpx
async with httpx.AsyncClient(verify=ssl_verify, timeout=30.0) as client:
    resp = await client.post(f"{base_url}/v1/statement", headers=headers, content=sql)
    data = resp.json()

    while True:
        state = data["stats"]["state"]
        columns = [c["name"] for c in data.get("columns", [])]
        all_rows.extend(data.get("data", []))

        if state in ("FINISHED", "FAILED", "CANCELED"):
            break
        next_uri = data.get("nextUri")
        if not next_uri:
            break
        # Reconstruct absolute URI — some CP4D builds return path-only nextUri
        if not next_uri.startswith("http"):
            next_uri = f"{base_url}{next_uri}"
        await asyncio.sleep(0.2)
        resp = await client.get(next_uri, headers=headers)
        data = resp.json()
```

A **hard wall-clock budget** of 75 seconds (`_POLL_WALL_LIMIT_S`) aborts the loop before the browser's axios 90-second timeout fires, returning partial results with the current `state`.

An **early-exit optimisation** (`row_limit`) stops following `nextUri` as soon as the number of accumulated rows matches the SQL `LIMIT N` clause, avoiding full pagination over large result sets.

---

## 6. Code Walkthrough

### 6.1 Configuration (`config.py`)

All connectivity settings are declared as Pydantic `BaseSettings` fields in [`backend/config.py`](../backend/config.py). They are loaded from environment variables (or `.env`) at import time:

```python
DEMO_MODE          # "mock" | "live"
PRESTO_HOST        # coordinator hostname
PRESTO_PORT        # 443 or 8443
PRESTO_USER        # authenticated identity
PRESTO_PASSWORD    # exchanged for CP4D token if PRESTO_BEARER_TOKEN absent
PRESTO_BEARER_TOKEN# pre-obtained JWT (preferred)
PRESTO_CPD_HOST    # CP4D console host for token exchange (defaults to PRESTO_HOST)
PRESTO_CATALOG     # session default catalog
PRESTO_SCHEMA      # session default schema
PRESTO_USE_SSL     # bool — enables HTTPS
PRESTO_SSL_VERIFY  # bool — set false for self-signed certificates
```

### 6.2 Token exchange (`presto_service.py`)

`_get_cpd_token()` (module-level, called from `_build_headers`) resolves the bearer token using the priority chain described in [Section 3](#3-authentication). In mock mode it returns `None` immediately and no `Authorization` header is added.

### 6.3 Submitting the history query (`_execute_via_httpx`)

`_execute_via_httpx(sql, user, catalog, schema, row_limit)` is the low-level async function that speaks the Presto REST protocol. It is called by `PrestoExecutor.execute_query()` — the single public entry point used by all services.

`execute_query()` selects the transport based on:

```python
if settings.DEMO_MODE == "live" and settings.PRESTO_HOST not in ("localhost", "127.0.0.1"):
    token = _get_cpd_token()
    if token or not TRINO_AVAILABLE:
        # CP4D / watsonx.data → always use httpx REST (token-based)
        result = await _execute_via_httpx(sql, user, catalog=catalog, schema=schema, ...)
    else:
        # Plain Trino (no token) → use trino Python client in thread pool
        result = await loop.run_in_executor(None, _execute_via_trino_sync, sql, user)
else:
    result = self._simulate(sql, user, client_ip, start_time)
```

The `catalog` and `schema` keyword arguments override the session default headers so that queries against `system.runtime.queries` are routed to the correct Presto namespace even when `PRESTO_CATALOG` is set to something else (e.g. `iceberg_data`).

### 6.4 Fetching and merging audit history (`fetch_live_audit_history`)

`fetch_live_audit_history(limit, only_new)` in [`backend/services/watsonx_data_service.py`](../backend/services/watsonx_data_service.py) is the primary public function. It:

1. **Guards against mock mode** — returns `[]` if `DEMO_MODE != "live"`.
2. **Discovers the `wxd_system_data` diagnostic schema** (once per process, cached in `_wxd_diag_schema_cache`).
3. **Fires both sources concurrently** via `asyncio.gather(fetch_runtime(), fetch_wxd_history())`.
4. **Merges and deduplicates** by `queryId` — `wxd_events` wins deduplication because they carry richer metrics.
5. **Sorts newest-first** in Python and trims to `limit`.
6. **Filters for new-only** when `only_new=True` (WebSocket polling mode) using the module-level `_seen_query_ids` set.

```python
runtime_events, wxd_events = await asyncio.gather(fetch_runtime(), fetch_wxd_history())

seen_ids: set = set()
merged: List[Dict] = []
for ev in wxd_events + runtime_events:   # wxd first so it wins dedup
    qid = ev.get("queryId", "")
    if qid not in seen_ids:
        seen_ids.add(qid)
        merged.append(ev)

merged.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
merged = merged[:limit]
```

### 6.5 Row-to-event conversion

Two separate converters handle the different column sets from each source:

| Function | Source | Key column differences |
|---|---|---|
| `_row_to_event(row, columns)` | `system.runtime.queries` | `state`, `created`, `end` |
| `_wxd_row_to_event(row, columns)` | `wxd_system_data` view | `query_state`, `create_time`, `end_time`, `wallTimeMillis`, `total_rows`, `total_bytes`, `failure_message` |

Both converters:
1. Extract fields by column name using an inner `col(name, default)` helper that handles missing columns gracefully.
2. Parse timestamps with `_parse_ts()` which tries multiple ISO 8601 / Presto datetime formats.
3. Call `_assess_risk()` to produce `(risk_level, category, rows_estimate, bytes_estimate)`.
4. Call `_extract_catalog_schema()` to resolve catalog/schema from SQL text if the view column is NULL.
5. Delegate to `_build_event()` which assembles the canonical event dict.

### 6.6 Event enrichment pipeline

`_build_event()` produces the final event dict. During assembly it also calls:

| Helper | Purpose |
|---|---|
| `_infer_role(user)` | Maps username patterns to human-readable role strings (e.g. `"ibmacp"` → `"Platform Admin"`) |
| `_infer_ip(user)` | Returns a deterministic internal IP for known user patterns; uses a hash for unknown users |
| `_infer_query_type(sql_u)` | Classifies the statement as `SELECT`, `DROP`, `INSERT`, `AGGREGATION`, `EXFILTRATION`, `METADATA`, etc. |
| `format_as_leef(event)` | Serialises the event to IBM QRadar LEEF 2.0 wire format |
| `format_as_cef(event)` | Serialises the event to ArcSight CEF wire format (used by Splunk/Sentinel) |

The two SIEM payload strings (`leefPayload`, `cefPayload`) are embedded into the event dict alongside all structured fields so the consumer can choose either format without re-serialising.

---

## 7. SIEM Audit Event Schema

Every row from Presto is converted into the following canonical dict (all fields are always present; `null` when not applicable):

| Field | Type | Source |
|---|---|---|
| `eventId` | `string (UUID)` | Generated at conversion time |
| `queryId` | `string` | Coordinator-assigned ID from `query_id` column |
| `engine` | `string` | Hardcoded `"Presto (Java) 0.286"` |
| `cluster` | `string` | First segment of `PRESTO_HOST` |
| `timestamp` | `ISO 8601` | Query end time |
| `createdTime` | `ISO 8601` | Query start / created time |
| `endTime` | `ISO 8601` | Query end time |
| `durationMs` | `integer` | Wall-clock execution time in ms |
| `cpuTimeMs` | `integer` | Estimated CPU time (`durationMs × 1.8`) |
| `user` | `string` | Presto `user` column |
| `userRole` | `string` | Inferred from username pattern |
| `clientIp` | `string` | Inferred from username pattern |
| `source` | `string` | Presto `source` tag |
| `catalog` | `string` | Resolved from view column or parsed from SQL |
| `schema` | `string` | Resolved from view column or parsed from SQL |
| `sqlText` | `string` | Full SQL statement |
| `queryType` | `string` | `SELECT`, `DROP`, `AGGREGATION`, `EXFILTRATION`, etc. |
| `category` | `string` | Threat/behavioural category (e.g. `"Mass PII Exfiltration"`) |
| `riskLevel` | `string` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `rowsScanned` | `integer` | Rows processed (real from `total_rows`; estimated otherwise) |
| `rowsReturned` | `integer` | Rows returned to client (0 on failure) |
| `bytesScanned` | `integer` | Bytes read (real from `total_bytes`; estimated otherwise) |
| `status` | `string` | `FINISHED`, `FAILED`, `CANCELED` |
| `errorCode` | `string \| null` | Presto error name (e.g. `PERMISSION_DENIED`) |
| `errorMessage` | `string \| null` | Human-readable failure reason |
| `leefPayload` | `string` | Serialised IBM QRadar LEEF 2.0 packet |
| `cefPayload` | `string` | Serialised ArcSight CEF packet |

---

## 8. API Endpoints

The FastAPI router in [`backend/routers/siem.py`](../backend/routers/siem.py) exposes the following endpoints that surface Presto SQL execution data:

### `GET /api/siem/events?limit=N`

Returns up to `N` recent audit events.

- **Live mode**: calls `fetch_live_audit_history(limit)` to pull from both Presto sources.
- **Mock mode**: falls back to `get_initial_history(limit)` (Faker synthetic events).
- Events are stored in `siem_engine.events` (in-process ring buffer, max 500 entries) after being evaluated against correlation rules.

```bash
curl http://localhost:8000/api/siem/events?limit=10 | python3 -m json.tool
```

### `POST /api/siem/execute`

Executes a user-supplied SQL statement on Presto and immediately returns the structured audit event.

Request body:
```json
{
  "sql": "SELECT * FROM iceberg_data.finance.transactions LIMIT 100",
  "user": "analyst_sarah",
  "clientIp": "10.244.12.45",
  "scenarioId": "custom"
}
```

Response:
```json
{
  "execution": { "status": "FINISHED", "queryId": "...", "columns": [...], "data": [...] },
  "auditEvent": { <full event schema> },
  "triggeredOffense": null,
  "source": "live"
}
```

The `source` field is `"live"` when the query ran on a real Presto coordinator, `"simulated"` otherwise.

### `GET /api/siem/summary`

Returns SIEM dashboard KPIs (total events, offenses, bytes scanned, events-per-second). In live mode all figures are derived purely from real Presto data with no synthetic baseline added.

### `POST /api/siem/reset`

Clears the in-memory event and offense store, then re-seeds it with the latest Presto audit history (or synthetic fallback).

---

## 9. WebSocket Incremental Polling

The WebSocket endpoint `ws://localhost:8000/api/siem/ws` provides real-time event streaming. In live mode it polls Presto every **8 seconds** using `fetch_live_audit_history(limit=50, only_new=True)`.

The `only_new=True` flag activates the incremental filter:

```python
# watsonx_data_service.py
if only_new:
    new_events = [e for e in merged if e.get("queryId") not in _seen_query_ids]
    _seen_query_ids.update(e.get("queryId") for e in new_events)
    return new_events
```

`_seen_query_ids` is a module-level `set` that persists across WebSocket poll cycles within a single process. Only `query_id` values not previously seen are returned and pushed to connected browser clients as:

```json
{
  "type": "NEW_EVENT",
  "event": { <full event schema> },
  "offense": null
}
```

---

## 10. Risk Classification Logic

Every SQL statement (regardless of source) is classified by `_assess_risk(sql_u, state)` which returns `(risk_level, category, rows_estimate, bytes_estimate)`. The rules apply in priority order:

| Priority | Condition | Risk | Category |
|---|---|---|---|
| 1 | `DROP`, `ALTER`, or `TRUNCATE` in SQL | `HIGH` | `Unauthorized DDL Attempt` |
| 2 | SQL starts with `CREATE` | `LOW` | `DDL Object Creation` |
| 3 | (`SSN` or `CREDIT_CARD` or `CUSTOMER_ACCOUNTS`) AND `SELECT *` | `CRITICAL` | `Mass PII Exfiltration` |
| 4 | `WHERE 1=1` OR (`SELECT *` with no `LIMIT`) | `MEDIUM` | `Unbounded Table Scan` |
| 5 | `KYC`, `COMPLIANCE`, or `GDPR` in SQL | `MEDIUM` | `Restricted Compliance Table Access` |
| 6 | `GROUP BY`, `SUM(`, `AVG(`, or `COUNT(` | `LOW` | `BI Report Aggregation` |
| 7 | *(default)* | `LOW` | `Standard Analytics` |

Risk classification happens independently of the SIEM correlation rules. The SIEM rules in [`backend/services/siem_service.py`](../backend/services/siem_service.py) use the classified event fields (plus `rowsScanned`, `bytesScanned`, `status`, `clientIp`) to decide whether to raise an offense.

---

## 11. Mock-mode Fallback

The entire live path is bypassed when `DEMO_MODE=mock` (or when `PRESTO_HOST` is `localhost`/`127.0.0.1`). The following substitutions apply:

| Live path | Mock fallback |
|---|---|
| `fetch_live_audit_history()` | Returns `[]`; caller uses `get_initial_history()` (Faker) |
| `PrestoExecutor.execute_query()` | Calls `_simulate()` returning deterministic hardcoded rows |
| `list_catalogs()` | Returns `["iceberg_data", "hive_lake", "system"]` |
| `list_schemas(catalog)` | Returns `_synthetic_schemas(catalog)` |

The backend **never raises an exception to the caller** due to Presto being unreachable. Every live call is wrapped in a `try/except` that logs a warning and returns `[]` or the simulated result.

---

## 12. Limitations and Operational Notes

### `system.runtime.queries` retention

The in-memory query cache on the Presto coordinator is finite. On a busy cluster, queries older than a few minutes may no longer appear. For complete historical coverage, `wxd_system_data` (Source B) must be available and accessible to `PRESTO_USER`.

### `wxd_system_data` schema discovery

The schema name within `wxd_system_data` is cluster-specific (e.g. `dap-lite-diag-v3.0.0`). The backend discovers it at first call and caches it. If the schema changes (e.g. after a watsonx.data upgrade), restart the backend to clear `_wxd_diag_schema_cache`.

### CP4D token expiry

CP4D JWT tokens typically expire after **8–12 hours**. The module-level `_cpd_token_cache` is **not** refreshed automatically within a process lifetime. For long-running deployments, either:
- Set `PRESTO_BEARER_TOKEN` to a service-account token with a longer TTL, or
- Restart the backend process periodically to force a new token exchange.

### Row cap on returned data

`execute_query()` caps the `data` array at 500 rows (`rows[:500]`) for UI safety. The full `rowCount` is still returned so the audit event reflects the true number of rows scanned by Presto.

### Internal system queries

The history views include the audit retrieval queries themselves (the `SELECT … FROM system.runtime.queries` and `SELECT … FROM wxd_system_data.*` calls). These are visible in the raw data but tagged with `source = "watsonx-data-siem-demo"`, making them easy to filter downstream if needed.

### No `clientIp` from system tables

`system.runtime.queries` does not expose the original client IP address. The `clientIp` field in the SIEM event for history-sourced queries is **inferred heuristically** from the username pattern (`_infer_ip(user)`), not read from Presto. Only queries submitted through the `POST /api/siem/execute` endpoint carry a real client IP (supplied by the API caller in the request body).
