// Отчёт о производстве за период «Сводки»: данные для печатной формы (PDF) и выгрузка CSV для Excel.
// Линия, потери и инциденты — по всей линии; разделы по моделям — только по выбранным маркам.
import { ECON, NORMS, stopWeight } from './model';
import { PERIODS } from './period';
import { fmt1, fmtDateTime, fmtInt, fmtKzt, pct, worst } from './format';

const tone = (good, warn) => (good ? 'g' : warn ? 'y' : 'r');
const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
const groupBy = (arr, key) => arr.reduce((m, x) => ((m[key(x)] ??= []).push(x), m), {});
const ts = (v) => new Date(v).getTime();

const KIND = Object.fromEntries(PERIODS);
export const INCIDENT_TYPE = {
  equipment_failure: 'Отказ оборудования', quality_deviation: 'Отклонение качества', plan_deviation: 'Отставание от плана',
  material_shortage: 'Нехватка комплектующих', downtime_limit: 'Превышение лимита простоя', safety: 'Техника безопасности',
};

export function buildReport(model, s, brands) {
  const p = s.period;
  const lossKzt = (e) => e.minutes * stopWeight(e) * ECON.downtimeMinKzt;

  // ── Итоги линии
  const crit = sum(s.downtime.filter((e) => e.eq?.criticality === 'high'), (e) => e.minutes);
  const critPerDay = crit / Math.max(1, p.days);
  const multi = p.days > 1;
  const dtTone = multi
    ? tone(critPerDay <= NORMS.critDowntime * 0.75, critPerDay <= NORMS.critDowntime * 1.25)
    : tone(crit <= NORMS.critDowntime * 0.75, crit <= NORMS.critDowntime * 1.25);
  const w = s.line.worst;
  const defTone = w ? tone(w.defect <= NORMS.defect, w.defect <= NORMS.defect * 2) : 'g';
  const plan = s.isCurrent ? s.line.planToDate : s.planTotal || s.line.planToDate;
  const kpis = [
    s.line.oee != null && { l: 'OEE линии', v: pct(s.line.oee), n: `цель ≥ ${NORMS.oee}%`, st: tone(s.line.oee >= NORMS.oee, s.line.oee >= NORMS.oee - 10) },
    { l: 'Выпуск', v: fmtInt(s.line.output), n: s.isCurrent && s.line.planToDate < s.planTotal ? `план к этому часу ${fmtInt(s.line.planToDate)} из ${fmtInt(s.planTotal)}` : `план ${fmtInt(plan)}`, st: tone(s.line.output >= plan, s.line.output >= plan * 0.9) },
    w && { l: `Брак · ${w.name}`, v: pct(w.defect), n: `норма ≤ ${fmt1(NORMS.defect)}%`, st: defTone },
    { l: 'Простой крит. оборуд.', v: multi ? `${fmtInt(critPerDay)} мин/сут` : `${fmtInt(crit)} мин`, n: `лимит ${NORMS.critDowntime} мин/сут${multi ? ` · всего ${fmtInt(crit)} мин` : ''}`, st: dtTone },
    { l: 'Потери', v: fmtKzt(s.finance.total), n: 'простой + брак', st: worst(dtTone, defTone) },
  ].filter(Boolean);

  // ── Модели выбранных марок
  const picked = new Set(brands);
  const models = s.models.filter((m) => picked.has(m.brand));
  const byBrand = brands.map((b) => ({ brand: b, models: models.filter((m) => m.brand === b) }));
  const withTarget = models.some((m) => m.target != null);

  // ── Причины простоя
  const reasons = Object.entries(groupBy(s.downtime.filter((e) => e.unplanned), (e) => e.reason))
    .map(([reason, evs]) => ({
      reason, count: evs.length, minutes: sum(evs, (e) => e.minutes), kzt: sum(evs, lossKzt),
      equipment: [...new Set(evs.map((e) => e.eq?.name.split(' ').pop()).filter(Boolean))].slice(0, 3).join(', '),
    }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  // ── Инциденты и решения ИИ
  const incs = model.incidents.filter((i) => s.inPeriod(ts(i.created_at)));
  const byType = Object.entries(groupBy(incs, (i) => i.type))
    .map(([type, list]) => ({ type: INCIDENT_TYPE[type] ?? type, count: list.length }))
    .sort((a, b) => b.count - a.count);
  const decided = incs.map((i) => i.decision).filter((d) => d && d.status === 'applied');
  const checked = decided.filter((d) => d.payload?.check);
  const incidents = {
    total: incs.length,
    critical: incs.filter((i) => i.severity === 'critical' || i.severity === 'high').length,
    open: incs.filter((i) => i.open).length,
    byType,
    decisions: decided.length,
    accuracy: checked.length ? Math.round(sum(checked, (d) => d.payload.check.accuracy) / checked.length) : null,
    checked: checked.length,
    aiEffect: s.finance.aiEffect,
  };

  return {
    title: 'Отчёт о производстве',
    factory: model.factory.name,
    location: model.factory.location,
    period: `${KIND[p.kind]} · ${p.label}${s.isCurrent ? ' (период не завершён)' : ''}`,
    generated: fmtDateTime(model.anchor),
    fileBase: `allur-twin_${p.kind}_${p.fromDay}${p.kind === 'shift' ? `_${p.shifts[0]?.id}` : ''}`,
    brands, kpis, byBrand, models, withTarget, isMonth: p.kind === 'month', remainingDays: s.remainingDays,
    lineAreas: s.lineAreas.map((a) => ({ id: a.id, name: a.name })),
    losses: s.finance, reasons, incidents,
    notes: `Ставки — допущения команды: минута простоя линии ${fmtInt(ECON.downtimeMinKzt)} ₸ (включает упущенную маржу), `
      + `исправление кузова ${fmtInt(ECON.defectKzt)} ₸, маржа с автомобиля ${fmtInt(ECON.carMarginKzt)} ₸. `
      + 'Выпуск — на выходе линии. Простой отнесён к модели, которая шла на линии в час остановки.',
  };
}

/* ───────── CSV для Excel ───────── */

// Excel в русской локали: разделитель «;», десятичная запятая, BOM — чтобы кириллица открылась без мастера импорта
const num = (v, d = 0) => (v == null || Number.isNaN(v) ? '' : (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ','));
const cell = (v) => {
  const t = v == null ? '' : String(v);
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export function reportCsv(r) {
  const rows = [];
  const add = (...cols) => rows.push(cols.map(cell).join(';'));
  const gap = () => rows.push('');

  add(r.title); add('Завод', r.factory); add('Период', r.period); add('Сформирован (время завода)', r.generated); add('Марки', r.brands.join(', '));
  gap();
  add('Итоги линии');
  add('Показатель', 'Значение', 'Норматив / план');
  for (const k of r.kpis) add(k.l, k.v, k.n);
  gap();

  add('По моделям');
  add('Марка', 'Модель', 'План', 'Факт', 'Выполнение, %', 'OEE, %', 'Брак худшего участка, %', 'Худший участок', 'Дефекты, ед.', 'Брак, ₸',
    'Простой при выпуске, мин', 'Простой, ₸', 'Потери, ₸', 'Маржа, ₸', ...(r.withTarget ? ['План месяца (кейс)', 'Прогноз месяца'] : []));
  for (const m of r.models) {
    const plan = m.planTotal || m.planToDate;
    add(m.brand, m.name, plan, m.output, num(plan ? (m.output / plan) * 100 : null, 1), num(m.oee, 1), num(m.worst?.defect, 1), m.worst?.name ?? '',
      m.defects, Math.round(m.defectKzt), m.stopMin, Math.round(m.stopKzt), Math.round(m.defectKzt + m.stopKzt), Math.round(m.marginKzt),
      ...(r.withTarget ? [m.target ?? '', m.forecast ?? ''] : []));
  }
  gap();

  add('Брак по моделям и участкам, %');
  add('Модель', ...r.lineAreas.map((a) => a.name));
  for (const m of r.models) add(m.name, ...r.lineAreas.map((a) => num(m.defectByArea[a.id], 1)));
  gap();

  add('Потери по участкам');
  add('Участок', 'Простой, мин', 'Простой, ₸', 'Брак и доработка, ед.', 'Брак, ₸', 'Итого, ₸');
  for (const a of r.losses.areas) add(a.name, a.downtimeMin, Math.round(a.downtimeKzt), a.defects, Math.round(a.defectKzt), Math.round(a.total));
  add('Итого', r.losses.stopMin, Math.round(r.losses.downtime), r.losses.defects, Math.round(r.losses.defect), Math.round(r.losses.total));
  gap();

  add('Главные причины простоя');
  add('Причина', 'Остановок', 'Минут', 'Потери, ₸', 'Оборудование');
  for (const x of r.reasons) add(x.reason, x.count, x.minutes, Math.round(x.kzt), x.equipment);
  gap();

  add('Инциденты');
  add('Всего', r.incidents.total);
  for (const t of r.incidents.byType) add(`  ${t.type}`, t.count);
  add('Критичных и серьёзных', r.incidents.critical); add('Не закрыто', r.incidents.open);
  add('Принято решений ИИ', r.incidents.decisions);
  add('Эффект решений ИИ, ₸', Math.round(r.incidents.aiEffect));
  add('Точность проверенных прогнозов, %', r.incidents.accuracy ?? '', r.incidents.checked ? `проверено ${r.incidents.checked}` : '');
  gap();
  add(r.notes);

  return '﻿' + rows.join('\r\n');
}

export function downloadCsv(r) {
  saveCsv(reportCsv(r), r.fileBase);
}

/* ───────── Журнал инцидентов ───────── */

const SEVERITY = { critical: 'критический', high: 'высокий', medium: 'средний', low: 'низкий' };
const CHOICE = { none: 'Ничего не менять', A: 'Вариант A', B: 'Вариант Б' };

// list — инциденты ровно как на экране (период, фильтр, участок); meta — подписи для шапки файла
export function downloadIncidentsCsv(list, meta) {
  const rows = [];
  const add = (...cols) => rows.push(cols.map(cell).join(';'));
  add('Журнал инцидентов');
  add('Завод', meta.factory);
  add('Период', meta.period);
  add('Фильтр', meta.filter);
  if (meta.area) add('Участок', meta.area);
  add('Сформирован (время завода)', meta.generated);
  add('Записей', list.length);
  rows.push('');
  add('Дата и время', 'Участок', 'Оборудование', 'Тип', 'Уровень', 'Событие', 'Описание', 'Статус', 'Простой, мин',
    'Решение', 'Кто принял', 'Как рекомендовал ИИ', 'Точность прогноза, %');
  for (const i of list) {
    const d = i.decision;
    const decided = d && ['applied', 'expired'].includes(d.status) && d.chosen;
    const title = decided && d.chosen !== 'none' ? d.payload?.options?.find((o) => o.key === d.chosen)?.title : null;
    add(
      fmtDateTime(i.created_at), i.area?.name ?? '', i.equipment?.name ?? '', INCIDENT_TYPE[i.type] ?? i.type,
      SEVERITY[i.severity] ?? i.severity, i.title, i.description ?? '', i.state, i.downtime ?? '',
      !d ? '' : decided ? `${CHOICE[d.chosen] ?? d.chosen}${title ? ` — ${title}` : ''}` : d.status === 'expired' ? 'не понадобилось' : 'ждёт выбора',
      decided ? (d.decided_by === 'operator' ? 'оператор' : 'авто') : '',
      decided ? (d.recommended === d.chosen ? 'да' : 'нет') : '',
      d?.payload?.check?.accuracy ?? '',
    );
  }
  saveCsv('\uFEFF' + rows.join('\r\n'), meta.fileBase);
}

function saveCsv(text, fileBase) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBase}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
