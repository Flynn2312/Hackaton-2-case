import { useMemo, useState } from 'react';
import { PageTitle, Segmented } from '../components/ui';
import PeriodPicker from '../components/PeriodPicker';
import { NORMS } from '../lib/model';
import { inPeriodOf, resolvePeriod } from '../lib/period';
import { downloadIncidentsCsv } from '../lib/report';
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

// Цвет плашки статуса: открыт — красный, в работе — жёлтый, закрыт — серый
const stateColors = (i) => ({
  bg: !i.open ? 'var(--color-neutral-200)' : i.status === 'open' ? S.r.tint : S.y.tint,
  fg: !i.open ? 'var(--color-neutral-800)' : i.status === 'open' ? S.r.ink : S.y.ink,
});

export default function IncidentsView({ model, areaId, onClearArea, onOpenDecision, period, onPeriod }) {
  const [filter, setFilter] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const area = areaId != null ? model.areas.find((a) => a.id === areaId) : null;
  // Период общий со «Сводкой» и «Финансами»; ушли за пределы истории — показываем текущий
  const p = useMemo(
    () => resolvePeriod(model, period.kind, period.offset) ?? resolvePeriod(model, period.kind, 0),
    [model, period.kind, period.offset],
  );
  const inPeriod = p ? inPeriodOf(p) : () => true;

  const list = model.incidents
    .filter((i) => inPeriod(new Date(i.created_at).getTime()))
    .filter((i) => filter === 'all' || (filter === 'crit' ? i.st === 'r' : i.open))
    .filter((i) => areaId == null || i.production_area_id === areaId);

  // CSV — ровно то, что на экране: период, фильтр и участок, все строки, а не только показанные
  const download = () => downloadIncidentsCsv(list, {
    factory: model.factory.name,
    period: p ? `${p.label}${p.offset === 0 ? ' (период не завершён)' : ''}` : 'вся история',
    filter: FILTERS.find(([k]) => k === filter)[1],
    area: area?.name,
    generated: fmtDateTime(model.anchor),
    fileBase: `allur-twin_incidents_${p ? `${p.kind}_${p.fromDay}${p.kind === 'shift' ? `_${p.shifts[0]?.id}` : ''}` : 'all'}${filter === 'all' ? '' : `_${filter}`}`,
  });

  return (
    <main className="px-4 md:px-7 pt-6 pb-10 flex flex-col gap-5 min-w-0">
      <PageTitle
        title="Журнал инцидентов"
        sub={
          <>
            Простой критичного оборудования за сутки: <b className="text-text">{model.critDowntime} мин</b> из норматива ≤ {NORMS.critDowntime} мин · за период записей {list.length}
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

      <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
        <PeriodPicker value={period} onChange={(v) => { onPeriod(v); setShown(PAGE); }} period={p} />
        <button type="button" className="btn btn-secondary flex items-center gap-2" onClick={download} disabled={!list.length} title="Журнал за выбранный период с текущим фильтром">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" />
          </svg>
          Скачать CSV
        </button>
      </div>

      {/* Телефон: инциденты карточками, таблица не помещается */}
      <div className="md:hidden flex flex-col gap-2">
        {list.slice(0, shown).map((i) => {
          const { bg, fg } = stateColors(i);
          return (
            <div key={i.id} className="bg-bg rounded-xl px-3.5 py-3 flex flex-col gap-1 shadow-[var(--shadow-card)] min-w-0" style={{ borderLeft: `3px solid ${S[i.st].fill}` }}>
              <div className="flex items-center justify-between gap-2 text-xs text-neutral-700">
                <span className="min-w-0 truncate">{fmtDateTime(i.created_at)} · {i.area?.name ?? '—'}</span>
                <span className="shrink-0 text-[11px] px-2 py-0.5" style={{ background: bg, color: fg }}>{i.state}</span>
              </div>
              <div className="text-sm font-medium break-words">{i.title}</div>
              {i.description && <div className="text-xs text-neutral-700 break-words">{i.description}</div>}
              <div className="text-[11px] text-neutral-600">
                уровень: {SEVERITY[i.severity] ?? i.severity}
                {i.downtime != null && <> · простой <b className="num" style={{ color: i.st === 'g' ? 'var(--color-text)' : S[i.st].ink }}>{i.downtime} мин</b></>}
              </div>
              <DecisionLine decision={i.decision} onOpen={() => onOpenDecision(i.id)} />
            </div>
          );
        })}
        {list.length === 0 && <div className="py-6 text-sm text-neutral-700">За период инцидентов по фильтру нет.</div>}
      </div>

      <div className="hidden md:block overflow-x-auto">
        <div className="grid grid-cols-[120px_170px_minmax(0,1fr)_90px_140px] min-w-[760px]">
          {['ВРЕМЯ', 'УЧАСТОК', 'СОБЫТИЕ', 'ПРОСТОЙ', 'СТАТУС'].map((h) => (
            <div key={h} className="px-2.5 py-2 border-b border-divider text-[11px] tracking-[.08em] text-neutral-700">{h}</div>
          ))}
          {list.slice(0, shown).map((i) => {
            const { bg: sBg, fg: sFg } = stateColors(i);
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
        {list.length === 0 && <div className="py-6 text-sm text-neutral-700">За период инцидентов по фильтру нет.</div>}
      </div>
      {list.length > shown && (
        <button type="button" className="btn btn-secondary self-start" onClick={() => setShown((n) => n + PAGE)}>
          Показать ещё ({list.length - shown})
        </button>
      )}
    </main>
  );
}
