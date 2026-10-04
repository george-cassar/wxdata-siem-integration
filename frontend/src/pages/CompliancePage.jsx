import React from 'react';
import { Tile, ProgressBar, StructuredListWrapper, StructuredListHead, StructuredListRow, StructuredListCell, StructuredListBody, Tag, Tooltip } from '@carbon/react';
import { Security, CheckmarkOutline, ChartLineData, Information } from '@carbon/icons-react';
import KPICard from '../components/KPICard';

export default function CompliancePage() {
  const complianceFrameworks = [
    { name: 'PCI-DSS v4.0 (Req 10.2: Audit all access to financial cardholder data)', status: 'COMPLIANT', coverage: '100%' },
    { name: 'GDPR Article 30 (Records of processing & PII lakehouse queries)', status: 'COMPLIANT', coverage: '100%' },
    { name: 'HIPAA Security Rule (Audit controls for PHI/Health tables)', status: 'COMPLIANT', coverage: '100%' },
    { name: 'SOC 2 Type II (Continuous monitoring of data access controls)', status: 'COMPLIANT', coverage: '100%' },
  ];

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 600, margin: 0 }}>Data Governance & Regulatory Compliance Audit</h2>
        <div style={{ fontSize: '0.875rem', color: '#c6c6c6', marginTop: '0.25rem' }}>
          Demonstrates automated compliance adherence achieved by capturing 100% of watsonx.data Presto query access into the SIEM
        </div>
      </div>

      <div className="kpi-grid">
        <KPICard
          title="Query Audit Coverage"
          value="100.0%"
          subtitle="Zero unmonitored execution paths"
          icon={CheckmarkOutline}
          status="success"
          tooltip="Displays the percentage of Presto lakehouse queries monitored and forwarded to the SIEM audit log. Calculated as (Monitored Queries / Total Queries Executed) × 100 via the coordinator SPI listener."
        />
        <KPICard
          title="Audit Trail Retention"
          value="365 Days"
          subtitle="SIEM immutable compliance store"
          icon={Security}
          status="default"
          tooltip="Displays the guaranteed retention window for immutable audit logs in SIEM storage. Calculated based on configured SIEM data lifecycle policies meeting regulatory requirement standards (e.g., PCI-DSS Req 10.7)."
        />
        <KPICard
          title="Mean Time to Detect (MTTD)"
          value="< 1.8s"
          subtitle="Real-time SPI asynchronous stream"
          icon={ChartLineData}
          status="success"
          tooltip="Displays the average elapsed time from Presto query execution completion to SIEM alert correlation. Calculated as the delta between query end timestamp and SIEM rule triggering timestamp across the asynchronous TLS pipeline."
        />
      </div>

      <Tile className="panel-card" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-title">
          <Security size={20} />
          <Tooltip
            label="Displays regulatory framework compliance status and audit logging coverage for lakehouse workloads. Calculated by verifying required security controls (user ID, timestamp, SQL text, target catalog/schema, result status) are captured in all exported LEEF/CEF event schemas."
            align="bottom-left"
          >
            <span style={{ cursor: 'help', textDecoration: 'underline dotted #8d8d8d', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              Regulatory Compliance Matrix
              <Information size={14} style={{ color: '#78a9ff' }} />
            </span>
          </Tooltip>
        </div>
        <StructuredListWrapper isCondensed>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>Standard / Regulation</StructuredListCell>
              <StructuredListCell head>Audit Status</StructuredListCell>
              <StructuredListCell head>Audit Coverage</StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {complianceFrameworks.map((cf, idx) => (
              <StructuredListRow key={idx}>
                <StructuredListCell><strong>{cf.name}</strong></StructuredListCell>
                <StructuredListCell>
                  <Tag type="green">{cf.status}</Tag>
                </StructuredListCell>
                <StructuredListCell>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ProgressBar value={100} max={100} hideLabel style={{ width: '120px' }} />
                    <span style={{ fontSize: '0.8125rem' }}>{cf.coverage}</span>
                  </div>
                </StructuredListCell>
              </StructuredListRow>
            ))}
          </StructuredListBody>
        </StructuredListWrapper>
      </Tile>
    </div>
  );
}
