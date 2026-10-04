#!/bin/bash
# setup.sh - Bootstrap local development environment for watsonx.data Presto ⟷ SIEM Integration Demo

set -e

echo ""
echo "============================================================"
echo "  IBM watsonx.data Presto ⟷ SIEM Integration Demo Setup    "
echo "============================================================"
echo ""

# Prerequisites check
command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required. Install from https://nodejs.org/"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: Python 3.9+ is required."; exit 1; }

NODE_VER=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo $NODE_VER | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "WARNING: Node.js $NODE_VER detected. Node 18+ is recommended."
fi

echo "[1/5] Copying .env.example to .env (edit for live Presto credentials)..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "  -> .env created. Default: DEMO_MODE=mock (no credentials required)"
else
    echo "  -> .env already exists, skipping copy"
fi

echo ""
echo "[2/5] Installing Frontend dependencies..."
cd frontend && npm install
cd ..

echo ""
echo "[3/5] Installing Backend dependencies..."
cd backend
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -r requirements.txt --quiet
deactivate
cd ..

echo ""
echo "[4/5] Running Backend smoke test..."
source backend/.venv/bin/activate
python3 -c "from backend.services.synthetic_data_service import get_initial_history; evts = get_initial_history(5); print(f'  -> OK: {len(evts)} synthetic events generated')"
deactivate

echo ""
echo "[5/5] Running Frontend build check..."
cd frontend && npm run build > /dev/null 2>&1 && echo "  -> Frontend build: SUCCESS" && cd ..

echo ""
echo "============================================================"
echo "  SETUP COMPLETE. Run the demo:"
echo ""
echo "  TERMINAL 1 (Backend):"
echo "    source backend/.venv/bin/activate"
echo "    uvicorn backend.main:app --port 8000 --reload"
echo ""
echo "  TERMINAL 2 (Frontend):"
echo "    cd frontend && npm run dev"
echo ""
echo "  Open: http://localhost:3000"
echo "============================================================"
