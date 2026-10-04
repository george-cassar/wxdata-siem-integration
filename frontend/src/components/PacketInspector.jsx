import React, { useState } from 'react';
import { Tile, Tabs, TabList, Tab, TabPanels, TabPanel, Button, CodeSnippet, Tag, Tooltip } from '@carbon/react';
import { Copy, Security, CheckmarkFilled, WarningAlt, Information } from '@carbon/icons-react';

export default function PacketInspector({ event }) {
  if (!event) {
    return (
      <Tile className="panel-card" style={{ minHeight: '380px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#8d8d8d' }}>
          <Security size={32} style={{ marginBottom: '0.5rem' }} />
          <div>Select any query event from the log stream to inspect its raw LEEF / CEF packet payload.</div>
        </div>
      </Tile>
    );
  }

  const getPacketClass = () => {
    switch (event.riskLevel) {
      case 'CRITICAL': return 'leef-packet-box critical';
      case 'HIGH': return 'leef-packet-box high';
      default: return 'leef-packet-box low';
    }
  };

  return (
    <div className="panel-card">
      <div className="panel-title" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Security size={20} />
          <Tooltip
            label="Displays the multi-format protocol payload (LEEF 2.0, CEF, Normalized JSON, Raw Engine Audit) for the selected Presto query event. Calculated by serializing normalized event attributes into SIEM standard wire formats."
            align="bottom-left"
          >
            <span style={{ cursor: 'help', textDecoration: 'underline dotted #8d8d8d', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              SIEM Packet & Schema Inspector
              <Information size={14} style={{ color: '#78a9ff' }} />
            </span>
          </Tooltip>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Tag type={event.riskLevel === 'CRITICAL' ? 'red' : event.riskLevel === 'HIGH' ? 'magenta' : 'green'}>
            {event.riskLevel} RISK
          </Tag>
          <Tag type="cyan">Query ID: {event.queryId}</Tag>
        </div>
      </div>

      <Tabs>
        <TabList aria-label="Packet Formats">
          <Tab>IBM LEEF 2.0 (QRadar)</Tab>
          <Tab>ArcSight / Sentinel CEF</Tab>
          <Tab>Parsed Normalized Schema</Tab>
          <Tab>Raw Engine JSON Event</Tab>
        </TabList>
        <TabPanels>
          {/* LEEF Format */}
          <TabPanel className="tab-pane-container">
            <div style={{ marginBottom: '0.5rem', fontSize: '0.8125rem', color: '#c6c6c6' }}>
              Standard IBM QRadar Log Event Extended Format (LEEF 2.0) delivered via Syslog TLS / Universal Cloud REST:
            </div>
            <div className={getPacketClass()}>
              {event.leefPayload || 'No LEEF representation available'}
            </div>
          </TabPanel>

          {/* CEF Format */}
          <TabPanel className="tab-pane-container">
            <div style={{ marginBottom: '0.5rem', fontSize: '0.8125rem', color: '#c6c6c6' }}>
              Common Event Format (CEF) for Splunk Enterprise Security & Microsoft Sentinel:
            </div>
            <div className="leef-packet-box">
              {event.cefPayload || 'No CEF representation available'}
            </div>
          </TabPanel>

          {/* Normalized Fields */}
          <TabPanel className="tab-pane-container">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div style={{ background: '#1e1e1e', padding: '0.75rem', borderRadius: '2px' }}>
                <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>User Identity (usrName)</div>
                <div style={{ fontWeight: 600, color: '#f4f4f4' }}>{event.user} ({event.userRole})</div>
              </div>
              <div style={{ background: '#1e1e1e', padding: '0.75rem', borderRadius: '2px' }}>
                <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Client IP (srcIp)</div>
                <div className="mono-text" style={{ fontWeight: 600, color: '#f4f4f4' }}>{event.clientIp}</div>
              </div>
              <div style={{ background: '#1e1e1e', padding: '0.75rem', borderRadius: '2px' }}>
                <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Catalog & Schema</div>
                <div style={{ fontWeight: 600, color: '#f4f4f4' }}>{event.catalog}.{event.schema}</div>
              </div>
              <div style={{ background: '#1e1e1e', padding: '0.75rem', borderRadius: '2px' }}>
                <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Engine Identifier</div>
                <div style={{ fontWeight: 600, color: '#f4f4f4' }}>{event.engine}</div>
              </div>
              <div style={{ background: '#1e1e1e', padding: '0.75rem', borderRadius: '2px' }}>
                <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Rows Scanned / Returned</div>
                <div style={{ fontWeight: 600, color: '#f4f4f4' }}>{event.rowsScanned?.toLocaleString()} / {event.rowsReturned?.toLocaleString()}</div>
              </div>
              <div style={{ background: '#1e1e1e', padding: '0.75rem', borderRadius: '2px' }}>
                <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Volume Scanned (Bytes)</div>
                <div style={{ fontWeight: 600, color: '#f4f4f4' }}>{(event.bytesScanned / 1024 / 1024).toFixed(2)} MB</div>
              </div>
            </div>

            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#8d8d8d', marginBottom: '0.25rem' }}>Full SQL Statement (sqlText)</div>
              <CodeSnippet type="multi" feedback="Copied to clipboard">
                {event.sqlText}
              </CodeSnippet>
            </div>
          </TabPanel>

          {/* Raw JSON */}
          <TabPanel className="tab-pane-container">
            <CodeSnippet type="multi" feedback="Copied to clipboard">
              {JSON.stringify(event, null, 2)}
            </CodeSnippet>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
  );
}
