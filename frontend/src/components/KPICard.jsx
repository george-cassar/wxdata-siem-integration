import React from 'react';
import { Tile, Tooltip } from '@carbon/react';

export default function KPICard({ title, value, subtitle, status = 'default', icon: Icon, tooltip }) {
  const getStatusClass = () => {
    switch (status) {
      case 'critical': return 'kpi-tile critical';
      case 'warning': return 'kpi-tile warning';
      case 'success': return 'kpi-tile success';
      default: return 'kpi-tile';
    }
  };

  const titleContent = (
    <span style={{ cursor: tooltip ? 'help' : 'default', textDecoration: tooltip ? 'underline dotted #8d8d8d' : 'none' }}>
      {title}
    </span>
  );

  return (
    <Tile className={getStatusClass()}>
      <div className="kpi-title">
        {tooltip ? (
          <Tooltip label={tooltip} align="bottom">
            {titleContent}
          </Tooltip>
        ) : (
          titleContent
        )}
        {Icon && <Icon size={20} />}
      </div>
      <div className="kpi-value">{value}</div>
      {subtitle && <div className="kpi-subtitle">{subtitle}</div>}
    </Tile>
  );
}
