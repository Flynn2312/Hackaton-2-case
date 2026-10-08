import { Blueprint } from './ui';
import { S, fmt1, fmtInt, pct } from '../lib/format';
import { lossesFromModel } from '../lib/losses';

// Карточка «Потери выпуска»: сколько машин недодано и по каким причинам, в авто и в деньгах.
const PARTS = [
  { key: 'downtime', label: 'простой', color: S.r.fill },
  { key: 'speed', label: 'низкая скорость', color: S.y.fill },
  { key: 'defect', label: 'брак', color: 'var(--color-neutral-700)' },
];
const mln = (v) => `${fmt1(v / 1e6)} млн ₸`;

export default function LossesCard({ model }) {
  const L = lossesFromModel(model);
  if (!L.rows.length) return null;
  const max = Math.max(1, ...L.rows.map((r) => PARTS.reduce((s, p) => s + Math.max(0, r[p.key]), 0)));
  return (
    <Blueprint className="p-[18px] flex flex-col gap-3.5">
      <div className="flex justify-between items-baseline gap-3 flex-wrap">
        <div>
          <h4>Потери выпуска</h4>
          <div className="text-xs text-neutral-700">план − годные = простой + низкая скорость + брак</div>
        </div>
        <span className="text-[13px] text-neutral-700">
          недовыпуск <b className="text-text">{fmtInt(L.gap)} авто</b> · ≈ <b className="text-text">{mln(L.money)}</b>
          {L.bottleneck && <> · больше всего теряет <b className="text-text">{L.bottleneck.name}</b></>}
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {L.rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[110px_minmax(0,1fr)_150px] items-center gap-3 text-[13px]">
            <span className="font-semibold">{r.name}</span>
            <div className="flex h-3.5 bg-neutral-100 border border-neutral-300">
              {PARTS.map((p) => (
                <div key={p.key} title={`${p.label}: ${fmt1(r[p.key])} авто`}
                  style={{ width: `${(Math.max(0, r[p.key]) / max) * 100}%`, background: p.color }} />
              ))}
            </div>
            <span className="text-right text-neutral-700">{pct(r.planPct)} плана · {mln(r.money)}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-4 text-xs text-neutral-700 flex-wrap">
        {PARTS.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5" style={{ background: p.color }} />{p.label}
          </span>
        ))}
        <span>маржа 350 тыс. ₸ за авто · исправление брака 120 тыс. ₸</span>
      </div>
    </Blueprint>
  );
}
