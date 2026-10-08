// Встроенные ответы ИИ-ассистента по данным модели двойника (правила, без внешней LLM).
// Основные ответы даёт Claude на бэкенде (/api/assistant/chat); эти правила — запасной вариант, когда ИИ недоступен.
import { NORMS } from './model';
import { S, eqShort, fmt1, fmtInt, pct } from './format';

export function presets(m) {
  return [
    m.worstDefect && m.worstDefect.defect > NORMS.defect && `Почему вырос брак на участке «${m.worstDefect.name}»?`,
    m.risingEq[0] && `Когда остановится ${eqShort(m.risingEq[0].eq.name)}?`,
    'Где узкое место линии?',
    'Выполним ли месячный план?',
  ].filter(Boolean);
}

export function greeting(m) {
  const by = (st) => m.areas.filter((a) => a.st === st).map((a) => a.name);
  const r = by('r');
  const y = by('y');
  return `Здравствуйте. Слежу за ${m.areas.length} участками линии.`
    + (r.length ? ` Сейчас критично: ${r.join(', ')}.` : '')
    + (y.length ? ` В зоне риска: ${y.join(', ')}.` : '')
    + ' Что разобрать?';
}

const has = (q, ...words) => words.some((w) => q.includes(w));

function areaSummary(a, m) {
  const lines = [`«${a.name}» — ${S[a.st].l.toLowerCase()}.`];
  if (a.hasRec) lines.push(`• OEE ${pct(a.oee)} (A ${pct(a.A * 100)} · P ${pct(a.P * 100)} · Q ${pct(a.Q * 100)}), выпуск ${a.actual} из ${a.plan}`);
  if (a.hasRec) lines.push(`• Брак ${pct(a.defect)} (${a.scrap} ед.), доработка ${a.rework} ед.`);
  lines.push(`• Простой за сутки ${a.downtimeMin} мин, оборудование в работе ${a.units.filter((u) => u.st === 'g').length} из ${a.units.length}`);
  for (const r of a.reasons.slice(0, 4)) lines.push(`• ${r.why}`);
  const al = m.alerts.find((x) => x.areaId === a.id);
  if (al) lines.push(`Действие: ${al.action}.`);
  else if (a.st === 'g') lines.push('Отклонений, требующих действий, нет.');
  return lines.join('\n');
}

function quality(m, a) {
  const t = a ?? m.worstDefect;
  if (!t) return 'Данных о качестве нет.';
  const tr = m.eqTrends.filter((x) => x.eq.production_area_id === t.id && x.lastMin > 0).sort((x, y) => y.lastMin - x.lastMin)[0];
  return [
    `Брак на участке «${t.name}» за сутки — ${pct(t.defect)} (${t.scrap} из ${t.total}), норма ≤ ${fmt1(NORMS.defect)}%. На доработке ${t.rework} ед.`,
    tr ? `• Больше всего внеплановых простоев на участке у ${eqShort(tr.eq.name)}: ${tr.lastMin} мин за 14 дн., чаще всего — «${tr.topReason}». Это вероятный источник отклонения параметров.` : '',
    ...t.openIncs.slice(0, 3).map((i) => `• Открыт инцидент: ${i.title}`),
    `Действие: проверить и откалибровать оборудование участка, ужесточить входной контроль. Цель — брак ≤ ${fmt1(NORMS.defect)}%; сценарий можно проверить во вкладке What-If.`,
  ].filter(Boolean).join('\n');
}

function equipment(m, a, q) {
  const list = m.eqTrends.filter((t) => (!a || t.eq.production_area_id === a.id));
  const named = list.find((t) => q.includes(eqShort(t.eq.name).toLowerCase()));
  const t = named ?? [...list].sort((x, y) => y.lastMin * Math.max(1, y.growth) - x.lastMin * Math.max(1, x.growth))[0];
  if (!t || !t.lastMin) return 'Внеплановых простоев оборудования за последние 14 дней нет.';
  const active = m.areas.flatMap((x) => x.activeDt).filter((e) => e.areaId === t.eq.production_area_id);
  return [
    `${t.eq.name}: ${t.lastMin} мин внеплановых простоев за 14 дн. (${t.lastCount} остановок) против ${t.prevMin} мин двумя неделями ранее.`,
    t.topReason ? `• Частая причина — «${t.topReason}».` : '',
    t.mtbfH ? `• Средняя наработка между отказами ~${Math.round(t.mtbfH)} ч — следующая остановка вероятна в ближайшую смену.` : '',
    ...active.map((e) => `• Сейчас стоит ${eqShort(e.eq.name)}: ${e.reason}, ${e.minutes} мин.`),
    `Рекомендую плановое ТО ${eqShort(t.eq.name)} в пересменку: короткий плановый останов вместо аварийного.`,
  ].filter(Boolean).join('\n');
}

function bottleneck(m) {
  const b = m.bottleneck;
  if (!b) return 'Нет данных о выработке участков.';
  const bufs = m.areas.filter((a) => a.buffer && a.buffer.st !== 'g');
  return [
    `Узкое место — «${b.name}»: минимальный OEE на линии ${pct(b.oee)} (доступность ${pct(b.A * 100)}, производительность ${pct(b.P * 100)}, качество ${pct(b.Q * 100)}).`,
    ...m.areas.filter((a) => a.hasRec).map((a) => `• ${a.name}: OEE ${pct(a.oee)}, выпуск ${a.actual} из ${a.plan}`),
    ...bufs.map((a) => `• Буфер после «${a.name}» — ${a.buffer.value} ед. при минимуме ${NORMS.bufferMin}: риск голодания следующего участка.`),
    'Действие: начать с узкого места — сократить простои и переналадки, держать буфер перед ним не ниже нормы.',
  ].join('\n');
}

function plan(m) {
  const gap = m.monthPlan - m.monthForecast;
  return [
    `Прогноз месяца — ${fmtInt(m.monthForecast)} авто при плане ${fmtInt(m.monthPlan)} (${gap > 0 ? `−${fmtInt(gap)}` : `+${fmtInt(-gap)}`}).`,
    `• Средний выпуск ${fmtInt(m.avgDaily)} авто/сут при плане ${fmtInt(m.dayPlan)}.`,
    gap > 0 ? `• Чтобы закрыть разрыв, нужно +${fmtInt(gap / Math.max(1, m.whatIfBase.remainingDays))} авто в сутки на оставшиеся ${m.whatIfBase.remainingDays} раб. дней.` : '• План выполняется с запасом.',
    'Сценарии устранения брака и превентивного ТО можно проверить во вкладке What-If.',
  ].join('\n');
}

export function answer(question, areaId, m) {
  const q = question.toLowerCase();
  const a = m.areas.find((x) => q.includes(x.name.toLowerCase())) ?? m.areas.find((x) => x.id === areaId) ?? null;
  if (has(q, 'брак', 'качеств', 'дефект', 'лкп')) return quality(m, a?.hasRec ? a : null);
  if (has(q, 'останов', 'простой', 'простаива', 'отказ', 'поломк', 'ремонт', 'конвейер', 'робот', 'камер', 'печь') || m.eqTrends.some((t) => q.includes(eqShort(t.eq.name).toLowerCase()))) return equipment(m, a, q);
  if (has(q, 'узк', 'голод', 'буфер', 'bottleneck', 'тормоз')) return bottleneck(m);
  if (has(q, 'план', 'месяц', 'выпуск', 'прогноз')) return plan(m);
  if (a) return areaSummary(a, m);
  return [
    `Состояние линии: OEE ${pct(m.lineOee)} (цель ≥ ${NORMS.oee}%), выпуск ${m.finalArea.actual} из ${m.dayPlan}, простой критичного оборудования ${m.critDowntime} мин.`,
    ...m.alerts.slice(0, 3).map((x) => `• ${x.title} → ${x.action}`),
    'Уточните участок или спросите про брак, простои, узкое место или план.',
  ].join('\n');
}
