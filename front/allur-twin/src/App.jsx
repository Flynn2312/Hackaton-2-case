import { useCallback, useEffect, useState } from 'react';
import { loadTwin } from './lib/model';
import { S } from './lib/format';
import FlowView from './views/FlowView';
import WhatIfView from './views/WhatIfView';
import RoiView from './views/RoiView';
import IncidentsView from './views/IncidentsView';
import CopilotView from './views/CopilotView';
import AreaDrawer from './components/AreaDrawer';

const REFRESH_MS = 30_000;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function useTwin() {
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setModel(await loadTwin());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  return { model, error, loading, reload };
}

export default function App() {
  const clock = useClock();
  const { model, error, loading, reload } = useTwin();
  const [view, setView] = useState('flow');
  const [sel, setSel] = useState(null);
  const [logArea, setLogArea] = useState(null);
  const [whatIf, setWhatIf] = useState(null);
  const [chatRequest, setChatRequest] = useState(null);

  const go = (v) => { setView(v); setSel(null); setLogArea(null); };

  const nav = [
    ['flow', 'Поток', model?.flowBadge],
    ['whatif', 'What-If'],
    ['roi', 'ROI'],
    ['log', 'Инциденты', model?.incBadge],
    ['chat', 'AI Copilot'],
  ];

  const selArea = model && sel != null ? model.areas.find((a) => a.id === sel) : null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center gap-5 px-7 h-14 whitespace-nowrap overflow-hidden border-b border-divider">
        <div className="flex items-baseline gap-2">
          <span className="font-heading font-semibold text-[22px] tracking-[.02em]">ALLUR TWIN</span>
          <span className="text-xs text-neutral-700">{model ? model.factory.location.split(',').pop().trim() : 'Костанай'} · линия 1</span>
        </div>
        <nav className="flex h-full shrink-0">
          {nav.map(([k, label, badge]) => (
            <button
              key={k}
              type="button"
              onClick={() => go(k)}
              className="h-full flex items-center gap-2 px-4 font-heading font-semibold text-base hover:bg-neutral-200"
              style={{ borderBottom: `2px solid ${view === k ? 'var(--color-accent)' : 'transparent'}`, color: view === k ? 'var(--color-accent-700)' : 'var(--color-text)' }}
            >
              <span>{label}</span>
              {badge?.n > 0 && (
                <span className="font-body text-[11px] font-medium px-1.5 py-px" style={{ background: S[badge.st].tint, color: S[badge.st].ink }}>{badge.n}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-[18px] text-[13px] text-neutral-700 min-w-0">
          <span className="flex items-center gap-[18px] min-w-0 overflow-hidden text-ellipsis">
            <span className="flex items-center gap-1.5 shrink-0">
              <span className="w-[7px] h-[7px] rounded-full animate-pulse-dot" style={{ background: error ? S.r.fill : S.g.fill }} />
              {error ? 'API недоступен' : `API · ${model ? model.stats.records.toLocaleString('ru-RU') : '…'} записей`}
            </span>
            <span className="overflow-hidden text-ellipsis">{model?.lastShiftLabel ?? 'загрузка смены…'}</span>
          </span>
          <span className="num text-xl text-text shrink-0">{clock}</span>
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
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] border-b border-divider">
            {model.kpis.map((k) => (
              <div key={k.l} className="px-5 py-3.5 border-r border-divider flex flex-col gap-0.5">
                <div className="text-[11px] tracking-[.08em] uppercase text-neutral-700 whitespace-nowrap overflow-hidden text-ellipsis">{k.l}</div>
                <div className="flex items-baseline gap-x-2 flex-wrap">
                  <span className="num whitespace-nowrap text-[30px] leading-[1.1]" style={{ color: S[k.st].ink }}>{k.v}</span>
                  <span className="text-xs text-neutral-700 whitespace-nowrap">{k.n}</span>
                </div>
              </div>
            ))}
          </div>

          {view === 'flow' && <FlowView model={model} onOpen={setSel} />}
          {view === 'whatif' && <WhatIfView model={model} preset={whatIf} />}
          {view === 'roi' && <RoiView model={model} />}
          {view === 'log' && <IncidentsView model={model} areaId={logArea} onClearArea={() => setLogArea(null)} />}
          {view === 'chat' && <CopilotView model={model} request={chatRequest} />}

          {selArea && (
            <AreaDrawer
              area={selArea}
              model={model}
              onClose={() => setSel(null)}
              onWhatIf={() => { setWhatIf({ areaId: selArea.id, at: Date.now() }); setView('whatif'); setSel(null); }}
              onIncidents={() => { setView('log'); setLogArea(selArea.id); setSel(null); }}
              onAsk={() => { setChatRequest({ areaId: selArea.id, q: `Что происходит на участке «${selArea.name}» и что делать?`, at: Date.now() }); setView('chat'); setSel(null); }}
            />
          )}
        </>
      )}
    </div>
  );
}
