import { useState } from 'react';
import { Blueprint, PageTitle, Slider } from '../components/ui';
import { ECON, NORMS } from '../lib/model';
import { S, fmt1, fmtInt, pct, sgn } from '../lib/format';

const round05 = (v) => Math.round(v * 2) / 2;

// Сценарная модель: базовая линия — факт последних суток из БД, рычаги меняют её
function simulate(b, st) {
  const baseOee = round05(b.bottleneck?.oee ?? NORMS.oee);
  let dOut = 0;

  // Рычаг 1: устранение причины брака на худшем по качеству участке
  const d = b.defectArea;
  const defect = d ? (st.quality ? Math.min(d.defect, NORMS.defect * 0.65) : d.defect) : 0;
  const defectsCut = d && d.defect ? (d.scrap + d.rework) * (1 - defect / d.defect) : 0;
  dOut += defectsCut * 0.5;

  // Рычаг 2: превентивное ТО оборудования с растущими простоями
  const m = b.maintEq;
  const recoveredMin = m && st.maint ? m.avgPerDay * 0.8 : 0;
  dOut += recoveredMin / b.taktMin;
  const downtime = Math.max(0, b.critDowntime - (m?.critical ? recoveredMin : 0));

  // Ползунок OEE узкого места
  dOut += (b.plan * (st.oee - baseOee)) / 100;

  // Буфер перед узким местом гасит простои выше по потоку
  const starv = Math.max(0, b.starvation - (st.buf - NORMS.bufferMin) * b.taktMin);
  dOut += ((b.starvation - starv) / b.taktMin) * 0.5;

  const out = b.output + dOut;
  const month = b.monthForecast + dOut * b.remainingDays;
  const effect = (((b.critDowntime - downtime) + (m && !m.critical ? recoveredMin : 0) + (b.starvation - starv)) * ECON.downtimeMinKzt
    + defectsCut * ECON.defectKzt + Math.max(0, (st.oee - baseOee) / 100 * b.plan) * ECON.carMarginKzt) * ECON.workDaysYear / 1e6;
  return { baseOee, dOut, out, defect, downtime, starv, month, effect };
}

export default function WhatIfView({ model, preset }) {
  const b = model.whatIfBase;
  const baseOee = round05(b.bottleneck?.oee ?? NORMS.oee);
  const initial = { quality: false, maint: false, oee: baseOee, buf: NORMS.bufferMin };
  const [st, setSt] = useState(() => {
    if (!preset) return initial;
    return {
      ...initial,
      quality: preset.areaId === b.defectArea?.id,
      maint: preset.areaId === b.maintEq?.areaId,
      oee: preset.areaId === b.bottleneck?.id ? Math.max(baseOee, NORMS.oee) : baseOee,
    };
  });
  const set = (patch) => setSt((s) => ({ ...s, ...patch }));
  const r = simulate(b, st);
  const tone = (good, warn) => (good ? 'g' : warn ? 'y' : 'r');

  const levers = [
    b.defectArea && {
      k: 'quality', title: `Устранить причину брака: ${b.defectArea.name}`,
      text: `Брак ${pct(b.defectArea.defect)} при норме ≤ ${fmt1(NORMS.defect)}% · калибровка оборудования и контроль параметров процесса`,
    },
    b.maintEq && {
      k: 'maint', title: `Превентивное ТО: ${b.maintEq.name}`,
      text: `В среднем ${Math.round(b.maintEq.avgPerDay)} мин внеплановых простоев в сутки${b.maintEq.reason ? `, чаще всего — «${b.maintEq.reason}»` : ''} · ТО в пересменку`,
    },
  ].filter(Boolean);

  const O = (l, v, base, norm, delta, s, better) => ({ l, v, base, norm, delta, s, better });
  const out = [
    O('Выпуск за сутки', `${Math.round(r.out)} авто`, fmtInt(b.output), `план ${fmtInt(b.plan)}`, Math.round(r.dOut) ? sgn(r.dOut) : '—', tone(r.out >= b.plan, r.out >= b.plan * 0.95), Math.round(r.dOut) ? r.dOut > 0 : null),
    O(`Брак · ${b.defectArea?.name ?? '—'}`, pct(r.defect), pct(b.defectArea?.defect ?? 0), `норма ≤ ${fmt1(NORMS.defect)}%`, st.quality ? `${sgn(r.defect - (b.defectArea?.defect ?? 0), fmt1)} п.п.` : '—', tone(r.defect <= NORMS.defect, r.defect <= NORMS.defect * 2), st.quality ? true : null),
    O('Простой крит. оборуд.', `${Math.round(r.downtime)} мин`, `${b.critDowntime} мин`, `норма ≤ ${NORMS.critDowntime}`, Math.round(r.downtime) !== b.critDowntime ? `${sgn(r.downtime - b.critDowntime)} мин` : '—', tone(r.downtime <= NORMS.critDowntime * 0.75, r.downtime <= NORMS.critDowntime), Math.round(r.downtime) !== b.critDowntime ? true : null),
    O(`Голодание · ${b.bottleneck?.name ?? 'линия'}`, `${Math.round(r.starv)} мин`, `${b.starvation} мин`, 'норма ≤ 10', Math.round(r.starv) !== b.starvation ? `${sgn(r.starv - b.starvation)} мин` : '—', tone(r.starv <= 10, r.starv <= 30), Math.round(r.starv) !== b.starvation ? r.starv < b.starvation : null),
    O('Прогноз месяца', `${fmtInt(r.month)} авто`, fmtInt(b.monthForecast), `план ≥ ${fmtInt(b.monthPlan)}`, Math.round(r.dOut * b.remainingDays) ? sgn(r.dOut * b.remainingDays) : '—', tone(r.month >= b.monthPlan, r.month >= b.monthPlan * 0.93), Math.round(r.dOut) ? r.dOut > 0 : null),
    O('Годовой эффект', `${fmtInt(r.effect)} млн ₸`, '0', `${ECON.workDaysYear} раб. дней`, r.effect > 0.5 ? '+' : '—', r.effect > 0.5 ? 'g' : 'y', r.effect > 0.5 ? true : null),
  ];
  const planPct = (r.month / b.monthPlan) * 100;
  const basePct = Math.min(100, (b.monthForecast / b.monthPlan) * 100);

  return (
    <main className="px-7 pt-6 pb-10 flex flex-col gap-6">
      <PageTitle title="Сценарный тренажёр What-If" sub="Включите управленческие действия — двойник пересчитает выпуск, простои, брак и эффект от фактических данных последних суток" />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-7 items-start">
        <Blueprint className="p-5 flex flex-col gap-[22px]">
          <h4>Действия</h4>
          {levers.map((lv) => (
            <button key={lv.k} type="button" onClick={() => set({ [lv.k]: !st[lv.k] })} className="grid grid-cols-[22px_minmax(0,1fr)] gap-3 text-left bg-transparent p-0">
              <span
                className="w-5 h-5 mt-0.5 flex items-center justify-center text-[13px] text-bg"
                style={{ border: `1.5px solid ${st[lv.k] ? 'var(--color-accent)' : 'var(--color-neutral-500)'}`, background: st[lv.k] ? 'var(--color-accent)' : 'transparent' }}
              >
                {st[lv.k] ? '✓' : ''}
              </span>
              <span className="flex flex-col gap-[3px]">
                <span className="font-medium">{lv.title}</span>
                <span className="text-xs text-neutral-700 leading-[1.45]">{lv.text}</span>
              </span>
            </button>
          ))}
          {b.bottleneck && (
            <Slider
              label={`OEE узкого места · ${b.bottleneck.name}`}
              value={st.oee}
              display={`${fmt1(st.oee)}%`}
              min={Math.min(75, baseOee)}
              max={95}
              step={0.5}
              onChange={(v) => set({ oee: v })}
              marks={[Math.min(75, baseOee), `факт ${fmt1(baseOee)}`, `норма ${NORMS.oee}`, 95]}
            />
          )}
          <Slider
            label="Мин. буфер перед узким местом"
            value={st.buf}
            display={`${st.buf} шт`}
            min={4}
            max={16}
            onChange={(v) => set({ buf: v })}
            hint="Больше буфер — меньше голодание участка, но выше НЗП и lead time"
          />
          <div className="flex gap-2.5 flex-wrap">
            <button type="button" className="btn btn-primary" onClick={() => set({ quality: true, maint: true, oee: Math.max(baseOee, NORMS.oee), buf: 12 })}>Оптимальный сценарий</button>
            <button type="button" className="btn btn-secondary" onClick={() => setSt(initial)}>Сбросить</button>
          </div>
        </Blueprint>

        <section className="grid grid-cols-2 border-t border-l border-divider">
          {out.map((o) => (
            <div key={o.l} className="px-[18px] py-4 border-r border-b border-divider flex flex-col gap-1 min-w-0">
              <div className="flex justify-between gap-2 text-xs">
                <span className="text-neutral-700 truncate">{o.l}</span>
                <span className="font-medium whitespace-nowrap" style={{ color: o.better == null ? 'var(--color-neutral-700)' : o.better ? S.g.ink : S.r.ink }}>{o.delta}</span>
              </div>
              <div className="num text-[36px] leading-[1.1] whitespace-nowrap" style={{ color: S[o.s].ink }}>{o.v}</div>
              <div className="text-xs text-neutral-700">было {o.base} · {o.norm}</div>
            </div>
          ))}
          <div className="col-span-2 px-[18px] py-4 border-r border-b border-divider flex flex-col gap-2">
            <div className="flex justify-between text-[13px]"><span>Месячный план {fmtInt(b.monthPlan)} авто</span><b>{Math.round(planPct)}%</b></div>
            <div className="h-2.5 bg-neutral-200 relative">
              <div className="h-full" style={{ width: `${Math.min(100, planPct)}%`, background: S[tone(r.month >= b.monthPlan, r.month >= b.monthPlan * 0.93)].fill }} />
              <div className="absolute -top-1 -bottom-1 w-px bg-text" style={{ left: `${basePct}%` }} />
            </div>
            <div className="text-[11px] text-neutral-700">Отметка — текущий прогноз {fmtInt(b.monthForecast)} · осталось {b.remainingDays} раб. дней</div>
          </div>
        </section>
      </div>
    </main>
  );
}
