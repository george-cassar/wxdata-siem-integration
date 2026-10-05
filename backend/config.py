import os
from typing import List
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DEMO_MODE: str = os.getenv("DEMO_MODE", "mock")
    PORT: int = int(os.getenv("PORT", "8000"))
    HOST: str = os.getenv("HOST", "0.0.0.0")

    # watsonx.data Presto / Trino Settings
    PRESTO_HOST: str = os.getenv("PRESTO_HOST", "localhost")
    PRESTO_PORT: int = int(os.getenv("PRESTO_PORT", "8443"))
    PRESTO_USER: str = os.getenv("PRESTO_USER", "ibmacp")
    PRESTO_PASSWORD: str = os.getenv("PRESTO_PASSWORD", "")
    # JWT bearer token – preferred auth for watsonx.data service accounts
    PRESTO_BEARER_TOKEN: str = os.getenv("PRESTO_BEARER_TOKEN", "")
    # Default catalog/schema used as the Trino connection's session default
    # and as the fallback when catalog/schema cannot be parsed from SQL.
    # These do NOT limit which catalogs are discovered — all catalogs visible
    # to PRESTO_USER are always enumerated via SHOW CATALOGS.
    # CP4D console hostname used to exchange username+password for a bearer token.
    # Defaults to PRESTO_HOST when not set (they are often the same).
    PRESTO_CPD_HOST: str = os.getenv("PRESTO_CPD_HOST", "")
    PRESTO_CATALOG: str = os.getenv("PRESTO_CATALOG", "iceberg_data")
    PRESTO_SCHEMA: str = os.getenv("PRESTO_SCHEMA", "finance")
    PRESTO_USE_SSL: bool = os.getenv("PRESTO_USE_SSL", "false").lower() == "true"
    # Set to "false" to skip TLS verification for self-signed certificates
    PRESTO_SSL_VERIFY: bool = os.getenv("PRESTO_SSL_VERIFY", "true").lower() == "true"
    # Source tag sent in X-Presto-Source header
    PRESTO_SOURCE_TAG: str = os.getenv("PRESTO_SOURCE_TAG", "watsonx-data-siem-demo")
    # X-Presto-User sent for audit/system queries (system.runtime.queries and
    # wxd_system_data views).  On watsonx.data CP4D the diagnostic view enforces
    # row-level security based on X-Presto-User: only rows where user = header
    # value are returned.  Setting this to "ibmlhapiuser" (the built-in CP4D
    # service account) bypasses the per-user filter and returns ALL users' queries.
    # The Bearer token (PRESTO_USER / PRESTO_BEARER_TOKEN) still authenticates
    # the HTTP request — these two concerns are independent.
    # Leave blank to use PRESTO_USER (the default before this setting existed).
    PRESTO_AUDIT_USER: str = os.getenv("PRESTO_AUDIT_USER", "ibmlhapiuser")
    # How many hours back the wxd_system_data history query looks.
    # Increase this if you need to surface queries older than the default window.
    AUDIT_HISTORY_HOURS: int = int(os.getenv("AUDIT_HISTORY_HOURS", "24"))
    # Hard wall-clock budget (seconds) for the httpx polling loop
    PRESTO_POLL_WALL_LIMIT_S: float = float(os.getenv("PRESTO_POLL_WALL_LIMIT_S", "75"))
    # Polling interval (seconds) between nextUri fetches
    PRESTO_POLL_INTERVAL_S: float = float(os.getenv("PRESTO_POLL_INTERVAL_S", "0.2"))
    # Maximum rows returned to the UI per query (safety cap)
    PRESTO_MAX_ROWS_UI: int = int(os.getenv("PRESTO_MAX_ROWS_UI", "500"))

    # Engine metadata — used in SIEM event payloads
    ENGINE_VERSION: str = os.getenv("ENGINE_VERSION", "Presto (Java) 0.286")
    # Cluster name reported in SIEM events (defaults to first segment of PRESTO_HOST)
    CLUSTER_NAME: str = os.getenv("CLUSTER_NAME", "")

    # CPU-time multiplier applied to wall-clock duration to estimate cpuTimeMs
    CPU_TIME_MULTIPLIER: float = float(os.getenv("CPU_TIME_MULTIPLIER", "1.8"))

    # LEEF/CEF vendor and product strings embedded in every formatted payload
    SIEM_VENDOR: str = os.getenv("SIEM_VENDOR", "IBM")
    SIEM_PRODUCT: str = os.getenv("SIEM_PRODUCT", "watsonx.data")
    SIEM_PRODUCT_VERSION: str = os.getenv("SIEM_PRODUCT_VERSION", "2.0.1")
    # Maximum characters of SQL text included in a CEF msg field
    SIEM_CEF_SQL_SNIPPET_LEN: int = int(os.getenv("SIEM_CEF_SQL_SNIPPET_LEN", "120"))
    # Maximum characters of SQL text included in a SIEM offense sqlSnippet
    SIEM_OFFENSE_SQL_SNIPPET_LEN: int = int(os.getenv("SIEM_OFFENSE_SQL_SNIPPET_LEN", "140"))

    # Simulated SIEM Engine Settings
    SIEM_SIMULATION_ENABLED: bool = True
    SIEM_FORWARD_HOST: str = os.getenv("SIEM_FORWARD_HOST", "")
    SIEM_FORWARD_PORT: int = int(os.getenv("SIEM_FORWARD_PORT", "514"))
    SIEM_FORWARD_PROTOCOL: str = os.getenv("SIEM_FORWARD_PROTOCOL", "UDP")
    SIEM_FORMAT: str = os.getenv("SIEM_FORMAT", "LEEF_2_0")

    # SIEM correlation rule thresholds
    RULE_EXFIL_ROW_THRESHOLD: int = int(os.getenv("RULE_EXFIL_ROW_THRESHOLD", "100000"))
    RULE_EXFIL_BYTES_THRESHOLD: int = int(os.getenv("RULE_EXFIL_BYTES_THRESHOLD", "50000000"))

    # In-memory ring-buffer sizes
    SIEM_EVENT_BUFFER_SIZE: int = int(os.getenv("SIEM_EVENT_BUFFER_SIZE", "500"))
    SIEM_OFFENSE_BUFFER_SIZE: int = int(os.getenv("SIEM_OFFENSE_BUFFER_SIZE", "30"))

    # Mock-mode synthetic baseline added to KPI totals so the demo looks realistic
    MOCK_BASELINE_EVENTS: int = int(os.getenv("MOCK_BASELINE_EVENTS", "1420"))
    MOCK_BASELINE_BYTES: int = int(os.getenv("MOCK_BASELINE_BYTES", "4820000000"))
    MOCK_BASELINE_ROWS: int = int(os.getenv("MOCK_BASELINE_ROWS", "12500000"))
    MOCK_BASELINE_EPS: str = os.getenv("MOCK_BASELINE_EPS", "14.2 eps")

    # Offense ID prefix (e.g. "SEC-OFF-101", "SEC-OFF-102" …)
    OFFENSE_ID_PREFIX: str = os.getenv("OFFENSE_ID_PREFIX", "SEC-OFF")
    OFFENSE_ID_START: int = int(os.getenv("OFFENSE_ID_START", "101"))
    OFFENSE_ASSIGNED_ANALYST: str = os.getenv("OFFENSE_ASSIGNED_ANALYST", "SOC Tier 2 / Auto-Triage")

    # Frontend defaults shown in Query Studio (pre-filled but overridable)
    DEFAULT_QUERY_USER: str = os.getenv("DEFAULT_QUERY_USER", "analyst_sarah")
    DEFAULT_QUERY_CLIENT_IP: str = os.getenv("DEFAULT_QUERY_CLIENT_IP", "10.244.12.45")
    DEFAULT_QUERY_SQL: str = os.getenv(
        "DEFAULT_QUERY_SQL",
        "SELECT customer_region, count(*) as tx_count, sum(amount) as total_volume_usd\n"
        "FROM {catalog}.{schema}.transactions\n"
        "GROUP BY customer_region",
    )

    # Initial events fetched by the dashboard on first load
    DASHBOARD_INITIAL_EVENT_COUNT: int = int(os.getenv("DASHBOARD_INITIAL_EVENT_COUNT", "30"))
    # Maximum live events / offenses kept client-side in the browser ring buffer
    WS_EVENT_RING_SIZE: int = int(os.getenv("WS_EVENT_RING_SIZE", "50"))
    WS_OFFENSE_RING_SIZE: int = int(os.getenv("WS_OFFENSE_RING_SIZE", "30"))

    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "*"
    ]

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
