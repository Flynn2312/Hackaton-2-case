import { NORMS } from '../lib/model';
import { S, fmt1, fmtInt, fmtKzt, pct } from '../lib/format';

// Печатная форма отчёта (A4). Видна только при печати: стили .print-only в index.css.
const tone = (good, warn) => (good ? 'g' : warn ? 'y' : 'r');
const defectTone = (v) => tone(v <= NORMS.defect, v <= NORMS.defect * 2);
const ink = (st) => (st === 'g' ? '#262626' : S[st].ink);

const th = 'whitespace-nowrap font-medium text-[#666] px-1.5 py-1 border-b border-[#ccc] align-bottom';
const td = 'px-1.5 py-1 border-b border-[#e5e5e5] align-top';
const tdn = `${td} text-right whitespace-nowrap tabular-nums`;

function Section({ title, sub, children }) {
  return (
    <section className="break-inside-avoid mt-5">
      <h4 className="text-[13px] font-semibold">{title}</h4>
      {sub && <div className="text-[9.5px] text-[#666] mb-1">{sub}</div>}
      {children}
    </section>
  );
}

export default function ReportPrint({ r }) {
  return (
    <div className="text-[10.5px] leading-[1.4] text-[#262626] bg-white">
      <header className="flex justify-between items-end gap-6 border-b-2 border-[#262626] pb-2">
        <div>
          <div className="flex items-baseline gap-1 leading-none">
            <span className="font-bold text-[22px] tracking-[-0.05em] text-brand">allur</span>
            <span className="font-medium text-[14px] text-[#7d7d7d]">twin</span>
          </div>
          <h2 className="text-[19px] mt-1.5">{r.title}</h2>
        </div>
        <div className="text-right text-[10px] text-[#444]">
          <div><b>{r.factory}</b>, {r.location}</div>
          <div>{r.period}</div>
          <div>Марки: {r.brands.join(', ')} · сформирован {r.generated} (время завода)</div>
        </div>
      </header>

      <Section title="1. Итоги линии">
        <div className="grid grid-cols-5 gap-1.5">
          {r.kpis.map((k) => (
            <div key={k.l} className="border border-[#d8d8d8] rounded-md px-2 py-1.5">
              <div className="text-[9px] text-[#666] truncate">{k.l}</div>
              <div className="text-[15px] font-semibold tabular-nums" style={{ color: ink(k.st) }}>{k.v}</div>
              <div className="text-[8.5px] text-[#666]">{k.n}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="2. По моделям" sub={r.isMonth ? `План месяца по моделям — из данных кейса; прогноз — по среднему выпуску за отработанные дни${r.remainingDays ? `, осталось ${r.remainingDays} раб. дн.` : ''}` : null}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} text-left`}>Модель</th>
              <th className={`${th} text-right`}>План</th>
              <th className={`${th} text-right`}>Факт</th>
              <th className={`${th} text-right`}>Вып.</th>
              <th className={`${th} text-right`}>OEE</th>
              <th className={`${th} text-right`}>Брак*</th>
              <th className={`${th} text-right`}>Дефекты</th>
              <th className={`${th} text-right`}>Простой</th>
              <th className={`${th} text-right`}>Потери</th>
              <th className={`${th} text-right`}>Маржа</th>
              {r.withTarget && <th className={`${th} text-right`}>План мес.</th>}
              {r.withTarget && <th className={`${th} text-right`}>Прогноз</th>}
            </tr>
          </thead>
          <tbody>
            {r.byBrand.map(({ brand, models }) => [
              <tr key={brand}><td colSpan={12} className="pt-2 pb-0.5 px-1.5 font-semibold border-b border-[#ccc]">{brand}</td></tr>,
              models.length === 0 && <tr key={`${brand}-none`}><td colSpan={12} className={`${td} text-[#7d7d7d]`}>За период нет выпуска</td></tr>,
              ...models.map((m) => {
                const plan = m.planTotal || m.planToDate;
                const done = plan ? (m.output / plan) * 100 : null;
                return (
                  <tr key={m.id}>
                    <td className={`${td} whitespace-nowrap`}>{m.name}</td>
                    <td className={tdn}>{fmtInt(plan)}</td>
                    <td className={tdn}>{fmtInt(m.output)}</td>
                    <td className={tdn} style={{ color: ink(m.st) }}>{done != null ? pct(done) : '—'}</td>
                    <td className={tdn} style={{ color: m.oee != null ? ink(tone(m.oee >= NORMS.oee, m.oee >= NORMS.oee - 10)) : undefined }}>{m.oee != null ? pct(m.oee) : '—'}</td>
                    <td className={tdn} style={{ color: m.worst ? ink(defectTone(m.worst.defect)) : undefined }}>{m.worst ? `${pct(m.worst.defect)} · ${m.worst.name}` : '—'}</td>
                    <td className={tdn}>{fmtInt(m.defects)}</td>
                    <td className={tdn}>{fmtInt(m.stopMin)} мин</td>
                    <td className={tdn}>{fmtKzt(m.defectKzt + m.stopKzt)}</td>
                    <td className={tdn}>{fmtKzt(m.marginKzt)}</td>
                    {r.withTarget && <td className={tdn}>{m.target != null ? fmtInt(m.target) : '—'}</td>}
                    {r.withTarget && <td className={tdn}>{m.forecast != null ? fmtInt(m.forecast) : '—'}</td>}
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
        <div className="text-[9px] text-[#666] mt-1">* Брак на худшем участке для модели. Потери — простой во время выпуска модели и брак в тенге.</div>
      </Section>

      {r.models.length > 0 && (
        <Section title="3. Брак по моделям и участкам" sub={`Доля брака от выпуска участка, норма ≤ ${fmt1(NORMS.defect)}%`}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Модель</th>
                {r.lineAreas.map((a) => <th key={a.id} className={`${th} text-right`}>{a.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.models.map((m) => (
                <tr key={m.id}>
                  <td className={td}>{m.name}</td>
                  {r.lineAreas.map((a) => {
                    const v = m.defectByArea[a.id];
                    const st = v != null ? defectTone(v) : 'g';
                    return (
                      <td key={a.id} className={tdn} style={{ color: ink(st), background: v != null && st !== 'g' ? S[st].tint : undefined }}>
                        {v != null ? pct(v) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="4. Потери по участкам" sub="Внеплановый простой с учётом веса узла и брак с доработкой">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} text-left`}>Участок</th>
              <th className={`${th} text-right`}>Простой, мин</th>
              <th className={`${th} text-right`}>Простой</th>
              <th className={`${th} text-right`}>Брак, ед.</th>
              <th className={`${th} text-right`}>Брак</th>
              <th className={`${th} text-right`}>Итого</th>
            </tr>
          </thead>
          <tbody>
            {r.losses.areas.map((a) => (
              <tr key={a.id}>
                <td className={td}>{a.name}</td>
                <td className={tdn}>{fmtInt(a.downtimeMin)}</td>
                <td className={tdn}>{fmtKzt(a.downtimeKzt)}</td>
                <td className={tdn}>{fmtInt(a.defects)}</td>
                <td className={tdn}>{fmtKzt(a.defectKzt)}</td>
                <td className={`${tdn} font-medium`}>{fmtKzt(a.total)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>Итого</td>
              <td className={tdn}>{fmtInt(r.losses.stopMin)}</td>
              <td className={tdn}>{fmtKzt(r.losses.downtime)}</td>
              <td className={tdn}>{fmtInt(r.losses.defects)}</td>
              <td className={tdn}>{fmtKzt(r.losses.defect)}</td>
              <td className={tdn}>{fmtKzt(r.losses.total)}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <div className="grid grid-cols-2 gap-6">
        <Section title="5. Главные причины простоя">
          {r.reasons.length === 0 ? <div className="text-[#666]">Внеплановых остановок не было.</div> : (
            <table className="w-full border-collapse">
              <thead>
                <tr><th className={`${th} text-left`}>Причина</th><th className={`${th} text-right`}>Мин</th><th className={`${th} text-right`}>Потери</th></tr>
              </thead>
              <tbody>
                {r.reasons.map((x) => (
                  <tr key={x.reason}>
                    <td className={td}>{x.reason}<div className="text-[9px] text-[#7d7d7d]">{x.count} ост.{x.equipment ? ` · ${x.equipment}` : ''}</div></td>
                    <td className={tdn}>{fmtInt(x.minutes)}</td>
                    <td className={tdn}>{x.kzt ? fmtKzt(x.kzt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="6. Инциденты и решения ИИ">
          <table className="w-full border-collapse">
            <tbody>
              <tr><td className={td}>Всего инцидентов</td><td className={tdn}>{r.incidents.total}</td></tr>
              {r.incidents.byType.map((t) => (
                <tr key={t.type}><td className={`${td} pl-4 text-[#555]`}>{t.type}</td><td className={tdn}>{t.count}</td></tr>
              ))}
              <tr><td className={td}>Критичных и серьёзных</td><td className={tdn}>{r.incidents.critical}</td></tr>
              <tr><td className={td}>Не закрыто</td><td className={tdn}>{r.incidents.open}</td></tr>
              <tr><td className={td}>Принято решений ИИ</td><td className={tdn}>{r.incidents.decisions}</td></tr>
              <tr><td className={td}>Эффект решений к «ничего не менять»</td><td className={tdn}>{r.incidents.aiEffect ? `${r.incidents.aiEffect > 0 ? '+' : '−'}${fmtKzt(Math.abs(r.incidents.aiEffect))}` : '0 ₸'}</td></tr>
              <tr>
                <td className={td}>Точность проверенных прогнозов</td>
                <td className={tdn}>{r.incidents.accuracy != null ? `${r.incidents.accuracy}% (${r.incidents.checked})` : 'нет проверенных'}</td>
              </tr>
            </tbody>
          </table>
        </Section>
      </div>

      <footer className="mt-6 pt-2 border-t border-[#ccc] text-[9px] text-[#666]">{r.notes}</footer>
    </div>
  );
}
