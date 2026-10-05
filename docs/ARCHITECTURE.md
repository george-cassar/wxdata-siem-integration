# Architecture Specification: watsonx.data Presto ⟷ SIEM Integration

## 1. Solution Overview
This solution provides continuous, low-latency, and zero-impact query audit logging for **IBM watsonx.data** (Presto Java engine), streaming structured audit events into Enterprise SIEM platforms (**IBM QRadar**, **Splunk**, **Microsoft Sentinel**, or **Elastic**).

The demo runs **fully locally** on a developer workstation (Vite dev server on port 3000 + FastAPI/uvicorn on port 8000). In **mock mode**, all data is synthetic (Faker, seed=42). In **live mode**, the backend connects to a remote watsonx.data Presto coordinator via HTTPS to execute real queries and pull real audit history from `system.runtime.queries` and `wxd_system_data`.

```mermaid
graph TD
    subgraph LOCAL["Developer Workstation (Local)"]
        direction TB
        Frontend["React Frontend
Vite Dev Server :3000
Carbon Design System UI"]
        Backend["FastAPI Backend
Uvicorn :8000
Mock + Live Services"]
        PrestoExecutor["PrestoExecutor
(trino / httpx REST client)"]
        SIEMEngine["SIEM Engine
(Correlation Rules + Event Store)"]
        SyntheticData["Synthetic Data Service
(Faker, seed=42)"]
        Frontend <-->|Vite proxy /api →:8000| Backend
        Backend <--> PrestoExecutor
        Backend <--> SIEMEngine
        Backend <--> SyntheticData
    end

    subgraph REMOTE["watsonx.data Presto (Remote)")
        PrestoCoord["Presto Java Coordinator
Port 443 / 8443"]
        Catalog["Apache Iceberg / Hive
Metadata Catalog"]
        PrestoWorkers["Presto Worker Nodes
(Distributed Execution)"]
    end

    subgraph SIEM["Enterprise SIEM
(IBM QRadar / Splunk / Sentinel)"]
        Ingress["SIEM Ingestion Gateway
Syslog TLS 6514 / REST API"]
        Parser["LEEF/CEF Universal DSM Parser"]
        CRE["Correlation Rules Engine
Exfiltration & Privilege Alerts"]
        SOC["SOC Dashboard & IR"]
    end

    PrestoExecutor -->|HTTPS / trino REST| PrestoCoord
    PrestoExecutor -->|HTTPX REST polling| PrestoCoord
    PrestoCoord -->|Query Lifecycle Event
(EventListener SPI)| Backend
    Backend -->|system.runtime.queries
X-Presto-User: ibmlhapiuser| PrestoCoord
    Backend -->|wxd_system_data audit view
X-Presto-User: ibmlhapiuser| PrestoCoord
    PrestoCoord --> PrestoWorkers --> Catalog

    SIEMEngine -->|LEEF 2.0 / CEF| Ingress
    Ingress --> Parser --> CRE --> SOC

    classDef localFill fill:#161616,stroke:#393939,color:#f4f4f4;
    classDef remoteFill fill:#0f62fe,stroke:#0f62fe,color:#ffffff;
    classDef siemFill fill:#6929c4,stroke:#6929c4,color:#ffffff;
    class Frontend,Backend,PrestoExecutor,SIEMEngine,SyntheticData localFill;
    class PrestoCoord,PrestoWorkers,Catalog,REMOTE remoteFill;
    class Ingress,Parser,CRE,SOC,SIEM siemFill;
```

## 2. Local Development Architecture

### Data Flow

1. **User submits SQL** via the Query Studio page (React + Carbon UI, port 3000)
2. **Vite dev proxy** forwards `/api` requests to the FastAPI backend (port 8000)
3. **Backend executes the query**:
   - **Mock mode**: `PrestoExecutor._simulate()` returns deterministic simulated results
   - **Live mode**: `PrestoExecutor` connects to the remote watsonx.data Presto coordinator via HTTPS using the Trino Python client or raw Presto REST polling (httpx)
4. **Audit event generation**: Every query (real or simulated) is converted into a structured SIEM audit event with user, IP, catalog, schema, SQL text, row/byte counts, execution duration, status (`FINISHED` / `FAILED`), and computed risk classification
5. **SIEM correlation**: `SIEMEngine.evaluate_event()` evaluates each event against 4 correlation rules and triggers offenses when thresholds are exceeded
6. **LEEF/CEF formatting**: Events are formatted into IBM LEEF 2.0 (for QRadar) and CEF (for Splunk/Sentinel) wire formats; vendor, product, version, and snippet lengths are all configurable via environment variables
7. **WebSocket streaming**: A live WebSocket (`/api/siem/ws`) pushes new events and offenses to the frontend in real time; the `_seen_query_ids` set prevents re-delivery of already-pushed events
8. **SIEM delivery** (optional): When `SIEM_FORWARD_HOST` is set, formatted events are forwarded via syslog to the configured SIEM

### Component Inventory

| Component | Location | Responsibility |
| :--- | :--- | :--- |
| React Frontend | `frontend/src/` | Carbon Design System UI, Vite dev server, API client (`api.js`) |
| FastAPI Backend | `backend/main.py` | Entry point, CORS, router registration |
| Health Router | `backend/routers/health.py` | `/api/health` — mode, version, Presto connection status; `/api/config` — frontend defaults |
| SIEM Router | `backend/routers/siem.py` | `/api/siem/*` — events, offenses, rules, catalog, execute, WebSocket |
| Scenarios Router | `backend/routers/scenarios.py` | `/api/scenarios` — 3 preset demo scenarios (SQL uses `PRESTO_CATALOG`/`PRESTO_SCHEMA` from env) |
| PrestoExecutor | `backend/services/presto_service.py` | Trino/httpx client; dual-mode (mock/live); CP4D bearer token exchange |
| SIEMEngine | `backend/services/siem_service.py` | Correlation rules engine, event store, offense tracking (all thresholds and buffers configurable) |
| SyntheticDataService | `backend/services/synthetic_data_service.py` | Faker-based (seed=42) mock audit events, LEEF/CEF formatting |
| watsonxDataService | `backend/services/watsonx_data_service.py` | Live catalog discovery, time-bounded audit history extraction, row-level security bypass via `PRESTO_AUDIT_USER` |
| DemoContext | `frontend/src/context/DemoContext.jsx` | Global state (summary, events, offenses, scenarios, WebSocket); ring-buffer sizes loaded from `/api/config` |

## 3. Audit Identity & Row-Level Security

On watsonx.data CP4D, the `wxd_system_data` diagnostic view and `system.runtime.queries` apply **row-level security based on the `X-Presto-User` request header** — only rows where `user = X-Presto-User` are returned, regardless of the Bearer token's privilege level.

The application separates two concerns:

| Header | Purpose | Controlled by |
|---|---|---|
| `Authorization: Bearer <token>` | Authenticates the HTTP request | `PRESTO_USER` / `PRESTO_PASSWORD` / `PRESTO_BEARER_TOKEN` |
| `X-Presto-User` | Session identity evaluated by row-level policies | `PRESTO_AUDIT_USER` (audit queries) or caller-supplied (execute queries) |

For **audit history queries** (`SHOW SCHEMAS`, `system.runtime.queries`, `wxd_system_data` history), the `X-Presto-User` header is set to `PRESTO_AUDIT_USER` (default `ibmlhapiuser`), which is the built-in CP4D service account with global visibility. This ensures all users' queries (including LDAP-authenticated users) are returned.

For **user-submitted queries** (`POST /api/siem/execute`), `X-Presto-User` is set to the user supplied in the request body, preserving the intended identity for access control.

## 4. Event Interception Mechanisms

### Approach 1: Presto EventListener SPI (Recommended for Production)
Presto provides a native Java Service Provider Interface (`EventListenerFactory`). When configured on the coordinator, Presto asynchronously pushes `QueryCreatedEvent`, `QueryCompletedEvent`, and `SplitCompletedEvent` objects to the registered listener.

- **Latency**: Sub-second (≈ 10–50 ms)
- **Overhead**: Negligible; listener callbacks execute on dedicated background worker pools
- **Demo simulation**: The backend's `watsonxDataService` polls `system.runtime.queries` and `wxd_system_data` as the functional equivalent of what the EventListener would emit

### Approach 2: Query History Monitoring & Management (QHMM)
watsonx.data persists query diagnostic history into object storage tables exposed through the `wxd_system_data` catalog. The backend polls the `query_completed_event_view` at 8-second WebSocket intervals.

- **Latency**: 8–16 seconds (WebSocket poll cycle)
- **History window**: Configurable via `AUDIT_HISTORY_HOURS` (default 24 h); uses `WHERE create_time >= NOW() - INTERVAL N HOUR` to scope the scan efficiently

## 5. SIEM Payload Formats & Mapping

### IBM QRadar LEEF 2.0 Standard

The LEEF header vendor, product, and version strings are configurable via `SIEM_VENDOR`, `SIEM_PRODUCT`, and `SIEM_PRODUCT_VERSION`.

```text
LEEF:2.0|IBM|watsonx.data|2.0.1|QueryExecution|
devTime=2025-02-15T14:30:10Z	usrName=analyst_sarah	src=10.244.12.45	identSrc=Presto (Java) 0.286
queryId=20250215_143010_00124_wxdcoord1	catalog=iceberg_data	schema=finance
action=SELECT	status=FINISHED	durationMs=120	rowsProcessed=100	bytesScanned=85000	riskLevel=LOW
sqlText=SELECT * FROM iceberg_data.finance.transactions WHERE transaction_date >= CURRENT_DATE - INTERVAL '7' DAY
```

### Key Field Mapping:
| watsonx.data / Presto Field | QRadar LEEF Attribute | Splunk / CEF Field | Description |
| :--- | :--- | :--- | :--- |
| `queryId` | `queryId` | `cs1` | Unique Presto query execution identifier |
| `user` | `usrName` | `suser` | Authenticated identity / Service Account |
| `clientIp` | `src` | `src` | Source client IP address |
| `catalog` & `schema` | `catalog`, `schema` | `cs2` | Lakehouse target namespace |
| `sqlText` | `sqlText` | `msg` (first `SIEM_CEF_SQL_SNIPPET_LEN` chars) | Raw / sanitized SQL statement |
| `rowsScanned` | `rowsProcessed` | `cn1` | Total rows processed by engine |
| `bytesScanned` | `bytesScanned` | `cn2` | Total bytes read from object storage |
| `status` | `status` | `cs3` | `FINISHED`, `FAILED`, `CANCELED` |

### CEF Severity Mapping

CEF severity is derived from the event's `riskLevel`:

| `riskLevel` | CEF Severity |
|---|---|
| `LOW` | `1` |
| `MEDIUM` | `5` |
| `HIGH` | `7` |
| `CRITICAL` | `10` |

## 6. Correlation Rules & Threat Detection

All numeric thresholds are configurable via environment variables — no values are hardcoded.

1. **Rule 1001 (Mass Data Exfiltration - MITRE T1005):** Single query scanning > `RULE_EXFIL_ROW_THRESHOLD` rows (default 100,000) or > `RULE_EXFIL_BYTES_THRESHOLD` bytes (default 50 MB) against customer/PII tables.
2. **Rule 1002 (Unauthorized DDL / Destruction - MITRE T1485):** Unauthorized `DROP`, `ALTER`, or `TRUNCATE` attempts resulting in `PERMISSION_DENIED`.
3. **Rule 1003 (Suspicious Off-Hours / Anomalous IP - MITRE T1078):** Queries from untrusted IP ranges (`192.168.100.*`) against compliance/KYC catalogs.
4. **Rule 1004 (Unbounded Table Scan / Resource Exhaustion - MITRE T1499):** Full table scans executing with `WHERE 1=1` without partition filters or LIMIT clauses.

## 7. Risk Classification Logic

Every SQL statement is classified by `_assess_risk(sql_u, state)` in priority order:

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

## 8. Catalog / Schema Extraction

`_extract_catalog_schema(sql)` resolves `(catalog, schema)` from a SQL statement in priority order:

1. **Quoted three-part identifier** — `"catalog"."schema"."table"` (skips internal names like `information_schema`)
2. **Unquoted three-part identifier** — `catalog.schema.table` (same skip rule)
3. **`information_schema` WHERE clause** — `WHERE table_catalog = 'x' AND table_schema = 'y'` (covers `SHOW CREATE TABLE` introspection queries from the watsonx.data Query Workspace)
4. **Session defaults** — `PRESTO_CATALOG` / `PRESTO_SCHEMA` from environment

## 9. Security Architecture

- **Authentication**: CP4D/watsonx.data Presto accepts only `Authorization: Bearer <cpd-token>`. The backend exchanges `PRESTO_USER` + `PRESTO_PASSWORD` for a CP4D token via `POST /icp4d-api/v1/authorize`, or accepts a pre-obtained `PRESTO_BEARER_TOKEN`.
- **Audit identity**: All audit/system queries use `X-Presto-User: <PRESTO_AUDIT_USER>` (default `ibmlhapiuser`) to bypass per-user row-level security and surface all users' query history. The Bearer token is unchanged.
- **TLS**: All Presto connections use HTTPS/TLS. `PRESTO_SSL_VERIFY` can be set to `false` for self-signed certificates in demo environments.
- **No hardcoded values**: Every credential, threshold, vendor string, and default is supplied via environment variables. The source code contains no hardcoded secrets, IPs, user names, or catalog names.
- **No data exfiltration**: The application only reads query **metadata** (user, duration, SQL text, row counts) from `system.runtime.queries` — no table row data is stored.
- **CORS**: The backend allows requests from `localhost:3000` (Vite dev) and `localhost:5173` (Vite preview).

## 10. Deployment Architecture
The demo is designed to run **locally** for demonstration purposes:

```
┌─────────────────────────────────────────────────────────┐
│  Developer Workstation (Local)                          │
│                                                         │
│  ┌──────────────────┐       ┌──────────────────────┐    │
│  │  React frontend  │ ←───→ │  FastAPI backend     │    │
│  │  localhost:3000  │  /api │  localhost:8000      │    │
│  │  (Vite dev proxy)│       │  (uvicorn)           │    │
│  └──────────────────┘       └──────────┬───────────┘    │
│                                        │ HTTPS/TLS      │
└────────────────────────────────────────│────────────────┘
                                         │
                              ┌──────────▼───────────────┐
                              │  IBM watsonx.data Presto │
                              │  (remote SaaS / on-prem) │
                              │  port 443 or 8443        │
                              └──────────────────────────┘
```

The **Vite dev proxy** (`vite.config.js`) forwards all `/api` requests and the WebSocket (`/api/siem/ws`) from the browser to the local backend — no CORS issues, no extra configuration.

## 11. NFRs
| Requirement | Target | How Met |
| :--- | :--- | :--- |
| Audit coverage | 100% of queries | EventListener SPI or `system.runtime.queries` + `wxd_system_data` polling |
| All-user visibility | All users, including LDAP | `X-Presto-User: ibmlhapiuser` bypasses per-user RLS on diagnostic views |
| Event delivery latency | < 2 seconds | Asynchronous EventListener + TLS forwarding |
| Presto CPU overhead | < 1.5% | EventListener callbacks on background threads; time-bounded `WHERE create_time` scan |
| Demo startup time | < 10 seconds | Mock mode with pre-seeded synthetic data |
| Browser support | Chrome/Firefox/Safari (latest) | Carbon Design System v11, WCAG 2.1 AA |
| Data privacy | No PII stored | Synthetic data only (Faker seed=42); live mode reads metadata only |

## 12. IBM Product Versions
| Product | Version | Purpose |
| :--- | :--- | :--- |
| IBM watsonx.data (Presto) | Configurable via `ENGINE_VERSION` (default `Presto (Java) 0.286`) | Lakehouse query engine with audit event emission |
| IBM QRadar | LEEF 2.0 | SIEM log ingestion format |
| Splunk Enterprise Security | CEF | SIEM log ingestion format |
| Microsoft Sentinel | Universal Cloud REST API | SIEM log ingestion format |
| Carbon Design System | v11 | Frontend UI framework |
