import { useState } from 'react';
import { Blueprint, PageTitle, Slider } from '../components/ui';
import { ECON } from '../lib/model';
import { S, fmt1, fmtInt } from '../lib/format';

export default function RoiView({ model }) {
  const { economy } = model;
  const [capex, setCapex] = useState(85);
  const [opex, setOpex] = useState(20);
  const [share, setShare] = useState(100);

  const total = (economy.total * share) / 100;
  const net = total - opex;
  const paybackDays = net > 0 ? capex / (net / 365) : Infinity;
  const maxRow = Math.max(...economy.rows.map((r) => r.v), 1);
  const cum = Array.from({ length: 13 }, (_, m) => -capex + (net / 12) * m);
  const mx = Math.max(...cum.map(Math.abs), 1);

  const top = [
    { l: 'Годовой эффект', v: `${fmt1(total / 1000)} млрд ₸`, n: `при реализации ${share}%`, ink: 'var(--color-text)' },
    { l: 'Чистый эффект в год', v: `${fmtInt(net)} млн ₸`, n: 'за вычетом OPEX', ink: net > 0 ? 'var(--color-text)' : S.r.ink },
    {
      l: 'Срок окупаемости',
      v: !Number.isFinite(paybackDays) ? 'нет' : paybackDays < 60 ? `${Math.round(paybackDays)} дн.` : `${fmt1(paybackDays / 30)} мес.`,
      n: `CAPEX ${capex} млн ₸`,
      ink: S[paybackDays <= 90 ? 'g' : paybackDays <= 365 ? 'y' : 'r'].ink,
    },
    { l: 'ROI за год', v: `${fmtInt(((net - capex) / capex) * 100)}%`, n: '(эффект − затраты) / CAPEX', ink: 'var(--color-text)' },
  ];

  return (
    <main className="px-7 pt-6 pb-10 flex flex-col gap-6">
      <PageTitle
        title="Экономический эффект"
        sub={`Калькулятор окупаемости внедрения · база — фактические простои, брак и недовыпуск за ${economy.windowDays} раб. дней из БД, пересчитанные на год`}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-l border-divider">
        {top.map((r) => (
          <div key={r.l} className="px-[18px] py-4 border-r border-b border-divider">
            <div className="text-xs text-neutral-700">{r.l}</div>
            <div className="num text-[38px] leading-[1.1] whitespace-nowrap" style={{ color: r.ink }}>{r.v}</div>
            <div className="text-xs text-neutral-700">{r.n}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-7 items-start">
        <Blueprint className="p-5 flex flex-col gap-5">
          <h4>Параметры</h4>
          <Slider label="CAPEX" value={capex} display={`${capex} млн ₸`} min={40} max={200} step={5} onChange={setCapex} hint="OPC UA шлюзы, датчики вибрации и температуры, интеграция" />
          <Slider label="OPEX в год" value={opex} display={`${opex} млн ₸`} min={5} max={60} onChange={setOpex} />
          <Slider label="Реализация эффекта" value={share} display={`${share}%`} min={10} max={100} step={5} onChange={setShare} hint="Консервативная оценка — доля расчётного эффекта, достигнутая на практике" />
          <div className="text-[11px] text-neutral-700 leading-[1.5] border-t border-divider pt-3">
            Допущения: минута простоя — {fmtInt(ECON.downtimeMinKzt)} ₸, исправление дефекта — {fmtInt(ECON.defectKzt)} ₸,
            маржинальный доход с авто — {fmtInt(ECON.carMarginKzt)} ₸, {ECON.workDaysYear} рабочих дней в году.
          </div>
        </Blueprint>

        <Blueprint className="p-5 flex flex-col gap-4">
          <h4>Структура годового эффекта</h4>
          {economy.rows.map((r) => (
            <div key={r.key} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_120px] gap-4 items-center">
              <div className="flex flex-col"><span className="text-sm">{r.l}</span><span className="text-xs text-neutral-700">{r.phys}</span></div>
              <div className="h-3.5 bg-neutral-200"><div className="h-full bg-accent" style={{ width: `${(r.v / maxRow) * 100}%` }} /></div>
              <div className="num text-xl text-right whitespace-nowrap">{fmtInt((r.v * share) / 100)} млн ₸</div>
            </div>
          ))}
          <div className="flex flex-col gap-2 mt-2">
            <div className="text-[13px] text-neutral-700">Накопленный денежный поток, первые 12 месяцев · млн ₸</div>
            <div className="flex gap-1.5 h-[150px]">
              {cum.map((v, m) => (
                <div key={m} className="flex-1 flex flex-col" title={`${m === 0 ? 'старт' : `M${m}`}: ${fmtInt(v)} млн ₸`}>
                  <div className="flex-[4] flex items-end"><div className="w-full" style={{ height: v > 0 ? `${(v / mx) * 100}%` : 0, background: S.g.fill }} /></div>
                  <div className="h-px bg-text" />
                  <div className="flex-1 flex items-start"><div className="w-full" style={{ height: v < 0 ? `${Math.min(100, (-v / capex) * 100)}%` : 0, background: S.r.fill }} /></div>
                </div>
              ))}
            </div>
            <div className="flex gap-1.5">
              {cum.map((_, m) => <span key={m} className="flex-1 text-center text-[10px] text-neutral-700">{m === 0 ? 'старт' : `M${m}`}</span>)}
            </div>
          </div>
        </Blueprint>
      </div>
    </main>
  );
}
