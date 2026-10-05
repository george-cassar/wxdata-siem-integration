import React, { useState, useEffect } from 'react';
import {
  TextArea,
  Button,
  Select,
  SelectItem,
  Tag,
  InlineNotification,
  Loading,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer
} from '@carbon/react';
import { Play, Flash, Security, WarningAlt, CheckmarkFilled } from '@carbon/icons-react';
import { useDemo } from '../context/DemoContext';
import { executeQuery, getFrontendConfig } from '../services/api';
import PacketInspector from '../components/PacketInspector';

export default function QueryStudioPage() {
  const { state, dispatch } = useDemo();
  const { scenarios } = state;

  const [selectedScenarioId, setSelectedScenarioId] = useState('scenario-1');
  const [sqlText, setSqlText] = useState('');
  const [currentUser, setCurrentUser] = useState('');
  const [clientIp, setClientIp] = useState('');

  // Load defaults from the backend on first render so no values are hardcoded here.
  useEffect(() => {
    getFrontendConfig()
      .then((cfg) => {
        setSqlText((prev) => prev || cfg.defaultQuerySql || '');
        setCurrentUser((prev) => prev || cfg.defaultQueryUser || '');
        setClientIp((prev) => prev || cfg.defaultQueryClientIp || '');
      })
      .catch(() => {});
  }, []);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [execError, setExecError] = useState(null);

  const handleScenarioChange = (e) => {
    const id = e.target.value;
    setSelectedScenarioId(id);
    const scen = scenarios.find((s) => s.id === id);
    if (scen) {
      setSqlText(scen.sql);
      setCurrentUser(scen.user);
      setClientIp(scen.clientIp);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setExecError(null);
    try {
      const resp = await executeQuery({
        sql: sqlText,
        user: currentUser,
        clientIp: clientIp,
        scenarioId: selectedScenarioId
      });
      setLastResult(resp);
      dispatch({
        type: 'ADD_LIVE_EVENT',
        payload: {
          event: resp.auditEvent,
          offense: resp.triggeredOffense
        }
      });
      dispatch({ type: 'SELECT_EVENT', payload: resp.auditEvent });
    } catch (err) {
      console.error(err);
      const detail = err.response?.data?.detail || err.response?.data?.message || err.message || 'Unknown error';
      const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout');
      setExecError(isTimeout
        ? 'Query timed out (>90 s). The Presto cluster may be under load — try again or simplify the SQL.'
        : `Execution failed: ${detail}`
      );
    } finally {
      setRunning(false);
    }
  };

  const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 600, margin: 0 }}>Interactive Presto Query Studio & Audit Interceptor</h2>
        <div style={{ fontSize: '0.875rem', color: '#c6c6c6', marginTop: '0.25rem' }}>
          Execute SQL queries on watsonx.data Presto to observe instantaneous SPI event generation, LEEF formatting, and SIEM correlation
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Left Column: SQL Runner */}
        <div className="panel-card" style={{ margin: 0 }}>
          <div className="panel-title">
            <Flash size={20} />
            <span>Presto SQL Execution Workspace</span>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
            <Select
              id="scenario-select"
              labelText="Load Demo Scenario"
              value={selectedScenarioId}
              onChange={handleScenarioChange}
              style={{ flex: 1 }}
            >
              {scenarios.map((s) => (
                <SelectItem key={s.id} value={s.id} text={`${s.title} (${s.riskLevel} Risk)`} />
              ))}
            </Select>
          </div>

          {selectedScenario && (
            <div style={{ background: '#1e1e1e', padding: '0.75rem', marginBottom: '1rem', borderLeft: '3px solid #0f62fe' }}>
              <div style={{ fontSize: '0.75rem', color: '#8d8d8d' }}>Scenario Context:</div>
              <div style={{ fontSize: '0.8125rem', color: '#f4f4f4' }}>{selectedScenario.description}</div>
              <div style={{ fontSize: '0.75rem', color: '#78a9ff', marginTop: '0.25rem' }}>
                Expected: {selectedScenario.expectedOutcome}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#c6c6c6', display: 'block', marginBottom: '0.25rem' }}>Authenticated User</label>
              <input
                type="text"
                value={currentUser}
                onChange={(e) => setCurrentUser(e.target.value)}
                style={{ width: '100%', background: '#161616', color: '#f4f4f4', border: '1px solid #525252', padding: '0.5rem', fontSize: '0.875rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#c6c6c6', display: 'block', marginBottom: '0.25rem' }}>Client Source IP</label>
              <input
                type="text"
                value={clientIp}
                onChange={(e) => setClientIp(e.target.value)}
                className="mono-text"
                style={{ width: '100%', background: '#161616', color: '#f4f4f4', border: '1px solid #525252', padding: '0.5rem', fontSize: '0.875rem' }}
              />
            </div>
          </div>

          <TextArea
            labelText="SQL Statement (Iceberg Lakehouse / Hive Catalog)"
            value={sqlText}
            onChange={(e) => setSqlText(e.target.value)}
            rows={5}
            className="sql-editor-area"
          />

          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button
              kind="primary"
              renderIcon={Play}
              onClick={handleRun}
              disabled={running}
            >
              {running ? 'Executing & Intercepting...' : 'Execute on Presto & Stream to SIEM'}
            </Button>
            {lastResult && (
              <Tag type={lastResult.execution.status === 'FINISHED' ? 'green' : 'red'}>
                {lastResult.execution.status} in {lastResult.execution.durationMs}ms
              </Tag>
            )}
          </div>
        </div>

        {/* Right Column: Execution Output */}
        <div>
          {lastResult?.triggeredOffense && (
            <InlineNotification
              kind="error"
              title={`SIEM Offense Triggered: ${lastResult.triggeredOffense.ruleName}`}
              subtitle={`Offense ID ${lastResult.triggeredOffense.offenseId} · MITRE ${lastResult.triggeredOffense.mitreTechnique}`}
              lowContrast
              style={{ marginBottom: '1rem' }}
            />
          )}

          <div className="panel-card" style={{ margin: 0, minHeight: '380px' }}>
            <div className="panel-title">
              <Security size={20} />
              <span>Query Result Set & Engine Telemetry</span>
            </div>

            {running ? (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <Loading withOverlay={false} description="Running query across Presto workers..." />
              </div>
            ) : execError ? (
              <InlineNotification
                kind="error"
                title="Query Execution Failed"
                subtitle={execError}
                hideCloseButton={false}
                lowContrast
                onClose={() => setExecError(null)}
                style={{ marginBottom: '1rem' }}
              />
            ) : lastResult ? (
              <div>
                {lastResult.execution.errorCode ? (
                  <InlineNotification
                    kind="error"
                    title={`Error: ${lastResult.execution.errorCode}`}
                    subtitle={lastResult.execution.errorMessage}
                    hideCloseButton
                    lowContrast
                  />
                ) : (
                  <TableContainer title={`Returned ${lastResult.execution.data?.length || 0} rows`}>
                    <Table size="sm">
                      <TableHead>
                        <TableRow>
                          {lastResult.execution.columns?.map((c, i) => (
                            <TableHeader key={i}>{c}</TableHeader>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {lastResult.execution.data?.map((row, idx) => (
                          <TableRow key={idx}>
                            {row.map((cell, ci) => (
                              <TableCell key={ci} className="mono-text" style={{ fontSize: '0.8125rem' }}>{cell}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#8d8d8d', marginTop: '4rem' }}>
                Run any scenario or custom SQL above to view execution results and SIEM packet generation.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Packet Inspector for Last Query */}
      {lastResult?.auditEvent && (
        <PacketInspector event={lastResult.auditEvent} />
      )}
    </div>
  );
}
