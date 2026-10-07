import { useEffect, useRef, useState } from 'react';
import { Blueprint } from '../components/ui';
import { answer, greeting, presets } from '../lib/copilot';

export default function CopilotView({ model, request }) {
  const [msgs, setMsgs] = useState(() => [{ me: false, text: greeting(model) }]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [ctx, setCtx] = useState(request?.areaId ?? null);
  const modelRef = useRef(model);
  modelRef.current = model;
  const handled = useRef(null);

  const ask = (q, areaId = ctx) => {
    q = (q || '').trim();
    if (!q || thinking) return;
    setMsgs((m) => [...m, { me: true, text: q }]);
    setDraft('');
    setThinking(true);
    setTimeout(() => {
      setMsgs((m) => [...m, { me: false, text: answer(q, areaId, modelRef.current) }]);
      setThinking(false);
    }, 600);
  };

  // Вопрос из боковой панели участка
  useEffect(() => {
    if (request && handled.current !== request.at) {
      handled.current = request.at;
      ask(request.q, request.areaId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const ctxArea = model.areas.find((a) => a.id === ctx);
  const ctxOpts = [{ id: null, name: 'Вся линия' }, ...model.areas];
  const s = model.stats;

  return (
    <main className="px-7 pt-6 pb-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-7 items-start">
      <Blueprint className="flex flex-col min-h-[600px]">
        <div className="px-[18px] py-3.5 border-b border-divider flex justify-between items-baseline gap-3">
          <h4>AI Copilot</h4>
          <span className="text-xs text-neutral-700">Контекст: {ctxArea ? ctxArea.name : 'вся линия'}</span>
        </div>
        <div className="flex-1 p-[18px] flex flex-col gap-3.5">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.me ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[78%] px-3.5 py-2.5 text-sm leading-[1.5] whitespace-pre-line text-pretty"
                style={{ background: m.me ? 'var(--color-accent)' : 'transparent', color: m.me ? 'var(--color-bg)' : 'var(--color-text)', border: `1px solid ${m.me ? 'var(--color-accent)' : 'var(--color-divider)'}` }}
              >
                <div className="text-[11px] tracking-[.06em] uppercase opacity-75 mb-1">{m.me ? 'Вы' : 'Copilot'}</div>
                {m.text}
              </div>
            </div>
          ))}
          {thinking && <div className="text-[13px] text-neutral-700">Copilot анализирует телеметрию…</div>}
        </div>
        <div className="px-[18px] py-3 flex gap-2 flex-wrap border-t border-divider">
          {presets(model).map((q) => (
            <button key={q} type="button" className="btn btn-secondary text-[13px]" disabled={thinking} onClick={() => ask(q)}>{q}</button>
          ))}
        </div>
        <div className="px-[18px] pb-[18px] flex gap-2.5">
          <input
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask(draft)}
            placeholder="Спросите о линии, участке или причине простоя…"
          />
          <button type="button" className="btn btn-primary shrink-0" disabled={thinking || !draft.trim()} onClick={() => ask(draft)}>Отправить</button>
        </div>
      </Blueprint>

      <aside className="flex flex-col gap-5">
        <Blueprint className="p-4 flex flex-col gap-2.5">
          <h6 className="text-neutral-700">Привязка к участку</h6>
          <div className="flex flex-wrap gap-1.5">
            {ctxOpts.map((c) => {
              const on = ctx === c.id;
              return (
                <button
                  key={c.id ?? 'all'}
                  type="button"
                  onClick={() => setCtx(c.id)}
                  className="px-2.5 py-1 text-xs"
                  style={{ border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-divider)'}`, background: on ? 'var(--color-accent)' : 'transparent', color: on ? 'var(--color-bg)' : 'var(--color-text)' }}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </Blueprint>

        <Blueprint className="p-4 flex flex-col gap-2.5">
          <h6 className="text-neutral-700">Наряд-заказы</h6>
          {model.orders.length === 0 && <div className="text-[13px] text-neutral-700">Открытых нарядов нет.</div>}
          {model.orders.map((o) => (
            <div key={o.id} className="flex flex-col gap-0.5 pt-2 border-t border-divider">
              <div className="flex justify-between gap-2 text-[11px] text-neutral-700"><span>{o.id}</span><span style={{ color: o.ink }}>{o.st}</span></div>
              <div className="text-[13px]">{o.t}</div>
            </div>
          ))}
        </Blueprint>

        <Blueprint className="p-4 grid grid-cols-2 gap-2.5">
          <h6 className="col-span-2 text-neutral-700">Данные двойника</h6>
          {[['Участки', s.areas], ['Оборудование', s.equipment], ['Простои', s.downtime], ['Инциденты', s.incidents]].map(([l, v]) => (
            <div key={l}>
              <div className="text-[11px] text-neutral-700">{l}</div>
              <div className="num text-[22px]">{v.toLocaleString('ru-RU')}</div>
            </div>
          ))}
        </Blueprint>
      </aside>
    </main>
  );
}
