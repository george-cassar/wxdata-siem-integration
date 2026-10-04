import React, { createContext, useContext, useReducer, useEffect } from 'react';
import { getSiemSummary, getSiemEvents, getSiemOffenses, getScenarios } from '../services/api';

const DemoContext = createContext();

const initialState = {
  loading: true,
  // All summary fields start at zero/null — they are replaced entirely by the
  // first GET /api/siem/summary response, whether live or mock.
  summary: {
    totalAuditEvents: 0,
    activeOffenses: 0,
    criticalOffenses: 0,
    highOffenses: 0,
    totalVolumeScannedBytes: 0,
    totalRowsProcessed: 0,
    engineStatus: null,
    leefStreamRate: null,
  },
  events: [],
  offenses: [],
  scenarios: [],
  selectedEvent: null,
  activeScenario: null,
  wsConnected: false
};

function demoReducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_INITIAL_DATA':
      return {
        ...state,
        summary: action.payload.summary || state.summary,
        events: action.payload.events || state.events,
        offenses: action.payload.offenses || state.offenses,
        scenarios: action.payload.scenarios || state.scenarios,
        loading: false
      };
    case 'ADD_LIVE_EVENT': {
      const newEvents = [action.payload.event, ...state.events.slice(0, 49)];
      const newOffenses = action.payload.offense
        ? [action.payload.offense, ...state.offenses.slice(0, 29)]
        : state.offenses;
      const newSummary = {
        ...state.summary,
        totalAuditEvents: (state.summary?.totalAuditEvents || 0) + 1,
        activeOffenses: newOffenses.length,
        criticalOffenses: newOffenses.filter(o => o.severity === 'CRITICAL').length,
        highOffenses: newOffenses.filter(o => o.severity === 'HIGH').length,
      };

      return {
        ...state,
        events: newEvents,
        offenses: newOffenses,
        summary: newSummary
      };
    }
    case 'SELECT_EVENT':
      return { ...state, selectedEvent: action.payload };
    case 'SET_SCENARIO':
      return { ...state, activeScenario: action.payload };
    case 'SET_WS_STATUS':
      return { ...state, wsConnected: action.payload };
    default:
      return state;
  }
}

export function DemoProvider({ children }) {
  const [state, dispatch] = useReducer(demoReducer, initialState);

  const refreshData = async () => {
    try {
      const [summary, events, offenses, scenarios] = await Promise.all([
        getSiemSummary(),
        getSiemEvents(30),
        getSiemOffenses(),
        getScenarios()
      ]);
      dispatch({
        type: 'SET_INITIAL_DATA',
        payload: { summary, events, offenses, scenarios }
      });
      if (events.length > 0 && !state.selectedEvent) {
        dispatch({ type: 'SELECT_EVENT', payload: events[0] });
      }
    } catch (err) {
      console.warn('Backend offline or mock fallback:', err);
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  useEffect(() => {
    refreshData();

    // WebSocket live stream
    let ws;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/siem/ws`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => dispatch({ type: 'SET_WS_STATUS', payload: true });
      ws.onclose = () => dispatch({ type: 'SET_WS_STATUS', payload: false });
      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data.type === 'NEW_EVENT') {
            dispatch({ type: 'ADD_LIVE_EVENT', payload: data });
          }
        } catch (e) {
          console.error('WS Parse Error', e);
        }
      };
    } catch (e) {
      console.warn('WS Init failed:', e);
    }

    return () => {
      if (ws) ws.close();
    };
  }, []);

  return (
    <DemoContext.Provider value={{ state, dispatch, refreshData }}>
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo() {
  return useContext(DemoContext);
}
