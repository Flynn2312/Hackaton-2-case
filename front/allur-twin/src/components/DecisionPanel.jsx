import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { S, accuracySt, fmt1, fmtInt, fmtKzt, fmtTime, sgn } from '../lib/format';

// Боковая панель решений по инцидентам: «ничего не менять», вариант A и Б от ИИ,
// таблица прогноза показателей на 3 часа и рекомендация. Без выбора по таймеру применяется «ничего не менять».
const LABEL = { none: 'Ничего не менять', A: 'Вариант A', B: 'Вариант Б' };
const SEVERITY_ST = { critical: 'r', high: 'r', medium: 'y', low: 'g' };

const fmtValue = (metric, v) => {
  if (metric.unit === '%') return `${fmt1(v)}%`;
  if (metric.key === 'effect') return v === 0 ? '0' : sgn(v);
  return fmtInt(v);
};

// Цена бездействия: на сколько «ничего не менять» хуже лучшего варианта (эффект в payload — тыс. ₸)
function InactionCost({ p }) {
  const best = Math.max(...p.options.filter((o) => o.key !== 'none').map((o) => o.values.effect ?? 0));
  if (!(best > 0)) return null;
  return (
    <div className="text-xs text-neutral-700">
      Цена бездействия: <b className="text-text font-medium">≈ {fmtKzt(best * 1000)}</b> за {p.horizon_min / 60} ч к лучшему варианту
    </div>
  );
}

// Проверка прогноза: через 3 ч после инцидента факт сравнивается с прогнозом выбранного варианта
function ForecastCheck({ d, p }) {
  const c = p.check;
  if (!c) {
    return (
      <div className="text-xs text-neutral-700">
        Проверка прогноза: через {p.horizon_min / 60} ч работы линии после инцидента сравним прогноз с фактом.
      </div>
    );
  }
  const st = accuracySt(c.accuracy);
  const metrics = p.metrics.filter((m) => m.key in c.fact);
  return (
    <div className="border border-divider p-3 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-sm">Проверка прогноза · {LABEL[c.choice]}</span>
        <span className="text-[13px]" style={{ color: S[st].ink }}>сбылся на <b className="num text-[17px]">{c.accuracy}%</b></span>
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-[11px] text-neutral-700">
            <th className="text-left font-normal py-1">{fmtTime(c.from)}–{fmtTime(c.to)}</th>
            <th className="text-right font-normal py-1 w-[70px]">прогноз</th>
            <th className="text-right font-normal py-1 w-[70px]">факт</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.key} className="border-t border-neutral-300">
              <td className="py-1 text-neutral-800">{m.label}<span className="text-neutral-600">, {m.unit}</span></td>
              <td className="py-1 text-right num">{fmtValue(m, c.forecast[m.key])}</td>
              <td className="py-1 text-right num font-semibold">{fmtValue(m, c.fact[m.key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.chosen !== 'none' && <div className="text-[11px] text-neutral-600">Точность — по выпуску линии. Эффект к «ничего не менять» проверить нельзя: второго завода без решения нет.</div>}
    </div>
  );
}

// Лучшее значение в строке таблицы (если варианты отличаются)
function bestKey(metric, options) {
  const vals = options.map((o) => o.values[metric.key]);
  if (Math.max(...vals) === Math.min(...vals)) return null;
  const pick = metric.better === 'higher' ? Math.max(...vals) : Math.min(...vals);
  return options.find((o) => o.values[metric.key] === pick)?.key ?? null;
}

function Countdown({ deadline, simNow, sim }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = simNow();
  if (!now || !deadline) return null;
  const simLeft = new Date(deadline).getTime() - now;
  const realSec = Math.max(0, Math.round(simLeft / (Number(sim?.speed) || 1) / 1000));
  const urgent = realSec <= 15;
  return (
    <div className="text-xs flex items-center gap-1.5" style={{ color: urgent ? S.r.ink : 'var(--color-neutral-700)' }}>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: urgent ? S.r.fill : S.y.fill }} />
      {sim?.running
        ? <>Без выбора через <b className="num text-sm">{Math.floor(realSec / 60)}:{String(realSec % 60).padStart(2, '0')}</b> применится «Ничего не менять» (в {fmtTime(deadline)} по времени завода)</>
        : <>Симуляция на паузе — время на выбор остановлено</>}
    </div>
  );
}

function DecisionBody({ decision: d, simNow, sim, onDecide, busy, error }) {
  const inc = d.incident;
  const p = d.payload;
  const st = SEVERITY_ST[inc.severity] ?? 'y';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] tracking-[.08em] uppercase" style={{ color: S[st].ink }}>
          {inc.area?.name ?? 'Участок'} · {fmtTime(inc.created_at)} · НЗ-{inc.id}
        </span>
        <h4 className="leading-tight">{inc.title}</h4>
      </div>

      {d.status === 'generating' && (
        <div className="border border-divider p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 font-medium">
            <span className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: 'var(--color-accent)' }} />
            ИИ готовит варианты решения…
          </div>
          <div className="text-xs text-neutral-700">
            Модель завода прогоняет каждый вариант на 3 часа вперёд, затем Claude выбирает два лучших действия и аргументирует рекомендацию. Обычно это занимает 10–30 секунд.
          </div>
        </div>
      )}

      {p && (
        <>
          <div className="text-sm leading-[1.5]">{p.analysis}</div>

          {d.status === 'ready' && (
            <div className="flex flex-col gap-1">
              <Countdown deadline={d.deadline_at} simNow={simNow} sim={sim} />
              <InactionCost p={p} />
            </div>
          )}
          {d.status === 'applied' && (
            <div className="text-sm px-3 py-2" style={{ background: S.g.tint, color: S.g.ink }}>
              Принято: <b>{LABEL[d.chosen]}</b>{d.chosen !== 'none' && ` — ${p.options.find((o) => o.key === d.chosen)?.title}`}
              {' · '}{d.decided_by === 'operator' ? 'выбор оператора' : 'автоматически по истечении времени'}
            </div>
          )}
          {d.status === 'applied' && <ForecastCheck d={d} p={p} />}
          {d.status === 'expired' && (
            <div className="text-sm px-3 py-2 bg-neutral-200">Решение не понадобилось: проблема устранилась до выбора.</div>
          )}

          <div className="overflow-x-auto -mx-1">
            <table className="w-full border-collapse text-[13px] min-w-[400px]">
              <thead>
                <tr>
                  <th className="text-left font-normal text-[11px] text-neutral-700 px-1 py-2 align-bottom w-[32%]">Прогноз на {p.horizon_min / 60} ч</th>
                  {p.options.map((o) => {
                    const rec = p.recommended === o.key;
                    const chosen = d.chosen === o.key;
                    return (
                      <th
                        key={o.key}
                        className="text-left align-bottom px-2 py-2 font-normal"
                        style={{
                          background: rec ? 'var(--color-accent-100)' : undefined,
                          borderTop: `3px solid ${chosen ? S.g.fill : rec ? 'var(--color-accent)' : 'transparent'}`,
                        }}
                      >
                        {rec && <div className="text-[10px] font-semibold tracking-[.06em] uppercase mb-0.5" style={{ color: 'var(--color-accent-700)' }}>★ Рекомендует ИИ</div>}
                        <div className="font-heading font-semibold text-[15px] leading-tight">{LABEL[o.key]}</div>
                        {o.key !== 'none' && <div className="text-[11px] text-neutral-700 leading-snug mt-0.5">{o.title}</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {p.metrics.map((m) => {
                  const best = bestKey(m, p.options);
                  return (
                    <tr key={m.key} className="border-t border-neutral-300">
                      <td className="px-1 py-1.5 text-neutral-800">{m.label}<span className="text-neutral-600">, {m.unit}</span></td>
                      {p.options.map((o) => (
                        <td
                          key={o.key}
                          className="px-2 py-1.5 num text-[15px]"
                          style={{
                            background: p.recommended === o.key ? 'var(--color-accent-100)' : undefined,
                            color: best === o.key ? S.g.ink : undefined,
                            fontWeight: best === o.key ? 600 : undefined,
                          }}
                        >
                          {fmtValue(m, o.values[m.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {d.status === 'ready' && (
                  <tr className="border-t border-neutral-300">
                    <td />
                    {p.options.map((o) => (
                      <td key={o.key} className="px-1 py-2" style={{ background: p.recommended === o.key ? 'var(--color-accent-100)' : undefined }}>
                        <button
                          type="button"
                          className={`btn w-full px-2 ${p.recommended === o.key ? 'btn-primary' : 'btn-secondary'}`}
                          disabled={!!busy}
                          onClick={() => onDecide(d.id, o.key)}
                        >
                          {busy === o.key ? '…' : 'Выбрать'}
                        </button>
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {error && <div className="text-xs" style={{ color: S.r.ink }}>{error}</div>}

          <div className="flex flex-col gap-2.5">
            {p.options.map((o) => (
              <div key={o.key} className="flex gap-2.5 text-[13px] leading-[1.45]">
                <span className="w-1 shrink-0" style={{ background: p.recommended === o.key ? 'var(--color-accent)' : 'var(--color-neutral-400)' }} />
                <div className="flex flex-col gap-0.5">
                  <b>{LABEL[o.key]}{o.key !== 'none' && `: ${o.title}`}</b>
                  <span>{o.rationale}</span>
                  <span className="text-[11px] text-neutral-700">Что делаем: {o.effect_text}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 text-[13px] leading-[1.45]" style={{ background: 'var(--color-accent-100)' }}>
            <b style={{ color: 'var(--color-accent-700)' }}>Почему ИИ рекомендует «{LABEL[p.recommended]}»:</b> {p.recommendation_reason}
          </div>
          <div className="text-[11px] text-neutral-600">
            Источник: {p.source_label}. Цифры — прогноз имитационной модели завода (среднее по нескольким прогонам), аргументация — ИИ.
          </div>
        </>
      )}
    </div>
  );
}

export default function DecisionPanel({ model, sim, simNow, selectedId, onSelect, onClose, onDecided }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const pending = model.pendingDecisions;
  const selected = model.decisions.find((d) => d.id === selectedId) ?? pending[0] ?? null;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const decide = async (id, choice) => {
    setBusy(choice);
    setError(null);
    try {
      await api.decide(id, choice);
      onDecided?.(id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="fixed top-14 right-0 bottom-0 w-[min(500px,100vw)] bg-bg border-l border-divider shadow-lg z-30 flex flex-col" aria-label="Решения по инцидентам">
      <div className="px-5 py-3 border-b border-divider flex items-center justify-between gap-3">
        <div>
          <div className="font-heading font-semibold text-lg leading-tight">Решения по инцидентам</div>
          <div className="text-xs text-neutral-700">
            {pending.length ? `Ждут выбора: ${pending.length}` : 'Нет инцидентов, ожидающих решения'}
            {model.forecastAccuracy && <> · прогнозы сбываются на <b className="text-text font-medium">{model.forecastAccuracy.value}%</b> ({model.forecastAccuracy.n} пров.)</>}
          </div>
        </div>
        <button type="button" onClick={onClose} className="btn btn-ghost btn-icon text-xl" aria-label="Закрыть">×</button>
      </div>

      {pending.length > 1 && (
        <div className="flex gap-1.5 px-5 py-2 border-b border-divider overflow-x-auto">
          {pending.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onSelect(d.id)}
              className="text-xs px-2.5 py-1 border whitespace-nowrap"
              style={{
                borderColor: selected?.id === d.id ? 'var(--color-accent)' : 'var(--color-divider)',
                background: selected?.id === d.id ? 'var(--color-accent-100)' : 'transparent',
              }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: S[SEVERITY_ST[d.incident.severity] ?? 'y'].fill }} />
              {d.incident.area?.name ?? 'Участок'} · НЗ-{d.id}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {selected
          ? <DecisionBody key={selected.id} decision={selected} simNow={simNow} sim={sim} onDecide={decide} busy={busy} error={error} />
          : <div className="text-sm text-neutral-700">Когда на линии случится отказ, брак или нехватка комплектующих, здесь появятся варианты решения от ИИ.</div>}
      </div>
    </aside>
  );
}
