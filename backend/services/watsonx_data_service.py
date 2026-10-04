"""
watsonx.data Live Data Service
==============================
Queries real IBM watsonx.data (Presto/Trino) catalogs to:

  1. Discover the FULL catalog → schema → table hierarchy across ALL catalogs
     visible to the configured user — not limited to PRESTO_CATALOG/SCHEMA.
  2. Pull recent query history from the Presto system tables and convert each
     row into a structured SIEM audit event (same shape as synthetic events).
  3. Convert any live query execution result into a SIEM audit event.

The Presto `system` catalog exposes:
  • system.runtime.queries       – live and recent completed queries
  • system.runtime.tasks         – per-stage task detail
  • information_schema.tables    – table listing per catalog

PRESTO_CATALOG / PRESTO_SCHEMA in config.py are used only as:
  - the trino connection's session default (so bare table names resolve)
  - the fallback when a SQL statement cannot be parsed for catalog/schema
They do NOT limit which catalogs or schemas are discovered.
"""

import asyncio
import datetime
import logging
import uuid
from typing import Any, Dict, List, Optional

from backend.config import settings
from backend.services.presto_service import presto_executor
from backend.services.synthetic_data_service import format_as_leef, format_as_cef

logger = logging.getLogger("watsonx_data_service")

# Catalogs that are always internal to Presto/Trino — never user data
_INTERNAL_CATALOGS = {"jmx", "tpcds", "tpch"}
# Schemas that exist in every catalog but contain no user tables
_INTERNAL_SCHEMAS = {"information_schema"}


# ---------------------------------------------------------------------------
# Catalog / schema / table discovery — ALL catalogs, no hardcoded filter
# ---------------------------------------------------------------------------

async def list_catalogs() -> List[str]:
    """
    Returns ALL user-accessible Presto catalogs by running SHOW CATALOGS.
    Excludes purely internal engine catalogs (jmx, tpcds, tpch).
    PRESTO_CATALOG is NOT used as a filter here.
    """
    try:
        result = await presto_executor.execute_query(
            "SHOW CATALOGS",
            user=settings.PRESTO_USER,
        )
        if result.get("source") == "simulated":
            # Return a richer synthetic set to show the multi-catalog concept
            return ["iceberg_data", "hive_lake", "system"]
        catalogs = [row[0] for row in result.get("data", []) if row]
        return [c for c in catalogs if c not in _INTERNAL_CATALOGS]
    except Exception as exc:
        logger.warning("list_catalogs failed: %s", exc)
        return ["iceberg_data", "hive_lake", "system"]


async def list_schemas(catalog: str) -> List[str]:
    """
    Returns all user schemas within a catalog by running SHOW SCHEMAS FROM <catalog>.
    Excludes information_schema which exists in every catalog.
    """
    try:
        result = await presto_executor.execute_query(
            f"SHOW SCHEMAS FROM {catalog}",
            user=settings.PRESTO_USER,
        )
        if result.get("source") == "simulated":
            # Synthetic multi-schema fallback per catalog
            return _synthetic_schemas(catalog)
        schemas = [row[0] for row in result.get("data", []) if row]
        return [s for s in schemas if s not in _INTERNAL_SCHEMAS]
    except Exception as exc:
        logger.warning("list_schemas(%s) failed: %s", catalog, exc)
        return _synthetic_schemas(catalog)


async def list_tables(catalog: str, schema: str) -> List[Dict[str, str]]:
    """
    Returns tables and their auto-classified data sensitivity labels
    for a specific catalog.schema pair.
    """
    try:
        result = await presto_executor.execute_query(
            f"SHOW TABLES FROM {catalog}.{schema}",
            user=settings.PRESTO_USER,
        )
        tables = []
        for row in result.get("data", []):
            tname = row[0] if row else ""
            if not tname:
                continue
            tables.append({
                "catalog": catalog,
                "schema": schema,
                "table": tname,
                "classification": _classify_table(tname),
            })
        return tables
    except Exception as exc:
        logger.warning("list_tables(%s.%s) failed: %s", catalog, schema, exc)
        return []


async def list_full_catalog_tree() -> List[Dict[str, Any]]:
    """
    Walks ALL catalogs → schemas → tables and returns a nested tree.

    Shape:
      [
        {
          "catalog": "iceberg_data",
          "schemas": [
            {
              "schema": "finance",
              "tables": [
                {"table": "transactions", "classification": "Confidential"},
                ...
              ]
            },
            ...
          ]
        },
        ...
      ]

    In live mode this calls SHOW CATALOGS once, then fans out SHOW SCHEMAS
    per catalog concurrently, then fans out SHOW TABLES per schema concurrently.
    In mock mode it returns a rich synthetic tree so the UI is demo-ready.
    """
    catalogs = await list_catalogs()

    async def build_catalog_node(catalog: str) -> Dict[str, Any]:
        schemas = await list_schemas(catalog)

        async def build_schema_node(schema: str) -> Dict[str, Any]:
            tables = await list_tables(catalog, schema)
            return {"schema": schema, "tables": tables}

        schema_nodes = await asyncio.gather(
            *[build_schema_node(s) for s in schemas],
            return_exceptions=False,
        )
        return {"catalog": catalog, "schemas": list(schema_nodes)}

    tree = await asyncio.gather(
        *[build_catalog_node(c) for c in catalogs],
        return_exceptions=False,
    )
    return list(tree)


# ---------------------------------------------------------------------------
# Synthetic multi-catalog fallback (mock mode / Presto unreachable)
# ---------------------------------------------------------------------------

def _synthetic_schemas(catalog: str) -> List[str]:
    """Returns a plausible set of schemas for a given synthetic catalog name."""
    _map = {
        "iceberg_data": ["finance", "compliance", "risk"],
        "hive_lake":    ["analytics", "telemetry", "raw_ingest"],
        "system":       ["runtime", "jdbc"],
    }
    return _map.get(catalog, ["default"])


def _classify_table(table_name: str) -> str:
    """Heuristic data classification based on table name."""
    name = table_name.lower()
    if any(k in name for k in ("customer", "account", "ssn", "credit", "pii", "kyc")):
        return "Restricted-PII"
    if any(k in name for k in ("compliance", "audit", "regulation", "gdpr")):
        return "Restricted-Compliance"
    if any(k in name for k in ("transaction", "payment", "order", "invoice", "finance")):
        return "Confidential"
    return "Internal"


# ---------------------------------------------------------------------------
# Query history from system tables → SIEM events
# ---------------------------------------------------------------------------

# system.runtime.queries — running + recently cached queries.
# Columns confirmed on watsonx.data CP4D: query_id, state, user, query,
# created, end, source  (no error_type, no started column on this build).
_RUNTIME_QUERIES_SQL = """
SELECT
    query_id,
    state,
    user,
    source,
    created,
    "end",
    query
FROM system.runtime.queries
ORDER BY created DESC
LIMIT {limit}
"""

# wxd_system_data.<diag_schema>.query_completed_event_view
# — persistent audit history for ALL catalogs/schemas on watsonx.data CP4D.
# Column names confirmed from live DESCRIBE:
#   cluster_name, query_id, query_state, create_time, end_time, wallTimeMillis,
#   user, catalog, schema, query, total_rows, total_bytes, error_code, failure_message
#
# PERFORMANCE NOTE: ORDER BY create_time DESC forces Presto to scan all 10k+
# rows before returning any, taking 60+ s.  We use NO ORDER BY so Presto can
# emit the first LIMIT rows immediately (~3 s), then sort client-side in Python.
# We also fetch a larger batch (limit * 4) so the client-side sort has a
# meaningful pool of rows to pick "most recent" from.
_WXD_HISTORY_SQL = """
SELECT
    query_id,
    query_state,
    user,
    source,
    create_time,
    end_time,
    wallTimeMillis,
    catalog,
    schema,
    query,
    total_rows,
    total_bytes,
    error_code,
    failure_message
FROM {full_table}
LIMIT {fetch_limit}
"""

# Cached at first use so we only run SHOW SCHEMAS once per process
_wxd_diag_schema_cache: Optional[str] = None

# Module-level set of already-seen query_ids so WebSocket pushes only new rows
_seen_query_ids: set = set()


def _row_to_event(row: List[Any], columns: List[str]) -> Optional[Dict[str, Any]]:
    """
    Converts a system.runtime.queries row into a SIEM audit event dict.
    Column names confirmed on watsonx.data CP4D:
      query_id, state, user, source, created, end, query
    """
    try:
        def col(name: str, default: Any = None) -> Any:
            try:
                return row[columns.index(name)]
            except (ValueError, IndexError):
                return default

        query_id = str(col("query_id", uuid.uuid4()))
        state    = str(col("state", "FINISHED"))
        user     = str(col("user", settings.PRESTO_USER))
        sql_text = str(col("query", "SELECT 1")).replace("<<>>", "\n")
        source   = str(col("source", "watsonx.data"))
        error_code = col("error_code")

        created = col("created")
        end     = col("end")
        try:
            ts_start = _parse_ts(created)
            ts_end   = _parse_ts(end) if end else ts_start
            duration_ms = max(0, int((ts_end - ts_start).total_seconds() * 1000))
        except Exception:
            ts_end = datetime.datetime.now(datetime.timezone.utc)
            duration_ms = 0

        sql_u = sql_text.upper()
        risk_level, category, rows_scanned, bytes_scanned = _assess_risk(sql_u, state)
        catalog_val, schema_val = _extract_catalog_schema(sql_text)
        status = "FINISHED" if state == "FINISHED" else ("FAILED" if state == "FAILED" else state)

        return _build_event(
            query_id=query_id, user=user, source=source,
            ts_start=ts_start if created else ts_end, ts_end=ts_end,
            duration_ms=duration_ms, wall_ms=duration_ms,
            catalog=catalog_val, schema=schema_val, sql_text=sql_text,
            state=state, status=status,
            rows_scanned=rows_scanned, bytes_scanned=bytes_scanned,
            error_code=str(error_code) if error_code else None, error_msg=None,
            risk_level=risk_level, category=category,
        )
    except Exception as exc:
        logger.debug("_row_to_event failed: %s", exc)
        return None


def _wxd_row_to_event(row: List[Any], columns: List[str]) -> Optional[Dict[str, Any]]:
    """
    Converts a wxd_system_data query_completed_event_view row into a SIEM event.
    Column names confirmed on watsonx.data CP4D:
      query_id, query_state, user, source, create_time, end_time, wallTimeMillis,
      catalog, schema, query, total_rows, total_bytes, error_code, failure_message
    """
    try:
        def col(name: str, default: Any = None) -> Any:
            try:
                return row[columns.index(name)]
            except (ValueError, IndexError):
                return default

        query_id   = str(col("query_id", uuid.uuid4()))
        state      = str(col("query_state", "FINISHED"))
        user       = str(col("user", settings.PRESTO_USER))
        sql_text   = str(col("query", "SELECT 1")).replace("<<>>", "\n")
        source     = str(col("source", "watsonx.data"))
        # Raw values from the view — may be Python None
        _raw_catalog = col("catalog")
        _raw_schema  = col("schema")
        wall_ms     = int(col("wallTimeMillis", 0) or 0)
        total_rows  = int(col("total_rows", 0) or 0)
        total_bytes = int(col("total_bytes", 0) or 0)
        error_code  = col("error_code")
        error_msg   = col("failure_message")

        create_time = col("create_time")
        end_time    = col("end_time")
        try:
            ts_start = _parse_ts(create_time)
            ts_end   = _parse_ts(end_time) if end_time else ts_start
        except Exception:
            ts_end = datetime.datetime.now(datetime.timezone.utc)
            ts_start = ts_end

        sql_u = sql_text.upper()
        risk_level, category, rows_est, bytes_est = _assess_risk(sql_u, state)
        # Prefer real metrics over heuristic estimates
        rows_scanned  = total_rows  if total_rows  > 0 else rows_est
        bytes_scanned = total_bytes if total_bytes > 0 else bytes_est
        status = "FINISHED" if state == "FINISHED" else ("FAILED" if state == "FAILED" else state)

        # Resolve catalog/schema: use the view's columns when present, otherwise
        # parse from the SQL text, and fall back to session defaults last.
        if _raw_catalog and str(_raw_catalog) not in ("None", "null", ""):
            catalog_val = str(_raw_catalog)
            schema_val  = str(_raw_schema) if (_raw_schema and str(_raw_schema) not in ("None", "null", "")) else ""
        else:
            catalog_val, schema_val = _extract_catalog_schema(sql_text)

        return _build_event(
            query_id=query_id, user=user, source=source,
            ts_start=ts_start, ts_end=ts_end,
            duration_ms=wall_ms, wall_ms=wall_ms,
            catalog=catalog_val, schema=schema_val, sql_text=sql_text,
            state=state, status=status,
            rows_scanned=rows_scanned, bytes_scanned=bytes_scanned,
            error_code=str(error_code) if error_code else None,
            error_msg=str(error_msg) if error_msg else None,
            risk_level=risk_level, category=category,
        )
    except Exception as exc:
        logger.debug("_wxd_row_to_event failed: %s", exc)
        return None


def _build_event(
    query_id: str, user: str, source: str,
    ts_start: datetime.datetime, ts_end: datetime.datetime,
    duration_ms: int, wall_ms: int,
    catalog: str, schema: str, sql_text: str,
    state: str, status: str,
    rows_scanned: int, bytes_scanned: int,
    error_code: Optional[str], error_msg: Optional[str],
    risk_level: str, category: str,
) -> Dict[str, Any]:
    """Assembles the canonical SIEM audit event dict used by both converters."""
    sql_u = sql_text.upper()
    event: Dict[str, Any] = {
        "eventId":     str(uuid.uuid4()),
        "queryId":     query_id,
        "engine":      "Presto (Java) 0.286",
        "cluster":     settings.PRESTO_HOST.split(".")[0] if settings.PRESTO_HOST else "watsonx-data",
        "timestamp":   ts_end.isoformat(),
        "createdTime": ts_start.isoformat(),
        "endTime":     ts_end.isoformat(),
        "durationMs":  duration_ms,
        "cpuTimeMs":   int(wall_ms * 1.8),
        "user":        user,
        "userRole":    _infer_role(user),
        "clientIp":    _infer_ip(user),
        "source":      source,
        "catalog":     catalog,
        "schema":      schema,
        "sqlText":     sql_text,
        "queryType":   _infer_query_type(sql_u),
        "category":    category,
        "riskLevel":   risk_level,
        "rowsScanned": rows_scanned,
        "rowsReturned": rows_scanned if status == "FINISHED" else 0,
        "bytesScanned": bytes_scanned,
        "status":      status,
        "errorCode":   error_code,
        "errorMessage": error_msg,
    }
    event["leefPayload"] = format_as_leef(event)
    event["cefPayload"]  = format_as_cef(event)
    return event


def _parse_ts(val: Any) -> datetime.datetime:
    if isinstance(val, datetime.datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=datetime.timezone.utc)
        return val
    s = str(val)
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%f %Z",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S %Z",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f %Z",
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
    ):
        try:
            dt = datetime.datetime.strptime(s.replace("UTC", "").strip(), fmt.replace(" %Z", ""))
            return dt.replace(tzinfo=datetime.timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse timestamp: {val!r}")


def _assess_risk(sql_u: str, state: str):
    """Returns (risk_level, category, rows_scanned_estimate, bytes_estimate)."""
    # DDL destruction / privilege ops — highest priority
    if any(k in sql_u for k in ("DROP ", "ALTER ", "TRUNCATE ")):
        return "HIGH", "Unauthorized DDL Attempt", 0, 1024
    # CREATE (incl. CREATE TABLE AS SELECT) — must come before SELECT-wildcard rules
    if sql_u.lstrip().startswith("CREATE"):
        return "LOW", "DDL Object Creation", 0, 1024
    # Targeted PII exfiltration via wildcard
    if ("SSN" in sql_u or "CREDIT_CARD" in sql_u or "CUSTOMER_ACCOUNTS" in sql_u) and "SELECT *" in sql_u:
        return "CRITICAL", "Mass PII Exfiltration", 500_000, 250_000_000
    # Unbounded scan — only applies to plain SELECT, not CTAS
    if "WHERE 1=1" in sql_u or ("SELECT *" in sql_u and "LIMIT" not in sql_u):
        return "MEDIUM", "Unbounded Table Scan", 200_000, 95_000_000
    if any(k in sql_u for k in ("KYC", "COMPLIANCE", "GDPR")):
        return "MEDIUM", "Restricted Compliance Table Access", 5_000, 2_500_000
    if any(k in sql_u for k in ("GROUP BY", "SUM(", "AVG(", "COUNT(")):
        return "LOW", "BI Report Aggregation", 20, 850_000
    return "LOW", "Standard Analytics", 100, 45_000


def _extract_catalog_schema(sql: str):
    """Best-effort extraction of catalog.schema from a SQL statement.

    Handles both quoted identifiers ("catalog"."schema"."table") and
    unquoted identifiers (catalog.schema.table), as well as mixed forms.
    Returns the first three-part name found, or the configured defaults.
    """
    import re

    # ── Quoted identifiers: "catalog"."schema"."table" ─────────────────────
    # Each segment is either "word" or bare word, separated by dots.
    _id = r'(?:"([\w]+)"|(\b[\w]+\b))'
    quoted_pattern = re.compile(
        _id + r'\.' + _id + r'\.' + _id,
        re.IGNORECASE,
    )
    m = quoted_pattern.search(sql)
    if m:
        # Each _id group contributes 2 capture groups: quoted and unquoted.
        # Groups: (1,2) = catalog, (3,4) = schema, (5,6) = table
        catalog_val = m.group(1) or m.group(2)  # prefer quoted, fallback unquoted
        schema_val  = m.group(3) or m.group(4)
        if catalog_val and schema_val:
            return catalog_val, schema_val

    # ── Unquoted only (fast path for plain identifiers) ────────────────────
    matches = re.findall(r'\b([\w]+)\.([\w]+)\.[\w]+', sql, re.IGNORECASE)
    if matches:
        return matches[0][0], matches[0][1]

    return settings.PRESTO_CATALOG, settings.PRESTO_SCHEMA


def _infer_role(user: str) -> str:
    mapping = {
        "admin": "Platform Admin",
        "ibmacp": "Platform Admin",
        "analyst": "Data Analyst",
        "eng": "Data Engineer",
        "service": "Service Account",
        "bot": "Automation Bot",
        "contractor": "External Consultant",
    }
    u = user.lower()
    for key, role in mapping.items():
        if key in u:
            return role
    return "Data User"


def _infer_ip(user: str) -> str:
    """Returns a plausible internal IP for known user patterns."""
    u = user.lower()
    if "contractor" in u or "external" in u:
        return "192.168.100.55"
    if "admin" in u or "ibmacp" in u:
        return "10.244.1.4"
    if "service" in u or "bot" in u:
        return "10.244.20.101"
    # Hash-based deterministic IP for repeatability
    h = hash(user) & 0xFFFF
    return f"10.244.{(h >> 8) & 0xFF}.{h & 0xFF}"


def _infer_query_type(sql_u: str) -> str:
    # Check DDL & destruction / modification operations
    if sql_u.startswith("DROP") or " DROP " in sql_u:
        return "DROP"
    if sql_u.startswith("ALTER") or " ALTER " in sql_u:
        return "ALTER"
    if sql_u.startswith("TRUNCATE") or " TRUNCATE " in sql_u:
        return "TRUNCATE"
    if sql_u.startswith("DELETE") or " DELETE " in sql_u:
        return "DELETE"
    if sql_u.startswith("CREATE") or " CREATE " in sql_u:
        return "CREATE"
    if sql_u.startswith("INSERT") or " INSERT " in sql_u:
        return "INSERT"
    if sql_u.startswith("UPDATE") or " UPDATE " in sql_u:
        return "UPDATE"
    if sql_u.startswith("GRANT") or " GRANT " in sql_u or sql_u.startswith("REVOKE") or " REVOKE " in sql_u:
        return "ACCESS_CONTROL"
    if sql_u.startswith("SHOW") or sql_u.startswith("DESCRIBE") or sql_u.startswith("EXPLAIN"):
        return "METADATA"
    
    # Check threat/analytics query types
    if "SSN" in sql_u or "CREDIT_CARD" in sql_u or "PASSWORD" in sql_u:
        return "EXFILTRATION"
    if "GROUP BY" in sql_u or "COUNT(" in sql_u or "SUM(" in sql_u or "AVG(" in sql_u:
        return "AGGREGATION"
    if "WHERE 1=1" in sql_u or ("SELECT *" in sql_u and "LIMIT" not in sql_u):
        return "TABLE_SCAN"
    if "SELECT" in sql_u:
        return "SELECT"
    return "OTHER"


# ---------------------------------------------------------------------------
# Public API: fetch real audit history from Presto
# ---------------------------------------------------------------------------

async def fetch_live_audit_history(limit: int = 50, only_new: bool = False) -> List[Dict[str, Any]]:
    """
    Pulls recent query history across ALL catalogs and schemas and converts
    each row into a SIEM audit event.

    Sources (queried concurrently, merged + deduplicated by query_id):
      1. system.runtime.queries                              — live / cached queries
      2. wxd_system_data.<diag_schema>.query_completed_event_view — persistent audit log

    only_new=True skips rows whose query_id was already seen (WebSocket polling).
    Returns [] if DEMO_MODE != "live" so callers fall back to synthetic history.
    """
    global _seen_query_ids, _wxd_diag_schema_cache

    if settings.DEMO_MODE != "live" or settings.PRESTO_HOST in ("localhost", "127.0.0.1"):
        return []

    # ------------------------------------------------------------------ #
    # 1. Discover the wxd_system_data diagnostic schema (cached after     #
    #    first successful call — one SHOW SCHEMAS per process lifetime).  #
    # ------------------------------------------------------------------ #
    if _wxd_diag_schema_cache is None:
        try:
            r = await presto_executor.execute_query(
                "SHOW SCHEMAS FROM wxd_system_data",
                user=settings.PRESTO_USER,
                catalog="wxd_system_data",
                schema="",
            )
            schemas = [row[0] for row in r.get("data", []) if row]
            diag = next((s for s in schemas if "diag" in s.lower()), None)
            _wxd_diag_schema_cache = diag or ""
            logger.info("wxd_system_data diag schema discovered: %r", _wxd_diag_schema_cache)
        except Exception as exc:
            logger.warning("Could not discover wxd diag schema: %s", exc)
            _wxd_diag_schema_cache = ""

    # ------------------------------------------------------------------ #
    # 2. Source A — system.runtime.queries (running / recently cached)   #
    # ------------------------------------------------------------------ #
    async def fetch_runtime() -> List[Dict[str, Any]]:
        try:
            # Fetch 4× rows (same multiplier as wxd_history) so that sorting
            # client-side has a meaningful pool even without ORDER BY in Presto.
            fetch_limit = limit * 4
            r = await presto_executor.execute_query(
                _RUNTIME_QUERIES_SQL.format(limit=fetch_limit),
                user=settings.PRESTO_USER,
                catalog="system",
                schema="runtime",
            )
            if r.get("source") == "simulated":
                return []
            cols = r.get("columns", [])
            events = [ev for ev in (_row_to_event(row, cols) for row in r.get("data", [])) if ev]
            events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
            return events[:limit]
        except Exception as exc:
            logger.debug("fetch_runtime failed: %s", exc)
            return []

    # ------------------------------------------------------------------ #
    # 3. Source B — wxd_system_data persistent audit history             #
    # No ORDER BY in the SQL — ORDER BY on 10k+ unpartitioned ORC rows   #
    # forces a full scan and sort (60+ s). Instead we fetch limit*4 rows  #
    # without ORDER BY (~3 s for the first page), convert them, then sort  #
    # newest-first in Python. The larger fetch pool gives the sort enough  #
    # material to surface the most-recent events.                          #
    # ------------------------------------------------------------------ #
    async def fetch_wxd_history() -> List[Dict[str, Any]]:
        if not _wxd_diag_schema_cache:
            return []
        # Quote the schema name — it contains dots/hyphens on watsonx.data CP4D
        full_table = f'wxd_system_data."{_wxd_diag_schema_cache}".query_completed_event_view'
        # Fetch more rows than we need so client-side sort has a meaningful pool
        fetch_limit = limit * 4
        try:
            r = await presto_executor.execute_query(
                _WXD_HISTORY_SQL.format(full_table=full_table, fetch_limit=fetch_limit),
                user=settings.PRESTO_USER,
                catalog="wxd_system_data",
                schema=_wxd_diag_schema_cache,
            )
            if r.get("source") == "simulated":
                return []
            cols = r.get("columns", [])
            events = [ev for ev in (_wxd_row_to_event(row, cols) for row in r.get("data", [])) if ev]
            # Sort newest-first in Python (avoids ORDER BY in Presto)
            events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
            logger.info("wxd_history: %d events fetched (fetch_limit=%d)", len(events), fetch_limit)
            return events[:limit]
        except Exception as exc:
            logger.debug("fetch_wxd_history failed: %s", exc)
            return []

    # ------------------------------------------------------------------ #
    # 4. Merge concurrently — wxd_history first (richer / more complete) #
    # ------------------------------------------------------------------ #
    runtime_events, wxd_events = await asyncio.gather(fetch_runtime(), fetch_wxd_history())

    seen_ids: set = set()
    merged: List[Dict[str, Any]] = []
    for ev in wxd_events + runtime_events:   # wxd first so it wins dedup
        qid = ev.get("queryId", "")
        if qid not in seen_ids:
            seen_ids.add(qid)
            merged.append(ev)

    merged.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    merged = merged[:limit]

    logger.info(
        "fetch_live_audit_history: %d total (runtime=%d, wxd=%d) → trimmed to %d",
        len(seen_ids), len(runtime_events), len(wxd_events), len(merged),
    )

    # ------------------------------------------------------------------ #
    # 5. Incremental filter for WebSocket polling                         #
    # ------------------------------------------------------------------ #
    if only_new:
        new_events = [e for e in merged if e.get("queryId") not in _seen_query_ids]
        _seen_query_ids.update(e.get("queryId") for e in new_events)
        logger.info("WebSocket incremental: %d new events", len(new_events))
        return new_events

    # Full refresh — reset the seen-id window to the current result set
    _seen_query_ids = {e.get("queryId") for e in merged}
    return merged


# ---------------------------------------------------------------------------
# Public API: convert a live query execution result → SIEM event
# ---------------------------------------------------------------------------

def execution_result_to_event(
    exec_result: Dict[str, Any],
    user: str,
    client_ip: str,
    sql: str,
) -> Dict[str, Any]:
    """
    Builds a SIEM audit event from a live Presto execution result dict
    (as returned by PrestoExecutor.execute_query).

    Works for both 'live' and 'simulated' source results.
    """
    sql_u = sql.upper()
    status = exec_result.get("status", "FINISHED")
    duration_ms = exec_result.get("durationMs", 0)
    row_count = exec_result.get("rowCount", len(exec_result.get("data", [])))

    risk_level, category, rows_scanned, bytes_scanned = _assess_risk(sql_u, status)

    # For live results we can use actual row counts
    if exec_result.get("source") == "live":
        rows_scanned = row_count

    catalog, schema = _extract_catalog_schema(sql)
    now = datetime.datetime.now(datetime.timezone.utc)

    event = {
        "eventId": str(uuid.uuid4()),
        "queryId": exec_result.get("queryId", f"evt_{int(now.timestamp() * 1000)}"),
        "engine": "Presto (Java) 0.286",
        "cluster": settings.PRESTO_HOST.split(".")[0] if settings.PRESTO_HOST else "watsonx-data",
        "timestamp": now.isoformat(),
        "createdTime": now.isoformat(),
        "endTime": now.isoformat(),
        "durationMs": duration_ms,
        "cpuTimeMs": int(duration_ms * 1.8),
        "user": user,
        "userRole": _infer_role(user),
        "clientIp": client_ip,
        "source": "watsonx.data Query Workspace / JDBC",
        "catalog": catalog,
        "schema": schema,
        "sqlText": sql,
        "queryType": _infer_query_type(sql_u),
        "category": category,
        "riskLevel": risk_level,
        "rowsScanned": rows_scanned,
        "rowsReturned": row_count if status == "FINISHED" else 0,
        "bytesScanned": bytes_scanned,
        "status": status,
        "errorCode": exec_result.get("errorCode"),
        "errorMessage": exec_result.get("errorMessage"),
    }
    event["leefPayload"] = format_as_leef(event)
    event["cefPayload"] = format_as_cef(event)
    return event
