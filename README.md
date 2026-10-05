# IBM watsonx.data Presto ↔ SIEM Integration

Real-time SQL query audit logging, multi-catalog metadata discovery, LEEF 2.0 / CEF packet transformation, and SIEM threat correlation for **IBM watsonx.data (Presto/Trino)** — runs **locally**, pulling live data from any remote Presto endpoint (IBM Cloud SaaS or on-prem watsonx.data / Cloud Pak for Data).

> **Synthetic data disclaimer**: when running in mock mode, all events, users, and query data are 100% synthetic (Faker-generated). When running in live mode, only query **metadata** (user, SQL text, timestamps, duration, row counts) is fetched from Presto system tables — no table row data or PII is read or stored.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Developer Workstation (Local)                          │
│                                                         │
│  ┌──────────────────┐       ┌──────────────────────┐    │
│  │  React Frontend  │ ←───→ │  FastAPI Backend     │    │
│  │  Carbon Design   │  /api │  uvicorn :8000       │    │
│  │  localhost:3000  │  +WS  │  (Mock & Live engine)│    │
│  └──────────────────┘       └──────────┬───────────┘    │
│                                        │ HTTPS / TLS    │
└────────────────────────────────────────│────────────────┘
                                         │
                               ┌─────────▼────────────────┐
                               │ IBM watsonx.data Presto  │
                               │ (Cloud SaaS / On-Prem)   │
                               │  • system.runtime.queries│
                               │  • wxd_system_data audit │
                               │  • Iceberg / Hive / Lake │
                               └──────────────────────────┘
```

The **Vite dev server** (`vite.config.js`) proxies `/api` and the real-time WebSocket (`/api/siem/ws`) to FastAPI on port 8000.

---

## Key Features

- **Dual Mode Operation**: Seamlessly switch between `DEMO_MODE=mock` (instant synthetic data, zero external dependencies) and `DEMO_MODE=live` (real Presto connection).
- **All-user audit visibility**: Audit queries are issued with `X-Presto-User: ibmlhapiuser` (configurable via `PRESTO_AUDIT_USER`) to bypass the row-level security in `wxd_system_data` views and surface queries from every user, including LDAP-authenticated users.
- **Time-bounded history fetch**: The `wxd_system_data` history query uses `WHERE create_time >= NOW() - INTERVAL N HOUR` (default 24 h, configurable via `AUDIT_HISTORY_HOURS`) so only the recent window is scanned — fast and guaranteed to include all queries visible in the Presto UI.
- **Dual Audit Retrieval**: Pulls live query executions concurrently from both in-memory `system.runtime.queries` and persistent `wxd_system_data.<diag_schema>.query_completed_event_view`.
- **Full Catalog Hierarchy Discovery**: Concurrent fan-out discovery across all catalogs (`SHOW CATALOGS` → `SHOW SCHEMAS` → `SHOW TABLES`) with automated data sensitivity classification (`Restricted-PII`, `Restricted-Compliance`, `Confidential`, `Internal`).
- **Real-Time SIEM Ingestion & Streaming**: Live WebSocket push (`/api/siem/ws`) streaming transformed **LEEF 2.0** (QRadar) and **CEF** (Splunk/Sentinel) audit logs to the UI, with incremental delivery — only previously-unseen events are pushed.
- **Threat Correlation & Offenses**: Real-time rule evaluation detecting mass data exfiltration (`RULE-WXD-1001`, MITRE T1005), unauthorized DDL / schema tampering (`RULE-WXD-1002`, MITRE T1485), excessive query frequency, and after-hours access.
- **Zero hardcoded values**: Every tunable — thresholds, buffer sizes, vendor strings, user defaults, engine version — is driven by an environment variable with a documented default in `.env.example`.
- **Carbon Design System UI**: Built with IBM `@carbon/react` featuring SOC Dashboard, Presto Query Studio, Threat Offenses, Compliance & Governance mapping, and Solution Architecture views.

---

## Quick Start

### Prerequisites
- **Python 3.9+** — `python3 --version`
- **Node.js 18+** — `node --version`

### 1 — One-shot setup
```bash
chmod +x scripts/setup-local.sh
./scripts/setup-local.sh
```

This installs backend deps (including the `trino` Presto client), installs frontend npm packages, and creates `.env` from the template.

### 2 — Configure (optional — for live mode)

Edit `.env` (created by the setup script):

```env
DEMO_MODE=mock   # ← everything synthetic, no Presto needed
# or
DEMO_MODE=live   # ← queries run against real watsonx.data Presto

PRESTO_HOST=<your-presto-hostname>
PRESTO_PORT=443
PRESTO_USE_SSL=true
PRESTO_SSL_VERIFY=false   # false for self-signed certificates

# Authentication — choose ONE:
PRESTO_USER=cpadmin
PRESTO_PASSWORD=<your-password>
# -- OR --
PRESTO_BEARER_TOKEN=<cpd-jwt-token>

# Audit identity — user sent in X-Presto-User for system/audit queries.
# Must have global visibility in wxd_system_data views to see all users' queries.
PRESTO_AUDIT_USER=ibmlhapiuser

# How many hours of history to fetch (default 24)
AUDIT_HISTORY_HOURS=24
```

> **Don't have a watsonx.data instance yet?** Leave `DEMO_MODE=mock` — everything runs with synthetic data and no Presto connection is needed.

### 3 — Start the backend (Terminal 1)
```bash
source backend/.venv/bin/activate
uvicorn backend.main:app --port 8000 --reload
```

Expected output:
```
[*] Starting watsonx.data Presto ⟷ SIEM Integration Demo Engine
[*] Mode: mock | Presto target: localhost:8443
```

### 4 — Start the frontend (Terminal 2)
```bash
cd frontend
npm run dev
```

### 5 — Open the demo
**`http://localhost:3000`**

---

## Finding your Presto hostname

Find the watsonx.data Presto hostname in the **watsonx.data console** under **Infrastructure → Connection details**.

**Common formats:**
- IBM Cloud SaaS: `ibm-lh-presto-svc-cpd-<instance>.<apps-domain>` (port 443)
- On-prem CP4D: `ibm-lh-lakehouse-presto-<id>-presto-svc.<apps-domain>` (port 443)

---

## Getting a Presto authentication token

**Basic auth (simplest):**
Use the watsonx.data admin username (`cpadmin` or `ibmacp`) and the password set during CP4D installation.

**JWT bearer token (preferred — no password exposure):**
```bash
# From the CP4D token endpoint:
curl -k -X POST https://<cpd-host>/icp4d-api/v1/authorize \
  -H "Content-Type: application/json" \
  -d '{"username":"cpadmin","password":"<password>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
```
Paste the result as `PRESTO_BEARER_TOKEN=` in `.env`.

---

## Why queries from other users were invisible

On watsonx.data CP4D, the `wxd_system_data` diagnostic view and `system.runtime.queries` apply **row-level security based on `X-Presto-User`**: each request only returns rows where `user = X-Presto-User`, regardless of the Bearer token's privilege level.

The `PRESTO_AUDIT_USER` setting (default `ibmlhapiuser`) controls the `X-Presto-User` header used **only** for these audit/system queries. `ibmlhapiuser` is the built-in CP4D service account that has global visibility across all users. The `Authorization: Bearer` token (from `PRESTO_USER`) continues to authenticate the HTTP request — the two are independent.

Set `PRESTO_AUDIT_USER` to a user that holds the `Metastore Admin` or `Data Access` role on your CP4D deployment if `ibmlhapiuser` does not work.

---

## Verifying Presto connectivity & API endpoints

With the backend running:
```bash
# Health check (shows mode, Presto target, connection status)
curl http://localhost:8000/api/health

# Frontend-facing configuration defaults
curl http://localhost:8000/api/config

# SOC dashboard summary statistics
curl http://localhost:8000/api/siem/summary

# Discover real catalogs from watsonx.data
curl http://localhost:8000/api/siem/catalog

# Discover full catalog -> schema -> table hierarchy
curl http://localhost:8000/api/siem/catalog/tree

# Discover schemas in a specific catalog
curl http://localhost:8000/api/siem/catalog/iceberg_data/schemas

# Discover tables with data classification
curl http://localhost:8000/api/siem/catalog/iceberg_data/schemas/finance/tables

# Pull live audit query history (from system.runtime.queries & wxd_system_data)
curl http://localhost:8000/api/siem/events?limit=5 | python3 -m json.tool

# View active correlation rules and triggered offenses
curl http://localhost:8000/api/siem/rules
curl http://localhost:8000/api/siem/offenses
```

The `source` field in responses indicates whether data was retrieved from Presto (`"live"`) or the deterministic simulation fallback (`"simulated"` / `"mock"`).

---

## Demo Scenarios & Threat Detection Rules

The Presto Query Studio provides preconfigured security scenarios demonstrating SIEM detection rules. SQL in scenarios uses `PRESTO_CATALOG` and `PRESTO_SCHEMA` from your `.env` — no hardcoded catalog names.

| Rule ID | Scenario | Severity | MITRE ATT&CK | Trigger Condition |
|---|---|---|---|---|
| `RULE-WXD-1001` | Mass Data Exfiltration | CRITICAL | T1005 (Data from Local System) | Row count > `RULE_EXFIL_ROW_THRESHOLD` or bytes > `RULE_EXFIL_BYTES_THRESHOLD` on customer/PII tables |
| `RULE-WXD-1002` | Unauthorized DDL Tampering | HIGH | T1485 (Data Destruction) | `DROP`, `ALTER`, or `TRUNCATE` resulting in `PERMISSION_DENIED` |
| `RULE-WXD-1003` | Suspicious IP on Restricted Catalog | MEDIUM | T1078 (Valid Accounts) | Queries from `192.168.100.*` range against `kyc` tables |
| `RULE-WXD-1004` | Unbounded Table Scan | MEDIUM | T1499 (Endpoint Denial of Service) | `WHERE 1=1` full table scan without partition filter |

In **live mode** queries execute directly on the Presto coordinator. In **mock mode** queries use deterministic simulated execution results with realistic durations and byte counts.

---

## Configuration Reference

All values are environment variables with defaults documented in [`.env.example`](.env.example). No value is hardcoded in source code.

### Connection
| Variable | Default | Description |
|---|---|---|
| `DEMO_MODE` | `mock` | `mock` = synthetic data; `live` = real Presto |
| `PRESTO_HOST` | `localhost` | Presto coordinator hostname |
| `PRESTO_PORT` | `8443` | Presto coordinator port |
| `PRESTO_USER` | `ibmacp` | User whose Bearer token authenticates HTTP requests |
| `PRESTO_PASSWORD` | *(empty)* | Exchanged for CP4D token if `PRESTO_BEARER_TOKEN` absent |
| `PRESTO_BEARER_TOKEN` | *(empty)* | Pre-obtained CP4D JWT (preferred) |
| `PRESTO_CPD_HOST` | *(empty)* | CP4D console host for token exchange (defaults to `PRESTO_HOST`) |
| `PRESTO_CATALOG` | `iceberg_data` | Session default catalog |
| `PRESTO_SCHEMA` | `finance` | Session default schema |
| `PRESTO_USE_SSL` | `false` | Enable HTTPS |
| `PRESTO_SSL_VERIFY` | `true` | Verify TLS certificate (`false` for self-signed) |

### Audit Identity
| Variable | Default | Description |
|---|---|---|
| `PRESTO_AUDIT_USER` | `ibmlhapiuser` | `X-Presto-User` for `system.runtime.queries` and `wxd_system_data` audit queries — must have global visibility to see all users' queries |
| `AUDIT_HISTORY_HOURS` | `24` | Hours of history fetched from `wxd_system_data` per poll cycle |

### Polling Behaviour
| Variable | Default | Description |
|---|---|---|
| `PRESTO_POLL_WALL_LIMIT_S` | `75` | Hard wall-clock limit (seconds) for the httpx polling loop |
| `PRESTO_POLL_INTERVAL_S` | `0.2` | Sleep between `nextUri` poll requests |
| `PRESTO_MAX_ROWS_UI` | `500` | Maximum rows returned per query to the UI |
| `PRESTO_SOURCE_TAG` | `watsonx-data-siem-demo` | Value sent in `X-Presto-Source` header |

### Engine & SIEM Payload
| Variable | Default | Description |
|---|---|---|
| `ENGINE_VERSION` | `Presto (Java) 0.286` | Engine string embedded in every audit event |
| `CLUSTER_NAME` | *(empty)* | Cluster label in events (defaults to first segment of `PRESTO_HOST`) |
| `CPU_TIME_MULTIPLIER` | `1.8` | Multiplier applied to `durationMs` to estimate `cpuTimeMs` |
| `SIEM_VENDOR` | `IBM` | Vendor string in LEEF and CEF headers |
| `SIEM_PRODUCT` | `watsonx.data` | Product string in LEEF and CEF headers |
| `SIEM_PRODUCT_VERSION` | `2.0.1` | Product version in LEEF header |
| `SIEM_CEF_SQL_SNIPPET_LEN` | `120` | Max SQL characters in the CEF `msg` field |
| `SIEM_OFFENSE_SQL_SNIPPET_LEN` | `140` | Max SQL characters in a SIEM offense `sqlSnippet` |

### Correlation Rules & Buffers
| Variable | Default | Description |
|---|---|---|
| `RULE_EXFIL_ROW_THRESHOLD` | `100000` | Row count threshold for Rule 1001 (exfiltration) |
| `RULE_EXFIL_BYTES_THRESHOLD` | `50000000` | Byte threshold for Rule 1001 |
| `SIEM_EVENT_BUFFER_SIZE` | `500` | Backend in-memory event ring buffer |
| `SIEM_OFFENSE_BUFFER_SIZE` | `30` | Backend in-memory offense ring buffer |
| `OFFENSE_ID_PREFIX` | `SEC-OFF` | Prefix for generated offense IDs |
| `OFFENSE_ID_START` | `101` | Starting numeric suffix for offense IDs |
| `OFFENSE_ASSIGNED_ANALYST` | `SOC Tier 2 / Auto-Triage` | Assigned analyst label on new offenses |

### Frontend & Dashboard
| Variable | Default | Description |
|---|---|---|
| `DEFAULT_QUERY_USER` | `analyst_sarah` | Pre-filled user in the Query Studio |
| `DEFAULT_QUERY_CLIENT_IP` | `10.244.12.45` | Pre-filled client IP in the Query Studio |
| `DEFAULT_QUERY_SQL` | *(aggregation query)* | Pre-filled SQL in the Query Studio (`{catalog}` and `{schema}` are substituted at runtime) |
| `DASHBOARD_INITIAL_EVENT_COUNT` | `30` | Events fetched on dashboard first load |
| `WS_EVENT_RING_SIZE` | `50` | Client-side event ring buffer size |
| `WS_OFFENSE_RING_SIZE` | `30` | Client-side offense ring buffer size |
| `MOCK_BASELINE_EVENTS` | `1420` | Synthetic baseline added to KPI totals in mock mode |
| `MOCK_BASELINE_BYTES` | `4820000000` | Synthetic baseline bytes in mock mode |
| `MOCK_BASELINE_ROWS` | `12500000` | Synthetic baseline rows in mock mode |
| `MOCK_BASELINE_EPS` | `14.2 eps` | Synthetic baseline events-per-second in mock mode |

---

## Technical Documentation & References

Detailed design documents and technical deep dives are available in the [`docs/`](docs/) directory:

- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**: Full architecture specification, sequence diagrams, LEEF 2.0 / CEF packet schemas, and component interaction models.
- **[`docs/PRESTO_SQL_AUDIT_RETRIEVAL.md`](docs/PRESTO_SQL_AUDIT_RETRIEVAL.md)**: Technical reference explaining how Presto executed SQL history is retrieved from `system.runtime.queries` and `wxd_system_data.<diag_schema>.query_completed_event_view`, including REST protocol details, authentication flows, audit user identity, and data mapping.

---

## Switching between mock and live

```bash
# In .env:
DEMO_MODE=mock   # fully synthetic, no Presto connection needed
DEMO_MODE=live   # real Presto coordinator queries + system audit history
```

The backend **always falls back** gracefully to simulation if Presto is unreachable or credentials are unconfigured — the application and UI will continue operating seamlessly.

---

## Project Structure

```
.
├── backend/
│   ├── main.py                         # FastAPI app entry point & lifespan
│   ├── config.py                       # Pydantic environment configuration (all settings)
│   ├── requirements.txt                # Python dependencies (trino, fastapi, uvicorn, faker, httpx)
│   ├── routers/
│   │   ├── health.py                   # /api/health + /api/config endpoints
│   │   ├── siem.py                     # /api/siem/* (events, catalog, execute, offenses, ws)
│   │   └── scenarios.py               # /api/scenarios (predefined test scenarios)
│   └── services/
│       ├── presto_service.py           # Trino client & httpx Presto REST executor + fallback
│       ├── watsonx_data_service.py     # Presto system tables & wxd_system_data audit ingestion
│       ├── siem_service.py             # SIEM correlation rules engine & offenses store
│       └── synthetic_data_service.py  # Faker synthetic audit events generator & LEEF/CEF formatters
├── frontend/
│   ├── vite.config.js                  # Vite dev server configuration + /api proxy
│   ├── package.json                    # Frontend dependencies (@carbon/react, @carbon/icons-react)
│   └── src/
│       ├── App.jsx                     # Root application shell with Carbon Header and SideNav
│       ├── routes.jsx                  # React Router definitions
│       ├── pages/
│       │   ├── DashboardPage.jsx       # SIEM Log Activity & SOC Dashboard
│       │   ├── QueryStudioPage.jsx     # Interactive Presto Query Studio (defaults from /api/config)
│       │   ├── OffensesPage.jsx        # Threat Offenses & alert investigation
│       │   ├── CompliancePage.jsx      # Compliance & Governance matrix (GDPR, HIPAA, PCI-DSS)
│       │   └── ArchitecturePage.jsx    # Interactive architectural diagrams & packet flows
│       ├── components/
│       │   ├── DemoBanner.jsx          # Mode status and environment indicator
│       │   ├── KPICard.jsx             # Metric KPI card
│       │   ├── LogActivityTable.jsx    # Real-time event log table with filters
│       │   ├── PacketInspector.jsx     # Side-by-side LEEF 2.0 / CEF / JSON viewer
│       │   ├── QueryDetailModal.jsx    # Detailed query execution modal
│       │   └── SOCChartPanel.jsx       # Event frequency and severity charts
│       ├── services/api.js             # Axios client & API methods (incl. getFrontendConfig)
│       └── context/DemoContext.jsx     # Global React context, WebSocket live feed & ring buffers
├── docs/
│   ├── ARCHITECTURE.md                 # System architecture specification
│   └── PRESTO_SQL_AUDIT_RETRIEVAL.md   # SQL query retrieval technical reference
├── scripts/
│   ├── setup-local.sh                  # One-shot automated local setup
│   ├── configure.sh                    # Interactive CLI environment configuration
│   └── verify-demo.sh                  # Automated health check and smoke test
├── .env.example                        # Template with all environment variables documented
└── README.md                           # This documentation
```

---

## Synthetic Data Disclaimer

This demonstration environment uses 100% synthetic data generated for simulation purposes in mock mode. No real client data, PII, or confidential credentials are used or stored. When connecting to a real watsonx.data instance in live mode, only query **metadata** (user, duration, SQL text, row counts) from `system.runtime.queries` and `wxd_system_data` is pulled — no actual table row data is read or stored by this application.
