import { useEffect, useRef, useState } from 'react';
import PeriodPicker from '../components/PeriodPicker';
import { usePeriodSummary } from '../lib/period';
import { ECON } from '../lib/model';
import { S, fmt1, fmtInt, fmtKzt, fmtTime } from '../lib/format';

// «Финансы»: сколько линия теряет прямо сейчас и куда уходят деньги по участкам за выбранный период.
// KPI в тенге за текущие сутки выводятся в общей строке KPI над вкладкой (App.jsx).
// Полосы «Куда уходят деньги»: простой — тёмный, брак — серый; самый дорогой участок — красным
const DOWNTIME = '#232323';
const DEFECT = '#c9c9c9';
const LEAD = 'var(--color-brand)';
const LEAD_DEFECT = '#f4aaa5';
// Подпись куска: млн с одним знаком, мелкие суммы — в тысячах
const short = (v) => (v >= 1e6 ? `${fmt1(v / 1e6)} млн` : `${fmtInt(v / 1e3)} тыс.`);
// Подпись пишем, только если целиком влезает в кусок: ~6,2 px на символ 12px/600 + отступы 20 px
const fits = (text, px) => px >= text.length * 6.2 + 20;

// Ширина дорожки полосы (у всех строк одинаковая) — от неё зависит, влезает ли подпись
function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export default function FinanceView({ model, simNow, period, onPeriod, onOpenDecision }) {
  const sum = usePeriodSummary(model, period);
  return (
    <main className="px-4 md:px-7 pt-6 pb-10 flex flex-col gap-7 min-w-0">
      <LiveLoss stops={model.finance.stops} anchor={model.anchor} simNow={simNow} pending={model.pendingDecisions.length} onOpenDecision={onOpenDecision} />
      <AreaLosses finance={sum?.finance ?? model.finance} sum={sum} period={period} onPeriod={onPeriod} />
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
      <section className="bg-bg rounded-2xl px-4 sm:px-6 py-5 flex items-center gap-5 flex-wrap shadow-[var(--shadow-card)] opacity-60">
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
    <section className="bg-bg rounded-2xl border px-4 sm:px-6 py-5 flex gap-x-10 gap-y-4 flex-wrap shadow-[var(--shadow-card)]" style={{ borderColor: S.r.fill }}>
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-[13px]" style={{ color: S.r.ink }}>
          <span className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: S.r.fill }} />Линия теряет сейчас
        </span>
        <span className="num text-[32px] sm:text-[40px] leading-[1.05] break-all" style={{ color: S.r.ink }}>{fmtInt(lost)} ₸</span>
        <span className="text-xs text-neutral-700">{fmtInt(rate)} ₸ за минуту завода</span>
      </div>
      <div className="flex-1 min-w-0 basis-[260px] flex flex-col justify-center gap-2">
        {stops.map((x) => (
          <div key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[14px] border-t border-divider pt-2 first:border-t-0 first:pt-0">
            <span><b className="font-medium">{x.name}</b> · {x.area} — {x.reason.toLowerCase()}, стоит с {fmtTime(x.startedAt)}</span>
            <span className="text-xs text-neutral-700 whitespace-nowrap">{fmtInt(x.rate)} ₸/мин</span>
          </div>
        ))}
      </div>
      {pending > 0 && (
        <button type="button" className="btn btn-primary self-center w-full sm:w-auto" onClick={() => onOpenDecision()}>Выбрать решение</button>
      )}
    </section>
  );
}

/* ───────── Куда уходят деньги ───────── */

function AreaLosses({ finance, sum, period, onPeriod }) {
  const max = Math.max(...finance.areas.map((a) => a.total), 1);
  const top = finance.total > 0 ? [...finance.areas].sort((a, b) => b.total - a.total)[0] : null;
  const [trackRef, trackW] = useWidth();
  const label = (text, v) => (fits(text, (v / max) * trackW) ? text : '');
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h3>Куда уходят деньги</h3>
          <div className="text-[13px] text-neutral-700">Прямые потери участков за период</div>
        </div>
        <PeriodPicker value={period} onChange={onPeriod} period={sum?.period} />
      </div>

      <div className="flex items-end justify-between gap-x-6 gap-y-2 flex-wrap">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-neutral-700">
          <span>Итого <b className="num text-[22px] text-text">{fmtKzt(finance.total)}</b></span>
          <span>простой {fmtKzt(finance.downtime)} · {fmtInt(finance.stopMin ?? 0)} мин</span>
          <span>брак и доработка {fmtKzt(finance.defect)} · {fmtInt(finance.defects ?? 0)} ед.</span>
          {finance.applied > 0 && (
            <span>эффект решений ИИ <b className="font-medium" style={{ color: finance.aiEffect < 0 ? S.y.ink : S.g.ink }}>{finance.aiEffect > 0 ? '+' : finance.aiEffect < 0 ? '−' : ''}{fmtKzt(Math.abs(finance.aiEffect))}</b> ({finance.applied})</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-700 [&>span]:whitespace-nowrap">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: DOWNTIME }} />простой</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: DEFECT }} />брак и доработка</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: LEAD }} />самый дорогой участок</span>
        </div>
      </div>

      <div className="bg-bg rounded-[14px] px-4 sm:px-6 py-1 sm:py-3 flex flex-col">
        {finance.areas.map((a, i) => {
          const lead = a.id === top?.id;
          const both = a.downtimeKzt > 0 && a.defectKzt > 0;
          const dtW = (a.downtimeKzt / max) * 100;
          const dfW = (a.defectKzt / max) * 100;
          const dtLabel = label(`простой ${short(a.downtimeKzt)}`, a.downtimeKzt);
          const dfLabel = label(`брак ${short(a.defectKzt)}`, a.defectKzt);
          return (
            <div
              key={a.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(160px,230px)_minmax(0,1fr)_130px] items-center gap-x-4 gap-y-2 py-3.5 border-b border-[#f0f0f0] last:border-b-0"
            >
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[15px] font-semibold break-words transition-colors duration-300" style={{ color: lead ? LEAD : undefined }}>{a.name}</span>
                <span className="text-xs text-[#888]">
                  {a.total ? [a.downtimeMin && `${fmtInt(a.downtimeMin)} мин простоя`, a.defects && `брак ${fmtInt(a.defects)} ед.`].filter(Boolean).join(' · ') : 'без потерь'}
                </span>
              </span>
              <span
                ref={i === 0 ? trackRef : undefined}
                className="col-span-2 sm:col-span-1 order-last sm:order-none flex h-[30px] rounded-md overflow-hidden bg-[#f4f4f4]"
                title={`простой ${fmtKzt(a.downtimeKzt)} · брак ${fmtKzt(a.defectKzt)}`}
              >
                <span
                  className="flex items-center overflow-hidden whitespace-nowrap text-xs font-semibold text-white transition-[width,background-color] duration-500"
                  style={{ width: `${dtW}%`, background: lead ? LEAD : DOWNTIME, paddingLeft: dtLabel ? 10 : 0 }}
                >
                  {dtLabel}
                </span>
                <span
                  className="flex items-center overflow-hidden whitespace-nowrap text-xs font-semibold text-[#1d1d1f] transition-[width,background-color] duration-500"
                  style={{ width: both ? `calc(${dfW}% - 2px)` : `${dfW}%`, marginLeft: both ? 2 : 0, background: lead ? LEAD_DEFECT : DEFECT, paddingLeft: dfLabel ? 10 : 0 }}
                >
                  {dfLabel}
                </span>
              </span>
              <span className="num text-[17px] sm:text-[19px] text-right whitespace-nowrap transition-colors duration-300" style={{ color: !a.total ? '#aaa' : lead ? LEAD : '#1d1d1f' }}>{fmtKzt(a.total)}</span>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-neutral-700">
        Минута простоя линии — {fmtInt(ECON.downtimeMinKzt)} ₸ (уже включает упущенную маржу, поэтому недовыпуск отдельно не прибавляется),
        исправление кузова — {fmtInt(ECON.defectKzt)} ₸. Ставки — допущения команды, уточняются на пилоте.
      </div>
    </section>
  );
}
