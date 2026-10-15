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
    <div className="flex p-1 gap-1 bg-surface rounded-[10px] max-w-full overflow-x-auto">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className="shrink-0 px-3 sm:px-3.5 py-[6px] text-[13px] font-medium rounded-lg transition-colors"
          style={{ background: value === k ? 'var(--color-bg)' : 'transparent', color: value === k ? 'var(--color-text)' : 'var(--color-neutral-600)', boxShadow: value === k ? 'var(--shadow-card)' : undefined }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function PageTitle({ title, sub, children }) {
  return (
    <div className="flex items-end justify-between gap-5 flex-wrap">
      <div className="flex flex-col gap-1 min-w-0">
        <h2 className="text-[24px] sm:text-[30px] break-words">{title}</h2>
        {sub && <div className="text-[13px] text-neutral-700">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function Slider({ label, value, display, min, max, step = 1, onChange, hint, marks }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-baseline gap-3"><span className="font-medium min-w-0">{label}</span><span className="num text-lg shrink-0">{display ?? value}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
      {marks && <div className="flex justify-between gap-1 text-[10px] sm:text-[11px] text-neutral-700">{marks.map((m) => <span key={m}>{m}</span>)}</div>}
      {hint && <div className="text-[11px] text-neutral-700">{hint}</div>}
    </div>
  );
}
