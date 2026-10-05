import random
import uuid
import datetime
from typing import Dict, Any, List

from backend.config import settings

# Seed for reproducible synthetic audit logs
random.seed(42)

USERS = [
    {"user": "analyst_sarah", "role": "Data Analyst", "ip": "10.244.12.45"},
    {"user": "data_eng_kumar", "role": "Data Engineer", "ip": "10.244.15.89"},
    {"user": "bi_service_acct", "role": "Service Account", "ip": "10.244.20.101"},
    {"user": "sec_audit_bot", "role": "Compliance Bot", "ip": "10.244.5.12"},
    {"user": "admin_root", "role": "Platform Admin", "ip": "10.244.1.4"},
    {"user": "contractor_mike", "role": "External Consultant", "ip": "192.168.100.55"},
]

TABLES = [
    {"catalog": "iceberg_data", "schema": "finance", "table": "transactions", "classification": "Confidential"},
    {"catalog": "iceberg_data", "schema": "finance", "table": "customer_accounts", "classification": "Restricted-PII"},
    {"catalog": "iceberg_data", "schema": "compliance", "table": "kyc_records", "classification": "Restricted-PII"},
    {"catalog": "hive_lake", "schema": "analytics", "table": "daily_metrics", "classification": "Internal"},
    {"catalog": "hive_lake", "schema": "telemetry", "table": "query_history", "classification": "Internal"},
    {"catalog": "system", "schema": "runtime", "table": "nodes", "classification": "Public"},
]

QUERY_TEMPLATES = [
    {
        "type": "SELECT",
        "sql": "SELECT transaction_id, account_id, amount, currency, status FROM iceberg_data.finance.transactions WHERE transaction_date >= CURRENT_DATE - INTERVAL '7' DAY LIMIT 100",
        "category": "Standard Analytics",
        "risk_level": "LOW",
        "rows": (50, 100),
        "bytes": (15000, 85000),
        "duration_ms": (80, 240),
        "status": "FINISHED"
    },
    {
        "type": "AGGREGATION",
        "sql": "SELECT customer_region, count(*), sum(amount) as total_volume FROM iceberg_data.finance.transactions GROUP BY customer_region",
        "category": "BI Report Aggregation",
        "risk_level": "LOW",
        "rows": (5, 20),
        "bytes": (450000, 1200000),
        "duration_ms": (150, 450),
        "status": "FINISHED"
    },
    {
        "type": "EXFILTRATION",
        "sql": "SELECT * FROM iceberg_data.finance.customer_accounts WHERE ssn IS NOT NULL AND credit_card_num IS NOT NULL",
        "category": "Mass PII Exfiltration",
        "risk_level": "CRITICAL",
        "rows": (500000, 1200000),
        "bytes": (250000000, 750000000),
        "duration_ms": (3500, 8500),
        "status": "FINISHED"
    },
    {
        "type": "DDL_DROP",
        "sql": "DROP TABLE iceberg_data.compliance.kyc_records",
        "category": "Unauthorized DDL Destruction",
        "risk_level": "HIGH",
        "rows": (0, 0),
        "bytes": (0, 1024),
        "duration_ms": (45, 95),
        "status": "FAILED",
        "error_code": "PERMISSION_DENIED",
        "error_message": "User contractor_mike does not have DROP privileges on catalog iceberg_data"
    },
    {
        "type": "TABLE_SCAN",
        "sql": "SELECT * FROM iceberg_data.finance.transactions WHERE 1=1",
        "category": "Unbounded Table Scan",
        "risk_level": "MEDIUM",
        "rows": (150000, 400000),
        "bytes": (85000000, 180000000),
        "duration_ms": (1200, 3100),
        "status": "FINISHED"
    }
]

def generate_synthetic_event(scenario_override: Dict[str, Any] = None) -> Dict[str, Any]:
    """Generates a structured watsonx.data Presto query audit event."""
    user_info = random.choice(USERS)
    template = random.choice(QUERY_TEMPLATES)
    
    if scenario_override:
        user_info = {
            "user": scenario_override.get("user", user_info["user"]),
            "role": scenario_override.get("role", user_info["role"]),
            "ip": scenario_override.get("ip", user_info["ip"])
        }
        template = scenario_override.get("template", template)

    now = datetime.datetime.now(datetime.timezone.utc)
    duration_ms = random.randint(template["duration_ms"][0], template["duration_ms"][1]) if isinstance(template["duration_ms"], tuple) else template["duration_ms"]
    start_time = now - datetime.timedelta(milliseconds=duration_ms)
    
    query_id = f"{start_time.strftime('%Y%m%d_%H%M%S')}_{random.randint(10000, 99999)}_wxd{random.choice(['coord1', 'coord2'])}"
    
    rows = random.randint(template["rows"][0], template["rows"][1]) if isinstance(template["rows"], tuple) else template["rows"]
    bytes_scanned = random.randint(template["bytes"][0], template["bytes"][1]) if isinstance(template["bytes"], tuple) else template["bytes"]
    
    status = template.get("status", "FINISHED")
    sql_text = template.get("sql", "SELECT 1")
    
    # Extract target catalog/schema if possible
    catalog = settings.PRESTO_CATALOG
    schema = settings.PRESTO_SCHEMA
    if "hive_lake" in sql_text:
        catalog = "hive_lake"
        schema = "analytics"

    cluster = settings.CLUSTER_NAME or (
        settings.PRESTO_HOST.split(".")[0] if settings.PRESTO_HOST else "watsonx-data"
    )

    event = {
        "eventId": str(uuid.uuid4()),
        "queryId": query_id,
        "engine": settings.ENGINE_VERSION,
        "cluster": cluster,
        "timestamp": now.isoformat(),
        "createdTime": start_time.isoformat(),
        "endTime": now.isoformat(),
        "durationMs": duration_ms,
        "cpuTimeMs": int(duration_ms * settings.CPU_TIME_MULTIPLIER),
        "user": user_info["user"],
        "userRole": user_info["role"],
        "clientIp": user_info["ip"],
        "source": "watsonx.data Query Workspace / JDBC",
        "catalog": catalog,
        "schema": schema,
        "sqlText": sql_text,
        "queryType": template.get("type", "SELECT"),
        "category": template.get("category", "General Query"),
        "riskLevel": template.get("risk_level", "LOW"),
        "rowsScanned": rows,
        "rowsReturned": rows if status == "FINISHED" else 0,
        "bytesScanned": bytes_scanned,
        "status": status,
        "errorCode": template.get("error_code"),
        "errorMessage": template.get("error_message")
    }
    
    # Format to LEEF and CEF representations
    event["leefPayload"] = format_as_leef(event)
    event["cefPayload"] = format_as_cef(event)
    
    return event

def format_as_leef(event: Dict[str, Any]) -> str:
    """Formats event to IBM LEEF (Log Event Extended Format) 2.0 standard for QRadar."""
    headers = [
        "LEEF:2.0",
        settings.SIEM_VENDOR,
        settings.SIEM_PRODUCT,
        settings.SIEM_PRODUCT_VERSION,
        event.get("queryType", "QueryExecution"),
        "\t"  # delimiter
    ]
    header_str = "|".join(headers[:5])
    
    attrs = [
        f"devTime={event['timestamp']}",
        f"usrName={event['user']}",
        f"src={event['clientIp']}",
        f"identSrc={event['engine']}",
        f"queryId={event['queryId']}",
        f"catalog={event['catalog']}",
        f"schema={event['schema']}",
        f"sqlText={event['sqlText'].replace(chr(9), ' ').replace(chr(10), ' ')}",
        f"action={event['queryType']}",
        f"status={event['status']}",
        f"durationMs={event['durationMs']}",
        f"rowsProcessed={event['rowsScanned']}",
        f"bytesScanned={event['bytesScanned']}",
        f"riskLevel={event['riskLevel']}"
    ]
    if event.get("errorCode"):
        attrs.append(f"errCode={event['errorCode']}")
    if event.get("errorMessage"):
        attrs.append(f"errDesc={event['errorMessage']}")
        
    return f"{header_str}|{chr(9).join(attrs)}"

def format_as_cef(event: Dict[str, Any]) -> str:
    """Formats event to ArcSight / Sentinel / Splunk Common Event Format (CEF)."""
    _CEF_SEVERITY = {"LOW": 1, "MEDIUM": 5, "HIGH": 7, "CRITICAL": 10}
    severity = _CEF_SEVERITY.get(event.get("riskLevel", "LOW"), 1)
    cef_header = (
        f"CEF:0|{settings.SIEM_VENDOR}|{settings.SIEM_PRODUCT}|2.0"
        f"|{event['queryType']}|Presto SQL Audit Event|{severity}"
    )
    cef_ext = (
        f"rt={event['timestamp']} suser={event['user']} src={event['clientIp']} "
        f"cs1Label=QueryID cs1={event['queryId']} "
        f"cs2Label=Catalog cs2={event['catalog']}.{event['schema']} "
        f"cs3Label=Status cs3={event['status']} "
        f"cn1Label=RowsProcessed cn1={event['rowsScanned']} "
        f"cn2Label=BytesScanned cn2={event['bytesScanned']} "
        f"msg={event['sqlText'][:settings.SIEM_CEF_SQL_SNIPPET_LEN]}"
    )
    return f"{cef_header}|{cef_ext}"

def get_initial_history(count: int = 25) -> List[Dict[str, Any]]:
    """Builds a starting list of recent events for demo initial state."""
    events = []
    for _ in range(count):
        events.append(generate_synthetic_event())
    # Sort descending by timestamp
    events.sort(key=lambda x: x["timestamp"], reverse=True)
    return events
