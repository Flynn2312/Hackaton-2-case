import { useState } from 'react';
import { Blueprint, PageTitle, Slider } from '../components/ui';
import { ECON, NORMS } from '../lib/model';
import { S, fmt1, fmtInt, sgn } from '../lib/format';

const round05 = (v) => Math.round(v * 2) / 2;

// Расширенная сценарная модель цифрового двойника
function simulateEnhanced(b, st) {
  const baseOee = round05(b.bottleneck?.oee ?? NORMS.oee);
  let dOut = 0;

  // 1. Управление браком (Окраска: факт 5.2% vs норма 2.0%)
  const baseDefect = b.defectArea?.defect ?? 5.2;
  const currentDefect = st.defectRate;
  const defectDiff = baseDefect - currentDefect; // положительно, если снижаем брак
  const defectCountDiff = (b.output * defectDiff) / 100;
  dOut += defectCountDiff * 0.7; // 70% устраненных дефектов переходят в годный выпуск без доработки

  // 2. Влияние простоя оборудования (+/- минут)
  // При такте ~4 мин/авто каждый час простоя = потеря ~15 авто
  const taktMin = b.taktMin || 4.0;
  const netDowntimeChange = st.extraDowntime - (st.maint ? (b.maintEq?.avgPerDay ?? 30) * 0.8 : 0);
  dOut -= netDowntimeChange / taktMin;

  // 3. Изменение загрузки линии (loadDelta: -30% .. +15%)
  dOut += (b.output * st.loadDelta) / 100;

  // 4. Остановка отдельных агрегатов (аварийный останов)
  if (st.stoppedConveyor) dOut -= 55 / taktMin; // остановка Конвейера-03
  if (st.stoppedPaint) dOut -= 40 / taktMin;    // остановка Камеры-02
  if (st.stoppedWeld) dOut -= 25 / taktMin;     // остановка Робота ABB-01

  // 5. Влияние буфера (гашение колебаний)
  const starv = Math.max(0, b.starvation - (st.buf - NORMS.bufferMin) * taktMin);
  dOut += ((b.starvation - starv) / taktMin) * 0.4;

  // Результирующий выпуск
  const out = Math.max(0, b.output + dOut);
  const planFulfillmentPct = (out / b.plan) * 100;

  // Риск срыва плана (0 - 100%)
  let planRiskPct = 0;
  if (out < b.plan) {
    planRiskPct = Math.min(100, Math.round(((b.plan - out) / b.plan) * 100 * 2.5));
  }

  // Пересчет OEE
  const simulatedOee = Math.max(35, Math.min(98, baseOee + (dOut / b.plan) * 100));

  // Финансовый эффект
  // Простой: стоимость минуты
  const downtimeLossKzt = Math.max(0, netDowntimeChange) * ECON.downtimeMinKzt;
  const downtimeSavedKzt = Math.max(0, -netDowntimeChange) * ECON.downtimeMinKzt;

  // Брак: исправление дефектного кузова (120 000 ₸)
  const defectLossKzt = Math.max(0, -defectDiff) * (b.output / 100) * ECON.defectKzt;
  const defectSavedKzt = Math.max(0, defectDiff) * (b.output / 100) * ECON.defectKzt;

  // Маржинальный доход с дополнительно выпущенных / недовыпущенных авто
  const marginDeltaKzt = dOut * ECON.carMarginKzt;

  // Итоговый чистый суточный эффект сценария (в млн ₸)
  const dailyFinancialDeltaMln = (marginDeltaKzt + downtimeSavedKzt + defectSavedKzt - downtimeLossKzt - defectLossKzt) / 1e6;

  // Годовой прогноз
  const month = Math.max(0, Math.round(b.monthForecast + dOut * b.remainingDays));
  const annualEffectMln = dailyFinancialDeltaMln * ECON.workDaysYear;

  const critDowntimeSim = Math.max(0, Math.round(b.critDowntime + netDowntimeChange + (st.stoppedConveyor ? 55 : 0)));

  return {
    baseOee,
    dOut,
    out,
    simulatedOee,
    defect: currentDefect,
    downtime: critDowntimeSim,
    planRiskPct,
    planFulfillmentPct,
    month,
    dailyFinancialDeltaMln,
    annualEffectMln,
  };
}

export default function WhatIfView({ model, preset }) {
  const b = model.whatIfBase;
  const baseDefect = b.defectArea?.defect ?? 5.2;

  const initial = {
    extraDowntime: 0,      // +X минут простоя
    loadDelta: 0,          // % изменения загрузки линии
    defectRate: baseDefect,// % брака
    stoppedConveyor: false,// аварийный останов Конвейера-03
    stoppedPaint: false,   // аварийный останов Камеры-02
    stoppedWeld: false,    // аварийный останов Робота ABB-01
    maint: false,          // превентивное ТО
    buf: NORMS.bufferMin,  // размер буфера
  };

  const [st, setSt] = useState(() => {
    if (!preset) return initial;
    return {
      ...initial,
      extraDowntime: preset.downtimeMin || 0,
      defectRate: preset.defectPct || baseDefect,
      stoppedConveyor: preset.equipmentName?.includes('Конвейер-03') || false,
      stoppedPaint: preset.equipmentName?.includes('Камера-02') || false,
      stoppedWeld: preset.equipmentName?.includes('ABB-01') || false,
    };
  });

  const [prevPreset, setPrevPreset] = useState(preset);
  if (preset !== prevPreset) {
    setPrevPreset(preset);
    if (preset) {
      setSt((prev) => ({
        ...prev,
        extraDowntime: preset.downtimeMin || prev.extraDowntime,
        defectRate: preset.defectPct || prev.defectRate,
        stoppedConveyor: preset.equipmentName?.includes('Конвейер-03') || false,
        stoppedPaint: preset.equipmentName?.includes('Камера-02') || false,
        stoppedWeld: preset.equipmentName?.includes('ABB-01') || false,
      }));
    }
  }

  const set = (patch) => setSt((s) => ({ ...s, ...patch }));
  const r = simulateEnhanced(b, st);

  const tone = (good, warn) => (good ? 'g' : warn ? 'y' : 'r');

  // Быстрые сценарии в 1 клик
  const applyPresetScenario = (name) => {
    if (name === 'paint-defect') {
      set({ ...initial, defectRate: 5.2, extraDowntime: 0, stoppedPaint: true });
    } else if (name === 'conveyor-break') {
      set({ ...initial, extraDowntime: 55, stoppedConveyor: true, loadDelta: -5 });
    } else if (name === 'load-drop') {
      set({ ...initial, loadDelta: -15 });
    } else if (name === 'optimal') {
      set({
        ...initial,
        defectRate: 2.0,
        extraDowntime: -30,
        maint: true,
        buf: 12,
        stoppedConveyor: false,
        stoppedPaint: false,
        stoppedWeld: false,
      });
    } else if (name === 'reset') {
      setSt(initial);
    }
  };

  return (
    <main className="px-7 pt-6 pb-12 flex flex-col gap-6">
      <PageTitle
        title="Сценарный тренажёр: Что будет, если? (What-If Simulation)"
        sub="Смоделируйте управленческие воздействия до их применения на реальном заводе Allur"
      />

      {/* KILLER FEATURE BANNER СО СЛОГАНОМ ДЛЯ ЗАЩИТЫ ПЕРЕД ЖЮРИ */}
      <Blueprint className="p-4 bg-accent-100/60 border-accent-600 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎯</span>
          <div>
            <div className="font-heading font-bold text-lg text-accent-900 tracking-wide">
              «Большинство систем показывают, что уже произошло. Наш цифровой двойник позволяет проверить, что произойдёт дальше».
            </div>
            <div className="text-xs text-neutral-700 mt-0.5">
              Моделирование влияния простоев, брака окраски и загрузки конвейера на суточный выпуск и финансовый результат в тенге.
            </div>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-neutral-600 mr-1">Быстрые сценарии:</span>
          <button
            type="button"
            className="btn btn-secondary text-xs px-2.5 py-1 bg-white hover:bg-neutral-100"
            onClick={() => applyPresetScenario('paint-defect')}
          >
            🚨 Брак 5.2%
          </button>
          <button
            type="button"
            className="btn btn-secondary text-xs px-2.5 py-1 bg-white hover:bg-neutral-100"
            onClick={() => applyPresetScenario('conveyor-break')}
          >
            ⚙ Обрыв цепи (55 мин)
          </button>
          <button
            type="button"
            className="btn btn-secondary text-xs px-2.5 py-1 bg-white hover:bg-neutral-100"
            onClick={() => applyPresetScenario('load-drop')}
          >
            📉 Загрузка −15%
          </button>
          <button
            type="button"
            className="btn btn-primary text-xs px-2.5 py-1"
            onClick={() => applyPresetScenario('optimal')}
          >
            💡 Оптимальный
          </button>
          <button
            type="button"
            className="btn btn-ghost text-xs px-2 py-1 text-neutral-600"
            onClick={() => applyPresetScenario('reset')}
          >
            Сброс
          </button>
        </div>
      </Blueprint>

      {/* Основная рабочая область: Слева рычаги, Справа пересчитанный двойник */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.25fr)] gap-7 items-start">
        {/* ПАНЕЛЬ РЫЧАГОВ И ПАРАМЕТРОВ ВОЗДЕЙСТВИЯ */}
        <Blueprint className="p-5 flex flex-col gap-5 bg-bg">
          <div className="flex items-center justify-between border-b border-divider pb-2.5">
            <h4 className="font-heading font-bold text-xl">Параметры симуляции</h4>
            <span className="text-xs text-neutral-600">Воздействие на виртуальную копию</span>
          </div>

          {/* 1. Дополнительный простой оборудования */}
          <Slider
            label="Внеплановый простой оборудования (+/-)"
            value={st.extraDowntime}
            display={`${st.extraDowntime > 0 ? '+' : ''}${st.extraDowntime} мин`}
            min={-30}
            max={90}
            step={5}
            onChange={(v) => set({ extraDowntime: v })}
            hint="Проверьте последствия: +30 мин простоя, +55 мин аварии цепи"
            marks={['-30 мин', '0 (факт)', '+30 мин', '+55 мин (обрыв цепи)', '+90 мин']}
          />

          {/* 2. Загрузка линии (-30% .. +15%) */}
          <Slider
            label="Изменение загрузки производственной линии"
            value={st.loadDelta}
            display={`${st.loadDelta > 0 ? '+' : ''}${st.loadDelta}%`}
            min={-30}
            max={15}
            step={1}
            onChange={(v) => set({ loadDelta: v })}
            hint="Моделирование замедления линии или ускорения такта"
            marks={['-30%', '-15%', '0 (факт)', '+10%']}
          />

          {/* 3. Уровень брака на Окраске */}
          <Slider
            label={`Брак на участке «Окраска-1» (факт 5.2% vs норма ≤ 2.0%)`}
            value={st.defectRate}
            display={`${fmt1(st.defectRate)}%`}
            min={0.5}
            max={8.0}
            step={0.1}
            onChange={(v) => set({ defectRate: v })}
            hint="Калибровка сушильной камеры снижает брак до нормы ≤ 2.0%"
            marks={['0.5%', '2.0% (норма)', '5.2% (факт 02.10)', '8.0%']}
          />

          {/* 4. Аварийная остановка оборудования */}
          <div className="flex flex-col gap-2 pt-2 border-t border-divider">
            <span className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
              Симуляция аварийного останова узлов:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => set({ stoppedConveyor: !st.stoppedConveyor })}
                className="p-2.5 border border-divider text-left text-xs flex flex-col gap-1 transition-colors"
                style={{
                  background: st.stoppedConveyor ? S.r.tint : 'transparent',
                  borderColor: st.stoppedConveyor ? S.r.frame : 'var(--color-divider)',
                }}
              >
                <b className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: st.stoppedConveyor ? S.r.fill : S.g.fill }} />
                  Конвейер-03
                </b>
                <span className="text-[11px] text-neutral-600">Сборка (+55 мин)</span>
              </button>

              <button
                type="button"
                onClick={() => set({ stoppedPaint: !st.stoppedPaint })}
                className="p-2.5 border border-divider text-left text-xs flex flex-col gap-1 transition-colors"
                style={{
                  background: st.stoppedPaint ? S.r.tint : 'transparent',
                  borderColor: st.stoppedPaint ? S.r.frame : 'var(--color-divider)',
                }}
              >
                <b className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: st.stoppedPaint ? S.r.fill : S.g.fill }} />
                  Камера-02
                </b>
                <span className="text-[11px] text-neutral-600">Окраска (+40 мин)</span>
              </button>

              <button
                type="button"
                onClick={() => set({ stoppedWeld: !st.stoppedWeld })}
                className="p-2.5 border border-divider text-left text-xs flex flex-col gap-1 transition-colors"
                style={{
                  background: st.stoppedWeld ? S.r.tint : 'transparent',
                  borderColor: st.stoppedWeld ? S.r.frame : 'var(--color-divider)',
                }}
              >
                <b className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: st.stoppedWeld ? S.r.fill : S.g.fill }} />
                  Робот ABB-01
                </b>
                <span className="text-[11px] text-neutral-600">Сварка (+25 мин)</span>
              </button>
            </div>
          </div>

          {/* 5. Буфер и превентивное ТО */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-divider">
            <Slider
              label="Буфер перед сборкой"
              value={st.buf}
              display={`${st.buf} шт`}
              min={4}
              max={16}
              onChange={(v) => set({ buf: v })}
              hint="Гасит простои сварки/окраски"
            />

            <div className="flex flex-col justify-end">
              <button
                type="button"
                onClick={() => set({ maint: !st.maint })}
                className="p-2.5 border border-divider text-left text-xs flex items-center gap-2.5 h-[62px]"
                style={{
                  background: st.maint ? S.g.tint : 'transparent',
                  borderColor: st.maint ? S.g.frame : 'var(--color-divider)',
                }}
              >
                <span className="text-lg">{st.maint ? '✓' : '○'}</span>
                <div>
                  <b className="block">Превентивное ТО в пересменку</b>
                  <span className="text-[11px] text-neutral-600">Замена цепи и фильтров (15 мин)</span>
                </div>
              </button>
            </div>
          </div>
        </Blueprint>

        {/* ПЕРЕСЧИТАННЫЙ ЦИФРОВОЙ ДВОЙНИК (РЕЗУЛЬТАТЫ СИМУЛЯЦИИ) */}
        <section className="grid grid-cols-2 border-t border-l border-divider bg-bg">
          {/* 1. Выпуск за сутки */}
          <div className="px-4 py-3.5 border-r border-b border-divider flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-700">Прогноз выпуска за сутки</span>
              <span className="font-bold" style={{ color: r.dOut >= 0 ? S.g.ink : S.r.ink }}>
                {r.dOut !== 0 ? sgn(r.dOut) : '—'}
              </span>
            </div>
            <div className="num text-3xl font-bold leading-none" style={{ color: S[tone(r.out >= b.plan, r.out >= b.plan * 0.95)].ink }}>
              {Math.round(r.out)} авто
            </div>
            <div className="text-[11px] text-neutral-600">
              было {fmtInt(b.output)} · план {fmtInt(b.plan)} авто
            </div>
          </div>

          {/* 2. Риск невыполнения плана */}
          <div className="px-4 py-3.5 border-r border-b border-divider flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-700">Риск срыва плана</span>
              <span className="font-bold">
                {r.planRiskPct > 0 ? `${r.planRiskPct}%` : 'минимальный'}
              </span>
            </div>
            <div className="num text-3xl font-bold leading-none" style={{ color: S[tone(r.planRiskPct <= 15, r.planRiskPct <= 45)].ink }}>
              {r.planRiskPct}%
            </div>
            <div className="text-[11px] text-neutral-600">
              выполнение {Math.round(r.planFulfillmentPct)}% от плана
            </div>
          </div>

          {/* 3. OEE линии */}
          <div className="px-4 py-3.5 border-r border-b border-divider flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-700">Прогнозный OEE линии</span>
              <span className="font-bold">{sgn(r.simulatedOee - r.baseOee, fmt1)}%</span>
            </div>
            <div className="num text-3xl font-bold leading-none" style={{ color: S[tone(r.simulatedOee >= NORMS.oee, r.simulatedOee >= NORMS.oee - 10)].ink }}>
              {fmt1(r.simulatedOee)}%
            </div>
            <div className="text-[11px] text-neutral-600">
              целевой норматив ≥ {NORMS.oee}%
            </div>
          </div>

          {/* 4. Брак на окраске */}
          <div className="px-4 py-3.5 border-r border-b border-divider flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-700">Брак на окраске</span>
              <span className="font-bold" style={{ color: r.defect <= 2.0 ? S.g.ink : S.r.ink }}>
                {r.defect <= 2.0 ? 'в норме' : 'превышение'}
              </span>
            </div>
            <div className="num text-3xl font-bold leading-none" style={{ color: S[tone(r.defect <= NORMS.defect, r.defect <= NORMS.defect * 2)].ink }}>
              {fmt1(r.defect)}%
            </div>
            <div className="text-[11px] text-neutral-600">
              было 5.2% · норма ≤ {fmt1(NORMS.defect)}%
            </div>
          </div>

          {/* 5. Простой критического оборудования */}
          <div className="px-4 py-3.5 border-r border-b border-divider flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-700">Простой крит. оборуд.</span>
              <span className="font-bold">{r.downtime > b.critDowntime ? `+${r.downtime - b.critDowntime} мин` : 'норма'}</span>
            </div>
            <div className="num text-3xl font-bold leading-none" style={{ color: S[tone(r.downtime <= NORMS.critDowntime * 0.75, r.downtime <= NORMS.critDowntime)].ink }}>
              {r.downtime} мин
            </div>
            <div className="text-[11px] text-neutral-600">
              лимит ≤ {NORMS.critDowntime} мин/сутки
            </div>
          </div>

          {/* 6. Ожидаемый суточный фин. результат */}
          <div className="px-4 py-3.5 border-r border-b border-divider flex flex-col gap-1 bg-neutral-100/30">
            <div className="flex justify-between text-xs">
              <span className="text-neutral-700 font-semibold">Финансовый эффект</span>
              <span className="font-bold" style={{ color: r.dailyFinancialDeltaMln >= 0 ? S.g.ink : S.r.ink }}>
                {r.dailyFinancialDeltaMln >= 0 ? 'экономия' : 'потери'}
              </span>
            </div>
            <div className="num text-3xl font-bold leading-none" style={{ color: r.dailyFinancialDeltaMln >= 0 ? S.g.ink : S.r.ink }}>
              {sgn(r.dailyFinancialDeltaMln, fmt1)} млн ₸
            </div>
            <div className="text-[11px] text-neutral-600">
              за смену · годовой: {fmtInt(r.annualEffectMln)} млн ₸
            </div>
          </div>

          {/* Месячный план и прогресс-бар */}
          <div className="col-span-2 px-4 py-4 border-r border-b border-divider flex flex-col gap-2">
            <div className="flex justify-between text-xs font-semibold">
              <span>Месячный прогноз выпуска: {fmtInt(r.month)} авто</span>
              <span>План {fmtInt(b.monthPlan)} авто ({Math.round((r.month / b.monthPlan) * 100)}%)</span>
            </div>
            <div className="h-2.5 bg-neutral-200 relative overflow-hidden rounded-xs">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (r.month / b.monthPlan) * 100)}%`,
                  background: S[tone(r.month >= b.monthPlan, r.month >= b.monthPlan * 0.93)].fill,
                }}
              />
            </div>
            <div className="text-[11px] text-neutral-600">
              Осталось {b.remainingDays} раб. дней в расчетном месяце. Сценарий пересчитывает баланс завода в реальном времени.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
