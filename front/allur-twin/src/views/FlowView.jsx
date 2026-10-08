import { Blueprint } from '../components/ui';
import { S, fmtDayLong, fmtInt } from '../lib/format';

// «Живой завод»: сводка по линии, поток участков карточками, выпуск по часам и что требует внимания.
const DIM = 'var(--color-neutral-700)';
const WORD = { g: 'В норме', y: 'Есть риск', r: 'Критично' };

export default function FlowView({ model, onOpen, onOpenEquipment }) {
  return (
    <main className="px-7 pt-6 pb-10 flex flex-col gap-7">
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h3>Поток производства</h3>
            <div className="text-[13px] text-neutral-700">Кузов идёт слева направо · нажмите на участок, чтобы увидеть подробности · данные на {fmtDayLong(model.day)}</div>
          </div>
          <div className="flex gap-4 text-xs text-neutral-700">
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

function Arrow({ area }) {
  const b = area.buffer;
  const c = b ? S[b.st] : null;
  return (
    <div className="w-[76px] shrink-0 flex flex-col items-center justify-center gap-1.5 px-1">
      <svg width="40" height="18" viewBox="0 0 40 18" fill="none" stroke="var(--color-neutral-500)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 9h34M28 2l8 7-8 7" />
      </svg>
      {b ? (
        <span className="text-center leading-tight" title="Кузова, которые ждут следующий участок">
          <span className="num text-lg block" style={{ color: b.st === 'g' ? 'var(--color-text)' : c.ink }}>{b.value}</span>
          <span className="text-[10px] text-neutral-700">в очереди</span>
        </span>
      ) : <span className="h-9" />}
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
      className="relative flex-1 min-w-[180px] text-left bg-bg border rounded-2xl flex flex-col shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderColor: a.st === 'g' ? 'transparent' : c.fill }}
    >
      <div className="h-1.5 rounded-t-2xl" style={{ background: c.fill }} />
      {bottleneck && (
        <span className="absolute -top-2.5 right-3 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand text-white">узкое место</span>
      )}
      <div className="px-4 pt-3 pb-3 flex flex-col gap-3 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="w-6 h-6 rounded-full grid place-items-center text-xs font-semibold bg-neutral-200 text-neutral-800">{step}</span>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: c.tint, color: c.ink }}>{WORD[a.st]}</span>
        </div>
        <div className="font-heading font-semibold text-[22px] leading-[1.1]">{a.name}</div>

        <div>
          <div className="text-xs text-neutral-700">{a.main.label}</div>
          <div className="num text-[32px] leading-[1.05]" style={{ color: a.main.st === 'g' ? 'var(--color-text)' : S[a.main.st].ink }}>{a.main.value}</div>
          <div className="text-xs text-neutral-700">{a.main.norm}</div>
        </div>

        <div className="flex flex-col gap-1.5">
          {a.main.label !== 'Оборудование в работе' && (
            <div className="text-xs text-neutral-700">
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
        </div>
      </div>
      <div className="px-4 py-2.5 border-t border-divider text-[13px] leading-[1.4] min-h-[52px] text-pretty flex gap-2" style={{ color: a.alert.st === 'n' ? DIM : S[a.alert.st].ink }}>
        <span aria-hidden="true">{a.alert.st === 'n' ? '✓' : '!'}</span>
        <span>{a.alert.text}</span>
      </div>
    </button>
  );
}

function Flow({ areas, bottleneckId, onOpen, onOpenEquipment }) {
  return (
    <div className="overflow-x-auto pt-3 pb-2 -mx-1 px-1">
      <div className="flex items-stretch" style={{ minWidth: areas.length * 256 }}>
        {areas.map((a, i) => (
          <div key={a.id} className="flex items-stretch flex-1 min-w-0">
            <AreaCard a={a} step={i + 1} bottleneck={a.id === bottleneckId} onOpen={onOpen} onOpenEquipment={onOpenEquipment} />
            {a.hasNext && <Arrow area={a} />}
          </div>
        ))}
      </div>
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
              <span className="text-[11px] font-medium" style={{ color: S[st].ink }}>{h.actual}</span>
              <div className="w-full rounded-t-[3px] transition-[height] duration-500" style={{ height: `${(h.actual / max) * 100}%`, background: S[st].fill }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {hours.map((h, i) => <span key={i} className="flex-1 text-center text-[11px] text-neutral-700">{h.label}</span>)}
      </div>
      <div className="flex gap-4 text-xs text-neutral-700">
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
              <span className="font-medium text-[15px]">{a.title}</span>
              <span className="text-xs whitespace-nowrap" style={{ color: S[a.st].ink }}>{a.eta}</span>
            </span>
            <span className="text-[13px] text-neutral-700 leading-[1.45] text-pretty">{a.text}</span>
            <span className="text-[13px] text-accent-700"><b className="font-medium">Что делать:</b> {a.action}</span>
          </span>
        </button>
      ))}
    </Blueprint>
  );
}
