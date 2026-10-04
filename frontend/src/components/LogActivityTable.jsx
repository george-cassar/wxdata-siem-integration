import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Button,
  Tag,
  Pagination,
  Dropdown,
  Tooltip,
  DatePicker,
  DatePickerInput,
  Theme,
} from '@carbon/react';
import { Download, Play, Pause, Information, Maximize, Minimize, Time } from '@carbon/icons-react';
import QueryDetailModal from './QueryDetailModal';

// ─── Static filter option lists ────────────────────────────────────────────

const RISK_OPTIONS = [
  { id: 'ALL', label: 'All Risks' },
  { id: 'CRITICAL', label: 'Critical' },
  { id: 'HIGH', label: 'High' },
  { id: 'MEDIUM', label: 'Medium' },
  { id: 'LOW', label: 'Low' },
];

const STATUS_OPTIONS = [
  { id: 'ALL', label: 'All Statuses' },
  { id: 'FINISHED', label: 'Finished' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'RUNNING', label: 'Running' },
];

const ACTION_OPTIONS = [
  { id: 'ALL', label: 'All Actions' },
  { id: 'SELECT', label: 'SELECT' },
  { id: 'AGGREGATION', label: 'AGGREGATION' },
  { id: 'EXFILTRATION', label: 'EXFILTRATION' },
  { id: 'DDL_DROP', label: 'DROP' },
  { id: 'CREATE', label: 'CREATE' },
  { id: 'ALTER', label: 'ALTER' },
  { id: 'INSERT', label: 'INSERT' },
  { id: 'UPDATE', label: 'UPDATE' },
  { id: 'DELETE', label: 'DELETE' },
  { id: 'TRUNCATE', label: 'TRUNCATE' },
  { id: 'ACCESS_CONTROL', label: 'ACCESS CONTROL' },
  { id: 'TABLE_SCAN', label: 'TABLE SCAN' },
  { id: 'METADATA', label: 'METADATA' },
];

// Preset time windows — id is minutes (0 = no filter)
const TIME_PRESETS = [
  { id: 0,   label: 'All time' },
  { id: 1,   label: 'Last 1 min' },
  { id: 5,   label: 'Last 5 min' },
  { id: 10,  label: 'Last 10 min' },
  { id: 30,  label: 'Last 30 min' },
  { id: -1,  label: 'Custom…' },
];

// ─── TimeFilterBar — defined at module level so React never remounts it ─────
// (Defining it inside the parent render function creates a new component type
//  on every render, which unmounts Flatpickr before onChange can fire.)

function TimeFilterBar({
  timePreset, setTimePreset,
  customStart, customEnd, setCustomStart, setCustomEnd,
  activeTimeLabel, resetPage,
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="time-filter-bar">
      <Time size={14} className="time-filter-icon" />
      <span className="time-filter-label">Time window:</span>

      {TIME_PRESETS.filter((p) => p.id !== -1).map((p) => (
        <button
          key={p.id}
          className={`time-pill${timePreset === p.id ? ' active' : ''}`}
          onClick={() => { setTimePreset(p.id); resetPage(); }}
          type="button"
        >
          {p.label}
        </button>
      ))}

      <button
        className={`time-pill${timePreset === -1 ? ' active' : ''}`}
        onClick={() => { setTimePreset(-1); resetPage(); }}
        type="button"
      >
        Custom…
      </button>

      {/* Active window badge — shown for presets and for custom once both dates chosen */}
      {activeTimeLabel && (
        <span className="time-filter-active-badge">
          {activeTimeLabel}
          <button
            className="time-filter-clear"
            onClick={() => {
              setTimePreset(0);
              setCustomStart(null);
              setCustomEnd(null);
              resetPage();
            }}
            type="button"
            aria-label="Clear time filter"
          >
            ×
          </button>
        </span>
      )}

      {/* Custom date-range pickers — always mounted when Custom is active so
          Flatpickr is never torn down mid-selection */}
      {timePreset === -1 && (
        <div className="time-custom-range">
          <DatePicker
            datePickerType="range"
            dateFormat="Y-m-d"
            maxDate={today}
            value={[
              customStart ? customStart.toISOString().slice(0, 10) : '',
              customEnd   ? customEnd.toISOString().slice(0, 10)   : '',
            ]}
            onChange={(dates) => {
              setCustomStart(dates[0] instanceof Date ? dates[0] : null);
              setCustomEnd(  dates[1] instanceof Date ? dates[1] : null);
              resetPage();
            }}
          >
            <DatePickerInput
              id="time-filter-start"
              placeholder="yyyy-mm-dd"
              labelText="From"
              size="sm"
            />
            <DatePickerInput
              id="time-filter-end"
              placeholder="yyyy-mm-dd"
              labelText="To"
              size="sm"
            />
          </DatePicker>
        </div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function LogActivityTable({
  events = [],
  onSelectEvent,
  selectedEventId,
  isPaused = false,
  onTogglePause
}) {
  const [searchTerm, setSearchTerm]       = useState('');
  const [actionFilter, setActionFilter]   = useState('ALL');
  const [riskFilter, setRiskFilter]       = useState('ALL');
  const [statusFilter, setStatusFilter]   = useState('ALL');
  const [userFilter, setUserFilter]       = useState('ALL');
  const [page, setPage]                   = useState(1);
  const [pageSize, setPageSize]           = useState(10);
  const [isFullscreen, setIsFullscreen]   = useState(false);
  const [detailEvent, setDetailEvent]     = useState(null);
  const [modalOpen, setModalOpen]         = useState(false);

  // Time-window filter state
  const [timePreset, setTimePreset]       = useState(0);   // minutes; 0=all, -1=custom
  const [customStart, setCustomStart]     = useState(null); // Date | null
  const [customEnd, setCustomEnd]         = useState(null); // Date | null

  // ── Derived: user list from live events ──
  const userOptions = useMemo(() => {
    const users = Array.from(new Set(events.map((e) => e.user).filter(Boolean))).sort();
    return [
      { id: 'ALL', label: 'All Users' },
      ...users.map((u) => ({ id: u, label: u })),
    ];
  }, [events]);

  // ── Escape key exits fullscreen ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // ── Time-window filter helpers ──
  const timeWindowStart = useMemo(() => {
    if (timePreset === 0) return null;
    if (timePreset === -1) return customStart;           // custom: use picker value
    return new Date(Date.now() - timePreset * 60 * 1000);
  }, [timePreset, customStart]);

  const timeWindowEnd = useMemo(() => {
    if (timePreset === 0) return null;
    if (timePreset === -1) return customEnd ?? new Date(); // custom end, or now
    return new Date();                                   // preset: up to now
  }, [timePreset, customEnd]);

  // Label shown on the active preset pill
  const activeTimeLabel = useMemo(() => {
    if (timePreset === 0) return null;
    if (timePreset === -1) {
      if (customStart && customEnd) {
        const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        return `${fmt(customStart)} – ${fmt(customEnd)}`;
      }
      return 'Custom';
    }
    return TIME_PRESETS.find((p) => p.id === timePreset)?.label ?? '';
  }, [timePreset, customStart, customEnd]);

  // ── Main filter pipeline ──
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // 1. Time window
      if (timeWindowStart || timeWindowEnd) {
        const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : null;
        if (!ts) return false;
        if (timeWindowStart && ts < timeWindowStart.getTime()) return false;
        if (timeWindowEnd   && ts > timeWindowEnd.getTime())   return false;
      }
      // 2. User
      if (userFilter !== 'ALL' && ev.user !== userFilter) return false;
      // 3. Action
      if (actionFilter !== 'ALL') {
        const qType = (ev.queryType || '').toUpperCase();
        if (actionFilter === 'DDL_DROP' && !(qType === 'DDL_DROP' || qType === 'DROP')) return false;
        else if (actionFilter !== 'DDL_DROP' && qType !== actionFilter) return false;
      }
      // 4. Risk
      if (riskFilter !== 'ALL' && ev.riskLevel !== riskFilter) return false;
      // 5. Status
      if (statusFilter !== 'ALL' && ev.status !== statusFilter) return false;
      // 6. Free-text search
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        ev.queryId?.toLowerCase().includes(term) ||
        ev.user?.toLowerCase().includes(term) ||
        ev.queryType?.toLowerCase().includes(term) ||
        ev.sqlText?.toLowerCase().includes(term) ||
        ev.riskLevel?.toLowerCase().includes(term) ||
        ev.status?.toLowerCase().includes(term)
      );
    });
  }, [events, timeWindowStart, timeWindowEnd, userFilter, actionFilter, riskFilter, statusFilter, searchTerm]);

  const totalItems   = filteredEvents.length;
  const startIndex   = (page - 1) * pageSize;
  const paginatedEvents = filteredEvents.slice(startIndex, startIndex + pageSize);

  const handleRowClick = (ev) => {
    setDetailEvent(ev);
    setModalOpen(true);
    if (onSelectEvent) onSelectEvent(ev);
  };

  const resetPage = () => setPage(1);

  const exportCSV = () => {
    const headers = ['Timestamp', 'QueryID', 'User', 'IP', 'Catalog', 'Schema', 'Status', 'Risk', 'SQL'];
    const rows = filteredEvents.map(e => [
      `"${e.timestamp}"`,
      `"${e.queryId}"`,
      `"${e.user}"`,
      `"${e.clientIp}"`,
      `"${e.catalog}"`,
      `"${e.schema}"`,
      `"${e.status}"`,
      `"${e.riskLevel}"`,
      `"${e.sqlText.replace(/"/g, '""')}"`
    ]);
    const csv = 'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `wxd_presto_siem_audit_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Tag renderers ──
  const getRiskTag = (risk) => {
    switch (risk) {
      case 'CRITICAL': return <Tag type="red">CRITICAL</Tag>;
      case 'HIGH':     return <Tag type="magenta">HIGH</Tag>;
      case 'MEDIUM':   return <Tag type="warm-gray">MEDIUM</Tag>;
      default:         return <Tag type="green">LOW</Tag>;
    }
  };

  const getActionTag = (action) => {
    const act = (action || 'QUERY').toUpperCase();
    switch (act) {
      case 'EXFILTRATION':
        return <Tag type="red" size="sm" title="Sensitive / Mass Data Exfiltration">EXFILTRATION</Tag>;
      case 'DDL_DROP':
      case 'DROP':
        return <Tag type="magenta" size="sm" title="Destructive DDL Drop Table/Schema">DROP</Tag>;
      case 'TRUNCATE':
      case 'DELETE':
        return <Tag type="purple" size="sm" title="DML Data Deletion">DELETE</Tag>;
      case 'ALTER':
        return <Tag type="high-contrast" size="sm" title="DDL Schema Alteration">ALTER</Tag>;
      case 'CREATE':
        return <Tag type="cyan" size="sm" title="DDL Object Creation">CREATE</Tag>;
      case 'INSERT':
      case 'UPDATE':
        return <Tag type="teal" size="sm" title="DML Data Modification">{act}</Tag>;
      case 'ACCESS_CONTROL':
      case 'GRANT':
      case 'REVOKE':
        return <Tag type="outline" size="sm" title="Privilege / RBAC Modification">ACCESS CTRL</Tag>;
      case 'AGGREGATION':
        return <Tag type="green" size="sm" title="Analytics & Aggregation Query">AGGREGATION</Tag>;
      case 'TABLE_SCAN':
        return <Tag type="warm-gray" size="sm" title="Full Unbounded Table Scan">TABLE SCAN</Tag>;
      case 'METADATA':
      case 'SHOW':
      case 'DESCRIBE':
        return <Tag type="gray" size="sm" title="Metadata Inspection Query">METADATA</Tag>;
      case 'SELECT':
      default:
        return <Tag type="blue" size="sm" title="Standard SELECT Query">{act}</Tag>;
    }
  };

  // ── Render ──
  return (
    <>
      <div className={`log-activity-panel ${isFullscreen ? 'fullscreen' : ''}`}>
        <TableContainer
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
              <Tooltip
                label="Displays the real-time stream of intercepted Presto query logs and telemetry. Calculated by intercepting query lifecycle events at the Presto coordinator SPI layer, enriched with user, catalog, IP, risk score, and formatting into LEEF/CEF syslog records."
                align="bottom-left"
              >
                <span style={{ cursor: 'help', textDecoration: 'underline dotted #8d8d8d', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  Presto Real-Time Log Activity (SIEM Ingestion Stream)
                  <Information size={14} style={{ color: '#78a9ff' }} />
                </span>
              </Tooltip>
            </span>
          }
          description="Live telemetry intercepted from Presto coordinator and formatted into LEEF/CEF event structures — click any row to inspect full details"
        >
          {/* ── Time filter bar (always visible, above the main toolbar) ── */}
          <TimeFilterBar
            timePreset={timePreset}
            setTimePreset={setTimePreset}
            customStart={customStart}
            customEnd={customEnd}
            setCustomStart={setCustomStart}
            setCustomEnd={setCustomEnd}
            activeTimeLabel={activeTimeLabel}
            resetPage={resetPage}
          />

          <TableToolbar>
            <TableToolbarContent>
              <TableToolbarSearch
                persistent
                placeholder="Search queries, users, IPs..."
                onChange={(e) => { setSearchTerm(e.target.value); resetPage(); }}
              />
              <Dropdown
                id="user-filter"
                titleText=""
                label="Filter by User"
                items={userOptions}
                itemToString={(item) => item?.label ?? ''}
                selectedItem={userOptions.find((o) => o.id === userFilter) ?? userOptions[0]}
                onChange={({ selectedItem }) => { setUserFilter(selectedItem?.id ?? 'ALL'); resetPage(); }}
                size="md"
                style={{ minWidth: '165px' }}
              />
              <Dropdown
                id="action-filter"
                titleText=""
                label="Filter by Action"
                items={ACTION_OPTIONS}
                itemToString={(item) => item?.label ?? ''}
                selectedItem={ACTION_OPTIONS.find((o) => o.id === actionFilter)}
                onChange={({ selectedItem }) => { setActionFilter(selectedItem?.id ?? 'ALL'); resetPage(); }}
                size="md"
                style={{ minWidth: '150px' }}
              />
              <Dropdown
                id="risk-filter"
                titleText=""
                label="Filter by Risk"
                items={RISK_OPTIONS}
                itemToString={(item) => item?.label ?? ''}
                selectedItem={RISK_OPTIONS.find((o) => o.id === riskFilter)}
                onChange={({ selectedItem }) => { setRiskFilter(selectedItem?.id ?? 'ALL'); resetPage(); }}
                size="md"
                style={{ minWidth: '140px' }}
              />
              <Dropdown
                id="status-filter"
                titleText=""
                label="Filter by Status"
                items={STATUS_OPTIONS}
                itemToString={(item) => item?.label ?? ''}
                selectedItem={STATUS_OPTIONS.find((o) => o.id === statusFilter)}
                onChange={({ selectedItem }) => { setStatusFilter(selectedItem?.id ?? 'ALL'); resetPage(); }}
                size="md"
                style={{ minWidth: '150px' }}
              />
              {onTogglePause && (
                <Button
                  renderIcon={isPaused ? Play : Pause}
                  kind={isPaused ? 'danger' : 'ghost'}
                  size="md"
                  onClick={onTogglePause}
                >
                  {isPaused ? 'Resume Stream' : 'Pause Stream'}
                </Button>
              )}
              <Button renderIcon={Download} kind="ghost" size="md" onClick={exportCSV}>
                Export CSV
              </Button>
              <Tooltip label={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Enter Fullscreen'} align="bottom-right">
                <Button
                  renderIcon={isFullscreen ? Minimize : Maximize}
                  kind={isFullscreen ? 'secondary' : 'ghost'}
                  size="md"
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  hasIconOnly
                  iconDescription={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                />
              </Tooltip>
            </TableToolbarContent>
          </TableToolbar>

          <div className="log-table-scroll-wrapper">
            <Table size="sm" useZebraStyles>
              <TableHead>
                <TableRow>
                  <TableHeader>Timestamp</TableHeader>
                  <TableHeader>User / Client IP</TableHeader>
                  <TableHeader>Action / Target</TableHeader>
                  <TableHeader>Query Snippet</TableHeader>
                  <TableHeader>Duration / Volume</TableHeader>
                  <TableHeader>Risk / Status</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedEvents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} style={{ textAlign: 'center', color: '#8d8d8d', padding: '2rem' }}>
                      No events matching filter
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedEvents.map((ev) => (
                    <TableRow
                      key={ev.eventId || ev.queryId}
                      onClick={() => handleRowClick(ev)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: selectedEventId === (ev.eventId || ev.queryId) ? '#353535' : undefined
                      }}
                    >
                      <TableCell className="mono-text" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>
                        <strong>{ev.user}</strong>
                        <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>{ev.clientIp}</div>
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>
                        {getActionTag(ev.queryType)}
                        <div style={{ fontSize: '0.75rem', color: '#c6c6c6', marginTop: '0.2rem' }}>{ev.catalog}.{ev.schema}</div>
                      </TableCell>
                      <TableCell
                        className="mono-text"
                        style={{
                          fontSize: '0.75rem',
                          maxWidth: '240px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}
                        title={ev.sqlText}
                      >
                        {ev.sqlText}
                      </TableCell>
                      <TableCell style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                        <div>{ev.durationMs}ms</div>
                        <div style={{ color: '#8d8d8d' }}>{(ev.bytesScanned / 1024).toFixed(1)} KB</div>
                      </TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>
                        {getRiskTag(ev.riskLevel)}
                        <div style={{ marginTop: '0.2rem' }}>
                          <Tag type={ev.status === 'FINISHED' ? 'teal' : 'red'} size="sm">{ev.status}</Tag>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <Pagination
            backwardText="Previous page"
            forwardText="Next page"
            itemsPerPageText="Items per page:"
            page={page}
            pageNumberText="Page Number"
            pageSize={pageSize}
            pageSizes={[5, 10, 20, 50]}
            totalItems={totalItems}
            onChange={({ page: newPage, pageSize: newPageSize }) => {
              setPage(newPage);
              setPageSize(newPageSize);
            }}
          />
        </TableContainer>
      </div>

      {/* Portal to document.body escapes the fullscreen panel's stacking
          context. The outer div establishes a new stacking context at
          z-index 10000 (above the fullscreen panel's 9999) so Carbon's
          modal backdrop at z-index 9000 paints above the panel.
          <Theme> restores the g90 dark tokens outside the app tree. */}
      {createPortal(
        <div style={{ position: 'relative', zIndex: 10000 }}>
          <Theme theme="g90">
            <QueryDetailModal
              event={detailEvent}
              open={modalOpen}
              onClose={() => setModalOpen(false)}
            />
          </Theme>
        </div>,
        document.body
      )}
    </>
  );
}
