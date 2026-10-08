import { useEffect } from 'react';
import { Corners } from './ui';
import { ECON, NORMS, STOP_WEIGHT } from '../lib/model';
import { S, eqShort, fmtDateTime, fmtInt, fmtKzt, fmtTime, fmtHours } from '../lib/format';

// Паспорт оборудования: живой статус узла, его простои, тренд и история инцидентов — всё из данных двойника.
const CRIT_LABEL = { high: 'высокая', medium: 'средняя', low: 'низкая' };
const STATUS = {
  running: { label: 'В работе', st: 'g' },
  idle: { label: 'Простаивает', st: 'y' },
  maintenance: { label: 'На ТО', st: 'y' },
  breakdown: { label: 'Авария', st: 'r' },
};

function Tile({ label, value, note, st }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-neutral-600">{label}</div>
      <div className="num text-2xl" style={{ color: st && st !== 'g' ? S[st].ink : 'var(--color-text)' }}>{value}</div>
      {note && <div className="text-[11px] text-neutral-600">{note}</div>}
    </div>
  );
}

export default function EquipmentPassportModal({ equipment, area, model, onClose, onWhatIf }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!equipment) return null;
  const eq = area?.equipment?.find((e) => e.id === equipment.id) ?? equipment;
  const status = STATUS[eq.status] ?? { label: eq.status, st: 'y' };
  const critical = eq.criticality === 'high';
  const trend = model.eqTrends.find((t) => t.eq.id === eq.id);
  const rising = model.risingEq.some((t) => t.eq.id === eq.id);
  const stop = model.finance.stops.find((s) => s.equipmentId === eq.id);
  const rate = (STOP_WEIGHT[eq.criticality] ?? 0) * ECON.downtimeMinKzt;
  const history = model.incidents.filter((i) => i.equipment_id === eq.id).slice(0, 5);
  const dayDowntime = eq.dayDowntime ?? 0;
  const stopMin = stop ? Math.max(0, Math.round((model.anchor - stop.startedAt) / 60000)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onClose} className="fixed inset-0 bg-neutral-900/50" />

      <aside className="relative w-full max-w-2xl bg-bg border border-divider shadow-lg z-10 max-h-[92vh] flex flex-col overflow-hidden blueprint" role="dialog" aria-modal="true" aria-labelledby="passport-title">
        <Corners />
        <div className="h-1.5 shrink-0" style={{ background: S[status.st].fill }} />

        <div className="px-6 py-4 border-b border-divider flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="text-[11px] tracking-[.08em] uppercase text-neutral-600 flex items-center gap-1.5 flex-wrap">
              <span>{area?.name || 'Производство'}</span><span>›</span><span className="font-semibold text-text">{eq.code}</span>
            </div>
            <h3 id="passport-title" className="truncate">{eq.name}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: S[status.st].tint, color: S[status.st].ink }}>{status.label}</span>
              <span className="text-xs text-neutral-600">критичность: <b>{CRIT_LABEL[eq.criticality] ?? eq.criticality}</b></span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon text-xl" aria-label="Закрыть">×</button>
        </div>

        <div className="p-6 overflow-y-auto flex flex-col gap-5 text-sm">
          {stop && (
            <div className="px-3 py-2.5 text-[13px]" style={{ background: S.r.tint, color: S.r.ink }}>
              Стоит с {fmtTime(stop.startedAt)} — {stop.reason.toLowerCase()}. {stopMin} мин, ≈ {fmtKzt(stopMin * stop.rate)} потерь.
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Tile
              label="Простой сегодня" value={`${fmtInt(dayDowntime)} мин`}
              note={critical ? `лимит ${NORMS.critDowntime} мин/сут` : 'все остановки'}
              st={critical && dayDowntime > NORMS.critDowntime ? 'r' : 'g'}
            />
            <Tile
              label="За 14 дней" value={`${fmtInt(trend?.lastMin ?? 0)} мин`}
              note={trend ? `${trend.lastCount} остановок · раньше ${fmtInt(trend.prevMin)} мин` : 'остановок нет'}
              st={rising ? 'y' : 'g'}
            />
            <Tile label="Между отказами" value={trend?.mtbfH ? fmtHours(trend.mtbfH) : '—'} note="в среднем за 4 недели" />
            <Tile
              label="Минута остановки" value={rate ? fmtKzt(rate) : '0 ₸'}
              note={rate ? (critical ? 'останавливает участок' : 'участок теряет половину темпа') : 'на выпуск не влияет'}
            />
          </div>

          {rising && trend && (
            <div className="border-l-4 px-3 py-2 text-[13px] leading-[1.45]" style={{ borderColor: S.y.fill, background: S.y.tint }}>
              Простои растут: {fmtInt(trend.lastMin)} мин за 14 дней против {fmtInt(trend.prevMin)} мин ранее
              {trend.topReason ? `, чаще всего — «${trend.topReason}»` : ''}.
              <span className="text-accent-700"> <b className="font-medium">Что делать:</b> плановое ТО {eqShort(eq.name)} в пересменку.</span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <h6 className="text-neutral-700">Последние инциденты узла</h6>
            {history.length === 0 && <div className="text-[13px] text-neutral-700">Инцидентов за 4 недели не было.</div>}
            {history.length > 0 && (
              <div className="border border-divider divide-y divide-divider text-xs">
                {history.map((i) => (
                  <div key={i.id} className="p-2.5 flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{i.title}</div>
                      <div className="text-[11px] text-neutral-600">{fmtDateTime(i.created_at)} · {i.state}</div>
                    </div>
                    {i.downtime != null && <span className="num text-sm whitespace-nowrap" style={{ color: S[i.st].ink }}>{i.downtime} мин</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-3.5 border-t border-divider flex items-center justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Закрыть</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onClose();
              onWhatIf?.({ areaId: area?.id, equipmentId: eq.id, equipmentName: eq.name, downtimeMin: trend?.lastCount ? Math.max(15, Math.round(trend.lastMin / trend.lastCount)) : 55, at: Date.now() });
            }}
          >
            Смоделировать остановку в What-If
          </button>
        </div>
      </aside>
    </div>
  );
}
