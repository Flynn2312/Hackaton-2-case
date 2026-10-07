import { useState } from 'react';
import { PageTitle, Segmented } from '../components/ui';
import { NORMS } from '../lib/model';
import { S, fmtDateTime } from '../lib/format';

const FILTERS = [['all', 'Все'], ['crit', 'Критичные'], ['open', 'Незакрытые']];
const PAGE = 50;
const SEVERITY = { critical: 'критический', high: 'высокий', medium: 'средний', low: 'низкий' };

export default function IncidentsView({ model, areaId, onClearArea }) {
  const [filter, setFilter] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const area = areaId != null ? model.areas.find((a) => a.id === areaId) : null;

  const list = model.incidents
    .filter((i) => filter === 'all' || (filter === 'crit' ? i.st === 'r' : i.open))
    .filter((i) => areaId == null || i.production_area_id === areaId);

  return (
    <main className="px-7 pt-6 pb-10 flex flex-col gap-5">
      <PageTitle
        title="Журнал инцидентов"
        sub={
          <>
            Простой критичного оборудования за сутки: <b className="text-text">{model.critDowntime} мин</b> из норматива ≤ {NORMS.critDowntime} мин · всего записей {model.incidents.length}
          </>
        }
      >
        <div className="flex items-center gap-3 flex-wrap">
          {area && (
            <button type="button" className="btn btn-secondary" onClick={onClearArea} title="Сбросить фильтр по участку">
              Участок: {area.name} ×
            </button>
          )}
          <Segmented options={FILTERS} value={filter} onChange={(k) => { setFilter(k); setShown(PAGE); }} />
        </div>
      </PageTitle>

      <div className="overflow-x-auto">
        <div className="grid grid-cols-[120px_170px_minmax(0,1fr)_90px_140px] min-w-[760px]">
          {['ВРЕМЯ', 'УЧАСТОК', 'СОБЫТИЕ', 'ПРОСТОЙ', 'СТАТУС'].map((h) => (
            <div key={h} className="px-2.5 py-2 border-b border-divider text-[11px] tracking-[.08em] text-neutral-700">{h}</div>
          ))}
          {list.slice(0, shown).map((i) => {
            const sBg = !i.open ? 'var(--color-neutral-200)' : i.status === 'open' ? S.r.tint : S.y.tint;
            const sFg = !i.open ? 'var(--color-neutral-800)' : i.status === 'open' ? S.r.ink : S.y.ink;
            return [
              <div key={`t${i.id}`} className="px-2.5 py-3 border-b border-neutral-300 text-[13px] text-neutral-700" style={{ borderLeft: `3px solid ${S[i.st].fill}` }}>{fmtDateTime(i.created_at)}</div>,
              <div key={`a${i.id}`} className="px-2.5 py-3 border-b border-neutral-300 text-sm">{i.area?.name ?? '—'}</div>,
              <div key={`w${i.id}`} className="px-2.5 py-3 border-b border-neutral-300 text-sm text-pretty">
                {i.title}
                {i.description && <div className="text-xs text-neutral-700 mt-0.5">{i.description}</div>}
                <div className="text-[11px] text-neutral-600 mt-0.5">уровень: {SEVERITY[i.severity] ?? i.severity}</div>
              </div>,
              <div key={`d${i.id}`} className="px-2.5 py-3 border-b border-neutral-300 num text-[17px]" style={{ color: i.st === 'g' ? 'var(--color-text)' : S[i.st].ink }}>
                {i.downtime != null ? `${i.downtime} мин` : '—'}
              </div>,
              <div key={`s${i.id}`} className="px-2.5 py-3 border-b border-neutral-300">
                <span className="text-[11px] px-2 py-0.5" style={{ background: sBg, color: sFg }}>{i.state}</span>
              </div>,
            ];
          })}
        </div>
        {list.length === 0 && <div className="py-6 text-sm text-neutral-700">Инцидентов по фильтру нет.</div>}
      </div>
      {list.length > shown && (
        <button type="button" className="btn btn-secondary self-start" onClick={() => setShown((n) => n + PAGE)}>
          Показать ещё ({list.length - shown})
        </button>
      )}
    </main>
  );
}
