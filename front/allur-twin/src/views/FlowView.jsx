import { Blueprint } from '../components/ui';
import { S, fmtDayLong, fmtInt } from '../lib/format';

// «Живой завод»: сводка по линии, поток участков карточками, выпуск по часам и что требует внимания.
const DIM = 'var(--color-neutral-700)';
const WORD = { g: 'В норме', y: 'Есть риск', r: 'Критично' };

export default function FlowView({ model, onOpen, onOpenEquipment }) {
  return (
    <main className="px-4 md:px-7 pt-6 pb-10 flex flex-col gap-7 min-w-0">
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h3>Поток производства</h3>
            <div className="text-[13px] text-neutral-700">Кузов идёт слева направо · нажмите на участок, чтобы увидеть подробности · данные на {fmtDayLong(model.day)}</div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700 [&>span]:whitespace-nowrap">
            {['g', 'y', 'r'].map((k) => (
              <span key={k} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: S[k].fill }} />{WORD[k]}</span>
            ))}
          </div>
        </div>
        <Flow areas={model.areas} bottleneckId={model.bottleneck?.id} onOpen={onOpen} onOpenEquipment={onOpenEquipment} />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-7">
        <HourlyChart model={model} />
        <Attention model={model} onOpen={onOpen} />
      </div>
    </main>
  );
}

/* ───────── Поток участков ───────── */

// Буфер между участками: стрелка с числом кузовов в очереди. Видна, когда все участки стоят в один ряд (2xl).
function Arrow({ area }) {
  const b = area.buffer;
  return (
    <div className="hidden 2xl:flex flex-col items-center justify-center gap-1.5 min-w-0">
      <svg width="32" height="16" viewBox="0 0 40 18" fill="none" stroke="var(--color-neutral-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 9h34M28 2l8 7-8 7" />
      </svg>
      {b && (
        <span className="text-center leading-tight" title="Кузова, которые ждут следующий участок">
          <span className="num text-lg block" style={{ color: b.st === 'g' ? 'var(--color-text)' : S[b.st].ink }}>{b.value}</span>
          <span className="text-[10px] text-neutral-700">в очереди</span>
        </span>
      )}
    </div>
  );
}

function AreaCard({ a, step, bottleneck, onOpen, onOpenEquipment }) {
  const c = S[a.st];
  const working = a.units.filter((u) => u.status === 'running').length;
  return (
    <button
      type="button"
      onClick={() => onOpen(a.id)}
      className="w-full h-full min-w-0 text-left bg-bg rounded-2xl overflow-hidden flex flex-col transition-transform duration-200 hover:-translate-y-0.5"
      // Рамка — внутренней тенью: не сдвигает цветную полосу, полоса ровно по ширине карточки
      style={{ boxShadow: `${a.st === 'g' ? '' : `inset 0 0 0 1.5px ${c.fill}, `}var(--shadow-card)` }}
    >
      <div className="h-1.5 w-full shrink-0" style={{ background: c.fill }} />
      <div className="px-4 pt-3 pb-3 flex flex-col gap-3 flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 min-h-5">
          <span className="w-6 h-6 shrink-0 rounded-full grid place-items-center text-xs font-semibold bg-neutral-200 text-neutral-800">{step}</span>
          {bottleneck && (
            <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand text-white">узкое место</span>
          )}
        </div>
        <div className="font-heading font-semibold text-[clamp(18px,1.3vw,22px)] leading-[1.15] break-words hyphens-auto">{a.name}</div>

        <div className="min-w-0">
          <div className="text-xs text-neutral-700 truncate">{a.main.label}</div>
          <div className="num text-[clamp(24px,2vw,32px)] leading-[1.1] truncate" style={{ color: a.main.st === 'g' ? 'var(--color-text)' : S[a.main.st].ink }}>{a.main.value}</div>
          <div className="text-xs text-neutral-700 break-words">{a.main.norm}</div>
        </div>

        <div className="flex flex-col gap-1.5 mt-auto min-w-0">
          {a.main.label !== 'Оборудование в работе' && (
            <div className="text-xs text-neutral-700 break-words">
              Оборудование в работе: <b className="text-text font-medium">{working} из {a.units.length}</b>
            </div>
          )}
          <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
            {a.units.map((u) => (
              <span
                key={u.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenEquipment?.(u, a)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpenEquipment?.(u, a); }}
                title={`${u.name} — ${u.label}`}
                className="w-3 h-3 rounded-full cursor-pointer hover:scale-125 transition-transform"
                style={{ background: u.st === 'g' ? 'oklch(0.68 0.14 150 / .45)' : S[u.st].fill }}
              />
            ))}
          </div>
          {a.buffer && (
            <div className="2xl:hidden text-xs text-neutral-700">
              В очереди к следующему участку:{' '}
              <b className="font-medium" style={{ color: a.buffer.st === 'g' ? 'var(--color-text)' : S[a.buffer.st].ink }}>{a.buffer.value}</b>
            </div>
          )}
        </div>
      </div>
      <div className="px-4 py-2.5 border-t border-divider text-[13px] leading-[1.4] min-h-[56px] flex gap-2 min-w-0" style={{ color: a.alert.st === 'n' ? DIM : S[a.alert.st].ink }}>
        <span aria-hidden="true" className="shrink-0">{a.alert.st === 'n' ? '✓' : '!'}</span>
        <span className="min-w-0 break-words line-clamp-3" title={a.alert.text}>{a.alert.text}</span>
      </div>
    </button>
  );
}

// Сетка подстраивается под экран: 1 / 2 / 3 колонки, на широком (2xl) — весь поток в один ряд со стрелками-буферами.
// Все карточки одной ширины (колонки 1fr) и одной высоты (строки 1fr).
function Flow({ areas, bottleneckId, onOpen, onOpenEquipment }) {
  const cols = `repeat(${Math.max(0, areas.length - 1)}, minmax(0, 1fr) 64px) minmax(0, 1fr)`;
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-3 2xl:gap-0 2xl:[grid-template-columns:var(--flow-cols)] pt-1"
      style={{ '--flow-cols': cols }}
    >
      {areas.map((a, i) => [
        <AreaCard key={a.id} a={a} step={i + 1} bottleneck={a.id === bottleneckId} onOpen={onOpen} onOpenEquipment={onOpenEquipment} />,
        a.hasNext && <Arrow key={`arrow-${a.id}`} area={a} />,
      ])}
    </div>
  );
}

/* ───────── Выпуск по часам ───────── */

function HourlyChart({ model }) {
  const { hours, hourPlan, finalArea, dayPlan } = model;
  const max = Math.max(hourPlan * 1.25, ...hours.map((h) => h.actual ?? 0));
  const done = hours.filter((h) => h.actual != null);
  const fact = done.reduce((s, h) => s + h.actual, 0);
  const planSoFar = done.reduce((s, h) => s + (h.plan ?? hourPlan), 0);
  return (
    <Blueprint className="p-[18px] flex flex-col gap-3.5">
      <div className="flex justify-between items-baseline gap-3 flex-wrap">
        <div>
          <h4>Сколько машин выпущено по часам</h4>
          <div className="text-xs text-neutral-700">на выходе линии · {finalArea.name}</div>
        </div>
        <span className="text-[13px] text-neutral-700">к этому часу <b className="text-text">{fmtInt(fact)}</b> из {fmtInt(planSoFar || dayPlan)}</span>
      </div>
      <div className="flex items-end gap-1.5 h-[180px] border-b border-text relative">
        <div className="absolute left-0 right-0 border-t border-dashed border-accent-700" style={{ bottom: `${(hourPlan / max) * 100}%` }} />
        <div className="absolute right-0 -translate-y-full text-[11px] text-accent-700 bg-bg px-1" style={{ bottom: `${(hourPlan / max) * 100}%` }}>план {hourPlan} в час</div>
        {hours.map((h, i) => {
          if (h.actual == null) {
            return (
              <div key={i} className="flex-1 h-full flex flex-col justify-end items-center">
                <div className="w-full border border-dashed border-neutral-400" style={{ height: `${(hourPlan / max) * 100}%` }} />
              </div>
            );
          }
          const plan = h.plan ?? hourPlan;
          const st = h.actual >= plan ? 'g' : h.actual >= plan * 0.8 ? 'y' : 'r';
          return (
            <div key={i} className="flex-1 h-full flex flex-col justify-end items-center gap-1 relative z-[1]" title={`${h.label}:00 — выпущено ${h.actual}, план ${plan}`}>
              <span className="hidden sm:block text-[11px] font-medium" style={{ color: S[st].ink }}>{h.actual}</span>
              <div className="w-full rounded-t-[3px] transition-[height] duration-500" style={{ height: `${(h.actual / max) * 100}%`, background: S[st].fill }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {hours.map((h, i) => <span key={i} className="flex-1 text-center text-[11px] text-neutral-700">{h.label}</span>)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700 [&>span]:whitespace-nowrap">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5" style={{ background: S.g.fill }} />план выполнен</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5" style={{ background: S.y.fill }} />немного не дотянули</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5" style={{ background: S.r.fill }} />сильно отстали</span>
      </div>
    </Blueprint>
  );
}

/* ───────── Что требует внимания ───────── */

function Attention({ model, onOpen }) {
  return (
    <Blueprint className="p-[18px] flex flex-col gap-1">
      <div className="mb-1.5">
        <h4>Что требует внимания</h4>
        <div className="text-xs text-neutral-700">по данным за последние 4 недели</div>
      </div>
      {model.alerts.length === 0 && <div className="text-[15px] text-neutral-700 border-t border-divider pt-3">✓ Рисков не обнаружено.</div>}
      {model.alerts.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => a.areaId && onOpen(a.areaId)}
          className="grid grid-cols-[4px_minmax(0,1fr)] gap-3 text-left border-t border-divider py-3 hover:bg-neutral-100 transition-colors"
        >
          <span style={{ background: S[a.st].fill }} />
          <span className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-[15px] min-w-0 break-words">{a.title}</span>
              <span className="text-xs whitespace-nowrap" style={{ color: S[a.st].ink }}>{a.eta}</span>
            </span>
            <span className="text-[13px] text-neutral-700 leading-[1.45] text-pretty break-words">{a.text}</span>
            <span className="text-[13px] text-accent-700 break-words"><b className="font-medium">Что делать:</b> {a.action}</span>
          </span>
        </button>
      ))}
    </Blueprint>
  );
}
