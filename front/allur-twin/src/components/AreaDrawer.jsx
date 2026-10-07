import { useEffect } from 'react';
import { Blueprint } from './ui';
import { S, eqShort, fmt1 } from '../lib/format';

const CRIT = { high: 'высокая', medium: 'средняя', low: 'низкая' };

export default function AreaDrawer({ area: a, onClose, onWhatIf, onIncidents, onAsk, onOpenEquipment }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pts = a.trend.points;
  const tmax = Math.max(...pts.map((p) => p.v), 0.0001) * 1.1;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-20" style={{ background: 'color-mix(in srgb, var(--color-neutral-900) 40%, transparent)' }} />
      <aside className="fixed top-0 right-0 bottom-0 w-[min(520px,100vw)] bg-bg shadow-lg z-[21] overflow-y-auto flex flex-col" role="dialog" aria-label={a.name}>
        <div className="h-1.5 shrink-0" style={{ background: S[a.st].fill }} />
        <div className="px-6 py-[18px] border-b border-divider flex justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] tracking-[.08em] text-neutral-700">{a.code} · {a.sub}</span>
            <h3>{a.name}</h3>
            <span className="text-[13px]" style={{ color: S[a.st].ink }}>{S[a.st].l} — {a.alert.text}</span>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon text-xl" aria-label="Закрыть">×</button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-[18px]">
          <h6 className="text-neutral-700">Параметры процесса · сутки</h6>
          {a.params.map((p) => (
            <div key={p.name} className="flex flex-col gap-1.5">
              <div className="flex justify-between items-baseline gap-3">
                <span className="text-sm">{p.name}</span>
                <span className="num text-xl" style={{ color: S[p.st].ink }}>{p.display}</span>
              </div>
              <div className="relative h-1.5 bg-neutral-200">
                <div className="absolute top-0 bottom-0" style={{ left: `${p.normFrom}%`, width: `${Math.max(p.normWidth, 1)}%`, background: 'oklch(0.68 0.14 150 / .35)' }} />
                <div className="absolute -top-1 w-[3px] h-3.5 -ml-px" style={{ left: `${p.pos}%`, background: S[p.st].fill }} />
              </div>
              <div className="text-[11px] text-neutral-700">Норма: {p.norm}</div>
            </div>
          ))}

          {a.reasons.length > 0 && (
            <Blueprint as="div" className="p-3.5 flex flex-col gap-2">
              <b className="text-[13px]">Почему статус «{S[a.st].l}»</b>
              {a.reasons.map((r, i) => (
                <div key={i} className="flex gap-2 text-xs leading-[1.45]">
                  <span className="w-1 shrink-0" style={{ background: S[r.st].fill }} />
                  <span>{r.why}</span>
                </div>
              ))}
            </Blueprint>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h6 className="text-neutral-700">Оборудование · {a.equipment.length} ед.</h6>
              <span className="text-[10px] text-neutral-600">нажмите на станок для паспорта</span>
            </div>
            {a.equipment.map((e) => {
              const u = a.units.find((x) => x.id === e.id) || e;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onOpenEquipment && onOpenEquipment(e, a)}
                  className="grid grid-cols-[10px_minmax(0,1fr)_auto] gap-2.5 items-center text-[13px] border-t border-divider pt-2 text-left hover:bg-neutral-100 p-1 transition-colors"
                >
                  <span className="w-2.5 h-2.5" style={{ background: S[u.st || 'g'].fill }} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{e.name}</span>
                    <span className="text-[11px] text-neutral-700">{e.code} · критичность {CRIT[e.criticality] ?? e.criticality}</span>
                  </span>
                  <span className="text-right flex flex-col items-end">
                    <span className="block text-xs" style={{ color: u.st === 'g' ? 'var(--color-neutral-700)' : S[u.st || 'g'].ink }}>{u.label || 'в работе'}</span>
                    <span className="text-[11px] text-accent-700 font-medium">Паспорт →</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            <h6 className="text-neutral-700">{a.trend.label}</h6>
            <div className="flex items-end gap-1 h-20 border-b border-text">
              {pts.map((p, i) => (
                <div
                  key={i}
                  className="flex-1"
                  title={`${p.t}: ${a.trend.unit === '%' ? fmt1(p.v) : Math.round(p.v)}${a.trend.unit}`}
                  style={{ height: `${Math.max(4, (p.v / tmax) * 100)}%`, background: i === pts.length - 1 ? S[a.st].fill : 'var(--color-accent-400)' }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-neutral-700">
              <span>{pts[0]?.t}</span><span>{pts[pts.length - 1]?.t}</span>
            </div>
          </div>

          {a.activeDt.length > 0 && (
            <div className="text-xs leading-[1.5]" style={{ color: S.r.ink }}>
              Сейчас стоит: {a.activeDt.map((e) => `${eqShort(e.eq.name)} (${e.reason}, ${e.minutes} мин)`).join(', ')}
            </div>
          )}

          <div className="flex gap-2.5 flex-wrap">
            <button type="button" onClick={onWhatIf} className="btn btn-primary">Смоделировать в What-If</button>
            <button type="button" onClick={onIncidents} className="btn btn-secondary">Инциденты участка</button>
            <button type="button" onClick={onAsk} className="btn btn-secondary">Спросить Copilot</button>
          </div>
        </div>
      </aside>
    </>
  );
}
