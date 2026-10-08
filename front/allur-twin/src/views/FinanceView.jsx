import { useEffect, useState } from 'react';
import { Blueprint } from '../components/ui';
import { ECON } from '../lib/model';
import { S, fmtDayLong, fmtInt, fmtKzt, fmtTime } from '../lib/format';

// «Финансы»: сколько линия теряет прямо сейчас и куда уходят деньги по участкам за сутки.
// KPI в тенге выводятся в общей строке KPI над вкладкой (App.jsx).
const DOWNTIME = 'var(--color-accent-800)';
const DEFECT = 'var(--color-accent-400)';

export default function FinanceView({ model, simNow, onOpen, onOpenDecision }) {
  return (
    <main className="px-7 pt-6 pb-10 flex flex-col gap-7">
      <LiveLoss stops={model.finance.stops} anchor={model.anchor} simNow={simNow} pending={model.pendingDecisions.length} onOpenDecision={onOpenDecision} />
      <AreaLosses finance={model.finance} day={model.day} onOpen={onOpen} />
    </main>
  );
}

/* ───────── Линия теряет сейчас ───────── */

function LiveLoss({ stops, anchor, simNow, pending, onOpenDecision }) {
  const active = stops.length > 0;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);

  const now = simNow?.() ?? anchor;
  const rate = stops.reduce((s, x) => s + x.rate, 0);
  const lost = stops.reduce((s, x) => s + Math.max(0, (now - x.startedAt) / 60000) * x.rate, 0);

  if (!active) {
    return (
      <section className="bg-bg rounded-2xl px-6 py-5 flex items-center gap-5 flex-wrap shadow-[var(--shadow-card)] opacity-60">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-[13px] text-neutral-700">
            <span className="w-2 h-2 rounded-full bg-neutral-400" />Линия теряет сейчас
          </span>
          <span className="num text-[40px] leading-[1.05] text-neutral-600">0 ₸</span>
        </div>
        <span className="text-[15px] text-neutral-700">✓ Остановок нет, линия работает без потерь</span>
      </section>
    );
  }

  return (
    <section className="bg-bg rounded-2xl border px-6 py-5 flex gap-x-10 gap-y-4 flex-wrap shadow-[var(--shadow-card)]" style={{ borderColor: S.r.fill }}>
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-[13px]" style={{ color: S.r.ink }}>
          <span className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: S.r.fill }} />Линия теряет сейчас
        </span>
        <span className="num text-[40px] leading-[1.05]" style={{ color: S.r.ink }}>{fmtInt(lost)} ₸</span>
        <span className="text-xs text-neutral-700">{fmtInt(rate)} ₸ за минуту завода</span>
      </div>
      <div className="flex-1 min-w-[260px] flex flex-col justify-center gap-2">
        {stops.map((x) => (
          <div key={x.id} className="flex items-baseline justify-between gap-4 text-[14px] border-t border-divider pt-2 first:border-t-0 first:pt-0">
            <span><b className="font-medium">{x.name}</b> · {x.area} — {x.reason.toLowerCase()}, стоит с {fmtTime(x.startedAt)}</span>
            <span className="text-xs text-neutral-700 whitespace-nowrap">{fmtInt(x.rate)} ₸/мин</span>
          </div>
        ))}
      </div>
      {pending > 0 && (
        <button type="button" className="btn btn-primary self-center" onClick={() => onOpenDecision()}>Выбрать решение</button>
      )}
    </section>
  );
}

/* ───────── Куда уходят деньги ───────── */

function AreaLosses({ finance, day, onOpen }) {
  const max = Math.max(...finance.areas.map((a) => a.total), 1);
  const top = finance.total > 0 ? [...finance.areas].sort((a, b) => b.total - a.total)[0] : null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h3>Куда уходят деньги</h3>
          <div className="text-[13px] text-neutral-700">Прямые потери участков за сутки · нажмите на участок, чтобы увидеть подробности · данные на {fmtDayLong(day)}</div>
        </div>
        <div className="flex gap-4 text-xs text-neutral-700">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5" style={{ background: DOWNTIME }} />простой</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5" style={{ background: DEFECT }} />брак и доработка</span>
        </div>
      </div>

      <Blueprint className="p-[18px] flex flex-col">
        {finance.areas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a.id)}
            className="grid grid-cols-[minmax(140px,200px)_minmax(0,1fr)_110px] items-center gap-4 text-left border-t border-divider first:border-t-0 py-3 hover:bg-neutral-100 transition-colors"
          >
            <span className="flex flex-col">
              <span className="flex items-center gap-2 font-medium text-[15px]">
                {a.name}
                {a.id === top?.id && <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-brand text-white">больше всего</span>}
              </span>
              <span className="text-xs text-neutral-700">
                {a.total ? [a.downtimeMin && `${fmtInt(a.downtimeMin)} мин простоя`, a.defects && `брак ${fmtInt(a.defects)} ед.`].filter(Boolean).join(' · ') : 'без потерь'}
              </span>
            </span>
            <span className="flex h-3 rounded-full overflow-hidden bg-neutral-200" title={`простой ${fmtKzt(a.downtimeKzt)} · брак ${fmtKzt(a.defectKzt)}`}>
              <span className="transition-[width] duration-500" style={{ width: `${(a.downtimeKzt / max) * 100}%`, background: DOWNTIME }} />
              <span className="transition-[width] duration-500" style={{ width: `${(a.defectKzt / max) * 100}%`, background: DEFECT }} />
            </span>
            <span className="num text-lg text-right whitespace-nowrap" style={{ color: a.total ? 'var(--color-text)' : 'var(--color-neutral-600)' }}>{fmtKzt(a.total)}</span>
          </button>
        ))}
      </Blueprint>

      <div className="text-xs text-neutral-700">
        Минута простоя линии — {fmtInt(ECON.downtimeMinKzt)} ₸ (уже включает упущенную маржу, поэтому недовыпуск отдельно не прибавляется),
        исправление кузова — {fmtInt(ECON.defectKzt)} ₸. Ставки — допущения команды, уточняются на пилоте.
      </div>
    </section>
  );
}
