// Итоги за выбранный период (смена / сутки / неделя / месяц) для «Сводки» и «Финансов».
// Считаются на клиенте из той же истории, что и живая модель (model.history), с разбивкой по моделям автомобилей.
// Строка KPI в шапке остаётся на текущих сутках — её считает buildModel.
import { useMemo } from 'react';
import { ECON, oeeStats, stopWeight } from './model';
import { addDays, fmtDayLong, isWeekday, localDate, localHour } from './format';

export const PERIODS = [['shift', 'Смена'], ['day', 'Сутки'], ['week', 'Неделя'], ['month', 'Месяц']];

// Марка — первое слово названия модели в справочнике car_models: «Chevrolet Onix» → Chevrolet, «JAC J7» → JAC
export const brandOf = (name) => name.trim().split(/\s+/)[0];
// Марки в порядке справочника (по id модели)
export const brandsOf = (carModels) => [...new Set([...carModels].sort((a, b) => a.id - b.id).map((m) => brandOf(m.name)))];

// Месячный план по моделям из тестовых данных кейса
export const MODEL_MONTH_PLAN = { 'CHEV-ONIX': 2500, 'CHEV-COBALT': 1800, 'JAC-J7': 500 };

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const HOUR = 3600e3;

const ts = (v) => new Date(v).getTime();
const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
const groupBy = (arr, key) => arr.reduce((m, x) => ((m[key(x)] ??= []).push(x), m), {});
const dm = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const p2 = (n) => String(n).padStart(2, '0');
const monday = (day) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const shiftMonth = (day, n) => {
  const [y, m] = day.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${p2((t % 12) + 1)}`;
};
const tone = (good, warn) => (good ? 'g' : warn ? 'y' : 'r');
const doneTone = (actual, plan) => tone(actual >= plan, actual >= plan * 0.9);

// Границы периода: смены, дни, подписи и можно ли листать назад/вперёд (offset 0 — текущий, -1 — предыдущий…)
export function resolvePeriod(model, kind, offset) {
  const { shifts, from } = model.history;
  const desc = [...shifts].sort((a, b) => ts(b.start_at) - ts(a.start_at));
  const i = -offset;
  const base = { kind, offset, canNext: offset < 0 };

  if (kind === 'shift') {
    const s = desc[i];
    if (!s) return null;
    const d = localDate(s.start_at);
    const prev = desc[i + 1];
    return {
      ...base, label: `${s.name} · ${fmtDayLong(d)}`, shifts: [s], fromDay: d, toDay: addDays(d, 1), days: 1, unit: 'hour',
      start: ts(s.start_at), end: ts(s.end_at), canPrev: !!prev && localDate(prev.start_at) >= from,
    };
  }
  if (kind === 'day') {
    const days = [...new Set(desc.map((s) => localDate(s.start_at)))];
    const d = days[i];
    if (!d) return null;
    const ss = shifts.filter((s) => localDate(s.start_at) === d);
    return {
      ...base, label: fmtDayLong(d), shifts: ss, fromDay: d, toDay: addDays(d, 1), days: 1, unit: 'hour',
      start: Math.min(...ss.map((s) => ts(s.start_at))), end: Math.max(...ss.map((s) => ts(s.end_at))),
      canPrev: !!days[i + 1] && days[i + 1] >= from,
    };
  }
  let fromDay, toDay, label;
  if (kind === 'week') {
    fromDay = addDays(monday(model.day), 7 * offset);
    toDay = addDays(fromDay, 7);
    label = `${dm(fromDay)} – ${dm(addDays(toDay, -1))}`;
  } else {
    const m = shiftMonth(model.day, offset);
    fromDay = `${m}-01`;
    toDay = `${shiftMonth(fromDay, 1)}-01`;
    const name = MONTHS[Number(m.slice(5, 7)) - 1];
    label = `${name[0].toUpperCase()}${name.slice(1)} ${m.slice(0, 4)}`;
  }
  const ss = shifts.filter((s) => { const d = localDate(s.start_at); return d >= fromDay && d < toDay; });
  // Назад — только если предыдущий период целиком попал в загруженную историю
  const prevFrom = kind === 'week' ? addDays(fromDay, -7) : `${shiftMonth(fromDay, -1)}-01`;
  return {
    ...base, label, shifts: ss, fromDay, toDay, unit: 'day',
    days: new Set(ss.map((s) => localDate(s.start_at))).size,
    canPrev: prevFrom >= from,
  };
}

// Столбцы графиков: часы смен (смена, сутки) или рабочие дни (неделя, месяц)
function bucketsOf(period) {
  if (period.unit === 'hour') {
    const out = [];
    for (const s of [...period.shifts].sort((a, b) => ts(a.start_at) - ts(b.start_at))) {
      for (let t = ts(s.start_at); t < ts(s.end_at); t += HOUR) out.push({ key: t, label: p2(localHour(t)) });
    }
    return out;
  }
  const withShifts = new Set(period.shifts.map((s) => localDate(s.start_at)));
  const out = [];
  for (let d = period.fromDay; d < period.toDay; d = addDays(d, 1)) {
    if (isWeekday(d) || withShifts.has(d)) out.push({ key: d, label: period.kind === 'month' ? d.slice(8, 10) : dm(d) });
  }
  return out;
}

// Линейные итоги по набору записей: OEE участков, выход линии, качество, ряды по столбцам графика
function lineStats(areas, recs, quals, anchor, bucketKey, buckets) {
  const recByArea = groupBy(recs, (r) => r.production_area_id);
  const qualByArea = groupBy(quals, (q) => q.production_area_id);
  const rows = areas.filter((a) => recByArea[a.id]?.length).map((a) => ({
    id: a.id, name: a.name, ...oeeStats(recByArea[a.id], qualByArea[a.id] ?? [], anchor),
  }));
  const counted = rows.filter((r) => r.availMin >= 5);
  const final = rows[rows.length - 1] ?? null;
  const finalRecs = final ? recByArea[final.id] : [];
  const byBucket = groupBy(finalRecs, bucketKey);
  return {
    rows, final,
    oee: counted.length ? sum(counted, (r) => r.oee) / counted.length : null,
    output: final?.actual ?? 0,
    planToDate: final?.plan ?? 0,
    defects: sum(rows, (r) => r.scrap + r.rework),
    worst: [...counted].sort((a, b) => b.defect - a.defect)[0] ?? null,
    series: buckets.map((b) => {
      const rs = byBucket[b.key];
      return { ...b, actual: rs ? sum(rs, (r) => r.actual_quantity) : null, plan: rs ? sum(rs, (r) => r.planned_quantity) : null };
    }),
  };
}

export function summarize(model, period) {
  const { recs, qual, dt, plans, decisions, carModels } = model.history;
  const anchor = model.anchor;
  const areas = model.areas;
  const ids = new Set(period.shifts.map((s) => s.id));
  const pr = recs.filter((r) => ids.has(r.shift_id));
  const pq = qual.filter((q) => ids.has(q.shift_id));
  const inPeriod = period.unit === 'hour'
    ? (t) => t >= period.start && t < period.end
    : (t) => { const d = localDate(t); return d >= period.fromDay && d < period.toDay; };
  const pdt = dt.filter((e) => inPeriod(ts(e.started_at)));
  const buckets = bucketsOf(period);
  const bucketKey = period.unit === 'hour' ? (r) => ts(r.timestamp) : (r) => r.day;
  const isCurrent = period.offset === 0;

  const line = lineStats(areas, pr, pq, anchor, bucketKey, buckets);
  const planTotal = sum(plans.filter((p) => ids.has(p.shift_id)), (p) => p.planned_quantity);

  // ── Потери в тенге: внеплановые остановки с весом узла + брак и доработка (как в buildModel)
  const lossKzt = (e) => e.minutes * stopWeight(e) * ECON.downtimeMinKzt;
  const stops = pdt.filter((e) => e.unplanned && stopWeight(e) > 0);
  const finAreas = areas.map((a) => {
    const evs = stops.filter((e) => e.areaId === a.id);
    const row = line.rows.find((r) => r.id === a.id);
    const defects = row ? row.scrap + row.rework : 0;
    const downtimeKzt = sum(evs, lossKzt);
    const defectKzt = defects * ECON.defectKzt;
    return { id: a.id, name: a.name, downtimeMin: sum(evs, (e) => e.minutes), downtimeKzt, defects, defectKzt, total: downtimeKzt + defectKzt };
  });
  const applied = decisions.filter((d) => d.status === 'applied' && d.chosen && d.chosen !== 'none' && d.decided_at && inPeriod(ts(d.decided_at)));
  const finance = {
    areas: finAreas,
    downtime: sum(finAreas, (a) => a.downtimeKzt),
    defect: sum(finAreas, (a) => a.defectKzt),
    total: sum(finAreas, (a) => a.total),
    stopMin: sum(stops, (e) => e.minutes),
    defects: sum(finAreas, (a) => a.defects),
    aiEffect: sum(applied, (d) => (d.payload?.options?.find((o) => o.key === d.chosen)?.values?.effect ?? 0) * 1000),
    applied: applied.length,
  };

  // ── Остановки по модели: в каждый час линия выпускает одну модель, простой относим к ней
  const hourModel = new Map(pr.map((r) => [ts(r.timestamp), r.car_model_id]));
  const modelOf = (e) => hourModel.get(Math.floor(ts(e.started_at) / HOUR) * HOUR) ?? null;

  // ── Прогноз месяца по моделям: только для текущего месяца
  let remainingDays = 0;
  if (period.kind === 'month' && isCurrent) {
    for (let d = addDays(model.day, 1); d < period.toDay; d = addDays(d, 1)) if (isWeekday(d)) remainingDays++;
  }
  const workedDays = new Set(pr.map((r) => r.day)).size || 1;

  const planByModel = groupBy(plans.filter((p) => ids.has(p.shift_id)), (p) => p.car_model_id);
  const recByModel = groupBy(pr, (r) => r.car_model_id);
  const qualByModel = groupBy(pq, (q) => q.car_model_id);
  const models = carModels
    .filter((m) => recByModel[m.id] || planByModel[m.id] || (period.kind === 'month' && MODEL_MONTH_PLAN[m.code]))
    .map((m) => {
      const s = lineStats(areas, recByModel[m.id] ?? [], qualByModel[m.id] ?? [], anchor, bucketKey, buckets);
      const evs = stops.filter((e) => modelOf(e) === m.id);
      const mPlan = sum(planByModel[m.id] ?? [], (p) => p.planned_quantity);
      const target = period.kind === 'month' ? MODEL_MONTH_PLAN[m.code] ?? null : null;
      const forecast = target != null && isCurrent ? Math.round(s.output + (s.output / workedDays) * remainingDays) : null;
      return {
        id: m.id, code: m.code, name: m.name, brand: brandOf(m.name),
        output: s.output, planToDate: s.planToDate, planTotal: mPlan,
        st: s.planToDate ? doneTone(s.output, s.planToDate) : 'g',
        share: line.output ? s.output / line.output : 0,
        oee: s.oee, worst: s.worst, defects: s.defects, defectKzt: s.defects * ECON.defectKzt,
        defectByArea: Object.fromEntries(s.rows.filter((r) => r.total).map((r) => [r.id, r.defect])),
        stopMin: sum(evs, (e) => e.minutes), stopKzt: sum(evs, lossKzt),
        marginKzt: s.output * ECON.carMarginKzt,
        target, forecast, series: s.series,
      };
    })
    .sort((a, b) => b.planTotal - a.planTotal || b.output - a.output);

  return { period, isCurrent, line, planTotal, models, finance, lineAreas: line.rows, remainingDays, downtime: pdt, inPeriod };
}

// Итоги за период. Если листание ушло за пределы истории (например, сменили вид периода) — показываем текущий.
export function usePeriodSummary(model, value) {
  return useMemo(() => {
    const p = resolvePeriod(model, value.kind, value.offset) ?? resolvePeriod(model, value.kind, 0);
    return p ? summarize(model, p) : null;
  }, [model, value.kind, value.offset]);
}
