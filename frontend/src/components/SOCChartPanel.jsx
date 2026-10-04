import React, { useMemo } from 'react';
import { Tile, Tag, Tooltip } from '@carbon/react';
import { Information } from '@carbon/icons-react';
import { DonutChart, SimpleBarChart } from '@carbon/charts-react';
import '@carbon/charts/styles.css';

/** Returns "Last N events · window start → now" label for the chart subtitle. */
function periodLabel(events) {
  if (!events || events.length === 0) return 'No events recorded yet';
  const timestamps = events
    .map((e) => e.timestamp)
    .filter(Boolean)
    .map((t) => new Date(t).getTime())
    .filter((n) => !isNaN(n));
  if (timestamps.length === 0) return `${events.length} events`;
  const oldest = new Date(Math.min(...timestamps));
  const newest = new Date(Math.max(...timestamps));
  const fmt = (d) =>
    d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  return `${events.length} events · ${fmt(oldest)} – ${fmt(newest)}`;
}

export default function SOCChartPanel({ events = [], offenses = [] }) {
  // ── Risk Distribution ──────────────────────────────────────────────────────
  // Use real counts only — no hardcoded fallback values that would mix real and
  // mock data when the engine hasn't been reset between test runs.
  const riskCounts = useMemo(
    () =>
      events.reduce((acc, ev) => {
        const risk = ev.riskLevel || 'LOW';
        acc[risk] = (acc[risk] || 0) + 1;
        return acc;
      }, {}),
    [events]
  );

  const donutData = [
    { group: 'LOW (Standard)',         value: riskCounts['LOW']      ?? 0 },
    { group: 'MEDIUM (Anomalous)',      value: riskCounts['MEDIUM']   ?? 0 },
    { group: 'HIGH (Privilege/DDL)',    value: riskCounts['HIGH']     ?? 0 },
    { group: 'CRITICAL (Exfiltration)',value: riskCounts['CRITICAL']  ?? 0 },
  ];

  const riskPeriodLabel = periodLabel(events);

  const donutOptions = {
    title: 'Audit Event Risk Classification',
    resizable: true,
    donut: {
      center: { label: 'Total Queries' }
    },
    color: {
      scale: {
        'LOW (Standard)':           '#24a148',
        'MEDIUM (Anomalous)':       '#f1c21b',
        'HIGH (Privilege/DDL)':     '#ff832b',
        'CRITICAL (Exfiltration)':  '#da1e28'
      }
    },
    theme: 'g90',
    height: '260px'
  };

  // ── Catalog / Schema activity ──────────────────────────────────────────────
  const tableCounts = useMemo(
    () =>
      events.reduce((acc, ev) => {
        // Skip placeholder/undefined keys so they don't pollute the chart
        if (!ev.catalog || ev.catalog === 'undefined') return acc;
        const key = `${ev.catalog}.${ev.schema}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    [events]
  );

  // Show ALL distinct catalog.schema pairs, sorted by frequency (no artificial top-5 cap)
  const barData = Object.entries(tableCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([group, value]) => ({ group, value }));

  const barPeriodLabel = periodLabel(events);

  // Palette for deterministic colors — Carbon blue-family, no hardcoded keys so
  // any catalog (including lab_catalog01, iceberg_data, hive_lake, etc.) gets a color.
  const BAR_PALETTE = [
    '#0f62fe', '#6929c4', '#005d5d', '#8a3ffc', '#1192e8',
    '#009d9a', '#9f1853', '#fa4d56', '#570408', '#198038',
  ];
  const colorScale = useMemo(() => {
    const entries = Object.entries(tableCounts).sort((a, b) => b[1] - a[1]);
    return Object.fromEntries(
      entries.map(([key], i) => [key, BAR_PALETTE[i % BAR_PALETTE.length]])
    );
  }, [tableCounts]);

  const barOptions = {
    title: 'Query Activity by Lakehouse Catalog & Schema',
    axes: {
      left:   { mapsTo: 'value' },
      bottom: { mapsTo: 'group', scaleType: 'labels' }
    },
    color: { scale: colorScale },
    theme: 'g90',
    height: '260px'
  };

  // Empty-state placeholder so the chart renders a frame even with 0 events
  const barDataOrPlaceholder =
    barData.length > 0
      ? barData
      : [{ group: '—', value: 0 }];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
      <Tile className="panel-card" style={{ margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Tooltip
              label="Displays the proportion of queries across risk tiers (Low, Medium, High, Critical). Calculated by evaluating query execution context (SQL tokens, target catalogs, scanned data volume thresholds, user identity, and policy violations)."
              align="bottom-left"
            >
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f4f4f4', cursor: 'help', textDecoration: 'underline dotted #8d8d8d', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                Audit Event Risk Classification
                <Information size={14} style={{ color: '#78a9ff' }} />
              </span>
            </Tooltip>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#8d8d8d' }} aria-label="Chart time period">
              {riskPeriodLabel}
            </span>
            {events.length === 0 && (
              <Tag type="warm-gray" size="sm">Awaiting events</Tag>
            )}
          </div>
        </div>
        <DonutChart data={donutData} options={{ ...donutOptions, title: undefined }} />
      </Tile>
      <Tile className="panel-card" style={{ margin: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Tooltip
              label="Displays query execution frequency grouped by lakehouse catalog and schema. Calculated by aggregating event counts per catalog.schema namespace from intercepted Presto SPI audit records."
              align="bottom-left"
            >
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f4f4f4', cursor: 'help', textDecoration: 'underline dotted #8d8d8d', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                Query Activity by Catalog & Schema
                <Information size={14} style={{ color: '#78a9ff' }} />
              </span>
            </Tooltip>
          </div>
          <span style={{ fontSize: '0.75rem', color: '#8d8d8d' }} aria-label="Chart time period">
            {barPeriodLabel}
          </span>
        </div>
        <SimpleBarChart data={barDataOrPlaceholder} options={{ ...barOptions, title: undefined }} />
      </Tile>
    </div>
  );
}
