from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.config import settings
from backend.routers import health, siem, scenarios

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"[*] Starting watsonx.data Presto ⟷ SIEM Integration Demo Engine")
    print(f"[*] Mode: {settings.DEMO_MODE} | Presto target: {settings.PRESTO_HOST}:{settings.PRESTO_PORT}")
    print(f"[*] SIEM Ingestion & Simulator ready on ws://{settings.HOST}:{settings.PORT}/api/siem/ws")
    yield
    print(f"[*] Shutting down...")

app = FastAPI(
    title="watsonx.data Presto & SIEM Integration Engine",
    description="Bridge and demonstration service for Presto query audit streaming to Enterprise SIEMs (IBM QRadar, Splunk, Sentinel)",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(siem.router)
app.include_router(scenarios.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host=settings.HOST, port=settings.PORT, reload=True)
