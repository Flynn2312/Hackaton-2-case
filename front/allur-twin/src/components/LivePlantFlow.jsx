import { useState, useEffect, useRef } from 'react';
import { Blueprint, Corners } from './ui';
import { S, fmtInt } from '../lib/format';

// 6 этапов технологического потока автозавода Allur
const STAGES = [
  { id: 'wh_in', code: 'WH-IN', name: 'Склад деталей', icon: '📦', normCt: '120 с', units: ['WH-AGV-01', 'WH-FL-01'] },
  { id: 'weld', code: 'WELD', name: 'Сварка кузовов', icon: '⚡', normCt: '190 с', units: ['WLD-ABB-01', 'WLD-CNV-01'] },
  { id: 'paint', code: 'PAINT', name: 'Окраска кузовов', icon: '🎨', normCt: '240 с', units: ['PNT-CAB-02', 'PNT-OVEN-01'] },
  { id: 'assy', code: 'ASSY', name: 'Сборка авто', icon: '🔧', normCt: '192 с', units: ['ASM-CNV-03', 'ASM-NUT-01'] },
  { id: 'qc', code: 'QC', name: 'Контроль качества', icon: '🔍', normCt: '150 с', units: ['QC-ALIGN-01', 'QC-ROLL-01'] },
  { id: 'wh_out', code: 'WH-OUT', name: 'Склад ГП (отгрузка)', icon: '🚗', normCt: '—', units: ['WH-FL-03'] },
];

// Сценарий 30-секундного Demo Day
const DEMO_STEPS = [
  {
    at: 0,
    title: 'Этап 1: Штатный режим работы (Смена 1)',
    desc: 'Все 6 участков в норме. Такт выпуска — 15 авто/ч. Межоперационные буферы сбалансированы (10–12 кузовов).',
    areaStatus: { weld: 'g', paint: 'g', assy: 'g', qc: 'g' },
    activeCarStep: 1,
    defectRate: 1.8,
    vibroRms: 2.1,
    savedMoney: 0,
  },
  {
    at: 7,
    title: 'Этап 2: Аномалия на Окраске-1 (02.10 факт)',
    desc: 'Камера-02: скачок температуры и засор фильтра. Брак взлетает до 5.2% (норма ≤ 2.0%). Образуется затор в буфере.',
    areaStatus: { weld: 'g', paint: 'r', assy: 'g', qc: 'y' },
    activeCarStep: 2,
    defectRate: 5.2,
    vibroRms: 2.8,
    savedMoney: 0,
  },
  {
    at: 14,
    title: 'Этап 3: Критический риск на Конвейере-03 сборки',
    desc: 'AI вибродиагностика фиксирует 6.2 мм/с (зона D, ISO 10816). Вероятность обрыва цепи — 78%! Угроза 55 мин простоя.',
    areaStatus: { weld: 'g', paint: 'r', assy: 'r', qc: 'y' },
    activeCarStep: 3,
    defectRate: 5.2,
    vibroRms: 6.2,
    savedMoney: 0,
  },
  {
    at: 21,
    title: 'Этап 4: Рекомендация Explainable AI',
    desc: 'ИИ предлагает окно пересменки (15 мин) для замены дефектного звена цепи и калибровки форсунок камеры окраски.',
    areaStatus: { weld: 'g', paint: 'y', assy: 'y', qc: 'g' },
    activeCarStep: 3,
    defectRate: 3.1,
    vibroRms: 4.5,
    savedMoney: 950000,
  },
  {
    at: 26,
    title: 'Этап 5: Решение принято — спасено 1.83 млн ₸!',
    desc: 'Двойник пересчитал сценарий: простой 55 мин предотвращён, брак снижен до 2.0%, суточный план выполнен (120 авто)!',
    areaStatus: { weld: 'g', paint: 'g', assy: 'g', qc: 'g' },
    activeCarStep: 5,
    defectRate: 2.0,
    vibroRms: 2.2,
    savedMoney: 1833000,
  },
];

export default function LivePlantFlow({ model, onOpenArea, onOpenEquipment }) {
  const [demoActive, setDemoActive] = useState(false);
  const [demoTime, setDemoTime] = useState(0); // 0 .. 30 sec
  const [isPlaying, setIsPlaying] = useState(false);
  const timerRef = useRef(null);

  // Текущий шаг демо
  const currentDemoStep = DEMO_STEPS.slice().reverse().find((s) => demoTime >= s.at) || DEMO_STEPS[0];

  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setDemoTime((t) => {
          if (t >= 30) {
            setIsPlaying(false);
            return 30;
          }
          return +(t + 0.5).toFixed(1);
        });
      }, 500);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isPlaying]);

  const handleStartDemo = () => {
    setDemoActive(true);
    setDemoTime(0);
    setIsPlaying(true);
  };

  const handleStopDemo = () => {
    setDemoActive(false);
    setIsPlaying(false);
    setDemoTime(0);
  };

  // Определение цвета для этапа
  const getStageColor = (stageCode) => {
    if (demoActive) {
      const codeMap = { WELD: 'weld', PAINT: 'paint', ASSY: 'assy', QC: 'qc' };
      const key = codeMap[stageCode];
      if (key && currentDemoStep.areaStatus[key]) {
        return currentDemoStep.areaStatus[key];
      }
      return 'g';
    }
    const realArea = model.areas.find((a) => a.code === stageCode);
    return realArea ? realArea.st : 'g';
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Верхний бар управления «Живым заводом» и Демо-режимом */}
      <Blueprint className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-neutral-100/40">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse-dot" />
            <h4 className="text-xl font-bold font-heading">
              Интерактивная карта завода Allur: Сквозной поток
            </h4>
            <span className="text-xs bg-accent-100 text-accent-800 px-2 py-0.5 font-semibold">
              Линия 1 · Костанай
            </span>
          </div>
          <p className="text-xs text-neutral-600">
            Движение кузова по циклу «Склад → Сварка → Окраска → Сборка → ОТК → Отгрузка». Кликните на узел для цифрового паспорта.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {!demoActive ? (
            <button
              type="button"
              className="btn btn-primary flex items-center gap-2 shadow-xs"
              onClick={handleStartDemo}
            >
              <span className="text-sm">▶</span>
              <span>Запустить симуляцию смены (30 сек)</span>
              <span className="text-[10px] bg-accent-900 text-white px-1.5 py-0.5 rounded-xs font-mono">
                DEMO DAY
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2 bg-neutral-200/80 p-1.5 border border-divider">
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-xs font-bold"
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? '⏸ Пауза' : '▶ Продолжить'}
              </button>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-xs"
                onClick={() => setDemoTime(0)}
              >
                🔄 Сначала
              </button>
              <button
                type="button"
                className="btn btn-secondary px-2 py-1 text-xs text-neutral-700"
                onClick={handleStopDemo}
              >
                ✕ Выйти из демо
              </button>
            </div>
          )}
        </div>
      </Blueprint>

      {/* Панель Демо-симуляции (если активна) */}
      {demoActive && (
        <Blueprint className="p-4 bg-accent-100/40 border-accent-600 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="num font-bold text-2xl text-accent-800">
                00:{String(Math.floor(demoTime)).padStart(2, '0')}
              </span>
              <span className="text-xs text-neutral-600 font-mono">/ 00:30 с</span>
              <div className="h-4 w-px bg-divider" />
              <b className="text-sm text-text">{currentDemoStep.title}</b>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <div>
                Брак окраски:{' '}
                <b style={{ color: currentDemoStep.defectRate > 2.0 ? S.r.ink : S.g.ink }}>
                  {currentDemoStep.defectRate}%
                </b>
              </div>
              <div>
                Вибрация цепи:{' '}
                <b style={{ color: currentDemoStep.vibroRms > 4.5 ? S.r.ink : S.g.ink }}>
                  {currentDemoStep.vibroRms} мм/с
                </b>
              </div>
              {currentDemoStep.savedMoney > 0 && (
                <div className="bg-ok-ink/10 text-ok-ink px-2 py-0.5 font-bold">
                  Эффект: +{fmtInt(currentDemoStep.savedMoney)} ₸
                </div>
              )}
            </div>
          </div>

          {/* Прогресс-бар 30 секунд с засечками этапов */}
          <div className="relative h-2.5 bg-neutral-300 overflow-hidden rounded-xs">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${(demoTime / 30) * 100}%` }}
            />
            {DEMO_STEPS.map((s) => (
              <div
                key={s.at}
                className="absolute top-0 bottom-0 w-0.5 bg-white/70"
                style={{ left: `${(s.at / 30) * 100}%` }}
                title={s.title}
              />
            ))}
          </div>

          <p className="text-xs text-neutral-800 leading-relaxed font-body">
            {currentDemoStep.desc}
          </p>
        </Blueprint>
      )}

      {/* Схема «Живой конвейер»: 6 цехов со связями и движением кузовов */}
      <div className="overflow-x-auto pb-2">
        <div className="flex items-stretch gap-2" style={{ minWidth: 920 }}>
          {STAGES.map((stg, idx) => {
            const stColor = getStageColor(stg.code);
            const realArea = model.areas.find((a) => a.code === stg.code);
            const isLast = idx === STAGES.length - 1;

            return (
              <div key={stg.id} className="flex-1 flex items-stretch gap-2 min-w-[145px]">
                {/* Карточка технологического участка */}
                <div
                  className="blueprint flex-1 flex flex-col justify-between p-3 bg-bg hover:bg-neutral-100/80 transition-colors"
                  style={{ borderColor: S[stColor].frame }}
                >
                  <Corners />
                  {/* Статусная верхняя полоска */}
                  <div
                    className="h-1 -mt-3 -mx-3 mb-2.5"
                    style={{ background: S[stColor].fill }}
                  />

                  <div>
                    <div className="flex items-center justify-between gap-1 text-[11px] text-neutral-600 mb-1">
                      <span>0{idx + 1} · {stg.code}</span>
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: S[stColor].fill }}
                      />
                    </div>

                    <div className="font-heading font-bold text-lg leading-tight text-text">
                      {stg.name}
                    </div>

                    <div className="text-[11px] text-neutral-600 mt-0.5 flex items-center gap-1">
                      <span>{stg.icon}</span>
                      <span>Такт: {stg.normCt}</span>
                    </div>
                  </div>

                  {/* Оборудование участка (кликабельно) */}
                  <div className="mt-3 pt-2 border-t border-divider flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-600">
                      Оборудование:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {stg.units.map((uCode) => {
                        const eqObj = model.equipment?.find((e) => e.code === uCode) || {
                          id: uCode,
                          code: uCode,
                          name: uCode,
                          criticality: 'high',
                          status: stColor === 'r' ? 'breakdown' : stColor === 'y' ? 'maintenance' : 'running',
                        };

                        return (
                          <button
                            key={uCode}
                            type="button"
                            onClick={() => onOpenEquipment && onOpenEquipment(eqObj, realArea)}
                            className="text-[10px] px-1.5 py-0.5 bg-neutral-200/80 hover:bg-accent-200 border border-divider text-neutral-800 truncate max-w-full font-mono transition-colors"
                            title={`Открыть паспорт оборудования: ${uCode}`}
                          >
                            {uCode}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Кнопка деталей цеха */}
                  {realArea && (
                    <button
                      type="button"
                      onClick={() => onOpenArea && onOpenArea(realArea.id)}
                      className="mt-2 text-[11px] text-accent-700 hover:text-accent-900 font-medium text-left"
                    >
                      Параметры цеха →
                    </button>
                  )}
                </div>

                {/* Связующий конвейерный переход между участками с анимированным кузовом */}
                {!isLast && (
                  <div className="w-10 shrink-0 flex flex-col items-center justify-center relative">
                    {/* Конвейерная направляющая */}
                    <div className="w-full h-1.5 bg-neutral-300 relative overflow-hidden rounded-xs">
                      {/* Анимированный движущийся кузов (светящаяся точка) */}
                      <div
                        className="absolute top-0 bottom-0 w-3 bg-accent animate-convey"
                        style={{
                          background: stColor === 'r' ? S.r.fill : 'var(--color-accent)',
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-neutral-600 mt-1 font-mono">→</span>
                    <span className="text-[9px] text-neutral-600 -mt-0.5">буфер</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
