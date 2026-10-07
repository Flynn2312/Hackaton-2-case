import { useEffect } from 'react';
import { Corners } from './ui';
import { S, fmtInt } from '../lib/format';

const CRIT_LABEL = { high: 'Высокая (Линия 1)', medium: 'Средняя', low: 'Низкая' };
const STATUS_META = {
  running: { label: 'В работе', st: 'g', desc: 'Узел функционирует в пределах нормальных допусков' },
  warning: { label: 'Требует внимания', st: 'y', desc: 'Зафиксировано нарастание вибронагрузки или перегрев' },
  idle: { label: 'Ожидание детали', st: 'y', desc: 'Линия временно свободна из-за буферного задела' },
  maintenance: { label: 'Плановое ТО', st: 'y', desc: 'Проведение планово-предупредительного ремонта' },
  breakdown: { label: 'Аварийный останов', st: 'r', desc: 'Внеплановая остановка оборудования' },
};

export default function EquipmentPassportModal({ equipment: eq, area, _model, onClose, onWhatIf }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!eq) return null;

  // Обогащаем паспорт оборудования специфическими данными из кейса Allur
  const isConveyor = eq.name.includes('Конвейер-03') || eq.code.includes('ASM-CNV-03');
  const isPaintCabin = eq.name.includes('Камера-02') || eq.code.includes('PNT-CAB-02');
  const isAbbRobot = eq.name.includes('ABB-01') || eq.code.includes('WLD-ABB-01');

  // Факты из кейса и телеметрия
  const loadPct = isConveyor ? 99 : isPaintCabin ? 96 : isAbbRobot ? 91 : (area?.load ? Math.round(area.load) : 94);
  const lastDowntimeMin = isConveyor ? 55 : isPaintCabin ? 40 : isAbbRobot ? 25 : (eq.dayDowntime || 0);
  const lastIncidentReason = isConveyor
    ? 'Обрыв тяговой цепи натяжной станции'
    : isPaintCabin
    ? 'Замена загрязненного фильтра тонкой очистки'
    : isAbbRobot
    ? 'Сбой оптического датчика позиционирования сварочного зажима'
    : 'Плановое технологическое обслуживание';

  const critLimitMin = 60; // Допустимый норматив простоя критичного оборудования в сутки
  const critUsagePct = Math.min(100, Math.round((lastDowntimeMin / critLimitMin) * 100));

  // Телеметрия по стандарту ISO 10816 (Вибродиагностика приводов)
  const vibroRms = isConveyor ? 6.2 : isPaintCabin ? 2.8 : isAbbRobot ? 3.1 : 1.9;
  const tempC = isConveyor ? 68.4 : isPaintCabin ? 144.5 : isAbbRobot ? 54.2 : 48.0;
  const hours = isConveyor ? 8420 : isPaintCabin ? 6240 : isAbbRobot ? 11200 : 4500;

  // Explainable AI оценка риска
  const riskScore = isConveyor ? 78 : isPaintCabin ? 84 : isAbbRobot ? 42 : 18;
  const riskStatus = riskScore >= 70 ? 'r' : riskScore >= 40 ? 'y' : 'g';

  const stMeta = STATUS_META[isConveyor ? 'warning' : eq.status] || STATUS_META.running;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs transition-opacity"
      />

      {/* Modal Dialog */}
      <aside
        className="relative w-full max-w-2xl bg-bg border border-divider shadow-2xl z-10 max-h-[92vh] flex flex-col overflow-hidden blueprint"
        role="dialog"
        aria-modal="true"
        aria-labelledby="passport-title"
      >
        <Corners />
        {/* Верхняя цветная полоска статуса */}
        <div className="h-1.5 shrink-0" style={{ background: S[riskStatus].fill }} />

        {/* Заголовок с промышленной иерархией */}
        <div className="px-6 py-4 border-b border-divider flex items-start justify-between gap-4 bg-neutral-100/60">
          <div className="flex flex-col gap-1 min-w-0">
            {/* Иерархия: Завод → Участок → Линия → Оборудование */}
            <div className="text-[11px] tracking-[.08em] uppercase text-neutral-600 flex items-center gap-1.5 flex-wrap">
              <span>Allur Костанай</span>
              <span>›</span>
              <span>{area?.name || 'Производство'}</span>
              <span>›</span>
              <span>Линия 1</span>
              <span>›</span>
              <span className="font-semibold text-text">{eq.code}</span>
            </div>
            <h3 id="passport-title" className="text-2xl font-bold truncate">
              {eq.name}
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className="text-[11px] font-semibold px-2 py-0.5 inline-flex items-center gap-1.5"
                style={{ background: S[riskStatus].tint, color: S[riskStatus].ink }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: S[riskStatus].fill }} />
                {stMeta.label}
              </span>
              <span className="text-xs text-neutral-600">
                Критичность: <b>{CRIT_LABEL[eq.criticality] || eq.criticality}</b>
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost text-2xl leading-none px-2 py-1 text-neutral-600 hover:text-text"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        {/* Тело паспорта (скроллируемое) */}
        <div className="p-6 overflow-y-auto flex flex-col gap-5 text-sm">
          {/* Сетка ключевых производственных метрик */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border border-divider p-3.5 bg-neutral-100/30">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-neutral-600">Загрузка линии</div>
              <div className="num text-2xl font-bold" style={{ color: loadPct >= 98 ? S.r.ink : 'inherit' }}>
                {loadPct}%
              </div>
              <div className="text-[10px] text-neutral-600">норма 85–95%</div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-neutral-600">Посл. простой</div>
              <div className="num text-2xl font-bold" style={{ color: lastDowntimeMin > 30 ? S.r.ink : S.g.ink }}>
                {lastDowntimeMin} мин
              </div>
              <div className="text-[10px] text-neutral-600">лимит {critLimitMin} мин/сут</div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-neutral-600">Наработка</div>
              <div className="num text-2xl font-bold">{fmtInt(hours)} ч</div>
              <div className="text-[10px] text-neutral-600">моточасы узла</div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wider text-neutral-600">Лимит простоя</div>
              <div className="num text-2xl font-bold" style={{ color: critUsagePct >= 90 ? S.r.ink : S.y.ink }}>
                {critUsagePct}%
              </div>
              <div className="text-[10px] text-neutral-600">израсходовано</div>
            </div>
          </div>

          {/* Телеметрия реального времени и ISO 10816 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h6 className="text-neutral-700 font-semibold">Телеметрия вибродиагностики (ISO 10816-3)</h6>
              <span className="text-xs text-neutral-600">Датчик: Triaxial Accel-03</span>
            </div>

            <div className="border border-divider p-3.5 flex flex-col gap-2.5 bg-neutral-100/20">
              <div className="flex justify-between items-baseline">
                <span className="text-xs font-medium">СКЗ виброскорости (RMS):</span>
                <span className="num text-xl font-bold" style={{ color: vibroRms >= 4.5 ? S.r.ink : S.g.ink }}>
                  {vibroRms} мм/с
                </span>
              </div>

              {/* Шкала зон ISO 10816 */}
              <div className="relative h-2 bg-neutral-300 rounded-xs overflow-hidden">
                {/* Зона A/B: норма до 2.5 */}
                <div className="absolute left-0 top-0 bottom-0 w-[35%]" style={{ background: S.g.fill }} />
                {/* Зона C: предупреждение 2.5 - 4.5 */}
                <div className="absolute left-[35%] top-0 bottom-0 w-[30%]" style={{ background: S.y.fill }} />
                {/* Зона D: критическая аварийная > 4.5 */}
                <div className="absolute left-[65%] top-0 bottom-0 right-0" style={{ background: S.r.fill }} />
                {/* Маркер текущего значения */}
                <div
                  className="absolute top-0 bottom-0 w-1 bg-text ring-1 ring-white"
                  style={{ left: `${Math.min(98, (vibroRms / 7.0) * 100)}%` }}
                />
              </div>

              <div className="flex justify-between text-[10px] text-neutral-600">
                <span>0.0 (Зона A: Отлично)</span>
                <span>2.5 (Зона B)</span>
                <span>4.5 (Зона C: Внимание)</span>
                <span>7.0 (Зона D: Опасно)</span>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-divider text-xs">
                <div className="flex justify-between">
                  <span className="text-neutral-600">Температура редуктора:</span>
                  <b style={{ color: tempC > 65 ? S.r.ink : 'inherit' }}>{tempC}°C</b>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Давление / Натяжение:</span>
                  <b>{isPaintCabin ? '18.5 кПа (фильтр)' : 'норма (38 кН)'}</b>
                </div>
              </div>
            </div>
          </div>

          {/* Explainable AI Risk Card (XAI) */}
          <div className="border border-divider p-4 flex flex-col gap-2.5 bg-accent-100/30" style={{ borderColor: S[riskStatus].frame }}>
            <div className="flex items-center justify-between">
              <span className="font-heading font-semibold text-base flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: S[riskStatus].fill }} />
                Explainable AI: Прогноз вероятности отказа
              </span>
              <span className="num font-bold text-lg" style={{ color: S[riskStatus].ink }}>
                {riskScore}% риск
              </span>
            </div>

            <div className="text-xs text-neutral-800 leading-relaxed">
              <b>Корневые факторы (Explainability):</b>
              <ul className="list-disc pl-4 mt-1 space-y-0.5 text-neutral-700">
                <li>Предыдущий зафиксированный инцидент: <b>{lastIncidentReason}</b> ({lastDowntimeMin} мин).</li>
                <li>Израсходовано {critUsagePct}% суточного допустимого лимита простоя (60 мин).</li>
                <li>Вибрация привода {vibroRms} мм/с превышает порог предупреждения ISO 10816.</li>
                <li>Экстремальная загрузка линии ({loadPct}%) не оставляет технологического люфта.</li>
              </ul>
            </div>

            <div className="border-t border-divider pt-2 text-xs">
              <span className="font-semibold text-accent-700">Предписание инженеру ТОиР:</span>
              <p className="mt-0.5 text-neutral-800">
                {isConveyor
                  ? 'Провести ревизию натяжной станции и превентивную замену соединительного звена цепи в окно пересменки (12–15 мин). Это предотвратит аварийный останов на 55 минут.'
                  : isPaintCabin
                  ? 'Заменить комплект карманных фильтров зоны тонкой очистки и провести калибровку термодатчиков сушильной камеры перед стартом смены.'
                  : 'Провести калибровку энкодера сварочного робота и очистку контактных губок зажима.'}
              </p>
            </div>
          </div>

          {/* История инцидентов */}
          <div className="flex flex-col gap-1.5">
            <h6 className="text-neutral-700 font-semibold">История последних инцидентов</h6>
            <div className="border border-divider divide-y divide-divider text-xs">
              <div className="p-2.5 flex justify-between items-center bg-neutral-100/50">
                <div>
                  <span className="font-semibold">{lastIncidentReason}</span>
                  <div className="text-[11px] text-neutral-600">02.10.2026 · Смена 1 · внеплановый останов</div>
                </div>
                <span className="num font-bold text-sm" style={{ color: S.r.ink }}>
                  {lastDowntimeMin} мин
                </span>
              </div>
              <div className="p-2.5 flex justify-between items-center">
                <div>
                  <span className="font-semibold">Плановое техническое обслуживание и смазка</span>
                  <div className="text-[11px] text-neutral-600">28.09.2026 · Плановый регламент</div>
                </div>
                <span className="num font-medium text-sm text-neutral-600">
                  20 мин
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Подвал действий: Прямой переход в What-If */}
        <div className="px-6 py-3.5 border-t border-divider bg-neutral-100/80 flex items-center justify-between gap-3">
          <div className="text-xs text-neutral-600">
            {isConveyor && 'Предотвращение простоя сохраняет 4.67 млн ₸'}
            {isPaintCabin && 'Устранение дефекта сохраняет 960 тыс. ₸'}
            {isAbbRobot && 'Калибровка предотвращает сбой такта сварки'}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              Закрыть
            </button>
            <button
              type="button"
              className="btn btn-primary flex items-center gap-1.5"
              onClick={() => {
                onClose();
                if (onWhatIf) {
                  onWhatIf({
                    areaId: area?.id,
                    equipmentId: eq.id,
                    equipmentName: eq.name,
                    downtime: lastDowntimeMin,
                    loadPct: loadPct,
                    isDefect: isPaintCabin,
                  });
                }
              }}
            >
              <span>⚡</span>
              <span>Смоделировать остановку в What-If</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
