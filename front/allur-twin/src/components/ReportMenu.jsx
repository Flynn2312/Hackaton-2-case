import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReportPrint from './ReportPrint';
import { buildReport, downloadCsv } from '../lib/report';

const DownloadIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" />
  </svg>
);

// «Скачать отчёт» на «Сводке»: выбор марок чекбоксами и формат — PDF (печатная форма) или CSV для Excel.
// Отчёт строится за период из переключателя и фиксируется в момент нажатия.
export default function ReportMenu({ model, sum, brands, brand }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState([]);
  const [print, setPrint] = useState(null);
  const ref = useRef(null);

  const toggleOpen = () => {
    if (!open) setChecked(brand ? [brand] : []);
    setOpen(!open);
  };

  // Закрытие по клику мимо и по Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // PDF: печатная форма рисуется порталом, затем диалог печати браузера («Сохранить как PDF»).
  // Заголовок документа — имя файла по умолчанию.
  useEffect(() => {
    if (!print) return undefined;
    const title = document.title;
    document.title = print.fileBase;
    const done = () => setPrint(null);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 100);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); document.title = title; };
  }, [print]);

  const selected = brands.filter((b) => checked.includes(b));
  const report = () => buildReport(model, sum, selected);
  const toggle = (b) => setChecked((c) => (c.includes(b) ? c.filter((x) => x !== b) : [...c, b]));

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn btn-secondary flex items-center gap-2" onClick={toggleOpen} disabled={!sum} aria-expanded={open}>
        <DownloadIcon />Скачать отчёт
      </button>

      {open && sum && (
        <div className="absolute right-0 top-full mt-2 z-30 w-[min(300px,calc(100vw-2rem))] bg-bg rounded-xl p-4 flex flex-col gap-4 shadow-[0_10px_30px_rgba(0,0,0,.14)] border border-divider">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">Отчёт за период</span>
            <span className="text-xs text-neutral-700">{sum.period.label}{sum.isCurrent ? ' · период не завершён' : ''}</span>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs text-neutral-700 mb-1.5">Марки в отчёте</legend>
            {brands.map((b) => (
              <label key={b} className="flex items-center gap-2.5 cursor-pointer text-[15px]">
                <input type="checkbox" className="w-4 h-4 accent-[var(--color-brand)]" checked={checked.includes(b)} onChange={() => toggle(b)} />
                {b}
              </label>
            ))}
            <span className="text-[11px] text-neutral-700">Итоги линии, потери и инциденты входят в отчёт всегда</span>
          </fieldset>

          <div className="flex flex-col gap-2">
            <button type="button" className="btn btn-primary" disabled={!selected.length} onClick={() => { setPrint(report()); setOpen(false); }}>
              PDF — для печати и отправки
            </button>
            <button type="button" className="btn btn-secondary" disabled={!selected.length} onClick={() => { downloadCsv(report()); setOpen(false); }}>
              Excel (CSV) — таблицы с цифрами
            </button>
            {!selected.length && <span className="text-[11px] text-neutral-700">Отметьте хотя бы одну марку</span>}
          </div>
        </div>
      )}

      {print && createPortal(<div className="print-only"><ReportPrint r={print} /></div>, document.body)}
    </div>
  );
}
