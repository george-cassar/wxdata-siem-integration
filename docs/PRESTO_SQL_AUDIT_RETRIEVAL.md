# Retrieving Executed SQL Details from Presto — Technical Reference

This document describes in detail how the **watsonx.data Presto ↔ SIEM Integration** project retrieves the details of all SQL statements executed on an IBM watsonx.data Presto/Trino coordinator, converts that raw query history into structured SIEM audit events, and exposes it through the backend API and WebSocket stream.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Authentication](#3-authentication)
4. [Audit Identity & Row-Level Security](#4-audit-identity--row-level-security)
5. [Query History Sources](#5-query-history-sources)
   - 5.1 [Source A — `system.runtime.queries`](#51-source-a--systemruntimequeries)
   - 5.2 [Source B — `wxd_system_data` persistent audit view](#52-source-b--wxd_system_data-persistent-audit-view)
6. [HTTP Transport — The Presto REST Protocol](#6-http-transport--the-presto-rest-protocol)
7. [Code Walkthrough](#7-code-walkthrough)
   - 7.1 [Configuration (`config.py`)](#71-configuration-configpy)
   - 7.2 [Token exchange (`presto_service.py`)](#72-token-exchange-presto_servicepy)
   - 7.3 [Submitting the history query (`_execute_via_httpx`)](#73-submitting-the-history-query-_execute_via_httpx)
   - 7.4 [Fetching and merging audit history (`fetch_live_audit_history`)](#74-fetching-and-merging-audit-history-fetch_live_audit_history)
   - 7.5 [Row-to-event conversion](#75-row-to-event-conversion)
   - 7.6 [Event enrichment pipeline](#76-event-enrichment-pipeline)
8. [SIEM Audit Event Schema](#8-siem-audit-event-schema)
9. [API Endpoints](#9-api-endpoints)
10. [WebSocket Incremental Polling](#10-websocket-incremental-polling)
11. [Risk Classification Logic](#11-risk-classification-logic)
12. [Catalog / Schema Extraction](#12-catalog--schema-extraction)
13. [Mock-mode Fallback](#13-mock-mode-fallback)
14. [Limitations and Operational Notes](#14-limitations-and-operational-notes)

---

## 1. Overview

Every SQL statement executed on a Presto/Trino coordinator is recorded in two system-level locations:

| Location | Retention | Coverage |
|---|---|---|
| `system.runtime.queries` | In-memory; cleared on coordinator restart | Live and recently completed queries |
| `wxd_system_data.<diag_schema>.query_completed_event_view` | Persistent (object storage) | All completed queries, survives restarts |

The backend queries **both sources concurrently**, deduplicates by `query_id`, and converts each row into a canonical SIEM audit event. The event carries the original SQL text, the authenticated user, client IP, catalog, schema, row/byte counts, execution duration, status (`FINISHED` / `FAILED`), and computed risk classification.

Both sources are queried using `X-Presto-User: <PRESTO_AUDIT_USER>` (default `ibmlhapiuser`) to bypass the per-user row-level security enforced by CP4D diagnostic views. Without this, only the queries of `PRESTO_USER` (e.g. `cpadmin`) would be returned.

---

## 2. Prerequisites

### 2.1 Presto / watsonx.data Connectivity

| Requirement | Notes |
|---|---|
| IBM watsonx.data instance | Cloud SaaS (IBM Cloud) or on-prem (IBM Cloud Pak for Data / CP4D) |
| Presto coordinator hostname | Find in the watsonx.data console under **Infrastructure → Connection details** |
| Port | `443` (IBM Cloud SaaS) or `8443` (on-prem CP4D) |
| TLS | All connections use HTTPS; set `PRESTO_SSL_VERIFY=false` for self-signed certificates |
| Auth user | `PRESTO_USER` must have `SELECT` privilege on `system.runtime.queries` and `wxd_system_data.*` |
| Audit user | `PRESTO_AUDIT_USER` (default `ibmlhapiuser`) must have global visibility in `wxd_system_data` diagnostic views |

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
PRESTO_USER=cpadmin
PRESTO_PASSWORD=<cp4d-password>
# --- OR ---
PRESTO_BEARER_TOKEN=<pre-obtained-jwt-token>

# Optional: separate CP4D console host if different from Presto coordinator
PRESTO_CPD_HOST=

# Audit identity — must have global visibility in wxd_system_data
PRESTO_AUDIT_USER=ibmlhapiuser

# How many hours of history to fetch per cycle (default 24)
AUDIT_HISTORY_HOURS=24
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
  -d '{"username":"cpadmin","password":"<password>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
```

Paste the result as `PRESTO_BEARER_TOKEN=<token>` in `.env`.

---

## 4. Audit Identity & Row-Level Security

On watsonx.data CP4D, the `wxd_system_data` diagnostic view and `system.runtime.queries` apply **row-level security (RLS) based on the `X-Presto-User` request header**. Each request returns only rows where `user = X-Presto-User`, regardless of the Bearer token's privilege level.

This means:
- Sending `X-Presto-User: cpadmin` returns only `cpadmin`'s own queries.
- Sending `X-Presto-User: ibmlhapiuser` returns **all** users' queries — including LDAP-authenticated users such as `prueba-user1`.

The application separates authentication from audit identity:

| Header | Value | Purpose |
|---|---|---|
| `Authorization: Bearer <token>` | Token for `PRESTO_USER` (e.g. `cpadmin`) | Authenticates the HTTP request |
| `X-Presto-User` | `PRESTO_AUDIT_USER` (default `ibmlhapiuser`) | Session identity evaluated by row-level policies |

For **audit history queries** (`SHOW SCHEMAS`, `system.runtime.queries`, `wxd_system_data` history), `X-Presto-User` is set to `settings.PRESTO_AUDIT_USER`. For **user-submitted queries** (`POST /api/siem/execute`), `X-Presto-User` is set to the user supplied in the request body.

> **If `ibmlhapiuser` does not have access on your deployment**, set `PRESTO_AUDIT_USER` to any user that holds the `Metastore Admin` or `Data Access` role in CP4D.

---

## 5. Query History Sources

### 5.1 Source A — `system.runtime.queries`

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
| `source` | `varchar` | Client tag (e.g. `watsonx-data-siem-demo`, `jdbc`, `wxd-sql`) |
| `created` | `timestamp` | Wall-clock time the query was received |
| `end` | `timestamp` | Wall-clock time the query completed (NULL for running) |
| `query` | `varchar` | Full SQL statement text |

> **Retention note:** `system.runtime.queries` is held entirely in coordinator memory. Entries are evicted when the coordinator restarts or the internal cache fills. For persistent coverage use Source B.

The query is executed with `catalog="system"`, `schema="runtime"`, and `user=audit_user` so the session headers reflect the correct namespace and the RLS policy returns all users' queries.

### 5.2 Source B — `wxd_system_data` persistent audit view

IBM watsonx.data CP4D persists completed query events to object storage and exposes them through a catalog called `wxd_system_data`. The specific schema name within this catalog is environment-dependent (it contains the cluster or deployment identifier), so the backend **auto-discovers** it at startup with a single `SHOW SCHEMAS FROM wxd_system_data` call (issued as `audit_user`) and caches the result in `_wxd_diag_schema_cache` for the lifetime of the process.

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
WHERE create_time >= NOW() - INTERVAL '<AUDIT_HISTORY_HOURS>' HOUR
LIMIT {fetch_limit}
```

| Column | Type | Meaning |
|---|---|---|
| `query_id` | `varchar` | Same coordinator-assigned ID as Source A |
| `query_state` | `varchar` | `FINISHED`, `FAILED` |
| `user` | `varchar` | Authenticated identity |
| `source` | `varchar` | Client tag (e.g. `wxd-sql`, `wxd-system`, `jdbc`) |
| `create_time` | `timestamp` | Query start time |
| `end_time` | `timestamp` | Query end time |
| `wallTimeMillis` | `bigint` | Elapsed wall-clock time in milliseconds |
| `catalog` | `varchar` | Target catalog (may be NULL for DDL / metadata queries) |
| `schema` | `varchar` | Target schema |
| `query` | `varchar` | Full SQL statement text |
| `total_rows` | `bigint` | Rows produced by the query |
| `total_bytes` | `bigint` | Bytes read from object storage |
| `error_code` | `varchar` | Presto error name (e.g. `PERMISSION_DENIED`) |
| `failure_message` | `varchar` | Human-readable failure reason |

#### Why `WHERE create_time >= NOW() - INTERVAL N HOUR` instead of bare `LIMIT`

A `LIMIT N` without `WHERE` on an ORC-backed table returns the **physically first** N rows written — typically the oldest records. Queries executed recently fall in later ORC files and are silently excluded.

The time-bounded `WHERE` clause:
1. Tells Presto to scan only the recent time partition — completes in ~2–3 s regardless of total table size.
2. Guarantees that all queries visible in the Presto UI (which are recent by definition) are included.
3. The window is controlled by `AUDIT_HISTORY_HOURS` (default 24 h, overridable via `.env`).
4. Client-side Python sort (`events.sort(key=..., reverse=True)`) produces newest-first order without an expensive `ORDER BY` in Presto.

---

## 6. HTTP Transport — The Presto REST Protocol

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
X-Presto-User:    <audit_user or caller-supplied user>
X-Presto-Catalog: <catalog>
X-Presto-Schema:  <schema>
X-Presto-Source:  <PRESTO_SOURCE_TAG>   (default: watsonx-data-siem-demo)
Content-Type:     text/plain
Authorization:    Bearer <cpd-token>    ← omitted when no token available
```

All header values are configurable via environment variables. No string is hardcoded in `_build_headers`.

### Poll Loop Details

```python
# Simplified from _execute_via_httpx
wall_deadline = time.time() + settings.PRESTO_POLL_WALL_LIMIT_S  # default 75 s

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
        # Hard wall-clock guard — abort before the browser axios timeout fires
        if time.time() >= wall_deadline:
            break
        # Reconstruct absolute URI — some CP4D builds return path-only nextUri
        if not next_uri.startswith("http"):
            next_uri = f"{base_url}{next_uri}"
        await asyncio.sleep(settings.PRESTO_POLL_INTERVAL_S)  # default 0.2 s
        resp = await client.get(next_uri, headers=headers)
        data = resp.json()
```

A **hard wall-clock budget** of `PRESTO_POLL_WALL_LIMIT_S` seconds (default 75 s) aborts the loop before the browser's axios 90-second timeout fires, returning partial results with the current `state`.

An **early-exit optimisation** (`row_limit`) stops following `nextUri` as soon as the number of accumulated rows matches the SQL `LIMIT N` clause, avoiding full pagination over large result sets.

---

## 7. Code Walkthrough

### 7.1 Configuration (`config.py`)

All connectivity settings are declared as Pydantic `BaseSettings` fields in [`backend/config.py`](../backend/config.py). They are loaded from environment variables (or `.env`) at import time. No value is hardcoded:

```python
DEMO_MODE               # "mock" | "live"
PRESTO_HOST             # coordinator hostname
PRESTO_PORT             # 443 or 8443
PRESTO_USER             # user whose Bearer token authenticates HTTP requests
PRESTO_PASSWORD         # exchanged for CP4D token if PRESTO_BEARER_TOKEN absent
PRESTO_BEARER_TOKEN     # pre-obtained JWT (preferred)
PRESTO_CPD_HOST         # CP4D console host for token exchange (defaults to PRESTO_HOST)
PRESTO_CATALOG          # session default catalog
PRESTO_SCHEMA           # session default schema
PRESTO_USE_SSL          # bool — enables HTTPS
PRESTO_SSL_VERIFY       # bool — set false for self-signed certificates
PRESTO_SOURCE_TAG       # X-Presto-Source header value (default: watsonx-data-siem-demo)
PRESTO_AUDIT_USER       # X-Presto-User for audit/system queries (default: ibmlhapiuser)
PRESTO_POLL_WALL_LIMIT_S# hard wall-clock limit for httpx polling loop (default: 75)
PRESTO_POLL_INTERVAL_S  # sleep between nextUri polls (default: 0.2)
PRESTO_MAX_ROWS_UI      # max rows returned to UI per query (default: 500)
AUDIT_HISTORY_HOURS     # hours of history fetched per cycle (default: 24)
ENGINE_VERSION          # engine string in SIEM events (default: Presto (Java) 0.286)
CLUSTER_NAME            # cluster label in SIEM events (defaults to first segment of PRESTO_HOST)
CPU_TIME_MULTIPLIER     # multiplier for cpuTimeMs estimate (default: 1.8)
SIEM_VENDOR             # LEEF/CEF vendor string (default: IBM)
SIEM_PRODUCT            # LEEF/CEF product string (default: watsonx.data)
SIEM_PRODUCT_VERSION    # LEEF product version (default: 2.0.1)
SIEM_CEF_SQL_SNIPPET_LEN# max SQL chars in CEF msg field (default: 120)
```

### 7.2 Token exchange (`presto_service.py`)

`_get_cpd_token()` (module-level, called from `_build_headers`) resolves the bearer token using the priority chain described in [Section 3](#3-authentication). In mock mode it returns `None` immediately and no `Authorization` header is added.

### 7.3 Submitting the history query (`_execute_via_httpx`)

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

### 7.4 Fetching and merging audit history (`fetch_live_audit_history`)

`fetch_live_audit_history(limit, only_new)` in [`backend/services/watsonx_data_service.py`](../backend/services/watsonx_data_service.py) is the primary public function. It:

1. **Guards against mock mode** — returns `[]` if `DEMO_MODE != "live"`.
2. **Resolves the audit user** — `audit_user = settings.PRESTO_AUDIT_USER or settings.PRESTO_USER`.
3. **Discovers the `wxd_system_data` diagnostic schema** (once per process, cached in `_wxd_diag_schema_cache`), issued as `audit_user`.
4. **Fires both sources concurrently** via `asyncio.gather(fetch_runtime(), fetch_wxd_history())`, both as `audit_user`.
5. **Merges and deduplicates** by `queryId` — `wxd_events` wins deduplication because they carry richer metrics.
6. **Sorts newest-first** in Python and trims to `limit`.
7. **Filters for new-only** when `only_new=True` (WebSocket polling mode) using the module-level `_seen_query_ids` set.

```python
audit_user = settings.PRESTO_AUDIT_USER or settings.PRESTO_USER

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

### 7.5 Row-to-event conversion

Two separate converters handle the different column sets from each source:

| Function | Source | Key column differences |
|---|---|---|
| `_row_to_event(row, columns)` | `system.runtime.queries` | `state`, `created`, `end` |
| `_wxd_row_to_event(row, columns)` | `wxd_system_data` view | `query_state`, `create_time`, `end_time`, `wallTimeMillis`, `total_rows`, `total_bytes`, `failure_message` |

Both converters:
1. Extract fields by column name using an inner `col(name, default)` helper that handles missing columns gracefully.
2. Parse timestamps with `_parse_ts()` which tries multiple ISO 8601 / Presto datetime formats.
3. Call `_assess_risk()` to produce `(risk_level, category, rows_estimate, bytes_estimate)`.
4. Call `_extract_catalog_schema()` to resolve catalog/schema from SQL text if the view column is NULL or an internal system path.
5. Delegate to `_build_event()` which assembles the canonical event dict.

### 7.6 Event enrichment pipeline

`_build_event()` produces the final event dict. During assembly it calls:

| Helper | Purpose |
|---|---|
| `_infer_role(user)` | Maps username patterns to human-readable role strings — includes `"prueba"` → `"LDAP User"` and `"ldap"` → `"LDAP User"` for CP4D LDAP-authenticated users |
| `_infer_ip(user)` | Returns a deterministic internal IP for known user patterns; uses a hash for unknown users |
| `_infer_query_type(sql_u)` | Classifies the statement as `SELECT`, `DROP`, `INSERT`, `AGGREGATION`, `EXFILTRATION`, `METADATA`, etc. |
| `format_as_leef(event)` | Serialises the event to IBM QRadar LEEF 2.0 wire format (vendor/product from `SIEM_VENDOR`/`SIEM_PRODUCT`) |
| `format_as_cef(event)` | Serialises the event to ArcSight CEF wire format; severity mapped from `riskLevel`; SQL truncated to `SIEM_CEF_SQL_SNIPPET_LEN` |

The two SIEM payload strings (`leefPayload`, `cefPayload`) are embedded into the event dict alongside all structured fields.

---

## 8. SIEM Audit Event Schema

Every row from Presto is converted into the following canonical dict (all fields are always present; `null` when not applicable):

| Field | Type | Source |
|---|---|---|
| `eventId` | `string (UUID)` | Generated at conversion time |
| `queryId` | `string` | Coordinator-assigned ID from `query_id` column |
| `engine` | `string` | `ENGINE_VERSION` setting (default `Presto (Java) 0.286`) |
| `cluster` | `string` | `CLUSTER_NAME` setting, or first segment of `PRESTO_HOST` |
| `timestamp` | `ISO 8601` | Query end time |
| `createdTime` | `ISO 8601` | Query start / created time |
| `endTime` | `ISO 8601` | Query end time |
| `durationMs` | `integer` | Wall-clock execution time in ms |
| `cpuTimeMs` | `integer` | Estimated CPU time (`durationMs × CPU_TIME_MULTIPLIER`) |
| `user` | `string` | Presto `user` column (the actual query submitter — not the audit user) |
| `userRole` | `string` | Inferred from username pattern via `_infer_role()` |
| `clientIp` | `string` | Inferred from username pattern via `_infer_ip()` |
| `source` | `string` | Presto `source` tag (e.g. `wxd-sql`, `wxd-system`, `jdbc`) |
| `catalog` | `string` | Resolved from view column or parsed from SQL |
| `schema` | `string` | Resolved from view column or parsed from SQL |
| `sqlText` | `string` | Full SQL statement |
| `queryType` | `string` | `SELECT`, `DROP`, `AGGREGATION`, `EXFILTRATION`, `METADATA`, etc. |
| `category` | `string` | Threat/behavioural category (e.g. `"Mass PII Exfiltration"`, `"Metadata Introspection"`) |
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

## 9. API Endpoints

The FastAPI router in [`backend/routers/siem.py`](../backend/routers/siem.py) exposes the following endpoints that surface Presto SQL execution data:

### `GET /api/siem/events?limit=N`

Returns up to `N` recent audit events.

- **Live mode**: **always** calls `fetch_live_audit_history(limit)` on every request so new queries are surfaced immediately without restarting the backend.
- **Mock mode**: seeds from `get_initial_history(limit)` (Faker synthetic events) once, then serves from memory.
- Events are evaluated against correlation rules and stored in `siem_engine.events` (in-process ring buffer, max `SIEM_EVENT_BUFFER_SIZE` entries).

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
  "auditEvent": { "<full event schema>" },
  "triggeredOffense": null,
  "source": "live"
}
```

The `source` field is `"live"` when the query ran on a real Presto coordinator, `"simulated"` otherwise.

### `GET /api/config`

Returns the backend-configured frontend defaults (default user, IP, SQL, ring-buffer sizes). The Query Studio page fetches this on mount so no frontend value is hardcoded.

### `GET /api/siem/summary`

Returns SIEM dashboard KPIs (total events, offenses, bytes scanned, events-per-second). In live mode all figures are derived purely from real Presto data. In mock mode configurable baseline values (`MOCK_BASELINE_EVENTS`, `MOCK_BASELINE_BYTES`, `MOCK_BASELINE_ROWS`) are added for demo realism.

### `POST /api/siem/reset`

Clears the in-memory event and offense store, then re-seeds it with the latest Presto audit history (or synthetic fallback).

---

## 10. WebSocket Incremental Polling

The WebSocket endpoint `ws://localhost:8000/api/siem/ws` provides real-time event streaming. In live mode it polls Presto every **8 seconds** using `fetch_live_audit_history(limit=50, only_new=True)`.

The `only_new=True` flag activates the incremental filter:

```python
# watsonx_data_service.py
if only_new:
    new_events = [e for e in merged if e.get("queryId") not in _seen_query_ids]
    # Accumulate seen IDs — never replace — so old events are not re-delivered
    _seen_query_ids.update(e.get("queryId") for e in merged)
    return new_events
```

**Key design decisions:**

- `_seen_query_ids` **accumulates** (`.update()`) rather than replacing on each incremental poll, preventing old events from being rediscovered.
- The first **full refresh** (`only_new=False`, e.g. on `GET /events`) does **not** pre-seed `_seen_query_ids` if it is empty. This ensures the first WebSocket poll after startup correctly reports all current events as new.
- Subsequent full refreshes (e.g. after `POST /api/siem/reset`) do update `_seen_query_ids` to the current result set.

New events are pushed to connected browser clients as:

```json
{
  "type": "NEW_EVENT",
  "event": { "<full event schema>" },
  "offense": null
}
```

---

## 11. Risk Classification Logic

Every SQL statement (regardless of source) is classified by `_assess_risk(sql_u, state)` which returns `(risk_level, category, rows_estimate, bytes_estimate)`. The rules apply in priority order:

| Priority | Condition | Risk | Category |
|---|---|---|---|
| 1 | `DROP`, `ALTER`, or `TRUNCATE` in SQL | `HIGH` | `Unauthorized DDL Attempt` |
| 2 | Starts with `SHOW`, `DESCRIBE`, `EXPLAIN`, or contains `INFORMATION_SCHEMA` | `LOW` | `Metadata Introspection` |
| 3 | Starts with `CREATE` | `LOW` | `DDL Object Creation` |
| 4 | (`SSN` or `CREDIT_CARD` or `CUSTOMER_ACCOUNTS`) AND `SELECT *` | `CRITICAL` | `Mass PII Exfiltration` |
| 5 | `WHERE 1=1` OR (`SELECT *` with no `LIMIT`) | `MEDIUM` | `Unbounded Table Scan` |
| 6 | `KYC`, `COMPLIANCE`, or `GDPR` in SQL | `MEDIUM` | `Restricted Compliance Table Access` |
| 7 | `GROUP BY`, `SUM(`, `AVG(`, or `COUNT(` | `LOW` | `BI Report Aggregation` |
| 8 | *(default)* | `LOW` | `Standard Analytics` |

Note: `SHOW CREATE TABLE` and `information_schema` queries (e.g. from the watsonx.data Query Workspace column browser) are correctly classified as `Metadata Introspection` (priority 2) rather than falling to `Standard Analytics`.

Risk classification happens independently of the SIEM correlation rules. The SIEM rules in [`backend/services/siem_service.py`](../backend/services/siem_service.py) use the classified event fields (plus `rowsScanned`, `bytesScanned`, `status`, `clientIp`) to decide whether to raise an offense.

---

## 12. Catalog / Schema Extraction

`_extract_catalog_schema(sql)` resolves `(catalog, schema)` from a SQL statement in priority order:

1. **Quoted three-part identifier** — `"catalog"."schema"."table"` — skips internal system names (`information_schema`, `system`, `jmx`, `tpcds`, `tpch`).
2. **Unquoted three-part identifier** — `catalog.schema.table` — same skip rule.
3. **`information_schema` WHERE clause** — searches for `table_catalog = 'x'` and `table_schema = 'y'` string literals in the `WHERE` clause. This handles introspection queries issued by the watsonx.data Query Workspace column browser:
   ```sql
   SELECT column_name ... FROM information_schema.columns
   WHERE table_catalog = 'lab_catalog01' AND table_schema = 'retail'
   ```
4. **Session defaults** — `PRESTO_CATALOG` / `PRESTO_SCHEMA` from environment.

---

## 13. Mock-mode Fallback

The entire live path is bypassed when `DEMO_MODE=mock` (or when `PRESTO_HOST` is `localhost`/`127.0.0.1`). The following substitutions apply:

| Live path | Mock fallback |
|---|---|
| `fetch_live_audit_history()` | Returns `[]`; caller uses `get_initial_history()` (Faker) |
| `PrestoExecutor.execute_query()` | Calls `_simulate()` returning deterministic synthetic rows |
| `list_catalogs()` | Returns `["iceberg_data", "hive_lake", "system"]` |
| `list_schemas(catalog)` | Returns `_synthetic_schemas(catalog)` |

The backend **never raises an exception to the caller** due to Presto being unreachable. Every live call is wrapped in a `try/except` that logs a warning and returns `[]` or the simulated result.

---

## 14. Limitations and Operational Notes

### `system.runtime.queries` retention

The in-memory query cache on the Presto coordinator is finite. On a busy cluster, queries older than a few minutes may no longer appear. For complete historical coverage, `wxd_system_data` (Source B) must be available and accessible.

### `wxd_system_data` schema discovery

The schema name within `wxd_system_data` is cluster-specific (e.g. `dap-lite-diag-v3.0.0`). The backend discovers it at first call and caches it. If the schema changes (e.g. after a watsonx.data upgrade), restart the backend to clear `_wxd_diag_schema_cache`.

### `PRESTO_AUDIT_USER` visibility requirement

`ibmlhapiuser` is the built-in CP4D service account that bypasses per-user row-level security in diagnostic views. If this account has been removed, restricted, or renamed on your deployment, set `PRESTO_AUDIT_USER` to any user with `Metastore Admin` or `Data Access` privileges. Setting it to the same value as `PRESTO_USER` will revert to showing only that user's own queries.

### CP4D token expiry

CP4D JWT tokens typically expire after **8–12 hours**. The module-level `_cpd_token_cache` is **not** refreshed automatically within a process lifetime. For long-running deployments, either:
- Set `PRESTO_BEARER_TOKEN` to a service-account token with a longer TTL, or
- Restart the backend process periodically to force a new token exchange.

### Row cap on returned data

`execute_query()` caps the `data` array at `PRESTO_MAX_ROWS_UI` rows (default 500) for UI safety. The full `rowCount` is still returned so the audit event reflects the true number of rows scanned by Presto.

### Internal system queries

The history views include the audit retrieval queries themselves (the `SELECT … FROM system.runtime.queries` and `SELECT … FROM wxd_system_data.*` calls). These are visible in the raw data but tagged with `source = PRESTO_SOURCE_TAG` (default `"watsonx-data-siem-demo"`), making them easy to filter downstream if needed.

### No `clientIp` from system tables

`system.runtime.queries` does not expose the original client IP address. The `clientIp` field in the SIEM event for history-sourced queries is **inferred heuristically** from the username pattern (`_infer_ip(user)`), not read from Presto. Only queries submitted through the `POST /api/siem/execute` endpoint carry a real client IP (supplied by the API caller in the request body).
