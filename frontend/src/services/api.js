import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
});

// Separate long-poll client for /siem/execute — real Presto queries can take
// 20-60 s on first run on watsonx.data; the default 15 s budget is too tight.
const slowApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 90000,
});
slowApi.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('API Error (execute):', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export const getHealth = () => api.get('/health');
export const getSiemSummary = () => api.get('/siem/summary');
export const getSiemEvents = (limit = 50) => api.get(`/siem/events?limit=${limit}`);
export const getSiemOffenses = () => api.get('/siem/offenses');
export const getSiemRules = () => api.get('/siem/rules');
export const getScenarios = () => api.get('/scenarios');
export const executeQuery = (payload) => slowApi.post('/siem/execute', payload);
export const resetSiemState = () => api.post('/siem/reset');

// watsonx.data catalog metadata (live mode: real Presto; mock mode: simulated)
export const getCatalogs = () => api.get('/siem/catalog');
// Full catalog → schema → table tree across ALL catalogs in one call
export const getCatalogTree = () => api.get('/siem/catalog/tree');
export const getSchemas = (catalog) => api.get(`/siem/catalog/${catalog}/schemas`);
export const getTables = (catalog, schema) => api.get(`/siem/catalog/${catalog}/schemas/${schema}/tables`);

export default api;
