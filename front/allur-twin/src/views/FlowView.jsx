import { useState } from 'react';
import { Blueprint, Legend, PageTitle, Segmented, StatusTag } from '../components/ui';
import LivePlantFlow from '../components/LivePlantFlow';
import { S, fmtDayLong, fmtInt } from '../lib/format';

const VARIANTS = [['cards', 'Карточки'], ['matrix', 'Матрица'], ['plan', 'План цеха']];
const DIM = 'var(--color-neutral-700)';

const mainInk = (a) => (a.main.st === 'g' ? 'var(--color-text)' : S[a.main.st].ink);
const alertInk = (a) => (a.alert.st === 'n' ? DIM : S[a.alert.st].ink);
const ctText = (a) => (a.ct ? `${Math.round(a.ct)} с` : '—');
const upText = (a) => (a.hasRec ? `${Math.round(a.A * 100)}%` : '—');
const oeeText = (a) => (a.hasRec ? `${Math.round(a.oee)}%` : '—');

export default function FlowView({ model, onOpen, onOpenEquipment, variant: initial = 'cards' }) {
  const [variant, setVariant] = useState(initial);
  const { areas } = model;

  return (
    <main className="px-7 pt-6 pb-10 flex flex-col gap-7">
      {/* Живой завод: Сквозной поток + 30-секундный интерактивный симулятор */}
      <LivePlantFlow model={model} onOpenArea={onOpen} onOpenEquipment={onOpenEquipment} />

      <PageTitle
        title="Детализация участков потока"
        sub={`${areas.map((a) => a.name).join(' → ')} · данные на ${fmtDayLong(model.day)} · выберите вид отображения`}
      >
        <div className="flex items-center gap-5 flex-wrap">
          <Legend />
          <Segmented options={VARIANTS} value={variant} onChange={setVariant} />
        </div>
      </PageTitle>

      {variant === 'cards' && <Cards areas={areas} onOpen={onOpen} onOpenEquipment={onOpenEquipment} />}
      {variant === 'matrix' && <Matrix areas={areas} onOpen={onOpen} />}
      {variant === 'plan' && <Plan areas={areas} onOpen={onOpen} onOpenEquipment={onOpenEquipment} />}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-7">
        <HourlyChart model={model} />
        <Alerts model={model} onOpen={onOpen} />
      </div>
    </main>
  );
}

function Buffer({ area }) {
  const b = area.buffer;
  return (
    <div className="w-[62px] flex-[0_0_62px] flex flex-col items-center justify-center gap-1">
      {b ? (
        <>
          <div style={{ width: 0, height: 0, borderLeft: '15px solid transparent', borderRight: '15px solid transparent', borderBottom: `24px solid ${S[b.st].fill}` }} />
          <div className="num text-xl" style={{ color: S[b.st].ink }}>{b.value}</div>
          <div className="text-[10px] text-neutral-700 text-center leading-[1.2]">{b.note}</div>
        </>
      ) : (
        <div className="text-[10px] text-neutral-700 text-center leading-[1.2]">—<br />нет учёта</div>
      )}
      <div className="text-base text-neutral-500">→</div>
    </div>
  );
}

function Cards({ areas, onOpen, onOpenEquipment }) {
  return (
    <div className="overflow-x-auto p-2 pb-3 -m-2 mb-0">
      <div className="flex items-stretch" style={{ minWidth: areas.length * 243 }}>
        {areas.map((a) => (
          <div key={a.id} className="flex items-stretch flex-1 min-w-0">
            <button
              type="button"
              onClick={() => onOpen(a.id)}
              className="blueprint flex-1 min-w-[190px] text-left bg-transparent p-0 flex flex-col hover:bg-neutral-100"
              style={{ borderColor: S[a.st].frame }}
            >
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <div className="h-1.5" style={{ background: S[a.st].fill }} />
              <div className="px-3.5 py-3 flex flex-col gap-1">
                <div className="flex justify-between items-center gap-1.5">
                  <span className="text-[11px] tracking-[.08em] text-neutral-700">{String(a.sequence).padStart(2, '0')} · {a.code}</span>
                  <StatusTag st={a.st} />
                </div>
                <div className="font-heading font-semibold text-[21px] leading-[1.15]">{a.name}</div>
                <div className="text-xs text-neutral-700 min-h-9 text-pretty">{a.sub}</div>
              </div>
              <div className="px-3.5 py-2.5 border-t border-divider">
                <div className="text-xs text-neutral-700">{a.main.label}</div>
                <div className="num text-[28px] leading-[1.1] whitespace-nowrap" style={{ color: mainInk(a) }}>{a.main.value}</div>
                <div className="text-xs text-neutral-700">{a.main.norm}</div>
              </div>
              <div className="grid grid-cols-3 border-t border-divider">
                {[['C/T', ctText(a)], ['UPTIME', upText(a)], ['OEE', oeeText(a)]].map(([l, v], i) => (
                  <div key={l} className={`px-2.5 py-2 ${i < 2 ? 'border-r border-divider' : ''}`}>
                    <div className="text-[10px] tracking-[.06em] text-neutral-700">{l}</div>
                    <div className="text-sm font-medium">{v}</div>
                  </div>
                ))}
              </div>
              <div className="px-3.5 py-1.5 border-t border-divider flex items-center justify-between text-[11px] text-neutral-600 bg-neutral-100/40">
                <span>Оборудование ({a.units.length}):</span>
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  {a.units.slice(0, 4).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => { if (onOpenEquipment) onOpenEquipment(u, a); }}
                      title={`${u.name} (паспорт)`}
                      className="w-3.5 h-3.5 hover:scale-125 transition-transform cursor-pointer"
                      style={{ background: S[u.st].fill }}
                    />
                  ))}
                  {a.units.length > 4 && <span className="text-[10px]">+{a.units.length - 4}</span>}
                </div>
              </div>
              <div className="px-3.5 py-2.5 border-t border-divider text-xs leading-[1.4] mt-auto min-h-14 text-pretty" style={{ color: alertInk(a) }}>{a.alert.text}</div>
            </button>
            {a.hasNext && <Buffer area={a} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function Matrix({ areas, onOpen }) {
  const cell = (v, st, big) => ({ v, st, big });
  const rows = [
    ['Статус', areas.map((a) => cell(S[a.st].l, a.st))],
    ['Ключевой показатель', areas.map((a) => ({ ...cell(a.main.value, a.main.st, true), sub: a.main.label }))],
    ['Норма', areas.map((a) => cell(a.main.norm))],
    ['Время цикла C/T', areas.map((a) => cell(ctText(a)))],
    ['Uptime', areas.map((a) => cell(upText(a), a.hasRec && a.A < 0.9 ? 'y' : null))],
    ['OEE', areas.map((a) => cell(oeeText(a), a.hasRec && a.oee < 85 ? 'y' : null))],
    ['Простой за сутки', areas.map((a) => cell(`${a.downtimeMin} мин`, a.downtimeMin > 60 ? 'y' : null))],
    ['Буфер на выходе', areas.map((a) => cell(a.buffer ? `${a.buffer.value} ${a.buffer.note}` : a.hasNext ? '—' : 'отгрузка', a.buffer?.st))],
    ['Событие', areas.map((a) => cell(a.alert.text, a.alert.st === 'n' ? null : a.alert.st))],
  ];
  return (
    <div className="overflow-x-auto p-2 -m-2">
      <Blueprint as="div" className="grid" style={{ gridTemplateColumns: `170px repeat(${areas.length}, minmax(150px, 1fr))`, minWidth: 170 + areas.length * 155 }}>
        <div className="px-3.5 py-3 border-b border-divider text-[11px] tracking-[.08em] uppercase text-neutral-700">Показатель</div>
        {areas.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a.id)}
            className="text-left bg-transparent border-l border-b border-divider px-3.5 py-2.5 flex flex-col gap-0.5 hover:bg-neutral-100"
            style={{ borderTop: `6px solid ${S[a.st].fill}` }}
          >
            <span className="text-[11px] text-neutral-700">{a.code} · {a.step}</span>
            <span className="font-heading font-semibold text-[19px] leading-[1.15]">{a.name}</span>
          </button>
        ))}
        {rows.map(([label, cells]) => (
          <Row key={label} label={label} cells={cells} />
        ))}
      </Blueprint>
    </div>
  );
}

function Row({ label, cells }) {
  return (
    <>
      <div className="px-3.5 py-3 border-b border-divider text-[13px] text-neutral-800 flex items-center">{label}</div>
      {cells.map((c, i) => {
        const dev = c.st && c.st !== 'g';
        return (
          <div
            key={i}
            className={`px-3.5 py-3 border-l border-b border-divider flex items-center leading-[1.35] text-pretty ${c.big ? 'num text-[22px]' : 'text-[13px]'}`}
            style={{ background: dev ? S[c.st].tint : 'transparent', color: dev ? S[c.st].ink : 'var(--color-text)' }}
          >
            {c.sub ? <span className="flex flex-col"><span className="font-body font-normal text-[11px] opacity-80">{c.sub}</span>{c.v}</span> : c.v}
          </div>
        );
      })}
    </>
  );
}

// «Змейка»: верхний ряд слева направо, нижний — справа налево. Число колонок — из числа участков.
function Plan({ areas, onOpen, onOpenEquipment }) {
  const cols = Math.max(1, Math.ceil(areas.length / 2));
  const pos = areas.map((_, i) => (i < cols ? [i * 2 + 1, 1] : [(cols - 1 - (i - cols)) * 2 + 1, 3]));
  const template = Array.from({ length: cols }, () => 'minmax(230px,1fr)').join(' 56px ');
  return (
    <div className="overflow-x-auto">
      <div className="grid" style={{ gridTemplateColumns: template, gridTemplateRows: 'auto 56px auto', minWidth: cols * 286 }}>
        {areas.map((a, i) => {
          const [c, r] = pos[i];
          const next = pos[i + 1];
          return [
            <button
              key={`s${a.id}`}
              type="button"
              onClick={() => onOpen(a.id)}
              className="blueprint text-left bg-transparent p-4 flex flex-col gap-3 hover:bg-neutral-100"
              style={{ gridColumn: c, gridRow: r, borderColor: S[a.st].frame }}
            >
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <div className="flex justify-between items-start gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] tracking-[.08em] text-neutral-700">{a.code} · {a.units.length} ед. оборудования</span>
                  <span className="font-heading font-semibold text-2xl leading-[1.1]">{a.name}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="num text-[30px] leading-none whitespace-nowrap" style={{ color: mainInk(a) }}>{a.main.value}</span>
                  <span className="text-[11px] text-neutral-700">{a.main.label}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {a.units.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onOpenEquipment) onOpenEquipment(u, a);
                    }}
                    title={`${u.name} — ${u.label} (нажмите для паспорта)`}
                    className="w-[22px] h-[22px] cursor-pointer hover:scale-110 transition-transform"
                    style={u.st === 'g'
                      ? { background: 'oklch(0.68 0.14 150 / .35)', border: `1px solid ${S.g.fill}` }
                      : { background: S[u.st].fill, border: `1px solid ${S[u.st].fill}` }}
                  />
                ))}
              </div>
              <div className="text-xs leading-[1.4] text-pretty" style={{ color: alertInk(a) }}>{a.alert.text}</div>
            </button>,
            next && (
              <div
                key={`b${a.id}`}
                className="flex flex-col items-center justify-center gap-0.5"
                style={{ gridColumn: r === next[1] ? (c + next[0]) / 2 : c, gridRow: r === next[1] ? r : 2 }}
              >
                <span className="text-xl text-neutral-600">{r !== next[1] ? '↓' : next[0] > c ? '→' : '←'}</span>
                <span className="num text-lg" style={{ color: a.buffer ? S[a.buffer.st].ink : DIM }}>{a.buffer ? a.buffer.value : '—'}</span>
                <span className="text-[10px] text-neutral-700">буфер</span>
              </div>
            ),
          ];
        })}
      </div>
    </div>
  );
}

function HourlyChart({ model }) {
  const { hours, hourPlan, finalArea, dayPlan } = model;
  const max = Math.max(hourPlan * 1.25, ...hours.map((h) => h.actual ?? 0));
  const done = hours.filter((h) => h.actual != null);
  const fact = done.reduce((s, h) => s + h.actual, 0);
  const planSoFar = done.reduce((s, h) => s + (h.plan ?? hourPlan), 0);
  return (
    <Blueprint className="p-[18px] flex flex-col gap-3.5">
      <div className="flex justify-between items-baseline gap-3 flex-wrap">
        <h4>Выпуск по часам · {finalArea.name}</h4>
        <span className="text-[13px] text-neutral-700">Факт <b className="text-text">{fmtInt(fact)}</b> из {fmtInt(planSoFar || dayPlan)} к этому часу</span>
      </div>
      <div className="flex items-end gap-1.5 h-[180px] border-b border-text relative">
        <div className="absolute left-0 right-0 border-t border-dashed border-accent-700" style={{ bottom: `${(hourPlan / max) * 100}%` }} />
        <div className="absolute right-0 -translate-y-full text-[11px] text-accent-700 bg-bg px-1" style={{ bottom: `${(hourPlan / max) * 100}%` }}>такт-план {hourPlan}/ч</div>
        {hours.map((h, i) => {
          if (h.actual == null) {
            return (
              <div key={i} className="flex-1 h-full flex flex-col justify-end items-center gap-1">
                <span className="text-[11px] font-medium text-neutral-600">{hourPlan}</span>
                <div className="w-full border border-dashed border-neutral-500" style={{ height: `${(hourPlan / max) * 100}%` }} />
              </div>
            );
          }
          const plan = h.plan ?? hourPlan;
          const st = h.actual >= plan ? 'g' : h.actual >= plan * 0.8 ? 'y' : 'r';
          return (
            <div key={i} className="flex-1 h-full flex flex-col justify-end items-center gap-1 relative z-[1]" title={`${h.label}:00 — факт ${h.actual}, план ${plan}`}>
              <span className="text-[11px] font-medium" style={{ color: S[st].ink }}>{h.actual}</span>
              <div className="w-full" style={{ height: `${(h.actual / max) * 100}%`, background: S[st].fill }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {hours.map((h, i) => <span key={i} className="flex-1 text-center text-[11px] text-neutral-700">{h.label}</span>)}
      </div>
    </Blueprint>
  );
}

function Alerts({ model, onOpen }) {
  return (
    <Blueprint className="p-[18px] flex flex-col gap-1">
      <div className="flex justify-between items-baseline mb-1.5">
        <h4>Предиктивные алерты</h4>
        <span className="text-xs text-neutral-700">тренды 28 дней · данные БД</span>
      </div>
      {model.alerts.length === 0 && <div className="text-sm text-neutral-700 border-t border-divider pt-3">Рисков не обнаружено.</div>}
      {model.alerts.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => a.areaId && onOpen(a.areaId)}
          className="grid grid-cols-[4px_minmax(0,1fr)_auto] gap-3 text-left bg-transparent border-t border-divider py-3 hover:bg-neutral-100"
        >
          <span style={{ background: S[a.st].fill }} />
          <span className="flex flex-col gap-[3px]">
            <span className="font-medium text-sm">{a.title}</span>
            <span className="text-xs text-neutral-700 leading-[1.45] text-pretty">{a.text}</span>
            <span className="text-xs text-accent-700">→ {a.action}</span>
          </span>
          <span className="flex flex-col items-end gap-0.5 pr-1">
            <span className="num text-xl whitespace-nowrap" style={{ color: S[a.st].ink }}>{a.eta}</span>
            <span className="text-[11px] text-neutral-700 whitespace-nowrap">{a.conf}</span>
          </span>
        </button>
      ))}
    </Blueprint>
  );
}
