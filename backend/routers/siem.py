import asyncio
import json
from typing import List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from pydantic import BaseModel
from backend.services.synthetic_data_service import (
    generate_synthetic_event,
    format_as_leef,
    format_as_cef,
    get_initial_history,
    QUERY_TEMPLATES,
    USERS
)
from backend.services.siem_service import siem_engine, RULES
from backend.services.presto_service import presto_executor
from backend.services.watsonx_data_service import (
    fetch_live_audit_history,
    execution_result_to_event,
    list_catalogs,
    list_schemas,
    list_tables,
    list_full_catalog_tree,
)
from backend.config import settings

router = APIRouter(prefix="/api/siem", tags=["SIEM Engine"])

class QueryRunRequest(BaseModel):
    sql: str
    user: str = "analyst_sarah"
    clientIp: str = "10.244.12.45"
    scenarioId: str = "custom"

# Active WebSocket connections
active_connections: List[WebSocket] = []

@router.get("/summary")
async def get_summary():
    """Returns SOC dashboard summary KPIs and engine health."""
    return siem_engine.get_summary_stats(live_mode=(settings.DEMO_MODE == "live"))

@router.get("/events")
async def get_events(limit: int = 50):
    """Returns recent Presto query audit events (real in live mode, synthetic in mock mode)."""
    if settings.DEMO_MODE == "live":
        # Always re-fetch in live mode so new queries are surfaced on every HTTP poll.
        # (The in-memory store is still used by the WebSocket path and offenses.)
        live_events = await fetch_live_audit_history(limit)
        if live_events:
            for ev in reversed(live_events):
                siem_engine.evaluate_event(ev)
            return siem_engine.events[:limit]
        # Presto unreachable — fall through to whatever is already in memory
        if siem_engine.events:
            return siem_engine.events[:limit]
        # Nothing in memory either — seed with synthetic baseline
        initial = get_initial_history(limit)
        for ev in reversed(initial):
            siem_engine.evaluate_event(ev)
    elif not siem_engine.events:
        # Mock mode: seed once, then serve from memory
        initial = get_initial_history(limit)
        for ev in reversed(initial):
            siem_engine.evaluate_event(ev)
    return siem_engine.events[:limit]

@router.get("/offenses")
async def get_offenses():
    """Returns triggered SIEM offenses and correlation alerts."""
    return siem_engine.offenses

@router.get("/rules")
async def get_rules():
    """Returns active correlation rules."""
    return RULES

# ---------------------------------------------------------------------------
# Catalog metadata endpoints (powered by real Presto in live mode)
# ---------------------------------------------------------------------------

@router.get("/catalog")
async def get_catalogs():
    """Lists ALL Presto catalogs visible to the configured user."""
    catalogs = await list_catalogs()
    return {"catalogs": catalogs, "source": "live" if settings.DEMO_MODE == "live" else "mock"}

@router.get("/catalog/tree")
async def get_catalog_tree():
    """
    Returns the full catalog → schema → table hierarchy across ALL catalogs
    visible to the configured user in a single response.
    Concurrent fan-out: one SHOW CATALOGS + N×SHOW SCHEMAS + M×SHOW TABLES.
    """
    tree = await list_full_catalog_tree()
    return {
        "tree": tree,
        "source": "live" if settings.DEMO_MODE == "live" else "mock",
        "totalCatalogs": len(tree),
        "totalSchemas": sum(len(c["schemas"]) for c in tree),
        "totalTables": sum(
            len(s["tables"]) for c in tree for s in c["schemas"]
        ),
    }

@router.get("/catalog/{catalog}/schemas")
async def get_schemas(catalog: str):
    """Lists all schemas within a catalog."""
    schemas = await list_schemas(catalog)
    return {"catalog": catalog, "schemas": schemas}

@router.get("/catalog/{catalog}/schemas/{schema}/tables")
async def get_tables(catalog: str, schema: str):
    """Lists tables and their data classification within a catalog.schema."""
    tables = await list_tables(catalog, schema)
    return {"catalog": catalog, "schema": schema, "tables": tables}

# ---------------------------------------------------------------------------
# Query execution
# ---------------------------------------------------------------------------

@router.post("/execute")
async def execute_query_and_audit(req: QueryRunRequest):
    """
    Executes a SQL query on Presto (real in live mode, simulated in mock mode)
    and emits a structured SIEM audit event.
    """
    exec_result = await presto_executor.execute_query(req.sql, req.user, req.clientIp)

    # Build audit event from the real execution result
    event = execution_result_to_event(exec_result, req.user, req.clientIp, req.sql)
    offense = siem_engine.evaluate_event(event)

    # Broadcast to live WebSocket clients
    ws_payload = {
        "type": "NEW_EVENT",
        "event": event,
        "offense": offense,
        "source": exec_result.get("source", "simulated"),
    }
    for ws in list(active_connections):
        try:
            await ws.send_text(json.dumps(ws_payload))
        except Exception:
            pass

    return {
        "execution": exec_result,
        "auditEvent": event,
        "triggeredOffense": offense,
        "source": exec_result.get("source", "simulated"),
    }

@router.post("/reset")
async def reset_siem():
    """Resets offenses and regenerates a clean baseline (real Presto history in live mode)."""
    siem_engine.events.clear()
    siem_engine.offenses.clear()

    live_events = await fetch_live_audit_history(20)
    if live_events:
        for ev in reversed(live_events):
            siem_engine.evaluate_event(ev)
        msg = f"SIEM state reset using {len(live_events)} real Presto audit events"
    else:
        initial = get_initial_history(20)
        for ev in reversed(initial):
            siem_engine.evaluate_event(ev)
        msg = "SIEM simulation state reset to synthetic baseline"

    return {"status": "SUCCESS", "message": msg}

@router.websocket("/ws")
async def websocket_stream(websocket: WebSocket):
    """Streams live Presto audit events and SIEM correlation alerts to the UI."""
    await websocket.accept()
    active_connections.append(websocket)
    try:
        while True:
            await asyncio.sleep(8.0)
            if settings.DEMO_MODE == "live":
                # Fetch only queries not yet seen — incremental poll across ALL catalogs
                new_events = await fetch_live_audit_history(limit=50, only_new=True)
                if not new_events:
                    continue  # nothing new — don't push stale data
                for bg_event in new_events:
                    offense = siem_engine.evaluate_event(bg_event)
                    await websocket.send_text(json.dumps({
                        "type": "NEW_EVENT",
                        "event": bg_event,
                        "offense": offense,
                    }))
            else:
                bg_event = generate_synthetic_event()
                offense = siem_engine.evaluate_event(bg_event)
                await websocket.send_text(json.dumps({
                    "type": "NEW_EVENT",
                    "event": bg_event,
                    "offense": offense,
                }))
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)
    except Exception:
        if websocket in active_connections:
            active_connections.remove(websocket)
