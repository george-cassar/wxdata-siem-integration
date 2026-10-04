import React, { useEffect, useState } from 'react';
import { InlineNotification } from '@carbon/react';
import { DataBase, CheckmarkFilled, Information } from '@carbon/icons-react';
import { getHealth } from '../services/api';

export default function DemoBanner() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    getHealth()
      .then((data) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);

  const isLive = health?.demoMode === 'live';
  const presto = health?.presto;

  // ── Live mode ─────────────────────────────────────────────────────────────
  if (isLive && presto) {
    return (
      <div className="demo-banner-sticky">
        <div
          style={{
            background: '#0e3a1c',
            borderBottom: '1px solid #24a148',
            padding: '0.5rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
          role="status"
          aria-label="Live Presto connection details"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <CheckmarkFilled size={16} style={{ color: '#24a148' }} aria-hidden="true" />
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#24a148' }}>
              Live Mode
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <DataBase size={14} style={{ color: '#78a9ff' }} aria-hidden="true" />
            <span style={{ fontSize: '0.8125rem', color: '#c6c6c6' }}>Presto:</span>
            <code style={{ fontSize: '0.8125rem', color: '#f4f4f4', fontFamily: 'IBM Plex Mono, monospace' }}>
              {presto.url}
            </code>
          </div>

        </div>
      </div>
    );
  }

  // ── Loading / backend unreachable — show nothing until health resolves ─────
  if (health === null) {
    return null;
  }

  // ── Mock mode (default) ───────────────────────────────────────────────────
  return (
    <div className="demo-banner-sticky">
      <InlineNotification
        kind="info"
        title="Demonstration & Simulation Environment"
        subtitle="All data, Presto audit events, and user activities are synthetic. No real client data or PII is used. Built with IBM watsonx.data."
        hideCloseButton
        lowContrast
        renderIcon={Information}
      />
    </div>
  );
}
