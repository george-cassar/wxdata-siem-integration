import datetime
import uuid
from typing import Dict, Any, List, Optional

RULES = [
    {
        "id": "RULE-WXD-1001",
        "name": "Mass Data Retrieval / Exfiltration Warning",
        "description": "Triggered when a single query reads > 100,000 rows or > 50MB of data from sensitive/PII tables.",
        "severity": "CRITICAL",
        "mitre_technique": "T1005 - Data from Local System",
        "threshold": {"rows": 100000, "bytes": 50000000},
        "category": "Data Exfiltration"
    },
    {
        "id": "RULE-WXD-1002",
        "name": "Unauthorized DDL / Table Modification Attempt",
        "description": "Triggered on unauthorized DROP, ALTER, or TRUNCATE attempts resulting in PERMISSION_DENIED.",
        "severity": "HIGH",
        "mitre_technique": "T1485 - Data Destruction / Impact",
        "category": "Privileged Abuse"
    },
    {
        "id": "RULE-WXD-1003",
        "name": "Off-Hours Privileged Table Query",
        "description": "Triggered when queries against restricted compliance or customer account catalogs occur from unusual IP ranges.",
        "severity": "MEDIUM",
        "mitre_technique": "T1078 - Valid Accounts",
        "category": "Suspicious Access"
    },
    {
        "id": "RULE-WXD-1004",
        "name": "Unbounded Table Scan / Resource Exhaustion",
        "description": "Triggered when full table scans execute without partition filters or LIMIT clauses, causing memory spikes.",
        "severity": "MEDIUM",
        "mitre_technique": "T1499 - Endpoint Denial of Service",
        "category": "Workload Anomaly"
    }
]

class SIEMEngine:
    def __init__(self):
        self.events: List[Dict[str, Any]] = []
        self.offenses: List[Dict[str, Any]] = []
        self.rules = RULES

    def evaluate_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Evaluates incoming Presto audit event against SIEM correlation rules."""
        self.events.insert(0, event)
        if len(self.events) > 500:
            self.events.pop()

        triggered_rule = None
        
        # Rule 1001: Data Exfiltration
        if (event.get("rowsScanned", 0) >= 100000 or event.get("bytesScanned", 0) >= 50000000) and "customer" in event.get("sqlText", "").lower():
            triggered_rule = self.rules[0]
            
        # Rule 1002: Unauthorized DDL
        elif event.get("status") == "FAILED" and any(k in event.get("sqlText", "").upper() for k in ["DROP", "ALTER", "TRUNCATE"]):
            triggered_rule = self.rules[1]

        # Rule 1003: External/Suspicious IP on Restricted Catalogs
        elif event.get("clientIp", "").startswith("192.168.100") and "kyc" in event.get("sqlText", "").lower():
            triggered_rule = self.rules[2]

        # Rule 1004: Unbounded Table Scan
        elif event.get("riskLevel") == "MEDIUM" and "WHERE 1=1" in event.get("sqlText", ""):
            triggered_rule = self.rules[3]

        if triggered_rule:
            offense = {
                "offenseId": f"SEC-OFF-{len(self.offenses) + 101}",
                "ruleId": triggered_rule["id"],
                "ruleName": triggered_rule["name"],
                "severity": triggered_rule["severity"],
                "category": triggered_rule["category"],
                "mitreTechnique": triggered_rule["mitre_technique"],
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "sourceUser": event["user"],
                "sourceIp": event["clientIp"],
                "queryId": event["queryId"],
                "sqlSnippet": event["sqlText"][:140] + ("..." if len(event["sqlText"]) > 140 else ""),
                "status": "OPEN",
                "assignedAnalyst": "SOC Tier 2 / Auto-Triage",
                "evidence": {
                    "rowsProcessed": event.get("rowsScanned"),
                    "bytesScanned": event.get("bytesScanned"),
                    "queryDuration": f"{event.get('durationMs')}ms",
                    "targetCatalog": f"{event.get('catalog')}.{event.get('schema')}"
                }
            }
            self.offenses.insert(0, offense)
            return offense

        return None

    def get_summary_stats(self, live_mode: bool = False) -> Dict[str, Any]:
        """
        Calculates SIEM dashboard KPI statistics.
        In live mode: pure real numbers, no synthetic baseline added.
        In mock mode: adds a baseline so KPIs look realistic in a demo.
        """
        total_events = len(self.events)
        total_offenses = len(self.offenses)
        critical_count = sum(1 for o in self.offenses if o["severity"] == "CRITICAL")
        high_count = sum(1 for o in self.offenses if o["severity"] == "HIGH")
        total_bytes = sum(e.get("bytesScanned", 0) for e in self.events)
        total_rows = sum(e.get("rowsScanned", 0) for e in self.events)

        # Compute events-per-second from the last 60 seconds of real events
        if total_events > 1:
            import datetime as _dt
            now = _dt.datetime.now(_dt.timezone.utc)
            recent = [
                e for e in self.events
                if e.get("timestamp") and
                (now - _dt.datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00"))).total_seconds() < 60
            ]
            eps = f"{len(recent) / 60:.1f} eps" if recent else "0.0 eps"
        else:
            eps = "0.0 eps" if live_mode else "14.2 eps"

        if live_mode:
            return {
                "totalAuditEvents": total_events,
                "activeOffenses": total_offenses,
                "criticalOffenses": critical_count,
                "highOffenses": high_count,
                "totalVolumeScannedBytes": total_bytes,
                "totalRowsProcessed": total_rows,
                "engineStatus": "HEALTHY (Presto Java 0.286)",
                "leefStreamRate": eps,
            }
        else:
            return {
                "totalAuditEvents": total_events + 1420,
                "activeOffenses": total_offenses,
                "criticalOffenses": critical_count,
                "highOffenses": high_count,
                "totalVolumeScannedBytes": total_bytes + 4820000000,
                "totalRowsProcessed": total_rows + 12500000,
                "engineStatus": "HEALTHY (Presto Java 0.286)",
                "leefStreamRate": eps,
            }

siem_engine = SIEMEngine()
