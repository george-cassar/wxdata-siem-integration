# Architecture Specification: watsonx.data Presto ⟷ SIEM Integration

## 1. Solution Overview
This solution provides continuous, low-latency, and zero-impact query audit logging for **IBM watsonx.data** (Presto Java engine), streaming structured audit events into Enterprise SIEM platforms (**IBM QRadar**, **Splunk**, **Microsoft Sentinel**, or **Elastic**).

The demo runs **fully locally** on a developer workstation (Vite dev server on port 3000 + FastAPI/uvicorn on port 8000). In **mock mode**, all data is synthetic (Faker, seed=42). In **live mode**, the backend connects to a remote watsonx.data Presto coordinator via HTTPS to execute real queries and pull real audit history from `system.runtime.queries`.

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
    Backend -->|system.runtime.queries| PrestoCoord
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
4. **Audit event generation**: Every query (real or simulated) is converted into a structured SIEM audit event with user, IP, catalog, schema, SQL text, row/byte counts, status, and risk level
5. **SIEM correlation**: `SIEMEngine.evaluate_event()` evaluates each event against 4 correlation rules and triggers offenses when thresholds are exceeded
6. **LEEF/CEF formatting**: Events are formatted into IBM LEEF 2.0 (for QRadar) and CEF (for Splunk/Sentinel) wire formats
7. **WebSocket streaming**: A live WebSocket (`/api/siem/ws`) pushes new events and offenses to the frontend in real time
8. **SIEM delivery** (optional): When `SIEM_FORWARD_HOST` is set, formatted events are forwarded via syslog to the configured SIEM

### Component Inventory

| Component | Location | Responsibility |
| :--- | :--- | :--- |
| React Frontend | `frontend/src/` | Carbon Design System UI, Vite dev server, API client (`api.js`) |
| FastAPI Backend | `backend/main.py` | Entry point, CORS, router registration |
| Health Router | `backend/routers/health.py` | `/api/health` — mode, version, Presto connection status |
| SIEM Router | `backend/routers/siem.py` | `/api/siem/*` — events, offenses, rules, catalog, execute, WebSocket |
| Scenarios Router | `backend/routers/scenarios.py` | `/api/scenarios` — 3 preset demo scenarios |
| PrestoExecutor | `backend/services/presto_service.py` | Trino/httpx client; dual-mode (mock/live); CP4D bearer token exchange |
| SIEMEngine | `backend/services/siem_service.py` | Correlation rules engine, event store, offense tracking |
| SyntheticDataService | `backend/services/synthetic_data_service.py` | Faker-based (seed=42) mock audit events, LEEF/CEF formatting |
| watsonxDataService | `backend/services/watsonx_data_service.py` | Live catalog discovery (SHOW CATALOGS), audit history extraction |
| DemoContext | `frontend/src/context/DemoContext.jsx` | Global state (summary, events, offenses, scenarios, WebSocket) |

## 3. Event Interception Mechanisms

### Approach 1: Presto EventListener SPI (Recommended for Production)
Presto provides a native Java Service Provider Interface (`EventListenerFactory`). When configured on the coordinator, Presto asynchronously pushes `QueryCreatedEvent`, `QueryCompletedEvent`, and `SplitCompletedEvent` objects to the registered listener.

- **Latency**: Sub-second (≈ 10–50 ms)
- **Overhead**: Negligible; listener callbacks execute on dedicated background worker pools
- **Demo simulation**: The backend's `watsonxDataService` pulls query history from `system.runtime.queries` as the equivalent of what the EventListener would emit

### Approach 2: Query History Monitoring & Management (QHMM)
watsonx.data persists query diagnostic history into object storage tables (`query_history`, `query_event_raw`). An external polling consumer reads micro-batches from storage and posts them to the SIEM via the QRadar Universal Cloud REST API.

- **Latency**: 15–60 seconds (batch polling)
- **Demo simulation**: The backend polls `system.runtime.queries` periodically (via WebSocket at 8-second intervals)

## 4. SIEM Payload Formats & Mapping

### IBM QRadar LEEF 2.0 Standard
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
| `sqlText` | `sqlText` | `msg` | Raw / sanitized SQL statement |
| `rowsScanned` | `rowsProcessed` | `cn1` | Total rows processed by engine |
| `bytesScanned` | `bytesScanned` | `cn2` | Total bytes read from object storage |
| `status` | `status` | `cs3` | `FINISHED`, `FAILED`, `CANCELED` |

## 5. Correlation Rules & Threat Detection
1. **Rule 1001 (Mass Data Exfiltration - MITRE T1005):** Single query scanning >100,000 rows or >50 MB against customer/PII tables.
2. **Rule 1002 (Unauthorized DDL / Destruction - MITRE T1485):** Unauthorized `DROP` or `ALTER` attempts resulting in `PERMISSION_DENIED`.
3. **Rule 1003 (Suspicious Off-Hours / Anomalous IP - MITRE T1078):** Queries from untrusted IP ranges against compliance catalogs.
4. **Rule 1004 (Unbounded Table Scan / Resource Exhaustion - MITRE T1499):** Full table scans executing without partition filters or LIMIT clauses, causing memory spikes.

## 6. Security Architecture
- **Authentication**: CP4D/watsonx.data Presto accepts only `Authorization: Bearer <cpd-token>`. The backend exchanges `PRESTO_USER` + `PRESTO_PASSWORD` for a CP4D token via `POST /icp4d-api/v1/authorize`, or accepts a pre-obtained `PRESTO_BEARER_TOKEN`.
- **TLS**: All Presto connections use HTTPS/TLS. `PRESTO_SSL_VERIFY` can be set to `false` for self-signed certificates in demo environments.
- **Credential management**: All credentials are loaded via environment variables (`.env` file). No credentials are hardcoded in source code or committed to version control.
- **No data exfiltration**: The application only reads query **metadata** (user, duration, SQL text, row counts) from `system.runtime.queries` — no table row data is stored.
- **CORS**: The backend allows requests from `localhost:3000` (Vite dev) and `localhost:5173` (Vite preview).

## 7. Deployment Architecture
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

## 8. NFRs
| Requirement | Target | How Met |
| :--- | :--- | :--- |
| Audit coverage | 100% of queries | EventListener SPI or `system.runtime.queries` polling |
| Event delivery latency | < 2 seconds | Asynchronous EventListener + TLS forwarding |
| Presto CPU overhead | < 1.5% | EventListener callbacks on background threads |
| Demo startup time | < 10 seconds | Mock mode with pre-seeded synthetic data |
| Browser support | Chrome/Firefox/Safari (latest) | Carbon Design System v11, WCAG 2.1 AA |
| Data privacy | No PII stored | Synthetic data only (Faker seed=42); live mode reads metadata only |

## 9. IBM Product Versions
| Product | Version | Purpose |
| :--- | :--- | :--- |
| IBM watsonx.data (Presto) | 0.286 (Java) | Lakehouse query engine with audit event emission |
| IBM QRadar | LEEF 2.0 | SIEM log ingestion format |
| Splunk Enterprise Security | CEF | SIEM log ingestion format |
| Microsoft Sentinel | Universal Cloud REST API | SIEM log ingestion format |
| Carbon Design System | v11 | Frontend UI framework |
