import { useState } from 'react';
import { Blueprint, PageTitle, Slider } from '../components/ui';
import { NORMS } from '../lib/model';
import { api } from '../lib/api';
import { S, fmt1, fmtDateTime } from '../lib/format';

const TONE = { good: 'g', warn: 'y', bad: 'r' };
const STOP_NODES = [['stoppedConveyor', 'Конвейер-03'], ['stoppedPaint', 'Камера-02'], ['stoppedWeld', 'ABB-01']];

// Текущий брак окраски за сутки — точка отсчёта для ползунка
function paintDefect(model) {
  const paint = model.areas.find((a) => a.code === 'PAINT');
  return paint?.hasRec && paint.defect > 0 ? Math.round(paint.defect * 10) / 10 : 5.2;
}

function initialState(model) {
  const baseDefect = paintDefect(model);
  return {
    extraDowntime: 0,       // +X минут простоя
    loadDelta: 0,           // % изменения загрузки линии
    defectRate: baseDefect, // % брака на окраске
    baseDefect,             // с чего начинали — меняются только сдвинутые рычаги
    stoppedConveyor: false, // аварийный останов Конвейера-03
    stoppedPaint: false,    // аварийный останов Камеры-02
    stoppedWeld: false,     // аварийный останов Робота ABB-01
    maint: false,           // превентивное ТО
    buf: NORMS.bufferMin,   // буфер перед сборкой
  };
}

// Пресет из карточки оборудования или AI Risk Center
function withPreset(st, preset) {
  const stops = Object.fromEntries(STOP_NODES.map(([k, name]) => [k, !!preset.equipmentName?.includes(name)]));
  const nodeStopped = Object.values(stops).some(Boolean);
  return {
    ...st,
    ...stops,
    // Останов известного узла уже включает его простой — не учитываем его второй раз ползунком
    extraDowntime: nodeStopped ? 0 : preset.downtimeMin || st.extraDowntime,
    defectRate: preset.defectPct || st.defectRate,
  };
}

const toRequest = (st) => ({
  extra_downtime: st.extraDowntime,
  load_delta: st.loadDelta,
  defect_rate: st.defectRate,
  base_defect_rate: st.baseDefect,
  stopped_conveyor: st.stoppedConveyor,
  stopped_paint: st.stoppedPaint,
  stopped_weld: st.stoppedWeld,
  maint: st.maint,
  buf: st.buf,
  base_buf: NORMS.bufferMin,
});

function Bullets({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h6 className="text-neutral-700">{title}</h6>
      <ul className="flex flex-col gap-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-sm leading-[1.45]">
            <span className="w-1 shrink-0 mt-1.5 h-3" style={{ background: 'var(--color-accent)' }} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ForecastPanel({ forecast, stale, onRun }) {
  const loading = forecast.status === 'loading';
  const r = forecast.data;
  const st = r ? TONE[r.tone] ?? 'y' : null;

  return (
    <Blueprint className="p-5 flex flex-col gap-4 bg-bg">
      <div className="flex items-start justify-between gap-4 border-b border-divider pb-3">
        <div>
          <h4 className="font-heading font-bold text-xl">Прогноз ИИ</h4>
          <div className="text-xs text-neutral-600">Сценарий проигрывается на копии живого завода: 8 часов работы линии со сценарием и без него</div>
        </div>
        <button type="button" className="btn btn-primary shrink-0 px-5" onClick={onRun} disabled={loading}>
          {loading ? 'Прогнозирую…' : r ? 'Спрогнозировать заново' : 'Спрогнозировать'}
        </button>
      </div>

      {forecast.status === 'idle' && (
        <div className="text-sm text-neutral-700 leading-[1.5]">
          Задайте параметры слева — простой, загрузку, брак, аварии узлов, буфер, ТО — и нажмите «Спрогнозировать».
          ИИ коротко объяснит, к чему приведёт сценарий, почему и что делать.
        </div>
      )}

      {loading && (
        <div className="flex flex-col gap-2 py-2">
          <div className="flex items-center gap-2 font-medium">
            <span className="w-2 h-2 rounded-full animate-pulse-dot" style={{ background: 'var(--color-accent)' }} />
            Модель завода проигрывает сценарий, ИИ готовит вывод…
          </div>
          <div className="text-xs text-neutral-700">Обычно 10–25 секунд.</div>
        </div>
      )}

      {forecast.status === 'error' && (
        <div className="text-sm" style={{ color: S.r.ink }}>Не удалось построить прогноз: {forecast.error}</div>
      )}

      {r && !loading && (
        <>
          {stale && (
            <div className="text-xs px-3 py-2" style={{ background: S.y.tint, color: S.y.ink }}>
              Параметры изменены после прогноза — нажмите «Спрогнозировать заново», чтобы увидеть новый результат.
            </div>
          )}

          <div className="px-4 py-3 font-heading font-semibold text-lg leading-snug" style={{ background: S[st].tint, color: S[st].ink, borderLeft: `4px solid ${S[st].fill}` }}>
            {r.verdict}
          </div>

          <div className="grid grid-cols-2 border-t border-l border-divider">
            {r.key_figures.map((k) => (
              <div key={k.label} className="px-3.5 py-3 border-r border-b border-divider flex flex-col gap-0.5">
                <span className="text-xs text-neutral-700">{k.label}</span>
                <span className="num text-2xl leading-tight">{k.value}</span>
                <span className="text-xs font-semibold" style={{ color: S[TONE[k.tone] ?? 'y'].ink }}>{k.change}</span>
              </div>
            ))}
          </div>

          <Bullets title="К чему приведёт" items={r.consequences} />
          <Bullets title="Почему" items={r.reasons} />
          <Bullets title="Как действовать" items={r.actions} />

          <div className="text-[11px] text-neutral-600 border-t border-divider pt-2.5">
            {r.source_label} · состояние завода на {fmtDateTime(r.sim_time)} · горизонт {r.horizon_h} ч ·{' '}
            цифры — среднее по нескольким прогонам модели завода
            {r.scenario?.length > 0 && <> · сценарий: {r.scenario.join('; ')}</>}
          </div>
        </>
      )}
    </Blueprint>
  );
}

export default function WhatIfView({ model, preset }) {
  const [st, setSt] = useState(() => (preset ? withPreset(initialState(model), preset) : initialState(model)));
  const [forecast, setForecast] = useState({ status: 'idle' });

  const [prevPreset, setPrevPreset] = useState(preset);
  if (preset !== prevPreset) {
    setPrevPreset(preset);
    if (preset) setSt((prev) => withPreset(prev, preset));
  }

  const set = (patch) => setSt((s) => ({ ...s, ...patch }));
  const request = toRequest(st);
  const stale = forecast.data && JSON.stringify(request) !== forecast.key;

  const runForecast = async () => {
    const key = JSON.stringify(request);
    setForecast((f) => ({ ...f, status: 'loading' }));
    try {
      const data = await api.whatIf(request);
      setForecast({ status: 'done', data, key });
    } catch (e) {
      setForecast({ status: 'error', error: e.message });
    }
  };

  // Быстрые сценарии в 1 клик
  const applyPresetScenario = (name) => {
    const initial = initialState(model);
    if (name === 'paint-defect') {
      setSt({ ...initial, defectRate: Math.max(5.2, initial.defectRate), stoppedPaint: true });
    } else if (name === 'conveyor-break') {
      setSt({ ...initial, stoppedConveyor: true, loadDelta: -5 }); // останов Конвейера-03 = 55 мин простоя
    } else if (name === 'load-drop') {
      setSt({ ...initial, loadDelta: -15 });
    } else if (name === 'optimal') {
      setSt({ ...initial, defectRate: 2.0, extraDowntime: -30, maint: true, buf: 12 });
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
          <div>
            <div className="font-heading font-bold text-lg text-accent-900 tracking-wide">
              «Большинство систем показывают, что уже произошло. Наш цифровой двойник позволяет проверить, что произойдёт дальше».
            </div>
            <div className="text-xs text-neutral-700 mt-0.5">
              Сценарий проигрывается на копии живого завода, а ИИ объясняет последствия для выпуска, брака, простоя и денег.
            </div>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-neutral-600 mr-1">Быстрые сценарии:</span>
          <button type="button" className="btn btn-secondary text-xs px-2.5 py-1 bg-white hover:bg-neutral-100" onClick={() => applyPresetScenario('paint-defect')}>
            Брак окраски
          </button>
          <button type="button" className="btn btn-secondary text-xs px-2.5 py-1 bg-white hover:bg-neutral-100" onClick={() => applyPresetScenario('conveyor-break')}>
            Обрыв цепи (55 мин)
          </button>
          <button type="button" className="btn btn-secondary text-xs px-2.5 py-1 bg-white hover:bg-neutral-100" onClick={() => applyPresetScenario('load-drop')}>
            Загрузка −15%
          </button>
          <button type="button" className="btn btn-primary text-xs px-2.5 py-1" onClick={() => applyPresetScenario('optimal')}>
            Оптимальный
          </button>
          <button type="button" className="btn btn-ghost text-xs px-2 py-1 text-neutral-600" onClick={() => applyPresetScenario('reset')}>
            Сброс
          </button>
        </div>
      </Blueprint>

      {/* Основная рабочая область: слева рычаги, справа прогноз ИИ */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.25fr)] gap-7 items-start">
        <Blueprint className="p-5 flex flex-col gap-5 bg-bg">
          <div className="flex items-center justify-between border-b border-divider pb-2.5">
            <h4 className="font-heading font-bold text-xl">Параметры симуляции</h4>
            <span className="text-xs text-neutral-600">Воздействие на виртуальную копию</span>
          </div>

          <Slider
            label="Внеплановый простой оборудования (+/-)"
            value={st.extraDowntime}
            display={`${st.extraDowntime > 0 ? '+' : ''}${st.extraDowntime} мин`}
            min={-30}
            max={90}
            step={5}
            onChange={(v) => set({ extraDowntime: v })}
            hint="Плюс — внеплановая остановка самого изношенного критичного оборудования, минус — меньше отказов за счёт обслуживания"
            marks={['-30 мин', '0 (факт)', '+30 мин', '+55 мин', '+90 мин']}
          />

          <Slider
            label="Изменение загрузки производственной линии"
            value={st.loadDelta}
            display={`${st.loadDelta > 0 ? '+' : ''}${st.loadDelta}%`}
            min={-30}
            max={15}
            step={1}
            onChange={(v) => set({ loadDelta: v })}
            hint="Замедление линии или ускорение такта"
            marks={['-30%', '-15%', '0 (факт)', '+10%']}
          />

          <Slider
            label={`Брак на участке «Окраска» (сейчас ${fmt1(st.baseDefect)}% · норма ≤ ${fmt1(NORMS.defect)}%)`}
            value={st.defectRate}
            display={`${fmt1(st.defectRate)}%`}
            min={0.5}
            max={8.0}
            step={0.1}
            onChange={(v) => set({ defectRate: v })}
            hint="Калибровка сушильной камеры снижает брак до нормы ≤ 2.0%"
            marks={['0.5%', '2.0% (норма)', '5.0%', '8.0%']}
          />

          <div className="flex flex-col gap-2 pt-2 border-t border-divider">
            <span className="text-xs font-semibold text-neutral-700 uppercase tracking-wider">
              Симуляция аварийного останова узлов:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                ['stoppedConveyor', 'Конвейер-03', 'Сборка (55 мин)'],
                ['stoppedPaint', 'Камера-02', 'Окраска (40 мин)'],
                ['stoppedWeld', 'Робот ABB-01', 'Сварка (25 мин)'],
              ].map(([k, name, sub]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set({ [k]: !st[k] })}
                  className="p-2.5 border border-divider text-left text-xs flex flex-col gap-1 transition-colors"
                  style={{ background: st[k] ? S.r.tint : 'transparent', borderColor: st[k] ? S.r.frame : 'var(--color-divider)' }}
                >
                  <b className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: st[k] ? S.r.fill : S.g.fill }} />
                    {name}
                  </b>
                  <span className="text-[11px] text-neutral-600">{sub}</span>
                </button>
              ))}
            </div>
          </div>

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
                style={{ background: st.maint ? S.g.tint : 'transparent', borderColor: st.maint ? S.g.frame : 'var(--color-divider)' }}
              >
                <span className="text-lg">{st.maint ? '✓' : '○'}</span>
                <div>
                  <b className="block">Превентивное ТО в пересменку</b>
                  <span className="text-[11px] text-neutral-600">Изношенные узлы обслуживаются без остановки линии</span>
                </div>
              </button>
            </div>
          </div>
        </Blueprint>

        <ForecastPanel forecast={forecast} stale={stale} onRun={runForecast} />
      </div>
    </main>
  );
}
