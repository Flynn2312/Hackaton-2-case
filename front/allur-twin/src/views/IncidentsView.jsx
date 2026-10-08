import { useState } from 'react';
import { PageTitle, Segmented } from '../components/ui';
import { NORMS } from '../lib/model';
import { S, accuracySt, fmtDateTime } from '../lib/format';

const FILTERS = [['all', 'Все'], ['crit', 'Критичные'], ['open', 'Незакрытые']];
const PAGE = 50;
const CHOICE = { none: 'Ничего не менять', A: 'Вариант A', B: 'Вариант Б' };

// Решение по инциденту: ждёт выбора — кнопка, принято — что выбрали и кто
function DecisionLine({ decision: d, onOpen }) {
  if (!d) return null;
  if (d.status === 'generating' || d.status === 'ready') {
    return (
      <button type="button" className="btn btn-primary mt-1.5 py-1 text-xs" onClick={onOpen}>
        {d.status === 'ready' ? 'Выбрать решение' : 'ИИ готовит варианты…'}
      </button>
    );
  }
  if (d.status === 'expired') return <div className="text-[11px] text-neutral-600 mt-0.5">Решение не понадобилось</div>;
  const title = d.chosen !== 'none' ? d.payload?.options?.find((o) => o.key === d.chosen)?.title : null;
  return (
    <button type="button" className="text-[11px] mt-0.5 text-left hover:underline" style={{ color: 'var(--color-accent-700)' }} onClick={onOpen}>
      Решение: {CHOICE[d.chosen]}{title ? ` — ${title}` : ''} · {d.decided_by === 'operator' ? 'оператор' : 'авто'}
      {d.recommended === d.chosen ? ' · как рекомендовал ИИ' : ''}
      {d.payload?.check && <span style={{ color: S[accuracySt(d.payload.check.accuracy)].ink }}> · прогноз сбылся на {d.payload.check.accuracy}%</span>}
    </button>
  );
}

const SEVERITY = { critical: 'критический', high: 'высокий', medium: 'средний', low: 'низкий' };

export default function IncidentsView({ model, areaId, onClearArea, onOpenDecision }) {
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
                <DecisionLine decision={i.decision} onOpen={() => onOpenDecision(i.id)} />
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
