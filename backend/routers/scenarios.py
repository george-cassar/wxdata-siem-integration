from fastapi import APIRouter
from backend.config import settings
from backend.services.synthetic_data_service import QUERY_TEMPLATES, USERS

router = APIRouter(prefix="/api/scenarios", tags=["Demonstration Scenarios"])

_cat = settings.PRESTO_CATALOG
_sch = settings.PRESTO_SCHEMA

DEMO_SCENARIOS = [
    {
        "id": "scenario-1",
        "title": "Scenario 1: Standard BI Aggregation",
        "category": "Baseline Operations",
        "riskLevel": "LOW",
        "description": "Business analyst runs periodic quarterly revenue aggregation over Iceberg lakehouse tables.",
        "user": settings.DEFAULT_QUERY_USER,
        "role": "Data Analyst",
        "clientIp": settings.DEFAULT_QUERY_CLIENT_IP,
        "sql": (
            f"SELECT customer_region, count(*) as tx_count, sum(amount) as total_volume_usd\n"
            f"FROM {_cat}.{_sch}.transactions\n"
            f"GROUP BY customer_region"
        ),
        "expectedOutcome": "Status FINISHED in ~150ms. SIEM logs informational LEEF event with LOW severity and no triggered offenses."
    },
    {
        "id": "scenario-2",
        "title": "Scenario 2: Mass Data Exfiltration Attempt",
        "category": "Data Exfiltration Threat",
        "riskLevel": "CRITICAL",
        "description": "Suspicious query scans unfiltered customer records and PII without LIMIT or partition filter.",
        "user": "contractor_mike",
        "role": "External Consultant",
        "clientIp": "192.168.100.55",
        "sql": (
            f"SELECT * FROM {_cat}.{_sch}.customer_accounts\n"
            f"WHERE ssn IS NOT NULL AND credit_card_num IS NOT NULL"
        ),
        "expectedOutcome": "Presto returns 500k rows (250MB scanned). SIEM triggers CRITICAL Offense (RULE-WXD-1001: MITRE T1005 Data from Local System)."
    },
    {
        "id": "scenario-3",
        "title": "Scenario 3: Unauthorized DDL Table Drop",
        "category": "Insider Threat & Tampering",
        "riskLevel": "HIGH",
        "description": "Unauthorized actor attempts to drop critical compliance audit table.",
        "user": "contractor_mike",
        "role": "External Consultant",
        "clientIp": "192.168.100.55",
        "sql": f"DROP TABLE {_cat}.compliance.kyc_records",
        "expectedOutcome": "Presto coordinator denies query with PERMISSION_DENIED. SIEM triggers HIGH Offense (RULE-WXD-1002: MITRE T1485 Data Destruction)."
    }
]

@router.get("")
async def get_scenarios():
    return DEMO_SCENARIOS
