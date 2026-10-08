// HTTP-клиент бэкенда. Адрес задаётся в .env: VITE_API_URL=https://адрес-бэкенда
const BASE = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
const PAGE = 1000; // максимум limit на бэкенде
const RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]),
  ).toString();
  const url = `${BASE}/api${path}${qs ? `?${qs}` : ''}`;
  // 5xx и сетевые сбои повторяем: free-инстанс Render и пулер БД иногда отвечают ошибкой на параллельные запросы
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      if (attempt >= RETRIES) throw e;
      await sleep(400 * (attempt + 1));
      continue;
    }
    if (res.ok) {
      const body = await res.json();
      return body?.data ?? body;
    }
    if (res.status < 500 || attempt >= RETRIES) throw new Error(`${path}: HTTP ${res.status}`);
    await sleep(400 * (attempt + 1));
  }
}

async function post(path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.detail ?? `${path}: HTTP ${res.status}`);
  return json?.data ?? json;
}

// Адрес WebSocket-стрима симулятора: тот же хост, что у API, схема ws/wss
export function streamUrl() {
  const origin = BASE || window.location.origin;
  return `${origin.replace(/^http/, 'ws')}/ws/digital-twin/stream`;
}

// Списки с пагинацией limit/offset — выкачиваем все страницы
async function getAll(path, params = {}) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await get(path, { ...params, limit: PAGE, offset });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export const api = {
  health: () => get('/health/db'),
  factories: () => get('/factories'),
  areas: (factoryId) => get('/production-areas', { factory_id: factoryId }),
  equipment: () => get('/equipment'),
  carModels: () => get('/car-models'),
  shifts: (factoryId, limit = 80) => get('/shifts', { factory_id: factoryId, limit }),
  plans: (factoryId) => getAll('/production-plans', { factory_id: factoryId }),
  productionRecords: (dateFrom, dateTo) => getAll('/production-records', { date_from: dateFrom, date_to: dateTo }),
  qualityRecords: (dateFrom, dateTo) => getAll('/quality-records', { date_from: dateFrom, date_to: dateTo }),
  downtime: (dateFrom) => getAll('/downtime-events', { date_from: dateFrom }),
  activeDowntime: () => getAll('/downtime-events', { active: true }),
  incidents: (dateFrom) => getAll('/incidents', { date_from: dateFrom }),
  oee: (factoryId, dateFrom, dateTo) => get('/analytics/oee', { factory_id: factoryId, date_from: dateFrom, date_to: dateTo }),
  qualityMetrics: (dateFrom, dateTo) => get('/analytics/quality-metrics', { date_from: dateFrom, date_to: dateTo }),
  simStatus: () => get('/sim/status'),
  simInject: (scenario) => post('/sim/inject', { scenario }),
  simPause: () => post('/sim/pause'),
  simResume: () => post('/sim/resume'),
  simReset: () => post('/sim/reset'),
  simSpeed: (speed) => post('/sim/speed', { speed }),
  decisions: () => get('/decisions', { limit: 300 }),
  decide: (incidentId, choice) => post(`/incidents/${incidentId}/decision`, { choice }),
};
