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
- **Dual Audit Retrieval**: Pulls live query executions concurrently from both in-memory `system.runtime.queries` and persistent `wxd_system_data.<diag_schema>.query_completed_event_view`.
- **Full Catalog Hierarchy Discovery**: Concurrent fan-out discovery across all catalogs (`SHOW CATALOGS` → `SHOW SCHEMAS` → `SHOW TABLES`) with automated data sensitivity classification (`Restricted-PII`, `Restricted-Compliance`, `Confidential`, `Internal`).
- **Real-Time SIEM Ingestion & Streaming**: Live WebSocket push (`/api/siem/ws`) streaming transformed **LEEF 2.0** (QRadar) and **CEF** (Splunk/Sentinel) audit logs to the UI.
- **Threat Correlation & Offenses**: Real-time rule evaluation detecting mass data exfiltration (`RULE-WXD-1001`, MITRE T1005), unauthorized DDL / schema tampering (`RULE-WXD-1002`, MITRE T1485), excessive query frequency, and after-hours access.
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
PRESTO_USER=ibmacp
PRESTO_PASSWORD=<your-password>
# -- OR --
PRESTO_BEARER_TOKEN=<cpd-jwt-token>
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
- On-prem: `<presto-coordinator>.<namespace>.svc.cluster.local` (port 8443, Kubernetes DNS)

---

## Getting a Presto authentication token

**Basic auth (simplest):**
Use the watsonx.data admin username (`ibmacp`) and the password set during CP4D installation.

**JWT bearer token (preferred — no password exposure):**
```bash
# From the CP4D token endpoint:
curl -k -X POST https://<cpd-host>/icp4d-api/v1/authorize \
  -H "Content-Type: application/json" \
  -d '{"username":"ibmacp","password":"<password>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
```
Paste the result as `PRESTO_BEARER_TOKEN=` in `.env`.

---

## Verifying Presto connectivity & API endpoints

With the backend running:
```bash
# Health check (shows mode, Presto target, connection status)
curl http://localhost:8000/api/health

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

The Presto Query Studio provides preconfigured security scenarios demonstrating SIEM detection rules:

| Rule ID | Scenario | Severity | MITRE ATT&CK | Description & Trigger Condition |
|---|---|---|---|---|
| `RULE-WXD-1001` | Mass Data Exfiltration | CRITICAL | T1005 (Data from Local System) | `SELECT *` without limit or row count > 10,000 on PII / sensitive tables |
| `RULE-WXD-1002` | Unauthorized DDL Tampering | HIGH | T1485 (Data Destruction) | `DROP TABLE`, `ALTER TABLE`, or `TRUNCATE` operations on critical catalogs |
| `RULE-WXD-1003` | Cross-Catalog Reconnaissance | MEDIUM | T1087 (Account Discovery) | Rapid enumeration across disparate catalogs (`SHOW CATALOGS`, `SHOW SCHEMAS`) |
| `RULE-WXD-1004` | Privilege Escalation / Admin | HIGH | T1078 (Valid Accounts) | Execution of administrative commands / `system` catalog queries by non-admin users |
| `RULE-WXD-1005` | After-Hours Access | MEDIUM | T1078.002 (Domain Accounts) | High-volume data queries executed outside normal business hours (20:00–06:00 UTC) |

In **live mode** queries execute directly on the Presto coordinator. In **mock mode** queries use deterministic simulated execution results with realistic execution durations and byte counts.

---

## Technical Documentation & References

Detailed design documents and technical deep dives are available in the [`docs/`](docs/) directory:

- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**: Full architecture specification, sequence diagrams, LEEF 2.0 / CEF packet schemas, and component interaction models.
- **[`docs/PRESTO_SQL_AUDIT_RETRIEVAL.md`](docs/PRESTO_SQL_AUDIT_RETRIEVAL.md)**: Technical reference explaining how Presto executed SQL history is retrieved from `system.runtime.queries` and `wxd_system_data.<diag_schema>.query_completed_event_view`, including REST protocol details, authentication flows, and data mapping.

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
│   ├── config.py                       # Pydantic environment configuration
│   ├── requirements.txt                # Python dependencies (trino, fastapi, uvicorn, faker, httpx)
│   ├── routers/
│   │   ├── health.py                   # /api/health endpoint
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
│       │   ├── QueryStudioPage.jsx     # Interactive Presto Query Studio
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
│       ├── services/api.js             # Axios client & API methods
│       └── context/DemoContext.jsx     # Global React context & WebSocket live feed
├── docs/
│   ├── ARCHITECTURE.md                 # System architecture specification
│   └── PRESTO_SQL_AUDIT_RETRIEVAL.md   # SQL query retrieval technical reference
├── scripts/
│   ├── setup-local.sh                  # One-shot automated local setup
│   ├── configure.sh                    # Interactive CLI environment configuration
│   └── verify-demo.sh                  # Automated health check and smoke test
├── .env.example                        # Template environment variables
└── README.md                           # This documentation
```

---

## Synthetic Data Disclaimer

This demonstration environment uses 100% synthetic data generated for simulation purposes. No real client data, PII, or confidential credentials are used or stored. When connecting to a real watsonx.data instance, only query **metadata** (user, duration, SQL text, row counts) from `system.runtime.queries` is pulled — no actual table row data is read or stored by this application.
