import { S } from '../lib/format';

// Уведомления живого потока: отказы, инциденты, смены. level: r / y / g, n — информационное
const TONE = { ...S, n: { fill: 'var(--color-accent)', ink: 'var(--color-accent-700)' } };

export default function Toasts({ notices, onDismiss, onOpen }) {
  if (!notices.length) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col gap-2 w-[min(380px,calc(100vw-32px))]">
      {notices.map((n) => {
        const tone = TONE[n.level] ?? TONE.n;
        return (
          <div
            key={n.id}
            role="status"
            className="bg-bg border border-divider shadow-lg flex animate-toast-in"
            style={{ borderLeft: `4px solid ${tone.fill}` }}
          >
            <button type="button" className="flex-1 text-left px-3.5 py-2.5 min-w-0" onClick={() => { onOpen(n); onDismiss(n.id); }}>
              <div className="font-heading font-semibold text-[15px] leading-tight" style={{ color: tone.ink }}>{n.title}</div>
              {n.text && <div className="text-xs text-neutral-700 mt-0.5 line-clamp-2">{n.text}</div>}
            </button>
            <button type="button" aria-label="Закрыть" className="px-2.5 text-neutral-600 hover:text-text" onClick={() => onDismiss(n.id)}>×</button>
          </div>
        );
      })}
    </div>
  );
}
