import React, { useState, useMemo } from 'react';
import {
  Tag,
  Tile,
  Button,
  Pagination,
  Dropdown,
  Search
} from '@carbon/react';
import { WarningAlt, Security, UserFollow, CheckmarkFilled, Time, FilterReset } from '@carbon/icons-react';
import { useDemo } from '../context/DemoContext';

const TIME_INTERVAL_OPTIONS = [
  { id: 'all', label: 'All Time' },
  { id: '15m', label: 'Last 15 minutes', minutes: 15 },
  { id: '1h', label: 'Last 1 hour', minutes: 60 },
  { id: '6h', label: 'Last 6 hours', minutes: 360 },
  { id: '24h', label: 'Last 24 hours', minutes: 1440 },
  { id: '7d', label: 'Last 7 days', minutes: 10080 }
];

const SEVERITY_OPTIONS = [
  { id: 'ALL', label: 'All Severities' },
  { id: 'CRITICAL', label: 'Critical Only' },
  { id: 'HIGH', label: 'High Only' },
  { id: 'MEDIUM', label: 'Medium Only' }
];

export default function OffensesPage() {
  const { state } = useDemo();
  const { offenses } = state;

  const [selectedTimeInterval, setSelectedTimeInterval] = useState(TIME_INTERVAL_OPTIONS[0]);
  const [selectedSeverity, setSelectedSeverity] = useState(SEVERITY_OPTIONS[0]);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);

  // Filter offenses by time interval, severity, and search term
  const filteredOffenses = useMemo(() => {
    const now = Date.now();
    return offenses.filter((offense) => {
      // Time interval filter
      if (selectedTimeInterval.minutes) {
        const offenseTime = new Date(offense.timestamp).getTime();
        const diffMinutes = (now - offenseTime) / (1000 * 60);
        if (diffMinutes > selectedTimeInterval.minutes) {
          return false;
        }
      }

      // Severity filter
      if (selectedSeverity.id !== 'ALL' && offense.severity !== selectedSeverity.id) {
        return false;
      }

      // Search filter
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesName = offense.ruleName?.toLowerCase().includes(term);
        const matchesUser = offense.sourceUser?.toLowerCase().includes(term);
        const matchesIp = offense.sourceIp?.toLowerCase().includes(term);
        const matchesId = offense.offenseId?.toLowerCase().includes(term);
        const matchesSql = offense.sqlSnippet?.toLowerCase().includes(term);
        const matchesMitre = offense.mitreTechnique?.toLowerCase().includes(term);
        if (!matchesName && !matchesUser && !matchesIp && !matchesId && !matchesSql && !matchesMitre) {
          return false;
        }
      }

      return true;
    });
  }, [offenses, selectedTimeInterval, selectedSeverity, searchTerm]);

  const totalItems = filteredOffenses.length;
  const startIndex = (page - 1) * pageSize;
  const paginatedOffenses = filteredOffenses.slice(startIndex, startIndex + pageSize);

  const resetFilters = () => {
    setSelectedTimeInterval(TIME_INTERVAL_OPTIONS[0]);
    setSelectedSeverity(SEVERITY_OPTIONS[0]);
    setSearchTerm('');
    setPage(1);
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 600, margin: 0 }}>SIEM Offense & Incident Investigation</h2>
        <div style={{ fontSize: '0.875rem', color: '#c6c6c6', marginTop: '0.25rem' }}>
          Automated correlation alerts generated from watsonx.data Presto query anomalies, data exfiltration patterns, and unauthorized operations
        </div>
      </div>

      {/* Filter and Control Bar */}
      <div
        className="panel-card"
        style={{
          marginBottom: '1.5rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr)) auto',
          gap: '1rem',
          alignItems: 'flex-end'
        }}
      >
        <Dropdown
          id="time-interval-dropdown"
          titleText="Time Interval Window"
          label="Select time range"
          items={TIME_INTERVAL_OPTIONS}
          itemToString={(item) => (item ? item.label : '')}
          selectedItem={selectedTimeInterval}
          onChange={({ selectedItem }) => {
            setSelectedTimeInterval(selectedItem);
            setPage(1);
          }}
          size="md"
        />

        <Dropdown
          id="severity-dropdown"
          titleText="Severity Filter"
          label="Filter by severity"
          items={SEVERITY_OPTIONS}
          itemToString={(item) => (item ? item.label : '')}
          selectedItem={selectedSeverity}
          onChange={({ selectedItem }) => {
            setSelectedSeverity(selectedItem);
            setPage(1);
          }}
          size="md"
        />

        <div>
          <label style={{ fontSize: '0.75rem', color: '#c6c6c6', display: 'block', marginBottom: '0.5rem' }}>
            Search Offenses
          </label>
          <Search
            size="md"
            placeholder="Search rules, users, IP, SQL..."
            labelText="Search Offenses"
            closeButtonLabelText="Clear search"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <Button
          kind="ghost"
          size="md"
          renderIcon={FilterReset}
          onClick={resetFilters}
          style={{ height: '40px' }}
        >
          Reset Filters
        </Button>
      </div>

      {/* Summary count pill */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.875rem', color: '#c6c6c6' }}>
          Showing <strong>{filteredOffenses.length}</strong> of <strong>{offenses.length}</strong> total offenses
          {selectedTimeInterval.id !== 'all' && ` in ${selectedTimeInterval.label.toLowerCase()}`}
        </div>
      </div>

      {filteredOffenses.length === 0 ? (
        <Tile className="panel-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <CheckmarkFilled size={40} style={{ color: '#24a148', marginBottom: '1rem' }} />
          <h3>No Offenses in Selected Window</h3>
          <p style={{ color: '#c6c6c6', marginTop: '0.5rem' }}>
            No security offenses matched the chosen time interval and filter criteria.
          </p>
          <div style={{ marginTop: '1rem' }}>
            <Button kind="tertiary" size="sm" onClick={resetFilters}>
              Clear Active Filters
            </Button>
          </div>
        </Tile>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {paginatedOffenses.map((offense) => (
            <div
              key={offense.offenseId}
              className="panel-card"
              style={{
                margin: 0,
                borderLeft: `4px solid ${offense.severity === 'CRITICAL' ? '#da1e28' : offense.severity === 'HIGH' ? '#ff832b' : '#f1c21b'}`
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className={`offense-pill ${offense.severity}`}>{offense.severity}</span>
                    <h3 style={{ fontSize: '1.25rem', margin: 0 }}>{offense.ruleName}</h3>
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: '#8d8d8d', marginTop: '0.25rem' }}>
                    Offense ID: <strong>{offense.offenseId}</strong> · Rule ID: <strong>{offense.ruleId}</strong> · Category: {offense.category} · Detected: {new Date(offense.timestamp).toLocaleTimeString()} ({new Date(offense.timestamp).toLocaleDateString()})
                  </div>
                </div>
                <Tag type="cyan">{offense.mitreTechnique}</Tag>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', background: '#1e1e1e', padding: '0.875rem', borderRadius: '2px', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Source User</div>
                  <div style={{ fontWeight: 600 }}>{offense.sourceUser}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Client IP Address</div>
                  <div className="mono-text" style={{ fontWeight: 600 }}>{offense.sourceIp}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Presto Query ID</div>
                  <div className="mono-text" style={{ fontSize: '0.8125rem' }}>{offense.queryId}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Target Catalog & Schema</div>
                  <div style={{ fontWeight: 600 }}>{offense.evidence?.targetCatalog || 'iceberg_data.finance'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Rows Scanned</div>
                  <div style={{ fontWeight: 600, color: '#ff832b' }}>{offense.evidence?.rowsProcessed?.toLocaleString()} rows</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Data Volume Scanned</div>
                  <div style={{ fontWeight: 600, color: '#ff832b' }}>{((offense.evidence?.bytesScanned || 0) / 1024 / 1024).toFixed(1)} MB</div>
                </div>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#8d8d8d', marginBottom: '0.25rem' }}>SQL Evidence Payload:</div>
                <div className="mono-text" style={{ background: '#161616', padding: '0.75rem', color: '#82cfff', fontSize: '0.8125rem', border: '1px solid #393939' }}>
                  {offense.sqlSnippet}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.8125rem', color: '#c6c6c6' }}>
                  Assigned: <strong>{offense.assignedAnalyst}</strong> · Status: <Tag type="red">OPEN / ESCALATED</Tag>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button kind="secondary" size="sm">Download SIEM Dossier</Button>
                  <Button kind="primary" size="sm">Triage Offense</Button>
                </div>
              </div>
            </div>
          ))}

          {/* Pagination Controls */}
          <Pagination
            backwardText="Previous page"
            forwardText="Next page"
            itemsPerPageText="Offenses per page:"
            page={page}
            pageNumberText="Page Number"
            pageSize={pageSize}
            pageSizes={[3, 5, 10, 20]}
            totalItems={totalItems}
            onChange={({ page: newPage, pageSize: newPageSize }) => {
              setPage(newPage);
              setPageSize(newPageSize);
            }}
          />
        </div>
      )}
    </div>
  );
}
