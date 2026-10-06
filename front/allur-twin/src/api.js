// Слой данных: ходит на бэкенд и приводит ответы к формату, который ждёт интерфейс.
// Адрес бэкенда задаётся в файле .env:  VITE_API_URL=https://адрес-бэкенда
const BASE = import.meta.env.VITE_API_URL || "";

async function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null)
  ).toString();
  const res = await fetch(`${BASE}/api${path}${qs ? "?" + qs : ""}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

const EQ_STATE = { running: "run", idle: "idle", maintenance: "maint", breakdown: "down" };

// Складываем записи по часам: "2026-10-06T09:15" -> "09:00"
function byHour(records) {
  const m = {};
  for (const r of records) {
    const k = r.timestamp.slice(0, 13);
    m[k] ??= { hour: k.slice(11) + ":00", plan: 0, fact: 0, loads: [] };
    m[k].plan += r.planned_quantity;
    m[k].fact += r.actual_quantity;
    m[k].loads.push(r.load_percent);
  }
  return Object.keys(m).sort().map((k) => m[k]);
}

export const api = {
  async getSnapshot() {
    // берём самую свежую смену
    const shifts = await get("/shifts", { limit: 1000 });
    if (!shifts.length) throw new Error("в базе нет смен");
    const shift = shifts.reduce((a, b) => (a.start_at > b.start_at ? a : b));

    const [areas, equipment, prod, quality, downtime, incidents] = await Promise.all([
      get("/production-areas"),
      get("/equipment"),
      get("/production-records", { shift_id: shift.id, limit: 1000 }),
      get("/quality-records", { shift_id: shift.id, limit: 1000 }),
      get("/downtime-events", { shift_id: shift.id, limit: 1000 }),
      get("/incidents", { limit: 100 }),
    ]);

    const areaOfEq = Object.fromEntries(equipment.map((e) => [e.id, e.production_area_id]));
    const history = {};

    const zones = [...areas]
      .sort((a, b) => a.sequence - b.sequence)
      .map((a) => {
        const hours = byHour(prod.filter((r) => r.production_area_id === a.id));
        const last = hours[hours.length - 1] || { plan: 0, fact: 0, loads: [0] };
        history[a.id] = hours.map(({ hour, plan, fact }) => ({ hour, plan, fact }));

        const q = quality.filter((r) => r.production_area_id === a.id);
        const total = q.reduce((s, r) => s + r.total_quantity, 0);
        const good = q.reduce((s, r) => s + r.good_quantity, 0);

        const mins = downtime
          .filter((d) => areaOfEq[d.equipment_id] === a.id)
          .reduce((s, d) => {
            const m = d.duration_minutes ?? (d.ended_at ? 0 : (Date.now() - new Date(d.started_at)) / 60000);
            return s + Math.min(Math.max(m, 0), 480);
          }, 0);

        return {
          id: a.id,
          name: a.name,
          plan: last.plan,
          output: last.fact,
          load: Math.round(last.loads.reduce((s, v) => s + v, 0) / last.loads.length),
          downtime: Math.round(mins),
          quality: total ? Math.round((good / total) * 1000) / 10 : 100,
          equipment: equipment
            .filter((e) => e.production_area_id === a.id)
            .map((e) => [e.name, EQ_STATE[e.status] || "idle"]),
        };
      });

    // общий график завода = выпуск последнего участка цепочки
    history.all = zones.length ? history[zones[zones.length - 1].id] : [];

    const incidentsUi = incidents
      .filter((i) => i.status === "open" || i.status === "in_progress")
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .map((i) => ({
        id: i.id,
        zone: i.production_area_id,
        level: i.severity === "high" || i.severity === "critical" ? "bad" : "warn",
        time: i.created_at.slice(11, 16),
        text: i.title,
      }));

    return { zones, incidents: incidentsUi, history };
  },
};
