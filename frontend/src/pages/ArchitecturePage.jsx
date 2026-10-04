import React, { useEffect, useState } from 'react';
import mermaid from 'mermaid';
import { Tile, Tabs, TabList, Tab, TabPanels, TabPanel, CodeSnippet, StructuredListWrapper, StructuredListHead, StructuredListRow, StructuredListCell, StructuredListBody, Tag } from '@carbon/react';
import { NetworkEnterprise, Code, WarningAlt, Security, ChartLineData, Information } from '@carbon/icons-react';

const DIAGRAM_DEF = `flowchart LR
    subgraph LAPTOP["Developer Workstation (Local)"]
        direction TB
        Frontend["React Frontend (Port 3000)<br/>Carbon Design UI"]
        Backend["FastAPI Backend (Port 8000)<br/>REST + WebSocket Engine"]
        InternalServices["Internal Backend Modules<br/>• SIEM Correlation Engine<br/>• Synthetic Data Generator"]
        Frontend <-->|"Proxy: /api"| Backend
        Backend <--> InternalServices
    end

    subgraph REMOTE["watsonx.data Presto (Remote)"]
        direction TB
        PrestoCoord["Presto Coordinator<br/>(HTTPS 443/8443)"]
        Catalog["Iceberg / Hive Catalog"]
        PrestoCoord --- Catalog
    end

    subgraph SIEM["Enterprise SIEM"]
        direction TB
        Ingress["SIEM Ingestion Gateway<br/>(Syslog TLS / REST)"]
        CRE["Correlation & Rules Engine<br/>(LEEF 2.0 / CEF)"]
        SOC["SOC Alerts & Dashboard"]
        Ingress --> CRE --> SOC
    end

    Backend -->|"Live Query & Audit"| PrestoCoord
    PrestoCoord -.->|"EventListener SPI"| Backend
    InternalServices -->|"Stream LEEF/CEF"| Ingress

    classDef localFill fill:#161616,stroke:#393939,stroke-width:1.5px,color:#f4f4f4;
    classDef remoteFill fill:#0f62fe,stroke:#0f62fe,stroke-width:1.5px,color:#ffffff;
    classDef siemFill fill:#6929c4,stroke:#6929c4,stroke-width:1.5px,color:#ffffff;
    class Frontend,Backend,InternalServices,LAPTOP localFill;
    class PrestoCoord,Catalog,REMOTE remoteFill;
    class Ingress,CRE,SOC,SIEM siemFill;
`;

const COMPONENT_INVENTORY = [
  { component: 'React Frontend', role: 'Vite dev server on port 3000', notes: 'Carbon Design System v11, IBM Plex fonts, g90 dark theme' },
  { component: 'FastAPI Backend', role: 'Uvicorn server on port 8000', notes: 'Routers: health, siem, scenarios; dual-mode mock/live services' },
  { component: 'PrestoExecutor', role: 'watsonx.data Presto client', notes: 'httpx REST polling + trino Python client; httpx is primary for CP4D auth' },
  { component: 'SIEMEngine', role: 'Correlation rules engine', notes: 'Evaluates events against 4 rules; maintains event/offense stores' },
  { component: 'SyntheticDataService', role: 'Mock data generator', notes: 'Faker with seed=42 for reproducible audit events, LEEF/CEF formatting' },
  { component: 'watsonxDataService', role: 'Live catalog & history fetcher', notes: 'Discovers all catalogs via SHOW CATALOGS; pulls from system.runtime.queries' },
];

const INTERCEPTION_CONTENT = `### Event Interception Mechanisms

**Approach 1: Presto EventListener SPI (Recommended)**
Presto provides a native Java Service Provider Interface (\`EventListenerFactory\`). When configured, the coordinator asynchronously pushes \`QueryCreatedEvent\`, \`QueryCompletedEvent\`, and \`SplitCompletedEvent\` to the registered listener.

- **Latency**: Sub-second (≈ 10–50 ms)
- **Overhead**: Negligible; listener callbacks execute on dedicated background worker pools

**Approach 2: Query History Monitoring & Management (QHMM)**
watsonx.data persists query diagnostic history into object storage tables (\`query_history\`, \`query_event_raw\`). An external polling consumer reads micro-batches and posts them to the SIEM via REST API.

- **Latency**: 15–60 seconds (batch polling)

### Key Field Mapping
| watsonx.data / Presto Field | QRadar LEEF Attribute | Splunk / CEF Field | Description |
| :--- | :--- | :--- | :--- |
| \`queryId\` | \`queryId\` | \`cs1\` | Unique Presto query execution identifier |
| \`user\` | \`usrName\` | \`suser\` | Authenticated identity / Service Account |
| \`clientIp\` | \`src\` | \`src\` | Source client IP address |
| \`catalog\` & \`schema\` | \`catalog\`, \`schema\` | \`cs2\` | Lakehouse target namespace |
| \`sqlText\` | \`sqlText\` | \`msg\` | Raw / sanitized SQL statement |
| \`rowsScanned\` | \`rowsProcessed\` | \`cn1\` | Total rows processed by engine |
| \`bytesScanned\` | \`bytesScanned\` | \`cn2\` | Total bytes read from object storage |
| \`status\` | \`status\` | \`cs3\` | \`FINISHED\`, \`FAILED\`, \`CANCELED\` |`;

const CORRELATION_CONTENT = `### Correlation Rules & Threat Detection

| Rule ID | Name | Severity | MITRE Technique | Trigger Condition |
| :--- | :--- | :--- | :--- | :--- |
| RULE-WXD-1001 | Mass Data Retrieval / Exfiltration Warning | CRITICAL | T1005 - Data from Local System | Single query reads > 100,000 rows or > 50 MB from customer/PII tables |
| RULE-WXD-1002 | Unauthorized DDL / Table Modification Attempt | HIGH | T1485 - Data Destruction / Impact | Unauthorized DROP, ALTER, or TRUNCATE resulting in PERMISSION_DENIED |
| RULE-WXD-1003 | Off-Hours Privileged Table Query | MEDIUM | T1078 - Valid Accounts | Queries from unusual IP ranges against restricted compliance catalogs |
| RULE-WXD-1004 | Unbounded Table Scan / Resource Exhaustion | MEDIUM | T1499 - Endpoint Denial of Service | Full table scans without partition filters or LIMIT clauses |

### Example LEEF 2.0 Payload
\`\`\`text
LEEF:2.0|IBM|watsonx.data|2.0.1|QueryExecution|	devTime=2025-02-15T14:30:10Z	usrName=analyst_sarah	src=10.244.12.45	identSrc=Presto (Java) 0.286	queryId=20250215_143010_00124_wxdcoord1	catalog=iceberg_data	schema=finance	action=SELECT	status=FINISHED	durationMs=120	rowsProcessed=100	bytesScanned=85000	riskLevel=LOW	sqlText=SELECT * FROM iceberg_data.finance.transactions WHERE transaction_date >= CURRENT_DATE - INTERVAL '7' DAY
\`\`\``;

const SETUP_CONTENT = `### Running the Demo Locally

**Prerequisites**
- Python 3.9+
- Node.js 18+

**Quick Start**
\`\`\`bash
# 1. One-shot setup (creates .venv, installs deps, generates .env)
./scripts/setup-local.sh

# 2. Start the backend (Terminal 1)
source backend/.venv/bin/activate
uvicorn backend.main:app --port 8000 --reload

# 3. Start the frontend (Terminal 2)
cd frontend && npm run dev

# 4. Open http://localhost:3000
\`\`\`

**Environment Variables**
| Variable | Default | Description |
| :--- | :--- | :--- |
| \`DEMO_MODE\` | \`mock\` | \`mock\` = synthetic data, \`live\` = real Presto queries |
| \`PRESTO_HOST\` | \`localhost\` | watsonx.data Presto coordinator hostname |
| \`PRESTO_PORT\` | \`8443\` | Presto port (443 for external route, 8443 for internal) |
| \`PRESTO_USE_SSL\` | \`false\` | Use HTTPS/TLS |
| \`PRESTO_SSL_VERIFY\` | \`true\` | Skip cert validation for self-signed certs |
| \`PRESTO_USER\` | \`ibmacp\` | CP4D/watsonx.data username |
| \`PRESTO_PASSWORD\` | (empty) | Password (exchanged for CP4D bearer token automatically) |
| \`PRESTO_BEARER_TOKEN\` | (empty) | Pre-obtained CP4D JWT token |
| \`PRESTO_CATALOG\` | \`iceberg_data\` | Default catalog session |
| \`PRESTO_SCHEMA\` | \`finance\` | Default schema session |

**Note**: In mock mode, no Presto connection is needed — all data is synthetic (Faker, seed=42). The backend automatically falls back to simulation if the Presto endpoint is unreachable.`;

export default function ArchitecturePage() {
  const [svgHtml, setSvgHtml] = useState('');

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      fontSize: 12,
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      },
      themeVariables: {
        darkMode: true,
        background: '#161616',
        primaryColor: '#0f62fe',
        primaryTextColor: '#f4f4f4',
        primaryBorderColor: '#393939',
        lineColor: '#8d8d8d',
        secondaryColor: '#6929c4',
        tertiaryColor: '#262626',
        fontSize: '12px',
        fontFamily: 'IBM Plex Sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }
    });

    const renderChart = async () => {
      try {
        const id = `mermaid-arch-${Date.now()}`;
        const { svg } = await mermaid.render(id, DIAGRAM_DEF);
        setSvgHtml(svg);
      } catch (err) {
        console.error('Mermaid render error:', err);
      }
    };

    renderChart();
  }, []);

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 600, margin: 0 }}>Architecture & Local Setup Guide</h2>
        <div style={{ fontSize: '0.875rem', color: '#c6c6c6', marginTop: '0.25rem' }}>
          Local development architecture for the watsonx.data Presto &rarr; SIEM audit integration demo
        </div>
      </div>

      {/* Local Development Topology Diagram */}
      <Tile className="panel-card" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-title">
          <NetworkEnterprise size={20} />
          <span>Local Development Solution Topology</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#8d8d8d', marginLeft: 'auto' }}>
            Scroll horizontally if needed
          </span>
        </div>
        <div className="architecture-diagram-container" style={{ width: '100%', overflowX: 'auto' }}>
          {svgHtml ? (
            <div
              className="architecture-mermaid-wrapper"
              dangerouslySetInnerHTML={{ __html: svgHtml }}
            />
          ) : (
            <div style={{ color: '#8d8d8d', textAlign: 'center', padding: '3rem' }}>Loading diagram…</div>
          )}
        </div>
        <div style={{ marginTop: '1rem', fontSize: '0.8125rem', color: '#8d8d8d', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
          <div><span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#161616', border: '1px solid #393939', borderRadius: '2px', marginRight: '6px' }}></span>Local services</div>
          <div><span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#0f62fe', borderRadius: '2px', marginRight: '6px' }}></span>Remote watsonx.data Presto</div>
          <div><span style={{ display: 'inline-block', width: '12px', height: '12px', background: '#6929c4', borderRadius: '2px', marginRight: '6px' }}></span>Enterprise SIEM</div>
        </div>
      </Tile>

      {/* Component Inventory */}
      <Tile className="panel-card" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-title">
          <Code size={20} />
          <span>Component Inventory</span>
        </div>
        <StructuredListWrapper isCondensed>
          <StructuredListHead>
            <StructuredListRow head>
              <StructuredListCell head>Component</StructuredListCell>
              <StructuredListCell head>Role</StructuredListCell>
              <StructuredListCell head>Notes</StructuredListCell>
            </StructuredListRow>
          </StructuredListHead>
          <StructuredListBody>
            {COMPONENT_INVENTORY.map((item, idx) => (
              <StructuredListRow key={idx}>
                <StructuredListCell><strong>{item.component}</strong></StructuredListCell>
                <StructuredListCell>{item.role}</StructuredListCell>
                <StructuredListCell>{item.notes}</StructuredListCell>
              </StructuredListRow>
            ))}
          </StructuredListBody>
        </StructuredListWrapper>
      </Tile>

      {/* SIEM Details Tabs */}
      <Tile className="panel-card">
        <div className="panel-title">
          <Security size={20} />
          <span>SIEM Integration Details</span>
        </div>
        <Tabs>
          <TabList aria-label="SIEM Details">
            <Tab>Event Interception &amp; Payload Formats</Tab>
            <Tab>Correlation Rules &amp; Threat Detection</Tab>
            <Tab>Local Setup Guide</Tab>
          </TabList>
          <TabPanels>
            <TabPanel className="tab-pane-container">
              <CodeSnippet type="multi" feedback="Copied to clipboard" wrapContent>
                {INTERCEPTION_CONTENT}
              </CodeSnippet>
            </TabPanel>
            <TabPanel className="tab-pane-container">
              <CodeSnippet type="multi" feedback="Copied to clipboard" wrapContent>
                {CORRELATION_CONTENT}
              </CodeSnippet>
            </TabPanel>
            <TabPanel className="tab-pane-container">
              <CodeSnippet type="multi" feedback="Copied to clipboard" wrapContent>
                {SETUP_CONTENT}
              </CodeSnippet>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </Tile>
    </div>
  );
}
