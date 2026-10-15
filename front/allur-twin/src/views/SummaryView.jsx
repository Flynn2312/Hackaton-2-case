import { useState } from 'react';
import { Blueprint, Segmented } from '../components/ui';
import PeriodPicker from '../components/PeriodPicker';
import ReportMenu from '../components/ReportMenu';
import { brandsOf, usePeriodSummary } from '../lib/period';
import { ECON, NORMS } from '../lib/model';
import { S, fmt1, fmtInt, fmtKzt, pct } from '../lib/format';

// «Сводка»: итоги смены, суток, недели или месяца для руководителя — по моделям выбранной марки.
// Марки берутся из справочника моделей в БД. KPI линии — только в шапке над вкладкой (текущие сутки).
const tone = (good, warn) => (good ? 'g' : warn ? 'y' : 'r');
const defectTone = (v) => tone(v <= NORMS.defect, v <= NORMS.defect * 2);
const ink = (st) => (st === 'g' ? 'var(--color-text)' : S[st].ink);

export default function SummaryView({ model, period, onPeriod }) {
  const sum = usePeriodSummary(model, period);
  const brands = brandsOf(model.history.carModels);
  const [picked, setPicked] = useState(null);
  const brand = brands.includes(picked) ? picked : brands[0];
  const models = sum ? sum.models.filter((m) => m.brand === brand) : [];
  return (
    <main className="px-4 md:px-7 pt-6 pb-10 flex flex-col gap-7 min-w-0">
      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h3>Сводка за период</h3>
            <div className="text-[13px] text-neutral-700">План и факт, качество и простои по моделям · выпуск — на выходе линии{sum?.line.final ? ` (${sum.line.final.name})` : ''}</div>
          </div>
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
            <PeriodPicker value={period} onChange={onPeriod} period={sum?.period} />
            <ReportMenu model={model} sum={sum} brands={brands} brand={brand} />
          </div>
        </div>
        {brands.length > 0 && <Segmented options={brands.map((b) => [b, b])} value={brand} onChange={setPicked} />}
      </section>

      {!sum ? <div className="text-neutral-700">Нет данных за период.</div> : (
        <>
          <Models models={models} brand={brand} sum={sum} />
          <DefectMatrix models={models} brand={brand} lineAreas={sum.lineAreas} />
        </>
      )}
    </main>
  );
}

/* ───────── По моделям ───────── */

function Models({ models, brand, sum }) {
  const { period } = sum;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3>Модели {brand}</h3>
        <div className="text-[13px] text-neutral-700">
          Простой отнесён к модели, которая шла на линии в час остановки · маржа — по ставке команды
          {period.kind === 'month' && ' · месячный план по моделям — из данных кейса'}
        </div>
      </div>
      {models.length === 0 && <div className="text-neutral-700">За период нет выпуска и плана по моделям {brand}.</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
        {models.map((m) => <ModelCard key={m.id} m={m} sum={sum} />)}
      </div>
    </section>
  );
}

function ModelCard({ m, sum }) {
  const plan = m.planTotal || m.planToDate;
  const done = plan ? m.output / plan : 0;
  const toDate = sum.isCurrent && m.planToDate < m.planTotal ? m.planToDate : null;
  const fcSt = m.forecast != null ? tone(m.forecast >= m.target, m.forecast >= m.target * 0.9) : null;
  return (
    <Blueprint className="p-[18px] flex flex-col gap-4 min-w-0">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h4 className="min-w-0 break-words">{m.name}</h4>
        <span className="text-xs text-neutral-700 whitespace-nowrap">{pct(m.share * 100)} выпуска линии</span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-x-2 flex-wrap">
          <span className="num text-[32px] leading-none" style={{ color: ink(m.st) }}>{fmtInt(m.output)}</span>
          <span className="text-[13px] text-neutral-700">из {fmtInt(plan)} по плану{toDate != null && ` · к этому часу ${fmtInt(toDate)}`}</span>
        </div>
        {/* Выполнение плана периода; штрих — план к текущему часу */}
        <div className="relative h-2 rounded-full bg-neutral-200" title={`выполнено ${pct(done * 100)}`}>
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(1, done) * 100}%`, background: S[m.st].fill }} />
          {toDate != null && plan > 0 && <div className="absolute -top-1 -bottom-1 w-0.5 bg-text" style={{ left: `${(toDate / plan) * 100}%` }} />}
        </div>
        {m.target != null && (
          <div className="text-[13px] text-neutral-700">
            План месяца по кейсу <b className="text-text font-medium">{fmtInt(m.target)}</b>
            {m.forecast != null && <> · прогноз <b className="font-medium" style={{ color: ink(fcSt) }}>{fmtInt(m.forecast)}</b> ({sum.remainingDays} раб. дн. осталось)</>}
          </div>
        )}
      </div>

      {sum.period.unit === 'day' && <MiniBars series={m.series} />}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px] border-t border-divider pt-3">
        <Fact label="OEE" value={m.oee != null ? pct(m.oee) : '—'} st={m.oee != null ? tone(m.oee >= NORMS.oee, m.oee >= NORMS.oee - 10) : 'g'} note={`цель ≥ ${NORMS.oee}%`} />
        <Fact label="Брак, худший участок" value={m.worst ? pct(m.worst.defect) : '—'} st={m.worst ? defectTone(m.worst.defect) : 'g'} note={m.worst?.name ?? 'нет данных'} />
        <Fact label="На исправление" value={`${fmtInt(m.defects)} ед.`} note={fmtKzt(m.defectKzt)} />
        <Fact label="Простой при выпуске" value={`${fmtInt(m.stopMin)} мин`} note={fmtKzt(m.stopKzt)} />
        <Fact label="Маржа выпуска" value={fmtKzt(m.marginKzt)} note={`${fmtKzt(ECON.carMarginKzt)} с машины`} />
        <Fact label="Потери на модели" value={fmtKzt(m.defectKzt + m.stopKzt)} note="простой + брак" />
      </dl>
    </Blueprint>
  );
}

function Fact({ label, value, note, st = 'g' }) {
  return (
    <div className="flex flex-col min-w-0">
      <dt className="text-xs text-neutral-700 truncate">{label}</dt>
      <dd className="num text-[17px] leading-tight" style={{ color: ink(st) }}>{value}</dd>
      {note && <dd className="text-[11px] text-neutral-700 truncate">{note}</dd>}
    </div>
  );
}

// Выпуск модели по дням: цвет столбца — выполнение дневного плана этой модели
function MiniBars({ series }) {
  const max = Math.max(1, ...series.map((b) => Math.max(b.actual ?? 0, b.plan ?? 0)));
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-neutral-700">Выпуск по дням</div>
      <div className="flex items-end gap-[2px] h-14 border-b border-text">
        {series.map((b) => {
          const st = b.actual != null && b.plan ? tone(b.actual >= b.plan, b.actual >= b.plan * 0.8) : 'g';
          return (
            <div key={b.key} className="flex-1 h-full flex items-end" title={b.actual != null ? `${b.label}: выпущено ${b.actual}, план ${b.plan}` : `${b.label}: нет выпуска`}>
              {b.actual != null && <div className="w-full rounded-t-[3px] transition-[height] duration-500" style={{ height: `${Math.max(2, (b.actual / max) * 100)}%`, background: S[st].fill }} />}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-neutral-700">
        <span>{series[0]?.label}</span><span>{series[series.length - 1]?.label}</span>
      </div>
    </div>
  );
}

/* ───────── Брак по моделям и участкам ───────── */

function DefectMatrix({ models, brand, lineAreas }) {
  if (!models.length || !lineAreas.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3>Брак по моделям {brand} и участкам</h3>
        <div className="text-[13px] text-neutral-700">Доля брака от выпуска участка · норма ≤ {fmt1(NORMS.defect)}%</div>
      </div>
      <Blueprint className="p-[18px] overflow-x-auto">
        <table className="w-full min-w-[520px] text-[14px] border-separate border-spacing-[2px]">
          <thead>
            <tr className="text-xs text-neutral-700">
              <th className="text-left font-normal pb-2 pr-3">Модель</th>
              {lineAreas.map((a) => <th key={a.id} className="font-normal pb-2 px-2">{a.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td className="font-medium pr-3 py-1 whitespace-nowrap">{m.name}</td>
                {lineAreas.map((a) => {
                  const v = m.defectByArea[a.id];
                  if (v == null) return <td key={a.id} className="text-center text-neutral-600 rounded-md bg-neutral-100 py-2">—</td>;
                  const st = defectTone(v);
                  return (
                    <td key={a.id} className="num text-center rounded-md py-2" title={`${m.name} · ${a.name}: брак ${pct(v)}`}
                      style={{ background: st === 'g' ? 'var(--color-neutral-100)' : S[st].tint, color: ink(st) }}>
                      {pct(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Blueprint>
    </section>
  );
}
