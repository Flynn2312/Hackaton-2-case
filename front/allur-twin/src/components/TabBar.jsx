import { useCallback, useEffect, useRef, useState } from 'react';
import { S } from '../lib/format';

// Вкладки дашборда. На узком экране не помещаются — листаются по горизонтали:
// пальцем, колёсиком мыши или стрелками по краям; активная вкладка всегда прокручивается в зону видимости.
export default function TabBar({ items, value, onChange, className = '' }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Вертикальное колесо мыши листает вкладки по горизонтали
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('wheel', onWheel); };
  }, [update]);

  // Только горизонтальная прокрутка полосы: scrollIntoView сдвинул бы и саму страницу
  useEffect(() => {
    const el = ref.current;
    const tab = el?.querySelector('[aria-selected="true"]');
    if (!tab) return;
    const left = tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [value]);

  const scrollBy = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' });

  return (
    <div className={`relative ${className}`}>
      <nav ref={ref} onScroll={update} role="tablist" className="flex h-full overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map(([k, label, short, badge]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={value === k}
            onClick={() => onChange(k)}
            className="shrink-0 h-full flex items-center gap-1.5 md:gap-2 px-3 md:px-3.5 text-[14px] font-medium transition-colors hover:text-text"
            style={{ boxShadow: value === k ? 'inset 0 -2px 0 var(--color-brand)' : undefined, color: value === k ? 'var(--color-text)' : 'var(--color-neutral-600)' }}
          >
            <span className="sm:hidden">{short ?? label}</span>
            <span className="hidden sm:inline">{label}</span>
            {badge?.n > 0 && (
              <span className="text-[11px] font-semibold min-w-5 h-5 px-1.5 rounded-full grid place-items-center" style={{ background: S[badge.st].tint, color: S[badge.st].ink }}>{badge.n}</span>
            )}
          </button>
        ))}
      </nav>
      {/* Края: затемнение и стрелка, когда за ними есть ещё вкладки */}
      {edges.left && <EdgeButton side="left" onClick={() => scrollBy(-1)} />}
      {edges.right && <EdgeButton side="right" onClick={() => scrollBy(1)} />}
    </div>
  );
}

function EdgeButton({ side, onClick }) {
  const left = side === 'left';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={left ? 'Предыдущие вкладки' : 'Следующие вкладки'}
      className={`absolute top-0 bottom-0 ${left ? 'left-0 pr-4 pl-1.5' : 'right-0 pl-4 pr-1.5'} flex items-center text-neutral-700`}
      style={{ background: `linear-gradient(to ${left ? 'right' : 'left'}, var(--color-bg) 55%, transparent)` }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={left ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} />
      </svg>
    </button>
  );
}
