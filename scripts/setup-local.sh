#!/usr/bin/env bash
# =============================================================================
# setup-local.sh — One-shot local setup for remote watsonx.data Presto demo
# =============================================================================
# What this does:
#   1. Checks Python 3 and Node.js are available
#   2. Creates/activates Python venv and installs backend deps (incl. trino)
#   3. Installs frontend npm packages
#   4. Copies .env.example → .env if no .env exists yet
#   5. Prints a concise "how to run" summary
#
# Usage:
#   chmod +x scripts/setup-local.sh
#   ./scripts/setup-local.sh
# =============================================================================
set -euo pipefail

RESET='\033[0m'; BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'

info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error() { echo -e "${RED}[ERROR]${RESET} $*"; exit 1; }

# ── Working directory: always repo root ─────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║  watsonx.data Presto ↔ SIEM Demo  ·  Local Setup        ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}"
echo ""

# ── 1. Check prerequisites ──────────────────────────────────────────────────
info "Checking prerequisites..."

command -v python3 >/dev/null 2>&1 || error "python3 not found. Install Python 3.9+ from https://python.org"
PYTHON_VER=$(python3 --version 2>&1 | awk '{print $2}')
ok "Python $PYTHON_VER"

command -v node >/dev/null 2>&1 || error "node not found. Install Node.js 18+ from https://nodejs.org"
NODE_VER=$(node --version)
ok "Node.js $NODE_VER"

command -v npm >/dev/null 2>&1 || error "npm not found. Install Node.js 18+ from https://nodejs.org"
ok "npm $(npm --version)"

# ── 2. Python venv + backend deps ────────────────────────────────────────────
info "Setting up Python virtual environment..."
if [ ! -d "backend/.venv" ]; then
    python3 -m venv backend/.venv
    ok "Created backend/.venv"
else
    ok "Reusing existing backend/.venv"
fi

info "Installing backend Python packages (incl. trino for live Presto)..."
source backend/.venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r backend/requirements.txt
ok "Backend dependencies installed"

# Verify trino is importable
python3 -c "import trino; print('  trino', trino.__version__)" && ok "trino package verified"

# ── 3. Frontend npm packages ─────────────────────────────────────────────────
info "Installing frontend npm packages..."
cd frontend
npm install --silent
cd ..
ok "Frontend dependencies installed"

# ── 4. Environment file ──────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
    cp .env.example .env
    warn ".env created from .env.example"
    warn "→ Open .env and set DEMO_MODE=live and PRESTO_HOST/credentials if connecting to a real watsonx.data instance."
else
    ok ".env already exists — skipping copy (edit it manually if needed)"
fi

# ── 5. Print run instructions ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD} Setup complete. How to run:${RESET}"
echo ""
echo -e "${CYAN}  Step 1 — Configure your Presto connection:${RESET}"
echo "    Edit .env and set:"
echo "      DEMO_MODE=live"
echo "      PRESTO_HOST=<your-presto-route-or-host>"
echo "      PRESTO_PORT=443   (external route) or 8443 (internal)"
echo "      PRESTO_USER=ibmacp"
echo "      PRESTO_PASSWORD=<password>   (or PRESTO_BEARER_TOKEN)"
echo "      PRESTO_SSL_VERIFY=false      (for self-signed certificates)"
echo ""
echo -e "${CYAN}  Step 2 — Start the backend (Terminal 1):${RESET}"
echo "    source backend/.venv/bin/activate"
echo "    uvicorn backend.main:app --port 8000 --reload"
echo ""
echo -e "${CYAN}  Step 3 — Start the frontend (Terminal 2):${RESET}"
echo "    cd frontend && npm run dev"
echo ""
echo -e "${CYAN}  Step 4 — Open the demo:${RESET}"
echo "    http://localhost:3000"
echo ""
echo -e "${CYAN}  Verify Presto connectivity:${RESET}"
echo "    curl http://localhost:8000/api/siem/catalog"
echo "    curl http://localhost:8000/api/health"
echo ""
echo -e "${YELLOW}  Running in mock mode? Set DEMO_MODE=mock — no Presto needed.${RESET}"
echo -e "${BOLD}══════════════════════════════════════════════════════════${RESET}"
echo ""
