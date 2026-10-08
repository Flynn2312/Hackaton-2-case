// Живой цифровой двойник: первичная загрузка + WebSocket-поток симулятора завода.
// Изменения строк (оборудование, простои, инциденты, почасовая выработка) дописываются в сырые данные,
// модель пересобирается на клиенте не чаще раза в секунду. Без WebSocket — опрос API, как раньше.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, streamUrl } from './api';
import { buildModel, loadRaw } from './model';

const REBUILD_MS = 1000;       // не чаще — пересборка модели и перерисовка дашборда
const POLL_LIVE_MS = 120_000;  // полная сверка с API при живом потоке
const POLL_OFFLINE_MS = 30_000;
const PING_MS = 30_000;        // держит соединение и не даёт free-инстансу Render уснуть
const NOTICE_TTL_MS = 8000;
const MAX_NOTICES = 4;

// Таблица в событии upsert -> ключ в сырых данных
const TABLES = {
  equipment: 'equipment', downtime_events: 'downtime', incidents: 'incidents', shifts: 'shifts',
  production_plans: 'plans', production_records: 'records', quality_records: 'quality',
  incident_decisions: 'decisions',
};

function upsert(list, rows) {
  const out = [...list];
  const index = new Map(out.map((r, i) => [r.id, i]));
  for (const row of rows) {
    const i = index.get(row.id);
    if (i != null) out[i] = { ...out[i], ...row };
    else { index.set(row.id, out.length); out.push(row); }
  }
  return out;
}

export function useLiveTwin() {
  const rawRef = useRef(null);
  const clockRef = useRef({ simNow: null, speed: 0, running: false, at: 0 });
  const rebuildTimer = useRef(null);
  const lastRebuild = useRef(0);
  const lastLoad = useRef(0);
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [sim, setSim] = useState(null);       // статус симулятора: speed, running, scenarios, ...
  const [notices, setNotices] = useState([]);

  // Текущее время завода: последнее известное + прошедшее реальное время × скорость
  const simNow = useCallback(() => {
    const c = clockRef.current;
    if (c.simNow == null) return null;
    return c.simNow + (c.running ? (Date.now() - c.at) * c.speed : 0);
  }, []);

  const setClock = useCallback((s) => {
    if (!s?.sim_now) return;
    clockRef.current = { simNow: new Date(s.sim_now).getTime(), speed: Number(s.speed) || 0, running: !!s.running, at: Date.now() };
  }, []);

  const rebuild = useCallback(() => {
    clearTimeout(rebuildTimer.current);
    rebuildTimer.current = null;
    if (!rawRef.current) return;
    lastRebuild.current = Date.now();
    try {
      setModel(buildModel(rawRef.current, simNow()));
    } catch (e) {
      setError(e);
    }
  }, [simNow]);

  const scheduleRebuild = useCallback(() => {
    if (rebuildTimer.current) return;
    const wait = Math.max(0, REBUILD_MS - (Date.now() - lastRebuild.current));
    rebuildTimer.current = setTimeout(rebuild, wait);
  }, [rebuild]);

  const reload = useCallback(async () => {
    setLoading(true);
    lastLoad.current = Date.now();
    try {
      const raw = await loadRaw();
      rawRef.current = raw;
      if (raw.sim) {
        setSim((prev) => ({ ...prev, ...raw.sim }));
        setClock(raw.sim);
      }
      rebuild();
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [rebuild, setClock]);

  const pushNotice = useCallback((n) => {
    const id = `${Date.now()}-${Math.random()}`;
    setNotices((list) => [{ ...n, id }, ...list].slice(0, MAX_NOTICES));
    setTimeout(() => setNotices((list) => list.filter((x) => x.id !== id)), NOTICE_TTL_MS);
  }, []);

  const dismissNotice = useCallback((id) => setNotices((list) => list.filter((x) => x.id !== id)), []);

  // Первичная загрузка и периодическая сверка
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    const t = setInterval(reload, connected ? POLL_LIVE_MS : POLL_OFFLINE_MS);
    return () => clearInterval(t);
  }, [reload, connected]);

  // Пока завод работает, модель стареет даже без событий (длительность идущих простоев, текущий час)
  useEffect(() => {
    const t = setInterval(() => { if (clockRef.current.running) scheduleRebuild(); }, 5000);
    return () => clearInterval(t);
  }, [scheduleRebuild]);

  // WebSocket с переподключением
  useEffect(() => {
    let ws;
    let closed = false;
    let retry = 0;
    let reconnectTimer;
    let pingTimer;

    const handle = (msg) => {
      switch (msg.type) {
        case 'hello':
        case 'clock':
          setClock(msg);
          setSim((prev) => ({ ...prev, ...msg }));
          break;
        case 'upsert': {
          const key = TABLES[msg.table];
          if (key && rawRef.current) {
            rawRef.current = { ...rawRef.current, [key]: upsert(rawRef.current[key] ?? [], msg.rows) };
            scheduleRebuild();
          }
          break;
        }
        case 'notice':
          pushNotice(msg);
          break;
        case 'reload':
          reload();
          break;
        default:
      }
    };

    const connect = () => {
      ws = new WebSocket(streamUrl());
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        // После переподключения могли пропустить события — сверяемся с API
        if (Date.now() - lastLoad.current > 3000) reload();
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
      };
      ws.onmessage = (e) => {
        try { handle(JSON.parse(e.data)); } catch { /* битое сообщение пропускаем */ }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        setConnected(false);
        if (closed) return;
        retry += 1;
        reconnectTimer = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(retry, 4)));
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      ws?.close();
    };
  }, [reload, scheduleRebuild, pushNotice, setClock]);

  // Управление симуляцией (сценарии, пауза, сброс)
  const control = useCallback(async (action) => {
    const res = await action(api);
    if (res?.status) {
      setSim((prev) => ({ ...prev, ...res.status }));
      setClock(res.status);
    }
    return res;
  }, [setClock]);

  return { model, error, loading, reload, connected, sim, simNow, notices, dismissNotice, control };
}
