// Цвета статусов и форматирование чисел/времени.

export const S = {
  g: { fill: 'var(--color-ok)', ink: 'var(--color-ok-ink)', tint: 'oklch(0.68 0.14 150 / .16)', frame: 'var(--color-divider)', l: 'Норма' },
  y: { fill: 'var(--color-warn)', ink: 'var(--color-warn-ink)', tint: 'oklch(0.80 0.15 85 / .25)', frame: 'var(--color-warn)', l: 'Риск' },
  r: { fill: 'var(--color-crit)', ink: 'var(--color-crit-ink)', tint: 'oklch(0.62 0.19 28 / .15)', frame: 'var(--color-crit)', l: 'Критично' },
};

const RANK = { g: 0, y: 1, r: 2 };
export const worst = (...sts) => sts.filter(Boolean).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'g');

export const fmtInt = (v) => Math.round(v).toLocaleString('ru-RU');
export const fmt1 = (v) => (Math.round(v * 10) / 10).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const pct = (v) => `${fmt1(v)}%`;
export const sgn = (v, f = fmtInt) => (v > 0 ? '+' : v < 0 ? '−' : '') + f(Math.abs(v));
// Деньги: 4,7 млн ₸ / 850 тыс. ₸ / 0 ₸
export const fmtKzt = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${fmt1(v / 1e9)} млрд ₸`;
  if (a >= 1e6) return `${fmt1(v / 1e6)} млн ₸`;
  if (a >= 1e3) return `${fmtInt(v / 1e3)} тыс. ₸`;
  return `${fmtInt(v)} ₸`;
};

// Завод в Костанае: UTC+5 круглый год. Считаем вручную, чтобы не зависеть от tzdata браузера.
export const TZ_OFFSET_H = 5;
const local = (ts) => new Date(new Date(ts).getTime() + TZ_OFFSET_H * 3600e3);
const p2 = (n) => String(n).padStart(2, '0');

export const localDate = (ts) => local(ts).toISOString().slice(0, 10); // YYYY-MM-DD
export const localHour = (ts) => local(ts).getUTCHours();
export const fmtTime = (ts) => { const d = local(ts); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
export const fmtDate = (ts) => { const d = local(ts); return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}`; };
export const fmtDateTime = (ts) => `${fmtDate(ts)} ${fmtTime(ts)}`;
export const fmtDayLong = (day) => day.split('-').reverse().join('.');

// Полночь локального дня в ISO с поясом — для фильтров date_from/date_to
export const dayStartIso = (day) => `${day}T00:00:00+0${TZ_OFFSET_H}:00`;
export const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const isWeekday = (day) => { const w = new Date(`${day}T00:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; };

export const fmtMinutes = (m) => (m >= 120 ? `${fmt1(m / 60)} ч` : `${fmtInt(m)} мин`);
export const fmtHours = (h) => (h < 1 ? `~${Math.max(1, Math.round(h * 60))} мин` : h < 48 ? `~${Math.round(h)} ч` : `~${Math.round(h / 24)} дн`);

// Короткое имя оборудования: «Сборочный конвейер Конвейер-03» -> «Конвейер-03»
export const eqShort = (name) => name.split(' ').pop();
