import React, { useMemo } from 'react';
import { useDemo } from '../context/DemoContext';
import KPICard from '../components/KPICard';
import SOCChartPanel from '../components/SOCChartPanel';
import LogActivityTable from '../components/LogActivityTable';
import PacketInspector from '../components/PacketInspector';
import { Security, WarningAlt, Activity, DataStructured, Reset, Time } from '@carbon/icons-react';
import { Button, Tag, Tooltip } from '@carbon/react';
import { resetSiemState } from '../services/api';

/** Derives the dashboard time window from the events array. */
function useDashboardPeriod(events) {
  return useMemo(() => {
    if (!events || events.length === 0) return null;
    const ts = events
      .map((e) => e.timestamp)
      .filter(Boolean)
      .map((t) => new Date(t).getTime())
      .filter((n) => !isNaN(n));
    if (ts.length === 0) return null;
    const oldest = new Date(Math.min(...ts));
    const newest = new Date(Math.max(...ts));
    const fmt = (d) =>
      d.toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    return `${fmt(oldest)} – ${fmt(newest)} (${events.length} events)`;
  }, [events]);
}

export default function DashboardPage() {
  const { state, dispatch, refreshData } = useDemo();
  const { summary, events, offenses, selectedEvent } = state;
  const periodLabel = useDashboardPeriod(events);

  const handleReset = async () => {
    await resetSiemState();
    refreshData();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 600, margin: 0 }}>SIEM SOC Activity & Threat Overview</h2>
          <div style={{ fontSize: '0.875rem', color: '#c6c6c6', marginTop: '0.25rem' }}>
            Unified Presto audit event ingestion, real-time LEEF streaming, and threat correlation for IBM watsonx.data
          </div>
          {periodLabel ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.5rem' }}>
              <Time size={14} style={{ color: '#78a9ff' }} aria-hidden="true" />
              <span style={{ fontSize: '0.75rem', color: '#78a9ff' }}>
                Dashboard period: {periodLabel}
              </span>
            </div>
          ) : (
            <div style={{ marginTop: '0.5rem' }}>
              <Tag type="warm-gray" size="sm">No events yet — awaiting telemetry</Tag>
            </div>
          )}
        </div>
        <Tooltip
          label="Clears all in-session events and offenses accumulated during mock test runs, then reloads a clean synthetic baseline."
          align="bottom-right"
        >
          <Button kind="danger--ghost" renderIcon={Reset} onClick={handleReset} size="md">
            Reset Telemetry Baseline
          </Button>
        </Tooltip>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <KPICard
          title="Total Intercepted Queries"
          value={summary.totalAuditEvents?.toLocaleString()}
          subtitle="Real-time Presto SPI event stream"
          icon={Activity}
          status="default"
          tooltip="Displays the cumulative count of Presto query executions intercepted across all catalogs. Calculated by aggregating event records received via the Presto SPI audit listener and LEEF stream buffer."
        />
        <KPICard
          title="Active SIEM Offenses"
          value={summary.activeOffenses?.toString()}
          subtitle={`${summary.criticalOffenses} Critical | ${summary.highOffenses} High`}
          icon={WarningAlt}
          status={summary.criticalOffenses > 0 ? 'critical' : summary.activeOffenses > 0 ? 'warning' : 'success'}
          tooltip="Displays currently open security incidents flagged for SOC triage. Calculated by evaluating ingested query events against SIEM correlation rules (mass exfiltration, unauthorized schema access, privilege escalation, and suspicious IPs)."
        />
        <KPICard
          title="Lakehouse Scanned Volume"
          value={`${(summary.totalVolumeScannedBytes / 1024 / 1024 / 1024).toFixed(2)} GB`}
          subtitle="Monitored Iceberg & Hive data scans"
          icon={DataStructured}
          status="default"
          tooltip="Displays total volume of table data scanned across Iceberg and Hive catalogs. Calculated by summing the processed input data bytes from Presto query completion statistics and converting to Gigabytes (GB)."
        />
        <KPICard
          title="SIEM Feed Velocity"
          value={summary.leefStreamRate || "—"}
          subtitle="Syslog TLS / Universal REST forwarder"
          icon={Security}
          status="success"
          tooltip="Displays the instantaneous throughput rate of audit telemetry dispatched to SIEM destinations. Calculated as the rolling average of LEEF/CEF formatted event records emitted per second (events/sec)."
        />
      </div>

      {/* Charts */}
      <SOCChartPanel events={events} offenses={offenses} />

      {/* Split View: Table & Packet Inspector */}
      <div className="soc-split-view">
        <div className="soc-table-column">
          <LogActivityTable
            events={events}
            onSelectEvent={(ev) => dispatch({ type: 'SELECT_EVENT', payload: ev })}
            selectedEventId={selectedEvent?.eventId || selectedEvent?.queryId}
          />
        </div>
        <div className="soc-inspector-column">
          <PacketInspector event={selectedEvent} />
        </div>
      </div>
    </div>
  );
}
