import { Segmented } from './ui';
import { PERIODS } from '../lib/period';

const Chevron = ({ left }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={left ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'} />
  </svg>
);

// Выбор периода: смена / сутки / неделя / месяц и листание ‹ › по предыдущим периодам
export default function PeriodPicker({ value, onChange, period }) {
  const offset = period?.offset ?? 0;
  const arrow = 'w-8 h-8 grid place-items-center rounded-lg text-text hover:bg-surface transition-colors disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex items-center gap-x-3 gap-y-2 flex-wrap max-w-full">
      <Segmented options={PERIODS} value={value.kind} onChange={(kind) => onChange({ kind, offset: 0 })} />
      <div className="flex items-center gap-1">
        <button type="button" className={arrow} disabled={!period?.canPrev} onClick={() => onChange({ kind: value.kind, offset: offset - 1 })} aria-label="Предыдущий период">
          <Chevron left />
        </button>
        <span className="text-[14px] font-medium text-center whitespace-nowrap min-w-[120px]">
          {period?.label ?? '—'}
          {offset === 0 && <span className="font-normal text-neutral-700"> · сейчас</span>}
        </span>
        <button type="button" className={arrow} disabled={!period?.canNext} onClick={() => onChange({ kind: value.kind, offset: offset + 1 })} aria-label="Следующий период">
          <Chevron />
        </button>
      </div>
    </div>
  );
}
