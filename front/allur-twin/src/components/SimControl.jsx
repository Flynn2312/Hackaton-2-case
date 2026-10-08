import { useEffect, useRef, useState } from 'react';
import { S, fmtDate, fmtTime } from '../lib/format';

// Часы завода и панель симуляции: пауза, сценарии-инциденты для демонстрации, сброс к текущей дате
export default function SimControl({ sim, connected, simNow, control }) {
  const [now, setNow] = useState(() => simNow() ?? Date.now());
  const [open, setOpen] = useState(null); // null — закрыто, иначе позиция окна на экране
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const ref = useRef(null);
  const buttonRef = useRef(null);

  // Окно позиционируется относительно экрана (fixed): шапка обрезает всё, что выходит за её высоту (overflow-hidden)
  const toggle = () => {
    if (open) { setOpen(null); return; }
    const r = buttonRef.current.getBoundingClientRect();
    setOpen({ top: r.bottom + 4, right: Math.max(16, window.innerWidth - r.right) });
  };

  useEffect(() => {
    const t = setInterval(() => setNow(simNow() ?? Date.now()), 1000);
    return () => clearInterval(t);
  }, [simNow]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(null); };
    const closeOnResize = () => setOpen(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', closeOnResize);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [open]);

  const live = connected && sim?.active && sim?.running;
  const st = live ? 'g' : sim?.active ? 'y' : null;
  const state = !sim?.sim_now ? 'симуляция не запущена'
    : !connected ? 'нет связи с потоком'
      : !sim.active ? 'генератор остановлен'
        : sim.running ? `LIVE · ×${Math.round(sim.speed)}` : 'пауза';

  const run = async (key, action) => {
    setBusy(key);
    setMsg(null);
    try {
      const res = await control(action);
      if (typeof res?.result === 'string') setMsg({ st: 'g', text: `Запущено: ${res.result}` });
    } catch (e) {
      setMsg({ st: 'r', text: e.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={!!open}
        className="flex items-center gap-2.5 px-2.5 py-1 hover:bg-neutral-200"
        title="Время завода и управление симуляцией"
      >
        <span className="w-[7px] h-[7px] rounded-full animate-pulse-dot" style={{ background: st ? S[st].fill : 'var(--color-neutral-500)' }} />
        <span className="flex flex-col items-end leading-tight">
          <span className="num text-xl text-text">{fmtTime(now)}</span>
          <span className="text-[10px] tracking-[.06em] uppercase text-neutral-700">{fmtDate(now)} · {state}</span>
        </span>
      </button>

      {open && (
        <div
          className="fixed z-50 w-[min(320px,calc(100vw-32px))] max-h-[calc(100vh-80px)] overflow-y-auto bg-bg border border-divider shadow-lg p-4 flex flex-col gap-3 whitespace-normal text-text"
          style={{ top: open.top, right: open.right }}
        >
          <div>
            <div className="font-heading font-semibold text-lg">Симуляция завода</div>
            <div className="text-xs text-neutral-700">
              Генератор пишет в БД смены, выработку, простои и инциденты. 1 секунда = {sim?.speed ? Math.round(sim.speed) : 60} с заводского времени; ночи и выходные пропускаются.
            </div>
          </div>

          <div className="flex gap-2">
            {sim?.running ? (
              <button type="button" className="btn btn-secondary flex-1" disabled={!!busy || !sim?.active} onClick={() => run('pause', (a) => a.simPause())}>Пауза</button>
            ) : (
              <button type="button" className="btn btn-primary flex-1" disabled={!!busy || !sim?.active} onClick={() => run('resume', (a) => a.simResume())}>Продолжить</button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!!busy || !sim?.active}
              onClick={() => window.confirm('Удалить все сгенерированные данные и начать симуляцию с текущей даты?') && run('reset', (a) => a.simReset())}
            >
              Сброс
            </button>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] tracking-[.08em] uppercase text-neutral-700">Вызвать событие</div>
            {(sim?.scenarios ?? []).map((s) => (
              <button
                key={s.key}
                type="button"
                className="btn btn-secondary justify-start text-left"
                disabled={!!busy || !sim?.active}
                onClick={() => run(s.key, (a) => a.simInject(s.key))}
              >
                {busy === s.key ? 'Запускаю…' : s.title}
              </button>
            ))}
          </div>

          {msg && <div className="text-xs" style={{ color: S[msg.st].ink }}>{msg.text}</div>}
          {sim?.last_error && <div className="text-xs" style={{ color: S.r.ink }}>Ошибка генератора: {sim.last_error}</div>}
        </div>
      )}
    </div>
  );
}
