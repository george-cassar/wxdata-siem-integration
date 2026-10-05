from fastapi import APIRouter
from backend.config import settings

router = APIRouter(prefix="/api", tags=["Health & Status"])

@router.get("/health")
async def health_check():
    protocol = "https" if settings.PRESTO_USE_SSL else "http"
    presto_url = f"{protocol}://{settings.PRESTO_HOST}:{settings.PRESTO_PORT}"
    base = {
        "status": "UP",
        "demoMode": settings.DEMO_MODE,
        "service": "watsonx.data-presto-siem-bridge",
        "version": "1.0.0",
    }
    if settings.DEMO_MODE == "live":
        base["presto"] = {
            "url": presto_url,
            "host": settings.PRESTO_HOST,
            "port": settings.PRESTO_PORT,
            "user": settings.PRESTO_USER,
            "catalog": settings.PRESTO_CATALOG,
            "schema": settings.PRESTO_SCHEMA,
            "ssl": settings.PRESTO_USE_SSL,
            "sslVerify": settings.PRESTO_SSL_VERIFY,
            "authMethod": "bearer_token" if settings.PRESTO_BEARER_TOKEN else "password",
        }
    else:
        base["disclaimer"] = "All queries and log event streams contain synthetic data only."
    return base


@router.get("/config")
async def get_frontend_config():
    """Exposes backend-configured defaults consumed by the frontend Query Studio."""
    return {
        "defaultQueryUser": settings.DEFAULT_QUERY_USER,
        "defaultQueryClientIp": settings.DEFAULT_QUERY_CLIENT_IP,
        "defaultQuerySql": settings.DEFAULT_QUERY_SQL.format(
            catalog=settings.PRESTO_CATALOG,
            schema=settings.PRESTO_SCHEMA,
        ),
        "wsEventRingSize": settings.WS_EVENT_RING_SIZE,
        "wsOffenseRingSize": settings.WS_OFFENSE_RING_SIZE,
        "dashboardInitialEventCount": settings.DASHBOARD_INITIAL_EVENT_COUNT,
    }
