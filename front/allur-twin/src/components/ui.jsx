import { S } from '../lib/format';

export const Corners = () => (
  <>
    <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
  </>
);

// Blueprint-рамка с «+» метками по углам
export function Blueprint({ as: Tag = 'section', className = '', children, ...rest }) {
  return (
    <Tag className={`blueprint ${className}`} {...rest}>
      <Corners />
      {children}
    </Tag>
  );
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="flex border border-divider">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className="px-3.5 py-[7px] text-[13px] border-r border-divider last:border-r-0"
          style={{ background: value === k ? 'var(--color-accent)' : 'transparent', color: value === k ? 'var(--color-bg)' : 'var(--color-text)' }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function StatusTag({ st, children }) {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 whitespace-nowrap" style={{ background: S[st].tint, color: S[st].ink }}>
      {children ?? S[st].l}
    </span>
  );
}

export function PageTitle({ title, sub, children }) {
  return (
    <div className="flex items-end justify-between gap-5 flex-wrap">
      <div className="flex flex-col gap-1">
        <h2>{title}</h2>
        {sub && <div className="text-[13px] text-neutral-700">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export const Legend = () => (
  <div className="flex gap-3.5 text-xs text-neutral-700">
    {['g', 'y', 'r'].map((k) => (
      <span key={k} className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5" style={{ background: S[k].fill }} />{S[k].l}
      </span>
    ))}
  </div>
);

export function Slider({ label, value, display, min, max, step = 1, onChange, hint, marks }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-3"><span className="font-medium">{label}</span><span className="num text-lg">{display ?? value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      {marks && <div className="flex justify-between text-[11px] text-neutral-700">{marks.map((m) => <span key={m}>{m}</span>)}</div>}
      {hint && <div className="text-[11px] text-neutral-700">{hint}</div>}
    </div>
  );
}
