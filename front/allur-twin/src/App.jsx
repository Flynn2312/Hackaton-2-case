import { useEffect, useRef, useState } from 'react';
import { useLiveTwin } from './lib/live';
import { S } from './lib/format';
import FlowView from './views/FlowView';
import WhatIfView from './views/WhatIfView';
import IncidentsView from './views/IncidentsView';
import AssistantView from './views/AssistantView';
import AreaDrawer from './components/AreaDrawer';
import EquipmentPassportModal from './components/EquipmentPassportModal';
import SimControl from './components/SimControl';
import Toasts from './components/Toasts';
import DecisionPanel from './components/DecisionPanel';
import { appHref } from './lib/route';

export default function App({ initialView = 'flow' }) {
  const { model, error, loading, reload, connected, sim, simNow, notices, dismissNotice, control } = useLiveTwin();
  const [view, setView] = useState(initialView);
  const [sel, setSel] = useState(null);
  const [logArea, setLogArea] = useState(null);
  const [whatIf, setWhatIf] = useState(null);
  const [chatRequest, setChatRequest] = useState(null);
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionId, setDecisionId] = useState(null);
  const seenDecisions = useRef(new Set());

  // Текущая вкладка — в адресе: перезагрузка и ссылки с лендинга открывают её же
  useEffect(() => { window.history.replaceState(null, '', appHref(view)); }, [view]);

  const openDecision = (id = null) => { setDecisionId(id); setDecisionOpen(true); };

  // Новый инцидент, требующий решения, — сразу открываем панель с вариантами
  const pendingIds = model?.pendingDecisions.map((d) => d.id).join(',') ?? '';
  useEffect(() => {
    if (!pendingIds) return;
    const fresh = pendingIds.split(',').map(Number).filter((id) => !seenDecisions.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => seenDecisions.current.add(id));
    setDecisionOpen(true);
    setDecisionId((cur) => (cur != null && pendingIds.split(',').map(Number).includes(cur) ? cur : fresh[0]));
  }, [pendingIds]);

  const go = (v) => { setView(v); setSel(null); setLogArea(null); };
  // Клик по уведомлению: инцидент — в журнал участка, событие оборудования — карточка участка
  const openNotice = (n) => {
    if (n.kind === 'decision' || (n.kind === 'incident' && model?.pendingDecisions.some((d) => d.id === n.incident_id))) openDecision(n.incident_id);
    else if (n.kind === 'incident') { setView('log'); setSel(null); setLogArea(n.area_id ?? null); }
    else if (n.area_id != null) { setView('flow'); setLogArea(null); setSel(n.area_id); }
  };

  const nav = [
    ['flow', 'Живой завод', model?.flowBadge],
    ['whatif', 'What-If'],
    ['log', 'Инциденты', model?.incBadge],
    ['chat', 'ИИ Ассистент'],
  ];

  const selArea = model && sel != null ? model.areas.find((a) => a.id === sel) : null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-6 px-7 h-16 whitespace-nowrap overflow-hidden bg-bg border-b border-divider">
        <div className="flex items-baseline gap-2.5">
          <a href="#/" className="flex items-baseline gap-1 leading-none" title="На главную">
            <span className="font-bold text-[28px] tracking-[-0.05em] text-brand">allur</span>
            <span className="font-medium text-[17px] tracking-[-0.02em] text-neutral-600">twin</span>
          </a>
          <span className="text-xs text-neutral-700">{model ? model.factory.location.split(',').pop().trim() : 'Костанай'} · линия 1</span>
        </div>
        <nav className="flex h-full shrink-0">
          {nav.map(([k, label, badge]) => (
            <button
              key={k}
              type="button"
              onClick={() => go(k)}
              className="h-full flex items-center gap-2 px-3.5 text-[14px] font-medium transition-colors hover:text-text"
              style={{ boxShadow: view === k ? 'inset 0 -2px 0 var(--color-brand)' : undefined, color: view === k ? 'var(--color-text)' : 'var(--color-neutral-600)' }}
            >
              <span>{label}</span>
              {badge?.n > 0 && (
                <span className="text-[11px] font-semibold min-w-5 h-5 px-1.5 rounded-full grid place-items-center" style={{ background: S[badge.st].tint, color: S[badge.st].ink }}>{badge.n}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-[18px] text-[13px] text-neutral-700 min-w-0">
          <span className="flex items-center gap-[18px] min-w-0 overflow-hidden text-ellipsis">
            <span className="flex items-center gap-1.5 shrink-0">
              <span className="w-[7px] h-[7px] rounded-full" style={{ background: error ? S.r.fill : S.g.fill }} />
              {error ? 'API недоступен' : `API · ${model ? model.stats.records.toLocaleString('ru-RU') : '…'} записей`}
            </span>
            <span className="overflow-hidden text-ellipsis">{model?.lastShiftLabel ?? 'загрузка смены…'}</span>
          </span>
          {model && (
            <button
              type="button"
              onClick={() => (decisionOpen ? setDecisionOpen(false) : openDecision())}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[14px] font-medium text-text bg-surface hover:bg-neutral-300 transition-colors shrink-0"
              style={{ background: decisionOpen ? 'var(--color-neutral-300)' : undefined }}
              title="Решения по инцидентам: варианты от ИИ"
            >
              Решения
              {model.pendingDecisions.length > 0 && (
                <span className="text-[11px] font-semibold min-w-5 h-5 px-1.5 rounded-full grid place-items-center text-white bg-brand animate-pulse-dot">
                  {model.pendingDecisions.length}
                </span>
              )}
            </button>
          )}
          <SimControl sim={sim} connected={connected} simNow={simNow} control={control} />
        </div>
      </header>

      {!model ? (
        <div className="flex-1 grid place-items-center p-10">
          {error ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <h3>Нет данных от бэкенда</h3>
              <div className="text-sm text-neutral-700 max-w-[480px]">{String(error.message)}. Проверьте, что API запущен и VITE_API_URL в .env указывает на него.</div>
              <button type="button" className="btn btn-primary" onClick={reload} disabled={loading}>Повторить</button>
            </div>
          ) : (
            <div className="text-neutral-700">Загружаю состояние цифрового двойника…</div>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3 px-7 pt-5">
            {model.kpis.map((k) => (
              <div key={k.l} className="px-5 py-4 bg-bg rounded-2xl flex flex-col gap-1 shadow-[var(--shadow-card)]">
                <div className="flex items-center gap-2 text-[13px] text-neutral-700 whitespace-nowrap overflow-hidden text-ellipsis">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: S[k.st].fill }} />{k.l}
                </div>
                <div className="flex items-baseline gap-x-2 flex-wrap">
                  <span className="num whitespace-nowrap text-[28px] leading-[1.1]" style={{ color: k.st === 'g' ? 'var(--color-text)' : S[k.st].ink }}>{k.v}</span>
                  <span className="text-xs text-neutral-700 whitespace-nowrap">{k.n}</span>
                </div>
              </div>
            ))}
          </div>

          {view === 'flow' && (
            <FlowView
              model={model}
              onOpen={setSel}
              onOpenEquipment={(eq, a) => setSelectedEquipment({ equipment: eq, area: a })}
            />
          )}
          {view === 'whatif' && <WhatIfView model={model} preset={whatIf} />}
          {view === 'log' && <IncidentsView model={model} areaId={logArea} onClearArea={() => setLogArea(null)} onOpenDecision={openDecision} />}
          {view === 'chat' && <AssistantView model={model} request={chatRequest} />}

          {selArea && (
            <AreaDrawer
              area={selArea}
              model={model}
              onClose={() => setSel(null)}
              onWhatIf={() => { setWhatIf({ areaId: selArea.id, at: Date.now() }); setView('whatif'); setSel(null); }}
              onIncidents={() => { setView('log'); setLogArea(selArea.id); setSel(null); }}
              onAsk={() => { setChatRequest({ areaId: selArea.id, q: `Что происходит на участке «${selArea.name}» и что делать?`, at: Date.now() }); setView('chat'); setSel(null); }}
              onOpenEquipment={(eq, a) => setSelectedEquipment({ equipment: eq, area: a })}
            />
          )}

          {selectedEquipment && (
            <EquipmentPassportModal
              equipment={selectedEquipment.equipment}
              area={selectedEquipment.area}
              model={model}
              onClose={() => setSelectedEquipment(null)}
              onWhatIf={(preset) => {
                setWhatIf(preset);
                setView('whatif');
                setSelectedEquipment(null);
              }}
            />
          )}
        </>
      )}

      {model && decisionOpen && (
        <DecisionPanel
          model={model}
          sim={sim}
          simNow={simNow}
          selectedId={decisionId}
          onSelect={setDecisionId}
          onClose={() => setDecisionOpen(false)}
        />
      )}

      <Toasts notices={notices} onDismiss={dismissNotice} onOpen={openNotice} />
    </div>
  );
}
