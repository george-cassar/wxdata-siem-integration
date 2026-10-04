import React from 'react';
import {
  Modal,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Tag,
  CodeSnippet,
  Tooltip,
} from '@carbon/react';
import {
  User,
  Network_2,
  DataBase,
  Time,
  Security,
  Warning,
  CheckmarkFilled,
  ErrorFilled,
  InProgress,
  Information,
} from '@carbon/icons-react';

function Field({ label, value, mono = false, wide = false }) {
  return (
    <div className={`qd-field${wide ? ' qd-field--wide' : ''}`}>
      <div className="qd-field-label">{label}</div>
      <div className={`qd-field-value${mono ? ' mono-text' : ''}`}>
        {value ?? <span className="qd-field-empty">—</span>}
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }) {
  return (
    <div className="qd-section">
      <div className="qd-section-title">
        {Icon && <Icon size={16} />}
        {title}
      </div>
      <div className="qd-section-grid">{children}</div>
    </div>
  );
}

function RiskBadge({ risk }) {
  const map = { CRITICAL: 'red', HIGH: 'magenta', MEDIUM: 'warm-gray', LOW: 'green' };
  return <Tag type={map[risk] ?? 'gray'}>{risk ?? 'UNKNOWN'}</Tag>;
}

function StatusBadge({ status }) {
  if (status === 'FINISHED') return <Tag type="teal"><CheckmarkFilled size={12} style={{ marginRight: '4px' }} />FINISHED</Tag>;
  if (status === 'FAILED')   return <Tag type="red"><ErrorFilled size={12} style={{ marginRight: '4px' }} />FAILED</Tag>;
  return <Tag type="blue"><InProgress size={12} style={{ marginRight: '4px' }} />{status ?? 'UNKNOWN'}</Tag>;
}

function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`;
  if (bytes >= 1048576)    return `${(bytes / 1048576).toFixed(2)} MB`;
  if (bytes >= 1024)       return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  });
}

export default function QueryDetailModal({ event, open, onClose }) {
  if (!event) return null;

  const riskColor = { CRITICAL: '#da1e28', HIGH: '#ee5396', MEDIUM: '#f1c21b', LOW: '#24a148' };
  const borderColor = riskColor[event.riskLevel] ?? '#393939';

  return (
    <Modal
      open={open}
      onRequestClose={onClose}
      className="query-detail-modal"
      modalHeading={
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Security size={18} style={{ color: '#78a9ff', flexShrink: 0 }} />
          Query Event Detail
          <Tag type="cyan" size="sm" style={{ fontFamily: 'var(--cds-font-family-mono)', fontSize: '0.7rem' }}>
            {event.queryId}
          </Tag>
          <RiskBadge risk={event.riskLevel} />
          <StatusBadge status={event.status} />
        </span>
      }
      passiveModal
      size="lg"
      className="query-detail-modal"
      style={{ '--qd-border-color': borderColor }}
    >
      {/* Top summary bar */}
      <div className="qd-summary-bar">
        <div className="qd-summary-item">
          <span className="qd-summary-label">Category</span>
          <span className="qd-summary-value">{event.category ?? event.queryType}</span>
        </div>
        <div className="qd-summary-divider" />
        <div className="qd-summary-item">
          <span className="qd-summary-label">Engine</span>
          <span className="qd-summary-value mono-text">{event.engine}</span>
        </div>
        <div className="qd-summary-divider" />
        <div className="qd-summary-item">
          <span className="qd-summary-label">Cluster</span>
          <span className="qd-summary-value mono-text">{event.cluster}</span>
        </div>
        <div className="qd-summary-divider" />
        <div className="qd-summary-item">
          <span className="qd-summary-label">Source</span>
          <span className="qd-summary-value">{event.source}</span>
        </div>
      </div>

      <Tabs>
        <TabList aria-label="Event detail tabs">
          <Tab>Overview</Tab>
          <Tab>Performance</Tab>
          <Tab>LEEF 2.0 (QRadar)</Tab>
          <Tab>CEF (Splunk / Sentinel)</Tab>
          <Tab>Raw JSON</Tab>
        </TabList>
        <TabPanels>

          {/* ── Tab 1: Overview ── */}
          <TabPanel className="tab-pane-container">
            <Section icon={User} title="User Identity">
              <Field label="Username" value={event.user} />
              <Field label="Role / Account Type" value={event.userRole} />
              <Field label="Client IP Address" value={event.clientIp} mono />
              <Field label="Source Application" value={event.source} />
            </Section>

            <Section icon={Time} title="Timing">
              <Field label="Event Timestamp" value={fmtTs(event.timestamp)} />
              <Field label="Query Start Time" value={fmtTs(event.createdTime)} />
              <Field label="Query End Time" value={fmtTs(event.endTime)} />
              <Field label="Wall-clock Duration" value={event.durationMs != null ? `${event.durationMs.toLocaleString()} ms` : '—'} />
              <Field label="CPU Time" value={event.cpuTimeMs != null ? `${event.cpuTimeMs.toLocaleString()} ms` : '—'} />
            </Section>

            <Section icon={DataBase} title="Data Target">
              <Field label="Catalog" value={event.catalog} mono />
              <Field label="Schema" value={event.schema} mono />
              <Field label="Query Type / Action" value={event.queryType} />
              <Field label="Query Category" value={event.category} />
            </Section>

            <Section icon={Security} title="Security Assessment">
              <Field label="Risk Level" value={<RiskBadge risk={event.riskLevel} />} />
              <Field label="Execution Status" value={<StatusBadge status={event.status} />} />
              {event.errorCode && <Field label="Error Code" value={event.errorCode} mono />}
              {event.errorMessage && <Field label="Error Message" value={event.errorMessage} wide />}
            </Section>

            <div className="qd-sql-block">
              <div className="qd-field-label" style={{ marginBottom: '0.5rem' }}>
                Full SQL Statement
              </div>
              <CodeSnippet type="multi" feedback="Copied!" wrapText>
                {event.sqlText}
              </CodeSnippet>
            </div>
          </TabPanel>

          {/* ── Tab 2: Performance ── */}
          <TabPanel className="tab-pane-container">
            <Section icon={Network_2} title="Execution Metrics">
              <Field label="Wall-clock Duration" value={event.durationMs != null ? `${event.durationMs.toLocaleString()} ms` : '—'} />
              <Field label="CPU Time" value={event.cpuTimeMs != null ? `${event.cpuTimeMs.toLocaleString()} ms` : '—'} />
              <Field label="Rows Scanned" value={event.rowsScanned?.toLocaleString()} />
              <Field label="Rows Returned" value={event.rowsReturned?.toLocaleString()} />
              <Field label="Bytes Scanned" value={fmtBytes(event.bytesScanned)} />
              <Field
                label="Scan Efficiency"
                value={
                  event.rowsScanned > 0 && event.rowsReturned != null
                    ? `${((event.rowsReturned / event.rowsScanned) * 100).toFixed(1)}% rows returned`
                    : '—'
                }
              />
            </Section>

            <Section icon={DataBase} title="Data Classification Context">
              <Field label="Catalog" value={event.catalog} mono />
              <Field label="Schema" value={event.schema} mono />
              <Field label="Engine" value={event.engine} mono />
              <Field label="Cluster" value={event.cluster} mono />
            </Section>

            {/* Volume bar */}
            {event.bytesScanned > 0 && (
              <div className="qd-volume-bar-wrap">
                <div className="qd-field-label" style={{ marginBottom: '0.5rem' }}>
                  Scan Volume Indicator
                </div>
                <div className="qd-volume-track">
                  <div
                    className="qd-volume-fill"
                    style={{
                      width: `${Math.min(100, (event.bytesScanned / 1073741824) * 100)}%`,
                      background: borderColor,
                    }}
                  />
                </div>
                <div className="qd-volume-label">
                  {fmtBytes(event.bytesScanned)} scanned
                  {event.bytesScanned >= 104857600 && (
                    <span style={{ color: '#ff832b', marginLeft: '0.5rem' }}>
                      <Warning size={12} style={{ verticalAlign: 'middle' }} /> Large scan volume
                    </span>
                  )}
                </div>
              </div>
            )}
          </TabPanel>

          {/* ── Tab 3: LEEF ── */}
          <TabPanel className="tab-pane-container">
            <div style={{ marginBottom: '0.5rem', fontSize: '0.8125rem', color: '#c6c6c6' }}>
              IBM QRadar Log Event Extended Format (LEEF 2.0) — delivered via Syslog TLS / Universal Cloud REST:
            </div>
            <div className={`leef-packet-box${event.riskLevel === 'CRITICAL' ? ' critical' : event.riskLevel === 'HIGH' ? ' high' : ' low'}`}>
              {event.leefPayload || 'No LEEF representation available'}
            </div>
          </TabPanel>

          {/* ── Tab 4: CEF ── */}
          <TabPanel className="tab-pane-container">
            <div style={{ marginBottom: '0.5rem', fontSize: '0.8125rem', color: '#c6c6c6' }}>
              Common Event Format (CEF) for Splunk Enterprise Security &amp; Microsoft Sentinel:
            </div>
            <div className="leef-packet-box">
              {event.cefPayload || 'No CEF representation available'}
            </div>
          </TabPanel>

          {/* ── Tab 5: Raw JSON ── */}
          <TabPanel className="tab-pane-container">
            <CodeSnippet type="multi" feedback="Copied!" wrapText>
              {JSON.stringify(event, null, 2)}
            </CodeSnippet>
          </TabPanel>

        </TabPanels>
      </Tabs>
    </Modal>
  );
}
