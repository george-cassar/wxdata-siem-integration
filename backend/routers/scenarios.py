from fastapi import APIRouter
from backend.services.synthetic_data_service import QUERY_TEMPLATES, USERS

router = APIRouter(prefix="/api/scenarios", tags=["Demonstration Scenarios"])

DEMO_SCENARIOS = [
    {
        "id": "scenario-1",
        "title": "Scenario 1: Standard BI Aggregation",
        "category": "Baseline Operations",
        "riskLevel": "LOW",
        "description": "Business analyst runs periodic quarterly revenue aggregation over Iceberg lakehouse tables.",
        "user": "analyst_sarah",
        "role": "Data Analyst",
        "clientIp": "10.244.12.45",
        "sql": "SELECT customer_region, count(*) as tx_count, sum(amount) as total_volume_usd\nFROM iceberg_data.finance.transactions\nGROUP BY customer_region",
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
        "sql": "SELECT * FROM iceberg_data.finance.customer_accounts\nWHERE ssn IS NOT NULL AND credit_card_num IS NOT NULL",
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
        "sql": "DROP TABLE iceberg_data.compliance.kyc_records",
        "expectedOutcome": "Presto coordinator denies query with PERMISSION_DENIED. SIEM triggers HIGH Offense (RULE-WXD-1002: MITRE T1485 Data Destruction)."
    }
]

@router.get("")
async def get_scenarios():
    return DEMO_SCENARIOS
