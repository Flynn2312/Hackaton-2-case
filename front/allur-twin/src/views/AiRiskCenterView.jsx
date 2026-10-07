import { useState } from 'react';
import { Blueprint, PageTitle } from '../components/ui';
import { S } from '../lib/format';

const RISKS = [
  {
    id: 'conveyor-03',
    equipmentCode: 'ASM-CNV-03',
    equipmentName: 'Главный напольный Конвейер-03',
    areaName: 'Сборка-1',
    areaCode: 'ASSY',
    riskScore: 78,
    riskLevel: 'CRITICAL',
    riskTitle: 'Высокий риск аварийного останова линии сборки',
    probabilityText: 'Вероятность критического простоя: 78%',
    st: 'r',
    reasons: [
      { label: 'Последний простой', value: '55 минут', note: 'инцидент 02.10, смена 1' },
      { label: 'Критический предел', value: '60 мин/сутки', note: 'регламент завода Allur (запас всего 5 мин!)' },
      { label: 'Загрузка линии', value: '99%', note: 'фактическая загрузка 7.9 ч из 8.0 ч' },
      { label: 'Причина предыдущего инцидента', value: 'Обрыв тяговой цепи', note: 'усталостное напряжение натяжителя' },
      { label: 'Телеметрия вибрации (ISO 10816)', value: '6.2 мм/с (Зона D)', note: 'аварийный порог > 4.5 мм/с' },
      { label: 'Температура редуктора', value: '68.4 °C', note: 'нагрев подшипникового узла' },
    ],
    consequences: [
      'Полная остановка сборочного конвейера Линии 1.',
      'Недовыпуск до 11 автомобилей за рабочую смену.',
      'Ожидаемый прямой финансовый ущерб: ~4 675 000 ₸.',
    ],
    recommendation:
      'Провести превентивную вибродиагностику натяжной станции и замену изношенного звена цепи в ближайшее 15-минутное окно пересменки до старта вечерней смены.',
    whatIfPreset: {
      equipmentName: 'Конвейер-03',
      downtimeMin: 55,
      loadDelta: 0,
      areaCode: 'ASSY',
    },
  },
  {
    id: 'paint-cabin-02',
    equipmentCode: 'PNT-CAB-02',
    equipmentName: 'Окрасочная камера Камера-02',
    areaName: 'Окраска-1',
    areaCode: 'PAINT',
    riskScore: 84,
    riskLevel: 'HIGH',
    riskTitle: 'Критический риск превышения нормы брака ЛКП',
    probabilityText: 'Вероятность выхода брака за пределы: 84%',
    st: 'r',
    reasons: [
      { label: 'Фактический брак', value: '5.2%', note: '02.10 факт (допустимый уровень ≤ 2.0%)' },
      { label: 'Перепад давления фильтров', value: '18.5 кПа', note: 'норма ≤ 12.0 кПа (сильное загрязнение)' },
      { label: 'Температура зоны сушки', value: '144.5 °C', note: 'норматив 140.0 ± 2.0 °C (перегрев эмали)' },
      { label: 'Предыдущий инцидент', value: 'Замена фильтра (40 мин)', note: '01.10 внеплановый останов' },
      { label: 'Загрузка участка', value: '96%', note: 'узкое место технологического потока' },
    ],
    consequences: [
      'Доработка и повторный цикл для 8 кузовов за смену.',
      'Блокировка буфера перед цехом сборки (риск голодания сборки).',
      'Прямые затраты на устранение дефектов: ~960 000 ₸ за смену.',
    ],
    recommendation:
      'Экстренная регламентная замена фильтров тонкой очистки и калибровка терморегуляторов зоны 2 сушильной печи до начала следующего такта.',
    whatIfPreset: {
      equipmentName: 'Камера-02',
      defectPct: 5.2,
      targetDefectPct: 2.0,
      areaCode: 'PAINT',
    },
  },
  {
    id: 'weld-robot-01',
    equipmentCode: 'WLD-ABB-01',
    equipmentName: 'Сварочный робот ABB-01',
    areaName: 'Сварка-1',
    areaCode: 'WELD',
    riskScore: 42,
    riskLevel: 'MEDIUM',
    riskTitle: 'Умеренный риск сбоя позиционирования кондуктора',
    probabilityText: 'Вероятность микроостанова: 42%',
    st: 'y',
    reasons: [
      { label: 'Предыдущий простой', value: '25 минут', note: '01.10 ошибка оптического датчика' },
      { label: 'Загрузка линии сварки', value: '91–98%', note: 'высокая интенсивность циклов' },
      { label: 'Погрешность позиционирования', value: '±0.15 мм', note: 'допуск по геометрии ±0.05 мм' },
    ],
    consequences: [
      'Микроостановы такта сварки на 5–10 минут.',
      'Риск отклонения геометрии по проёмам дверей.',
    ],
    recommendation:
      'Юстировка оптического датчика нулевой точки и очистка контактных поверхностей сварочных клещей в межсменный интервал.',
    whatIfPreset: {
      equipmentName: 'ABB-01',
      downtimeMin: 25,
      areaCode: 'WELD',
    },
  },
];

export default function AiRiskCenterView({ model, onOpenEquipment, onOpenWhatIf }) {
  const [filterLevel, setFilterLevel] = useState('all');

  const filtered = RISKS.filter((r) => {
    if (filterLevel === 'critical') return r.st === 'r';
    if (filterLevel === 'medium') return r.st === 'y';
    return true;
  });

  return (
    <main className="px-7 pt-6 pb-12 flex flex-col gap-6">
      <PageTitle
        title="AI Risk Center · Центр предиктивных рисков"
        sub="Explainable AI: Прогнозирование потенциальных простоев и узких мест до их возникновения на заводе Allur"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-600">Фильтр рисков:</span>
          <div className="flex border border-divider">
            {[
              ['all', 'Все (3)'],
              ['critical', 'Критические (2)'],
              ['medium', 'Умеренные (1)'],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilterLevel(k)}
                className="px-3 py-1 text-xs border-r border-divider last:border-r-0"
                style={{
                  background: filterLevel === k ? 'var(--color-accent)' : 'transparent',
                  color: filterLevel === k ? 'white' : 'inherit',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </PageTitle>

      {/* Верхний баннер Explainable AI концепции */}
      <Blueprint className="p-4 bg-accent-100/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-accent-600">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-heading font-bold text-lg text-accent-900">
              Архитектура Explainable AI (XAI)
            </span>
            <span className="text-[11px] bg-accent-700 text-white px-2 py-0.5 font-semibold">
              ISO 10816 + Telemetry
            </span>
          </div>
          <p className="text-xs text-neutral-800 leading-relaxed max-w-3xl">
            Мы не используем «черный ящик» с абстрактными процентами. Жюри видит прозрачную причинно-следственную цепочку:
            <b className="text-text"> Риск → Факторы телеметрии → Производственные последствия → Рекомендация ТОиР</b>.
          </p>
        </div>

        <div className="flex items-center gap-6 shrink-0 text-xs">
          <div>
            <div className="text-neutral-600">Потенциальный ущерб:</div>
            <div className="num font-bold text-xl text-crit-ink">5 635 000 ₸</div>
          </div>
          <div>
            <div className="text-neutral-600">Окно вмешательства:</div>
            <div className="num font-bold text-xl text-accent-900">15–30 мин</div>
          </div>
        </div>
      </Blueprint>

      {/* Список карточек Explainable AI */}
      <div className="grid grid-cols-1 gap-6">
        {filtered.map((item) => (
          <Blueprint
            key={item.id}
            className="p-5 flex flex-col gap-4 bg-bg"
            style={{ borderColor: S[item.st].frame }}
          >
            {/* Шапка карточки риска */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-divider">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-bold px-2 py-0.5 uppercase tracking-wider"
                    style={{ background: S[item.st].tint, color: S[item.st].ink }}
                  >
                    {item.riskLevel} РИСК
                  </span>
                  <span className="text-xs text-neutral-600 font-mono">
                    {item.equipmentCode} · {item.areaName}
                  </span>
                </div>
                <h3 className="text-2xl font-bold font-heading">{item.equipmentName}</h3>
                <span className="text-sm font-semibold" style={{ color: S[item.st].ink }}>
                  {item.probabilityText}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="btn btn-secondary text-xs"
                  onClick={() => {
                    const realEq = model.equipment?.find((e) => e.code === item.equipmentCode) || {
                      id: item.equipmentCode,
                      code: item.equipmentCode,
                      name: item.equipmentName,
                      criticality: 'high',
                      status: item.st === 'r' ? 'breakdown' : 'running',
                    };
                    const realArea = model.areas.find((a) => a.code === item.areaCode);
                    if (onOpenEquipment) {
                      onOpenEquipment(realEq, realArea);
                    }
                  }}
                >
                  📄 Цифровой паспорт
                </button>

                <button
                  type="button"
                  className="btn btn-primary text-xs flex items-center gap-1.5"
                  onClick={() => {
                    if (onOpenWhatIf) {
                      onOpenWhatIf(item.whatIfPreset);
                    }
                  }}
                >
                  <span>⚡</span>
                  <span>Смоделировать в What-If</span>
                </button>
              </div>
            </div>

            {/* Блок 1: Причины (Explainability) */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
                Почему AI фиксирует высокий риск (Факторы):
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {item.reasons.map((r, i) => (
                  <div
                    key={i}
                    className="p-2.5 border border-divider bg-neutral-100/50 flex flex-col gap-0.5"
                  >
                    <span className="text-[11px] text-neutral-600">{r.label}</span>
                    <span className="num font-bold text-sm text-text">{r.value}</span>
                    <span className="text-[10px] text-neutral-600 leading-tight">{r.note}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Блок 2: Последствия и Рекомендация */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-divider text-xs">
              {/* Производственные последствия */}
              <div className="flex flex-col gap-1.5 p-3 bg-neutral-100/30 border border-divider">
                <span className="font-bold text-crit-ink flex items-center gap-1.5">
                  <span>⚠</span> Ожидаемые последствия без вмешательства:
                </span>
                <ul className="list-disc pl-4 space-y-1 text-neutral-700">
                  {item.consequences.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>

              {/* Предписание AI */}
              <div className="flex flex-col gap-1.5 p-3 bg-accent-100/30 border border-divider">
                <span className="font-bold text-accent-800 flex items-center gap-1.5">
                  <span>💡</span> Рекомендация Explainable AI:
                </span>
                <p className="text-neutral-800 leading-relaxed">
                  {item.recommendation}
                </p>
                <div className="mt-auto pt-2 text-[11px] text-neutral-600">
                  Статус: <b>Готово к передаче мастеру смены</b>
                </div>
              </div>
            </div>
          </Blueprint>
        ))}
      </div>
    </main>
  );
}
