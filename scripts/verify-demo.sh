#!/bin/bash
# verify-demo.sh - Full automated smoke test for watsonx.data Presto ⟷ SIEM Integration Demo
#
# Runs the backend in mock mode (no external connectivity needed), verifies all
# endpoints, then builds the frontend and runs compliance checks.

set -e

PASS=0
FAIL=0

log_ok() { echo "  ✅  $1"; PASS=$((PASS+1)); }
log_fail() { echo "  ❌  FAIL: $1"; FAIL=$((FAIL+1)); }

echo ""
echo "============================================================"
echo "  watsonx.data SIEM Demo - Automated Verification Suite    "
echo "============================================================"
echo ""

# ── Resolve project root (script may be invoked from anywhere) ─────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Stage 1: Backend smoke test
echo "[Stage 1] Backend boot and endpoint verification (mock mode)..."

# Activate backend venv
if [ -f "backend/.venv/bin/activate" ]; then
    source backend/.venv/bin/activate
else
    python3 -m venv backend/.venv
    source backend/.venv/bin/activate
    pip install --quiet -r backend/requirements.txt
fi

# Start backend in mock mode on port 8099 (avoids conflicts with port 8000)
DEMO_MODE=mock PORT=8099 uvicorn backend.main:app --port 8099 --no-access-log &
BACKEND_PID=$!
sleep 3

# Hit health endpoint
if curl -fsS http://localhost:8099/api/health > /tmp/health.json 2>&1; then
    log_ok "/api/health → 200 OK"
    cat /tmp/health.json
else
    log_fail "/api/health did not return 200"
fi

if curl -fsS http://localhost:8099/api/siem/summary > /dev/null 2>&1; then
    log_ok "/api/siem/summary → 200 OK"
else
    log_fail "/api/siem/summary failed"
fi

if curl -fsS http://localhost:8099/api/siem/events > /dev/null 2>&1; then
    log_ok "/api/siem/events → 200 OK"
else
    log_fail "/api/siem/events failed"
fi

if curl -fsS http://localhost:8099/api/scenarios > /dev/null 2>&1; then
    log_ok "/api/scenarios → 200 OK"
else
    log_fail "/api/scenarios failed"
fi

# POST execute test
EXEC_RESP=$(curl -fsS -X POST http://localhost:8099/api/siem/execute \
  -H 'Content-Type: application/json' \
  -d '{"sql":"SELECT count(*) FROM iceberg_data.finance.transactions","user":"analyst_sarah","clientIp":"10.244.12.45"}' 2>&1)
if echo "$EXEC_RESP" | grep -q "execution"; then
    log_ok "POST /api/siem/execute → valid audit event response"
else
    log_fail "POST /api/siem/execute failed"
fi

kill $BACKEND_PID 2>/dev/null || true
deactivate 2>/dev/null || true

echo ""
echo "[Stage 2] Frontend build verification..."
cd frontend
if npm run build > /tmp/frontend_build.log 2>&1; then
    log_ok "npm run build → exit 0 (no Sass/Carbon/JSX errors)"
else
    cat /tmp/frontend_build.log
    log_fail "npm run build failed - see above"
fi
cd ..

echo ""
echo "[Stage 3] Compliance gate..."

# No hardcoded keys
if ! grep -r "AKIA\|api_key\s*=\s*\"[a-zA-Z0-9]" backend/ frontend/src/ 2>/dev/null | grep -v ".env.example"; then
    log_ok "No hardcoded API keys detected"
else
    log_fail "Hardcoded key patterns found"
fi

# Check disclaimer present
if grep -q "synthetic" frontend/src/components/DemoBanner.jsx 2>/dev/null; then
    log_ok "DemoBanner synthetic data disclaimer present"
else
    log_fail "DemoBanner synthetic disclaimer missing"
fi

# Check Carbon is in deps
if grep -q "@carbon/react" frontend/package.json 2>/dev/null; then
    log_ok "@carbon/react present in package.json"
else
    log_fail "@carbon/react missing from package.json"
fi

# Check no OpenShift-specific files remain
if [ ! -d "openshift" ]; then
    log_ok "openshift/ directory removed"
else
    log_fail "openshift/ directory still exists"
fi

if [ ! -f "Dockerfile.frontend" ] && [ ! -f "Dockerfile.backend" ]; then
    log_ok "OpenShift Dockerfiles removed"
else
    log_fail "Dockerfile(s) still exist"
fi

echo ""
echo "============================================================"
echo "  Results: ${PASS} passed · ${FAIL} failed"
if [ $FAIL -eq 0 ]; then
    echo "  ✅  ALL CHECKS PASSED — demo is ready for delivery"
else
    echo "  ❌  $FAIL checks FAILED — fix before handover"
    exit 1
fi
echo "============================================================"
