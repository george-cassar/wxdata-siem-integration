"""
Presto / Trino HTTP client for IBM watsonx.data.

Uses the Trino Python client (`trino`) when available, with an httpx-based
fallback that speaks the Presto REST protocol (POST → poll nextUri).

Authentication: CP4D/watsonx.data Presto does NOT accept HTTP Basic Auth.
It requires Authorization: Bearer <cpd-token>.  Two ways to provide this:
  - PRESTO_BEARER_TOKEN: a pre-obtained CP4D access token (preferred)
  - PRESTO_USER + PRESTO_PASSWORD: exchanged automatically for a token via
    POST https://<PRESTO_CPD_HOST>/icp4d-api/v1/authorize on first use

SSL:  PRESTO_USE_SSL=true  (set PRESTO_SSL_VERIFY=false to skip cert validation
      for self-signed certificates — acceptable in a demo environment).
"""
import asyncio
import time
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

from backend.config import settings

logger = logging.getLogger("presto_service")

# Module-level cache so the token is fetched once per process startup
_cpd_token_cache: Optional[str] = None


# ---------------------------------------------------------------------------
# Trino Python client (optional — best path for production/live use)
# ---------------------------------------------------------------------------
try:
    import trino  # type: ignore
    from trino.auth import JWTAuthentication  # type: ignore
    TRINO_AVAILABLE = True
except ImportError:
    TRINO_AVAILABLE = False
    logger.info("trino package not installed; falling back to httpx Presto REST client")


# ---------------------------------------------------------------------------
# CP4D token exchange
# ---------------------------------------------------------------------------

def _get_cpd_token() -> Optional[str]:
    """
    Returns a CP4D bearer token.  Priority:
      1. PRESTO_BEARER_TOKEN env var (pre-obtained token, no exchange needed)
      2. Module-level cache (already exchanged this process)
      3. Exchange PRESTO_USER + PRESTO_PASSWORD via /icp4d-api/v1/authorize
    Returns None when no credentials are configured (mock / anonymous).
    Only called when DEMO_MODE=live, so network errors propagate to the caller
    which handles the simulation fallback.
    """
    global _cpd_token_cache

    # In mock mode never attempt a network call
    if settings.DEMO_MODE != "live":
        return None

    if settings.PRESTO_BEARER_TOKEN:
        return settings.PRESTO_BEARER_TOKEN

    if _cpd_token_cache:
        return _cpd_token_cache

    if not settings.PRESTO_PASSWORD:
        return None

    cpd_host = settings.PRESTO_CPD_HOST or settings.PRESTO_HOST
    url = f"https://{cpd_host}/icp4d-api/v1/authorize"
    logger.info("Fetching CP4D token from %s", url)
    resp = httpx.post(
        url,
        json={"username": settings.PRESTO_USER, "password": settings.PRESTO_PASSWORD},
        verify=settings.PRESTO_SSL_VERIFY,
        timeout=10.0,
    )
    resp.raise_for_status()
    body = resp.json()
    token = body.get("token") or body.get("access_token")
    if not token:
        raise ValueError(f"No token field in CP4D response: {list(body.keys())}")
    _cpd_token_cache = token
    logger.info("CP4D token obtained (first 12 chars: %s…)", token[:12])
    return token


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _build_headers(user: str, catalog: Optional[str] = None, schema: Optional[str] = None) -> Dict[str, str]:
    """Build Presto request headers.  catalog/schema override the session defaults."""
    headers: Dict[str, str] = {
        "X-Presto-User": user,
        "X-Presto-Catalog": catalog or settings.PRESTO_CATALOG,
        "X-Presto-Schema": schema or settings.PRESTO_SCHEMA,
        "X-Presto-Source": settings.PRESTO_SOURCE_TAG,
        "Content-Type": "text/plain",
    }
    token = _get_cpd_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _ssl_context():
    """Returns (verify, cert) suitable for httpx based on settings."""
    if not settings.PRESTO_USE_SSL:
        return False, None
    if not settings.PRESTO_SSL_VERIFY:
        return False, None  # skip cert validation (self-signed certificates)
    return True, None


# ---------------------------------------------------------------------------
# httpx Presto REST polling client
# ---------------------------------------------------------------------------

async def _execute_via_httpx(
    sql: str, user: str,
    catalog: Optional[str] = None,
    schema: Optional[str] = None,
    row_limit: int = 0,
) -> Tuple[str, List[str], List[List[Any]], int]:
    """
    Speaks the Presto HTTP protocol: POST statement → poll nextUri until done.
    catalog/schema override the session defaults (used for system.* queries).
    row_limit > 0: stop following nextUri as soon as we have that many rows
    (avoids paginating through 10k+ rows when the SQL says LIMIT N).
    Returns (status, columns, rows, duration_ms).

    Fixes applied:
    - Relative nextUri (e.g. /v1/query/xxx/results/1) is reconstructed into an
      absolute URL using the configured base_url.  Some CP4D Presto builds return
      relative paths; httpx.AsyncClient has no base_url set so a relative GET
      would raise UnsupportedProtocol and silently fall to simulation.
    - A hard wall-clock budget (_POLL_WALL_LIMIT_S) prevents the loop from
      running longer than the browser's axios timeout (90 s), which would cause
      the frontend to see a timeout error even when Presto eventually succeeds.
    """
    protocol = "https" if settings.PRESTO_USE_SSL else "http"
    base_url = f"{protocol}://{settings.PRESTO_HOST}:{settings.PRESTO_PORT}"
    headers = _build_headers(user, catalog=catalog, schema=schema)
    ssl_verify, _ = _ssl_context()

    all_rows: List[List[Any]] = []
    columns: List[str] = []
    status = "UNKNOWN"
    error_code: Optional[str] = None
    error_msg: Optional[str] = None
    start_ms = int(time.time() * 1000)
    wall_deadline = time.time() + settings.PRESTO_POLL_WALL_LIMIT_S

    async with httpx.AsyncClient(verify=ssl_verify, timeout=30.0) as client:
        # Submit query
        resp = await client.post(
            f"{base_url}/v1/statement",
            headers=headers,
            content=sql,
        )
        resp.raise_for_status()
        data = resp.json()

        # Poll until terminal state (or early-exit when row_limit reached)
        while True:
            state = data.get("stats", {}).get("state", "UNKNOWN")
            if data.get("columns") and not columns:
                columns = [c["name"] for c in data["columns"]]
            if data.get("data"):
                all_rows.extend(data["data"])

            # Early exit: we have all the rows we asked for
            if row_limit > 0 and len(all_rows) >= row_limit:
                status = "FINISHED"
                break

            if state in ("FINISHED", "FAILED", "CANCELED"):
                status = state
                # Capture the Presto error object — present on every FAILED response.
                # Without this the errorCode/errorMessage fields are lost and the UI
                # shows "FAILED in Xms" with no explanation of why.
                err_obj = data.get("error") or {}
                if err_obj:
                    error_code = err_obj.get("errorName") or str(err_obj.get("errorCode", ""))
                    error_msg  = err_obj.get("message") or err_obj.get("failureInfo", {}).get("message")
                break

            next_uri = data.get("nextUri")
            if not next_uri:
                status = "FINISHED"
                break

            # Hard wall-clock guard: stop before the browser axios timeout fires
            if time.time() >= wall_deadline:
                logger.warning(
                    "Presto poll exceeded %ss wall limit; returning partial results "
                    "(state=%s, rows=%d)", settings.PRESTO_POLL_WALL_LIMIT_S, state, len(all_rows)
                )
                status = state if state else "RUNNING"
                break

            # Reconstruct absolute URI — some CP4D Presto builds return a path-only
            # nextUri (e.g. /v1/query/xxx/results/1).  httpx has no base_url so a
            # relative URI raises UnsupportedProtocol; prefix it with base_url.
            if next_uri and not next_uri.startswith("http"):
                next_uri = f"{base_url}{next_uri}"

            await asyncio.sleep(settings.PRESTO_POLL_INTERVAL_S)
            resp = await client.get(next_uri, headers=headers)
            resp.raise_for_status()
            data = resp.json()

    duration_ms = int(time.time() * 1000) - start_ms
    return status, columns, all_rows, duration_ms, error_code, error_msg


# ---------------------------------------------------------------------------
# trino Python client (synchronous, run in thread pool)
# ---------------------------------------------------------------------------

def _execute_via_trino_sync(
    sql: str, user: str
) -> Tuple[str, List[str], List[List[Any]], int, Optional[str], Optional[str]]:
    """Synchronous execution via trino package (offloaded to thread pool).
    Returns 6-tuple matching _execute_via_httpx: (status, columns, rows, duration_ms, error_code, error_msg).
    """
    token = _get_cpd_token()
    auth = JWTAuthentication(token) if token else None

    conn = trino.dbapi.connect(
        host=settings.PRESTO_HOST,
        port=settings.PRESTO_PORT,
        user=user,
        catalog=settings.PRESTO_CATALOG,
        schema=settings.PRESTO_SCHEMA,
        auth=auth,
        http_scheme="https" if settings.PRESTO_USE_SSL else "http",
        verify=settings.PRESTO_SSL_VERIFY,
        source="watsonx-data-siem-demo",
        request_timeout=30,
    )
    cursor = conn.cursor()
    start_ms = int(time.time() * 1000)
    cursor.execute(sql)
    rows = cursor.fetchall()
    duration_ms = int(time.time() * 1000) - start_ms
    columns = [d[0] for d in cursor.description] if cursor.description else []
    conn.close()
    return "FINISHED", columns, [list(r) for r in rows], duration_ms, None, None


# ---------------------------------------------------------------------------
# Public executor class
# ---------------------------------------------------------------------------

class PrestoExecutor:
    """
    Executes queries against watsonx.data Presto/Trino.

    Live mode  (DEMO_MODE=live, PRESTO_HOST≠localhost):
      - CP4D/watsonx.data: always uses httpx REST polling, which sends
        X-Presto-User + Authorization: Bearer <token>.  The trino Python client
        is NOT used for CP4D because it sends X-Trino-User which watsonx.data
        Presto (Java) does not recognise, returning "400: User must be set".
      - Plain Trino (no token, no password): uses the trino client if available.
      - Falls back to simulation on any error.

    Mock mode: returns deterministic simulated responses for demo scenarios.
    """

    def __init__(self):
        self.host = settings.PRESTO_HOST
        self.port = settings.PRESTO_PORT
        self.catalog = settings.PRESTO_CATALOG
        self.schema = settings.PRESTO_SCHEMA

    async def execute_query(
        self,
        sql: str,
        user: str = "analyst_sarah",
        client_ip: str = "10.244.12.45",
        catalog: Optional[str] = None,
        schema: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Execute SQL and return structured result with metadata.
        catalog/schema override the session defaults when set (e.g. for system.* queries).
        """
        import re as _re
        start_time = time.time()

        # Extract LIMIT N from the SQL so the httpx poller can exit early
        _limit_match = _re.search(r'\bLIMIT\s+(\d+)', sql, _re.IGNORECASE)
        _row_limit = int(_limit_match.group(1)) if _limit_match else 0

        if settings.DEMO_MODE == "live" and settings.PRESTO_HOST not in ("localhost", "127.0.0.1"):
            try:
                token = _get_cpd_token()
                if token or not TRINO_AVAILABLE:
                    status, columns, rows, duration_ms, error_code, error_msg = await _execute_via_httpx(
                        sql, user, catalog=catalog, schema=schema, row_limit=_row_limit
                    )
                else:
                    status, columns, rows, duration_ms, error_code, error_msg = await asyncio.get_event_loop().run_in_executor(
                        None, _execute_via_trino_sync, sql, user
                    )

                return {
                    "status": status,
                    "queryId": f"live_{int(start_time * 1000)}",
                    "sql": sql,
                    "user": user,
                    "clientIp": client_ip,
                    "durationMs": duration_ms,
                    "columns": columns,
                    "data": rows[:settings.PRESTO_MAX_ROWS_UI],
                    "rowCount": len(rows),
                    "errorCode": error_code,
                    "errorMessage": error_msg,
                    "source": "live",
                }
            except Exception as exc:
                logger.warning("Live Presto query failed, falling back to simulation: %s", exc)

        # ── Simulation fallback ──────────────────────────────────────────
        return self._simulate(sql, user, client_ip, start_time)

    def _simulate(
        self, sql: str, user: str, client_ip: str, start_time: float
    ) -> Dict[str, Any]:
        sql_u = sql.strip().upper()
        duration_ms = 120
        status = "FINISHED"
        error_code = None
        error_msg = None
        rows_data: List[Any] = []
        columns: List[str] = []

        if any(kw in sql_u for kw in ("DROP ", "ALTER ", "TRUNCATE ")):
            duration_ms = 65
            status = "FAILED"
            error_code = "PERMISSION_DENIED"
            error_msg = f"User '{user}' lacks administrative DROP/ALTER authority on catalog '{self.catalog}'"
            columns = ["error"]
            rows_data = [[error_msg]]
        elif "CUSTOMER_ACCOUNTS" in sql_u or "SSN" in sql_u:
            duration_ms = 2400
            columns = ["account_id", "customer_name", "ssn_masked", "credit_card", "balance_usd"]
            rows_data = [
                ["ACC-90412", "E. Harper", "***-**-4912", "4532-****-****-8821", "$42,500.00"],
                ["ACC-90413", "M. Vance", "***-**-8123", "5425-****-****-1190", "$128,400.00"],
                ["ACC-90414", "S. Lin", "***-**-3341", "4012-****-****-7712", "$9,150.00"],
                ["[... 499,997 additional records streamed ...]"],
            ]
        elif "GROUP BY" in sql_u or "SUM(" in sql_u:
            duration_ms = 350
            columns = ["customer_region", "transaction_count", "total_volume_usd"]
            rows_data = [
                ["North America", "1,240,500", "$48,920,400.00"],
                ["EMEA", "980,120", "$36,410,200.00"],
                ["APAC", "750,400", "$28,100,500.00"],
                ["LATAM", "310,800", "$11,250,000.00"],
            ]
        else:
            duration_ms = 95
            columns = ["transaction_id", "account_id", "amount", "currency", "status"]
            rows_data = [
                ["TXN-881021", "ACC-90412", "1,450.00", "USD", "COMPLETED"],
                ["TXN-881022", "ACC-90413", "8,200.50", "USD", "COMPLETED"],
                ["TXN-881023", "ACC-90414", "230.00", "EUR", "COMPLETED"],
                ["TXN-881024", "ACC-90415", "14,000.00", "USD", "FLAGGED_REVIEW"],
            ]

        return {
            "status": status,
            "queryId": f"sim_{int(start_time * 1000)}",
            "sql": sql,
            "user": user,
            "clientIp": client_ip,
            "durationMs": duration_ms,
            "errorCode": error_code,
            "errorMessage": error_msg,
            "columns": columns,
            "data": rows_data,
            "rowCount": len(rows_data),
            "source": "simulated",
        }


presto_executor = PrestoExecutor()
