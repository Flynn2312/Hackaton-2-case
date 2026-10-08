// Модель цифрового двойника: загружает сырые данные с бэкенда и считает
// состояние участков, KPI линии, буферы, алерты и экономику.
// Порядок участков в потоке берётся из production_areas.sequence — ничего не захардкожено.
import { api } from './api';
import {
  S, worst, localDate, localHour, fmtTime, fmtDateTime, dayStartIso, addDays, isWeekday,
  eqShort, fmt1, fmtInt, pct, fmtHours,
} from './format';

// Нормативы из кейса («Дополнительные вводные»)
export const NORMS = {
  oee: 85,             // %, целевой OEE
  defect: 2.0,         // %, допустимый брак
  critDowntime: 60,    // мин/сутки простоя критичного оборудования
  shiftMinutes: 480,   // 8-часовая смена
  bufferBase: 10,      // нормативный межоперационный задел, кузовов
  bufferMin: 8,
};

// Допущения для экономики (совпадают с backend/app/services/case_data.py ASSUMPTIONS)
export const ECON = {
  downtimeMinKzt: 85_000,   // стоимость минуты простоя линии
  defectKzt: 120_000,       // исправление одного дефектного кузова
  carMarginKzt: 350_000,    // маржинальный доход с автомобиля (допущение команды)
  workDaysYear: 250,
  downtimeCut: 0.30,        // доля внеплановых простоев, устраняемых предиктивным ТО
  defectCut: 0.50,          // доля брака, устраняемая контролем параметров
  shortfallCut: 0.25,       // доля недовыпуска, возвращаемая балансировкой потока
};

const HISTORY_DAYS = 28;
const SEVERITY_ST = { critical: 'r', high: 'r', medium: 'y', low: 'g' };
const OPEN = new Set(['open', 'in_progress']);
export const INCIDENT_STATE = { open: 'Открыт', in_progress: 'В работе', resolved: 'Закрыт', closed: 'Закрыт' };
const EQ_STATE = { running: 'в работе', idle: 'простаивает', maintenance: 'на ТО', breakdown: 'авария' };
const EQ_ST = { running: 'g', idle: 'y', maintenance: 'y', breakdown: 'r' };

// Сырые данные с бэкенда. Живой поток (lib/live.js) дописывает в них изменения из WebSocket
// и пересобирает модель через buildModel — без повторной загрузки.
export async function loadRaw() {
  const factories = await api.factories();
  if (!factories.length) throw new Error('В базе нет заводов');
  const factory = factories[0];

  const [areas, equipment, shifts, plans, sim] = await Promise.all([
    api.areas(factory.id), api.equipment(), api.shifts(factory.id), api.plans(factory.id),
    api.simStatus().catch(() => null),
  ]);
  if (!shifts.length) throw new Error('В базе нет смен');
  if (!areas.length) throw new Error('В базе нет производственных участков');

  const lastShift = latestShift(shifts);
  const day = localDate(lastShift.start_at);
  const from = dayStartIso(addDays(day, -HISTORY_DAYS));
  const to = dayStartIso(addDays(day, 1));
  const live = !!sim?.sim_now;

  const [records, quality, downtime, activeDowntime, incidents, oee] = await Promise.all([
    api.productionRecords(from),
    api.qualityRecords(from),
    api.downtime(from),
    api.activeDowntime(),
    api.incidents(from),
    // В живом режиме OEE считаем на клиенте: серверный снимок устаревает с каждой минутой симуляции
    live ? null : api.oee(factory.id, dayStartIso(day), to).catch(() => null),
  ]);
  // Идущие простои могли начаться раньше окна истории
  const seen = new Set(downtime.map((d) => d.id));
  for (const d of activeDowntime) if (!seen.has(d.id)) downtime.push(d);

  return { factory, areas, equipment, shifts, plans, downtime, incidents, records, quality, oee, sim };
}

export async function loadTwin() {
  return buildModel(await loadRaw());
}

const ts = (v) => new Date(v).getTime();
const latestShift = (shifts) => shifts.reduce((a, b) => (ts(a.start_at) > ts(b.start_at) ? a : b));
const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
const groupBy = (arr, key) => arr.reduce((m, x) => ((m[key(x)] ??= []).push(x), m), {});
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Параметр процесса для боковой панели: шкала min..max, зелёная зона нормы lo..hi
function param(name, value, display, { min, max, lo, hi, norm, st }) {
  const toPct = (v) => clamp(((v - min) / (max - min)) * 100, 0, 100);
  return { name, value, display, norm, st, pos: toPct(value), normFrom: toPct(lo), normWidth: toPct(hi) - toPct(lo) };
}

// simNow — текущее время завода (мс) от живого потока; без него — из статуса симулятора или конец последней смены
export function buildModel(raw, simNow = null) {
  const { factory, areas: areasRaw, equipment, shifts, plans, downtime, incidents, records, quality, oee, sim } = raw;
  const lastShift = latestShift(shifts);
  const day = localDate(lastShift.start_at);
  const anchor = simNow ?? (sim?.sim_now ? new Date(sim.sim_now).getTime() : new Date(lastShift.end_at).getTime());
  const areasSorted = [...areasRaw].sort((a, b) => a.sequence - b.sequence);
  const shiftById = Object.fromEntries(shifts.map((s) => [s.id, s]));
  const dayShifts = shifts.filter((s) => localDate(s.start_at) === day).sort((a, b) => ts(a.start_at) - ts(b.start_at));
  const dayShiftIds = new Set(dayShifts.map((s) => s.id));
  const eqById = Object.fromEntries(equipment.map((e) => [e.id, e]));
  const eqByArea = groupBy(equipment, (e) => e.production_area_id);
  const areaById = Object.fromEntries(areasRaw.map((a) => [a.id, a]));

  // ── События простоя: участок, длительность (активные — до «сейчас»), плановость
  const dt = downtime.map((e) => {
    const eq = eqById[e.equipment_id];
    const active = !e.ended_at;
    const minutes = e.duration_minutes ?? Math.max(0, Math.round((anchor - new Date(e.started_at).getTime()) / 60000));
    return {
      ...e, eq, areaId: eq?.production_area_id, minutes, active, day: localDate(e.started_at),
      unplanned: !['planned_maintenance', 'changeover'].includes(e.type),
    };
  });
  const dtDay = dt.filter((e) => e.day === day);

  // ── Записи выработки/качества с локальной датой
  const recs = records.map((r) => ({ ...r, day: localDate(r.timestamp) }));
  const qual = quality.map((q) => ({ ...q, day: localDate(q.timestamp) }));
  const recDays = [...new Set(recs.map((r) => r.day))].sort();
  const recsByArea = groupBy(recs, (r) => r.production_area_id);
  const qualByArea = groupBy(qual, (q) => q.production_area_id);

  // ── Инциденты
  const incs = [...incidents].sort((a, b) => ts(b.created_at) - ts(a.created_at)).map((i) => {
    const st = SEVERITY_ST[i.severity] ?? 'y';
    const match = i.equipment_id && dt.find((e) => e.equipment_id === i.equipment_id
      && Math.abs(new Date(e.started_at) - new Date(i.created_at)) < 3 * 3600e3);
    return {
      ...i, st, area: areaById[i.production_area_id], open: OPEN.has(i.status),
      state: INCIDENT_STATE[i.status] ?? i.status, downtime: match ? match.minutes : null,
      equipment: i.equipment_id ? eqById[i.equipment_id] : null,
    };
  });

  // ── Участки
  const areas = areasSorted.map((a, idx) => {
    const eqs = eqByArea[a.id] ?? [];
    const dayRecs = (recsByArea[a.id] ?? []).filter((r) => dayShiftIds.has(r.shift_id));
    const dayQual = (qualByArea[a.id] ?? []).filter((q) => dayShiftIds.has(q.shift_id));

    const plan = sum(dayRecs, (r) => r.planned_quantity);
    const actual = sum(dayRecs, (r) => r.actual_quantity);
    const runtime = sum(dayRecs, (r) => r.runtime_minutes);
    // Доступное время: полный час для прошедших часов, для идущего — сколько минут уже прошло
    const hourStarts = [...new Set(dayRecs.map((r) => new Date(r.timestamp).getTime()))];
    const availMin = sum(hourStarts, (t) => clamp((anchor - t) / 60000, 0, 60));
    const hasRec = dayRecs.length > 0 && availMin >= 5; // первые минуты смены ещё не показательны
    const total = sum(dayQual, (q) => q.total_quantity);
    const good = sum(dayQual, (q) => q.good_quantity);
    const scrap = sum(dayQual, (q) => q.scrap_quantity);
    const rework = sum(dayQual, (q) => q.rework_quantity);

    const A = availMin ? runtime / availMin : 0;
    const P = plan && A ? Math.min(1, actual / (plan * A)) : 0;
    const Q = total ? good / total : 1;
    const oeeA = A * P * Q * 100;
    const defect = total ? (scrap / total) * 100 : 0;
    const load = dayRecs.length ? sum(dayRecs, (r) => Number(r.load_percent)) / dayRecs.length : 0;
    const ct = actual ? (runtime * 60) / actual : null;

    const areaDt = dtDay.filter((e) => e.areaId === a.id);
    const downtimeMin = sum(areaDt, (e) => e.minutes);
    const critDowntimeMin = sum(areaDt.filter((e) => e.eq?.criticality === 'high'), (e) => e.minutes);
    const activeDt = dt.filter((e) => e.areaId === a.id && e.active);
    const openIncs = incs.filter((i) => i.production_area_id === a.id && i.open);
    const running = eqs.filter((e) => e.status === 'running').length;

    // Статус участка — худшее из отклонений
    const reasons = [];
    const flag = (st, why) => { reasons.push({ st, why }); };
    if (hasRec) {
      if (oeeA < NORMS.oee - 10) flag('r', `OEE ${pct(oeeA)}`); else if (oeeA < NORMS.oee) flag('y', `OEE ${pct(oeeA)}`);
      if (defect > NORMS.defect * 2) flag('r', `брак ${pct(defect)}`); else if (defect > NORMS.defect) flag('y', `брак ${pct(defect)}`);
    }
    for (const e of eqs) {
      if (e.status === 'breakdown') flag(e.criticality === 'high' ? 'r' : 'y', `${eqShort(e.name)} — авария`);
      else if (e.status === 'maintenance' && e.criticality === 'high') flag('y', `${eqShort(e.name)} на ТО`);
    }
    for (const i of openIncs) flag(i.severity === 'critical' ? 'r' : i.severity === 'low' ? 'g' : 'y', i.title);
    if (critDowntimeMin > NORMS.critDowntime) flag('y', `простой критичного оборуд. ${critDowntimeMin} мин`);
    const st = worst(...reasons.map((r) => r.st));

    // Ключевой показатель
    let main;
    if (hasRec && defect > NORMS.defect) main = { label: 'Брак', value: pct(defect), norm: `норма ≤ ${fmt1(NORMS.defect)}%`, st: defect > NORMS.defect * 2 ? 'r' : 'y' };
    else if (hasRec) main = { label: 'OEE', value: pct(oeeA), norm: `норма ≥ ${NORMS.oee}%`, st: oeeA >= NORMS.oee ? 'g' : oeeA >= NORMS.oee - 10 ? 'y' : 'r' };
    else main = { label: 'Оборудование в работе', value: `${running} / ${eqs.length}`, norm: 'все единицы в работе', st: running === eqs.length ? 'g' : eqs.some((e) => e.status === 'breakdown') ? 'y' : 'g' };

    // Строка события
    let alert = { text: 'Отклонений нет', st: 'n' };
    const topInc = [...openIncs].sort((x, y) => '  lowmediumhighcritical'.indexOf(y.severity) - '  lowmediumhighcritical'.indexOf(x.severity))[0];
    if (activeDt.length) {
      const e = activeDt[0];
      alert = { text: `${eqShort(e.eq.name)}: ${e.reason.toLowerCase()} — стоит с ${fmtTime(e.started_at)}`, st: e.eq.criticality === 'high' ? 'r' : 'y' };
    } else if (topInc) alert = { text: topInc.title, st: topInc.st === 'g' ? 'n' : topInc.st };
    else if (areaDt.length) {
      const e = [...areaDt].sort((x, y) => y.minutes - x.minutes)[0];
      alert = { text: `${eqShort(e.eq.name)}: ${e.reason.toLowerCase()}, ${e.minutes} мин`, st: 'n' };
    }

    // Тренд для панели: брак по дням / выпуск по часам / простой по дням
    let trend;
    if (main.label === 'Брак') {
      const byDay = groupBy(qualByArea[a.id] ?? [], (q) => q.day);
      trend = { label: 'Брак, % по дням', unit: '%', points: Object.keys(byDay).sort().slice(-12).map((d) => {
        const t = sum(byDay[d], (q) => q.total_quantity);
        return { t: d.slice(8, 10) + '.' + d.slice(5, 7), v: t ? (sum(byDay[d], (q) => q.scrap_quantity) / t) * 100 : 0 };
      }) };
    } else if (hasRec) {
      const byTs = groupBy(recsByArea[a.id] ?? [], (r) => r.timestamp);
      trend = { label: 'Выпуск по часам, ед.', unit: '', points: Object.keys(byTs).sort().slice(-12).map((ts) => ({ t: `${fmtTime(ts)}`, v: sum(byTs[ts], (r) => r.actual_quantity) })) };
    } else {
      const days = recDays.slice(-12);
      trend = { label: 'Простой, мин по дням', unit: ' мин', points: days.map((d) => ({ t: d.slice(8, 10) + '.' + d.slice(5, 7), v: sum(dt.filter((e) => e.areaId === a.id && e.day === d), (e) => e.minutes) })) };
    }

    // Параметры процесса
    const params = [];
    if (hasRec) {
      params.push(
        param('OEE', oeeA, pct(oeeA), { min: 50, max: 100, lo: NORMS.oee, hi: 100, norm: `≥ ${NORMS.oee}%`, st: main.label === 'OEE' ? main.st : oeeA >= NORMS.oee ? 'g' : 'y' }),
        param('Доступность', A * 100, pct(A * 100), { min: 50, max: 100, lo: 90, hi: 100, norm: '≥ 90%', st: A >= 0.9 ? 'g' : 'y' }),
        param('Производительность', P * 100, pct(P * 100), { min: 50, max: 100, lo: 95, hi: 100, norm: '≥ 95%', st: P >= 0.95 ? 'g' : 'y' }),
        param('Брак', defect, pct(defect), { min: 0, max: 8, lo: 0, hi: NORMS.defect, norm: `≤ ${fmt1(NORMS.defect)}%`, st: defect <= NORMS.defect ? 'g' : defect <= NORMS.defect * 2 ? 'y' : 'r' }),
        param('Доработка', total ? (rework / total) * 100 : 0, `${rework} ед.`, { min: 0, max: 8, lo: 0, hi: 3, norm: '≤ 3% выпуска', st: total && rework / total > 0.03 ? 'y' : 'g' }),
        param('Средняя загрузка', load, pct(load), { min: 50, max: 100, lo: 85, hi: 100, norm: '≥ 85%', st: load >= 85 ? 'g' : 'y' }),
      );
    }
    params.push(
      param('Простой за сутки', downtimeMin, `${downtimeMin} мин`, { min: 0, max: 150, lo: 0, hi: NORMS.critDowntime, norm: `≤ ${NORMS.critDowntime} мин`, st: downtimeMin <= NORMS.critDowntime ? 'g' : 'y' }),
      param('Оборудование в работе', running, `${running} / ${eqs.length}`, { min: 0, max: eqs.length || 1, lo: eqs.length - 0.0001, hi: eqs.length || 1, norm: `${eqs.length} / ${eqs.length}`, st: running === eqs.length ? 'g' : eqs.some((e) => e.status === 'breakdown') ? 'r' : 'y' }),
    );

    return {
      id: a.id, code: a.code, name: a.name, sequence: a.sequence, step: `${idx + 1}/${areasSorted.length}`,
      st, reasons, hasRec, plan, actual, runtime, oee: oeeA, A, P, Q, defect, scrap, rework, total, load, ct,
      downtimeMin, critDowntimeMin, main, alert, trend, params, openIncs, activeDt,
      sub: `${eqs.length} ед. оборудования${hasRec ? ` · загрузка ${Math.round(load)}%` : ''}`,
      units: eqs.map((e) => ({ id: e.id, name: e.name, code: e.code, status: e.status, criticality: e.criticality, st: EQ_ST[e.status] ?? 'g', label: EQ_STATE[e.status] ?? e.status })),
      equipment: eqs.map((e) => ({ ...e, dayDowntime: sum(areaDt.filter((d) => d.equipment_id === e.id), (d) => d.minutes) })),
    };
  });

  // ── Буферы между соседними участками (расчётный НЗП: задел + выход(i) − выход(i+1) за сутки)
  areas.forEach((a, i) => {
    const next = areas[i + 1];
    a.hasNext = !!next;
    if (next && a.hasRec && next.hasRec) {
      const v = Math.max(0, NORMS.bufferBase + a.actual - next.actual);
      a.buffer = { value: v, st: v < NORMS.bufferMin / 2 ? 'r' : v < NORMS.bufferMin ? 'y' : 'g', note: `ед. · мин ${NORMS.bufferMin}` };
    } else a.buffer = null;
  });

  // ── Выход линии: последний по потоку участок с учётом выработки
  const finalArea = [...areas].reverse().find((a) => a.hasRec) ?? areas[areas.length - 1];
  const dayPlan = sum(plans.filter((p) => dayShiftIds.has(p.shift_id)), (p) => p.planned_quantity) || finalArea.plan;
  const finalRecs = recsByArea[finalArea.id] ?? [];

  // Почасовой выпуск за сутки (часы — по сменам дня)
  const hourMap = groupBy(finalRecs.filter((r) => dayShiftIds.has(r.shift_id)), (r) => localHour(r.timestamp));
  const hours = [];
  for (const s of dayShifts) {
    for (let t = new Date(s.start_at).getTime(); t < new Date(s.end_at).getTime(); t += 3600e3) {
      const h = localHour(t);
      const rs = hourMap[h];
      hours.push({ h, label: String(h).padStart(2, '0'), actual: rs ? sum(rs, (r) => r.actual_quantity) : null, plan: rs ? sum(rs, (r) => r.planned_quantity) : null });
    }
  }
  const hourPlan = Math.round(dayPlan / Math.max(1, hours.length)) || 15;

  // Выпуск по дням и прогноз месяца
  const outByDay = Object.fromEntries(Object.entries(groupBy(finalRecs, (r) => r.day)).map(([d, rs]) => [d, sum(rs, (r) => r.actual_quantity)]));
  const planByDay = {};
  for (const p of plans) {
    const s = shiftById[p.shift_id];
    if (s) planByDay[localDate(s.start_at)] = (planByDay[localDate(s.start_at)] ?? 0) + p.planned_quantity;
  }
  const month = day.slice(0, 7);
  const monthEnd = addDays(`${month}-01`, 40).slice(0, 7) + '-01';
  let remainingDays = 0;
  for (let d = addDays(day, 1); d < monthEnd; d = addDays(d, 1)) if (isWeekday(d)) remainingDays++;
  const mtdDays = recDays.filter((d) => d.startsWith(month));
  const mtd = sum(mtdDays, (d) => outByDay[d] ?? 0);
  const last10 = recDays.slice(-10);
  const avgDaily = last10.length ? sum(last10, (d) => outByDay[d] ?? 0) / last10.length : 0;
  const plannedDays = Object.keys(planByDay).sort().slice(-10);
  const avgDailyPlan = plannedDays.length ? sum(plannedDays, (d) => planByDay[d]) / plannedDays.length : dayPlan;
  const monthPlan = Math.round(avgDailyPlan * (mtdDays.length + remainingDays));
  const monthForecast = Math.round(mtd + avgDaily * remainingDays);

  // ── KPI линии
  const lineAreas = areas.filter((a) => a.hasRec);
  const lineOee = oee?.oee_percent ?? (lineAreas.length ? sum(lineAreas, (a) => a.oee) / lineAreas.length : 0);
  const critDowntime = sum(dtDay.filter((e) => e.eq?.criticality === 'high'), (e) => e.minutes);
  const totalDowntime = sum(dtDay, (e) => e.minutes);
  const worstDefect = [...lineAreas].sort((a, b) => b.defect - a.defect)[0];
  const bottleneck = [...lineAreas].sort((a, b) => a.oee - b.oee)[0];
  const tone = (good, warn) => (good ? 'g' : warn ? 'y' : 'r');

  const kpis = [
    { l: 'OEE линии', v: pct(lineOee), n: `цель ≥ ${NORMS.oee}%`, st: tone(lineOee >= NORMS.oee, lineOee >= NORMS.oee - 10) },
    { l: 'Выпуск за сутки', v: fmtInt(finalArea.actual), n: `план ${fmtInt(dayPlan)}`, st: tone(finalArea.actual >= dayPlan, finalArea.actual >= dayPlan * 0.9) },
    { l: 'Простой крит. оборуд.', v: `${critDowntime} мин`, n: `≤ ${NORMS.critDowntime} мин · всего ${totalDowntime}`, st: tone(critDowntime <= NORMS.critDowntime * 0.75, critDowntime <= NORMS.critDowntime * 1.25) },
    worstDefect && { l: `Брак · ${worstDefect.name}`, v: pct(worstDefect.defect), n: `≤ ${fmt1(NORMS.defect)}%`, st: tone(worstDefect.defect <= NORMS.defect, worstDefect.defect <= NORMS.defect * 2) },
    { l: 'Прогноз месяца', v: fmtInt(monthForecast), n: `из ${fmtInt(monthPlan)}`, st: tone(monthForecast >= monthPlan, monthForecast >= monthPlan * 0.9) },
  ].filter(Boolean);

  // ── Тренды оборудования (28 дней): рост внеплановых простоев
  const d14 = addDays(day, -13);
  const d28 = addDays(day, -27);
  const eqTrends = equipment.map((e) => {
    const evs = dt.filter((x) => x.equipment_id === e.id && x.unplanned && x.day >= d28);
    const last = evs.filter((x) => x.day >= d14);
    const prev = evs.filter((x) => x.day < d14);
    const lastMin = sum(last, (x) => x.minutes);
    const prevMin = sum(prev, (x) => x.minutes);
    const times = evs.map((x) => new Date(x.started_at).getTime()).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const mtbfH = gaps.length ? sum(gaps) / gaps.length / 3600e3 : null;
    const reasons = Object.entries(groupBy(last, (x) => x.reason)).sort((a, b) => b[1].length - a[1].length);
    return {
      eq: e, area: areaById[e.production_area_id], lastMin, prevMin, lastCount: last.length, prevCount: prev.length,
      growth: prevMin ? lastMin / prevMin : lastMin ? 3 : 0, mtbfH, lastAt: times[times.length - 1], topReason: reasons[0]?.[0],
      avgPerDay: lastMin / Math.max(1, recDays.filter((d) => d >= d14).length),
    };
  });
  const risingEq = eqTrends.filter((t) => t.lastMin >= 40 && t.growth >= 1.3).sort((a, b) => b.lastMin * b.growth - a.lastMin * a.growth);
  const topDowntimeEq = [...eqTrends].sort((a, b) => b.lastMin - a.lastMin)[0];

  // ── Предиктивные алерты (статистика по данным БД)
  const alerts = [];
  for (const e of dt.filter((x) => x.active)) {
    alerts.push({
      areaId: e.areaId, st: e.eq.criticality === 'high' ? 'r' : 'y',
      title: `${areaById[e.areaId]?.name} · ${eqShort(e.eq.name)} стоит`,
      text: `${e.reason}. Простой ${e.minutes} мин с ${fmtTime(e.started_at)}, критичность — ${e.eq.criticality}.`,
      action: 'назначить ремонтную бригаду, перевести поток на резерв', eta: 'сейчас', conf: 'факт, телеметрия',
    });
  }
  for (const t of risingEq.slice(0, 2)) {
    const etaH = t.mtbfH && t.lastAt ? Math.max(2, (t.lastAt + t.mtbfH * 3600e3 - anchor) / 3600e3) : null;
    alerts.push({
      areaId: t.eq.production_area_id, st: t.eq.criticality === 'high' && t.growth >= 2 ? 'r' : 'y',
      title: `${t.area?.name} · рост простоев ${eqShort(t.eq.name)}`,
      text: `${t.lastMin} мин за 14 дн. против ${t.prevMin} мин ранее (${t.lastCount} остановок). Частая причина — «${t.topReason}».`,
      action: `плановое ТО ${eqShort(t.eq.name)} в пересменку`,
      eta: etaH ? fmtHours(etaH) : '—', conf: `вероятность ${Math.round(clamp(55 + (t.growth - 1) * 30, 55, 95))}%`,
    });
  }
  for (const a of lineAreas) {
    const byDay = groupBy(qualByArea[a.id] ?? [], (q) => q.day);
    const days = Object.keys(byDay).sort();
    const rate = (ds) => { const qs = ds.flatMap((d) => byDay[d]); const t = sum(qs, (q) => q.total_quantity); return t ? (sum(qs, (q) => q.scrap_quantity) / t) * 100 : 0; };
    const recent = rate(days.slice(-3));
    const before = rate(days.slice(-17, -3));
    if (recent > NORMS.defect) {
      alerts.push({
        areaId: a.id, st: recent > NORMS.defect * 2 ? 'r' : 'y',
        title: `${a.name} · брак ${pct(recent)} за 3 дня`,
        text: `Норма ≤ ${fmt1(NORMS.defect)}%, двумя неделями ранее — ${pct(before)}. ${a.rework} ед. на доработке за сутки.`,
        action: 'проверить параметры процесса и оснастку участка', eta: recent > before ? 'растёт' : 'сейчас',
        conf: `${days.slice(-3).length} дн. данных`,
      });
    }
  }
  if (bottleneck && bottleneck.oee < NORMS.oee) {
    alerts.push({
      areaId: bottleneck.id, st: 'y', title: `${bottleneck.name} · узкое место линии`,
      text: `Минимальный OEE на линии — ${pct(bottleneck.oee)} (доступность ${pct(bottleneck.A * 100)}, производительность ${pct(bottleneck.P * 100)}).`,
      action: 'перебалансировать такт, сократить переналадки', eta: 'смена', conf: 'расчёт OEE',
    });
  }
  alerts.sort((a, b) => (a.st === b.st ? 0 : a.st === 'r' ? -1 : b.st === 'r' ? 1 : 0));

  // ── Экономика (годовой эффект из данных окна HISTORY_DAYS)
  const winDays = Math.max(1, recDays.length);
  const unplannedMin = sum(dt.filter((e) => e.unplanned && e.day >= recDays[0]), (e) => e.minutes);
  const defects = sum(qual, (q) => q.scrap_quantity + q.rework_quantity);
  const shortfall = Math.max(0, sum(recDays, (d) => (planByDay[d] ?? 0) - (outByDay[d] ?? 0)));
  const perYear = ECON.workDaysYear / winDays;
  const economy = {
    windowDays: winDays,
    rows: [
      { key: 'downtime', l: 'Сокращение внеплановых простоев', phys: `${fmtInt((unplannedMin * perYear) / 60)} ч/год · −${ECON.downtimeCut * 100}%`, v: (unplannedMin * perYear * ECON.downtimeCut * ECON.downtimeMinKzt) / 1e6 },
      { key: 'defects', l: 'Снижение брака и доработок', phys: `${fmtInt(defects * perYear)} ед./год · −${ECON.defectCut * 100}%`, v: (defects * perYear * ECON.defectCut * ECON.defectKzt) / 1e6 },
      { key: 'shortfall', l: 'Возврат недовыпуска', phys: `${fmtInt(shortfall * perYear)} авто/год · ${ECON.shortfallCut * 100}% возврат`, v: (shortfall * perYear * ECON.shortfallCut * ECON.carMarginKzt) / 1e6 },
    ],
  };
  economy.total = sum(economy.rows, (r) => r.v);

  // ── База для What-If
  const wdtArea = worstDefect;
  const whatIfBase = {
    output: finalArea.actual, plan: dayPlan, critDowntime, monthForecast, monthPlan, remainingDays,
    defectArea: wdtArea && { id: wdtArea.id, name: wdtArea.name, defect: wdtArea.defect, scrap: wdtArea.scrap, rework: wdtArea.rework },
    maintEq: (risingEq[0] ?? topDowntimeEq) && (() => { const t = risingEq[0] ?? topDowntimeEq; return { id: t.eq.id, areaId: t.eq.production_area_id, name: eqShort(t.eq.name), fullName: t.eq.name, avgPerDay: t.avgPerDay, critical: t.eq.criticality === 'high', reason: t.topReason }; })(),
    bottleneck: bottleneck && { id: bottleneck.id, name: bottleneck.name, oee: bottleneck.oee },
    starvation: (() => {
      // Простои выше узкого места по потоку «голодят» его
      if (!bottleneck) return 0;
      const upIds = new Set(areas.filter((a) => a.sequence < bottleneck.sequence).map((a) => a.id));
      return Math.round(sum(dtDay.filter((e) => upIds.has(e.areaId) && e.unplanned), (e) => e.minutes) * 0.5);
    })(),
    taktMin: NORMS.shiftMinutes / Math.max(1, dayPlan / Math.max(1, dayShifts.length)),
  };

  // ── Наряд-заказы: открытые инциденты по оборудованию
  const orders = incs.filter((i) => i.open && i.equipment).slice(0, 4).map((i) => ({
    id: `НЗ-${i.id} · ${i.area?.name ?? ''}`, st: i.state, t: i.title, ink: S[i.status === 'open' ? 'r' : 'y'].ink,
  }));

  const notG = areas.filter((a) => a.st !== 'g');
  return {
    factory, day, anchor, lastShift, dayShifts, areas, finalArea, hours, hourPlan, dayPlan,
    kpis, alerts: alerts.slice(0, 4), incidents: incs, orders, economy, whatIfBase, eqTrends, risingEq,
    lineOee, critDowntime, totalDowntime, worstDefect, bottleneck, monthForecast, monthPlan, avgDaily,
    flowBadge: { n: notG.length, st: worst(...notG.map((a) => a.st)) },
    incBadge: { n: incs.filter((i) => i.open).length, st: incs.some((i) => i.open && i.st === 'r') ? 'r' : 'y' },
    stats: { areas: areas.length, equipment: equipment.length, downtime: downtime.length, incidents: incidents.length, records: records.length },
    updatedAt: Date.now(), lastShiftLabel: `${lastShift.name} · ${fmtDateTime(lastShift.start_at)}`,
  };
}
