# IBM watsonx.data Presto ↔ SIEM Integration Demo

Real-time SQL query audit logging, LEEF 2.0 / CEF packet transformation, and SIEM threat correlation for **IBM watsonx.data Presto** — runs **fully locally**, pulling live data from any remote Presto endpoint (IBM Cloud SaaS or on-prem watsonx.data).

> **Synthetic data disclaimer**: when running in mock mode all events, users, and query data are 100% synthetic. No real client data or PII is used or stored.

---

## Architecture

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

## Verifying Presto connectivity

With the backend running:
```bash
# Health check
curl http://localhost:8000/api/health

# Discover real catalogs from your watsonx.data instance
curl http://localhost:8000/api/siem/catalog

# Discover schemas in a catalog
curl http://localhost:8000/api/siem/catalog/iceberg_data/schemas

# Discover tables (with auto-classification)
curl http://localhost:8000/api/siem/catalog/iceberg_data/schemas/finance/tables

# Pull real query history from system.runtime.queries
curl http://localhost:8000/api/siem/events?limit=5 | python3 -m json.tool
```

The `source` field in event responses tells you whether data came from Presto (`"live"`) or the simulation fallback (`"simulated"`).

---

## Demo Scenarios (Query Studio)

| Scenario | Risk | What it demonstrates |
|---|---|---|
| Standard BI Aggregation | LOW | Normal analyst query — LEEF event, no offense |
| Mass Data Exfiltration | CRITICAL | `SELECT *` on PII table — triggers RULE-WXD-1001, MITRE T1005 |
| Unauthorized DDL Drop | HIGH | `DROP TABLE` denied — triggers RULE-WXD-1002, MITRE T1485 |

In **live mode** these queries execute on your real Presto coordinator. In **mock mode** they use deterministic simulated results.

---

## Switching between mock and live

```bash
# In .env:
DEMO_MODE=mock   # fully synthetic, no Presto needed
DEMO_MODE=live   # real Presto queries + system.runtime.queries history
```

The backend **always falls back** to simulation if Presto is unreachable — the demo never crashes.

---

## Project structure

```
.
├── backend/
│   ├── main.py                         # FastAPI app entry
│   ├── config.py                       # All settings (PRESTO_*, DEMO_MODE)
│   ├── requirements.txt                # Python deps incl. trino
│   ├── routers/
│   │   ├── health.py                   # /api/health
│   │   ├── siem.py                     # /api/siem/* — events, execute, catalog
│   │   └── scenarios.py               # /api/scenarios
│   └── services/
│       ├── presto_service.py           # Trino client + httpx fallback + simulation
│       ├── watsonx_data_service.py     # system.runtime.queries → SIEM events
│       ├── siem_service.py             # SIEM correlation rules engine
│       └── synthetic_data_service.py  # Faker-based synthetic audit events
├── frontend/
│   ├── vite.config.js                  # Vite dev server + /api proxy → :8000
│   └── src/
│       ├── pages/                      # Dashboard, QueryStudio, Offenses, ...
│       ├── components/                 # KPICard, SOCChartPanel, PacketInspector
│       ├── services/api.js             # Axios client + catalog endpoints
│       └── context/DemoContext.jsx     # Global state + WebSocket
├── scripts/
│   ├── setup-local.sh                  # One-shot local setup script
│   ├── configure.sh                    # Interactive environment configuration
│   └── verify-demo.sh                  # Automated smoke test
├── .env.example                        # Template for all configuration
├── ARCHITECTURE.md                     # Solution architecture & component design
├── DEMO_SCRIPT.md                      # Presenter talk track with timing
├── PILOT_PLAN.md                       # 4-week Client Engineering pilot plan
└── README.md                           # This file
```

---

## Synthetic Data Disclaimer

This demonstration environment uses 100% synthetic data generated for simulation purposes. No real client data, PII, or confidential credentials are used or stored. When connecting to a real watsonx.data instance, only query **metadata** (user, duration, SQL text, row counts) from `system.runtime.queries` is pulled — no actual table row data is read or stored by this application.
