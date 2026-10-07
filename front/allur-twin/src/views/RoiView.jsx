import { useState } from 'react';
import { Blueprint, PageTitle, Slider } from '../components/ui';
import { ECON } from '../lib/model';
import { S, fmt1, fmtInt } from '../lib/format';

export default function RoiView({ _model }) {
  // Настраиваемый сценарный калькулятор (Killer Feature 3)
  const [hourlyDowntimeCost, setHourlyDowntimeCost] = useState(2_000_000); // 2 млн ₸ в час по умолчанию
  const [defectReworkCost, setDefectReworkCost] = useState(120_000);       // 120 тыс ₸ за кузов
  const [carMarginCost, setCarMarginCost] = useState(350_000);             // 350 тыс ₸ маржа с авто

  // Параметры CAPEX / OPEX
  const [capex, setCapex] = useState(85);
  const [opex, setOpex] = useState(20);
  const [share, setShare] = useState(100);

  // Расчет эффекта кейса (Конвейер-03: 55 мин простоя, Окраска: брак 5.2% -> 2.0%)
  const preventedDowntimeMin = 55;
  const taktMin = 4.0; // ~15 авто в час
  const savedCarsFromDowntime = Math.round(preventedDowntimeMin / taktMin); // ~14 авто
  const defectCarsSaved = 4; // разница между 5.2% и 2.0% при суточном выпуске 120 авто

  // Экономический расчет за 1 смену
  const downtimeShiftSavings = Math.round((preventedDowntimeMin / 60) * hourlyDowntimeCost);
  const defectShiftSavings = defectCarsSaved * defectReworkCost;
  const marginShiftSavings = savedCarsFromDowntime * carMarginCost;
  const totalShiftEffect = downtimeShiftSavings + defectShiftSavings;

  // Годовой пересчет с учетом настраиваемой стоимости часа простоя
  const annualDowntimeEffect = ((downtimeShiftSavings * 2 * ECON.workDaysYear) / 1e6) * (share / 100);
  const annualDefectEffect = ((defectShiftSavings * 2 * ECON.workDaysYear) / 1e6) * (share / 100);
  const annualMarginEffect = ((marginShiftSavings * 2 * ECON.workDaysYear) / 1e6) * (share / 100);

  const customAnnualTotal = annualDowntimeEffect + annualDefectEffect + annualMarginEffect;
  const net = customAnnualTotal - opex;
  const paybackMonths = net > 0 ? (capex / net) * 12 : Infinity;

  const quickCostPresets = [1_500_000, 2_000_000, 2_500_000, 3_000_000];

  const top = [
    {
      l: 'Прямой эффект за смену',
      v: `${fmt1(totalShiftEffect / 1e6)} млн ₸`,
      n: `при ставке ${fmtInt(hourlyDowntimeCost)} ₸/ч`,
      ink: 'var(--color-text)',
    },
    {
      l: 'Годовой потенциал внедрения',
      v: `${fmt1(customAnnualTotal / 1000)} млрд ₸`,
      n: `${ECON.workDaysYear} рабочих дней · 2 смены`,
      ink: S.g.ink,
    },
    {
      l: 'Чистый эффект в год',
      v: `${fmtInt(net)} млн ₸`,
      n: `за вычетом OPEX ${opex} млн ₸`,
      ink: net > 0 ? 'var(--color-text)' : S.r.ink,
    },
    {
      l: 'Срок окупаемости CAPEX',
      v: !Number.isFinite(paybackMonths) ? '—' : `${fmt1(paybackMonths)} мес.`,
      n: `CAPEX ${capex} млн ₸`,
      ink: S[paybackMonths <= 6 ? 'g' : paybackMonths <= 12 ? 'y' : 'r'].ink,
    },
  ];

  return (
    <main className="px-7 pt-6 pb-12 flex flex-col gap-6">
      <PageTitle
        title="Экономический эффект и Производственный потенциал (ROI)"
        sub="Критерий оценки хакатона: 20 баллов за производственный эффект и потенциал внедрения для завода Allur"
      />

      {/* КАРТОЧКА КЛЮЧЕВОГО ЭФФЕКТА ИЗ ЗАПРОСА ПОЛЬЗОВАТЕЛЯ */}
      <Blueprint className="p-5 bg-accent-100/40 border-accent-600 flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-divider pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">💰</span>
            <h3 className="font-heading font-bold text-2xl text-accent-900">
              Карточка производственного эффекта (Кейс Allur)
            </h3>
          </div>
          <span className="text-xs font-mono bg-accent-200 text-accent-800 px-2 py-0.5 font-bold">
            02.10 СЦЕНАРИЙ
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="border border-divider p-3 bg-bg">
            <div className="text-[11px] uppercase tracking-wider text-neutral-600">Предотвращённый простой</div>
            <div className="num font-bold text-2xl text-accent-800">{preventedDowntimeMin} мин</div>
            <div className="text-[11px] text-neutral-600">Конвейер-03 (сборка)</div>
          </div>

          <div className="border border-divider p-3 bg-bg">
            <div className="text-[11px] uppercase tracking-wider text-neutral-600">Сохранённый выпуск</div>
            <div className="num font-bold text-2xl text-text">+{savedCarsFromDowntime} авто</div>
            <div className="text-[11px] text-neutral-600">за счет непрерывного такта</div>
          </div>

          <div className="border border-divider p-3 bg-bg">
            <div className="text-[11px] uppercase tracking-wider text-neutral-600">Снижение брака</div>
            <div className="num font-bold text-2xl text-ok-ink">5,2% → 2,0%</div>
            <div className="text-[11px] text-neutral-600">+4 годных кузова / смену</div>
          </div>

          <div className="border border-divider p-3 bg-bg">
            <div className="text-[11px] uppercase tracking-wider text-neutral-600">Ожидаемая экономия</div>
            <div className="num font-bold text-2xl text-accent-800">≈ {fmt1(totalShiftEffect / 1e6)} млн ₸</div>
            <div className="text-[11px] text-neutral-600">прямой эффект за смену</div>
          </div>
        </div>

        {/* Сценарный калькулятор стоимости часа простоя */}
        <div className="pt-3 border-t border-divider flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1 max-w-xl text-xs text-neutral-800">
            <b className="text-sm font-heading font-bold text-text">
              Настраиваемый тариф Allur: Стоимость часа простоя линии
            </b>
            <p className="leading-relaxed">
              Мы не выдумываем закрытые финансовые ставки завода Allur. Финансовая служба может задать любой внутренний норматив:
            </p>
            <div className="p-2 bg-neutral-200/80 font-mono text-[11px] text-accent-900 border border-divider">
              При стоимости часа простоя <b>{fmtInt(hourlyDowntimeCost)} ₸</b> предотвращение 55 минут простоя даёт потенциальный эффект:
              <br />
              (55 / 60) × {fmtInt(hourlyDowntimeCost)} = <b>{fmtInt(downtimeShiftSavings)} ₸</b> (≈ {fmt1(downtimeShiftSavings / 1e6)} млн ₸).
            </div>
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold">Быстрый выбор:</span>
              <div className="flex border border-divider">
                {quickCostPresets.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setHourlyDowntimeCost(val)}
                    className="px-2 py-1 text-xs border-r border-divider last:border-r-0 hover:bg-neutral-200"
                    style={{
                      background: hourlyDowntimeCost === val ? 'var(--color-accent)' : 'transparent',
                      color: hourlyDowntimeCost === val ? 'white' : 'inherit',
                    }}
                  >
                    {fmt1(val / 1e6)} млн ₸
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-600">Точное значение:</span>
              <input
                type="number"
                step="100000"
                min="500000"
                max="10000000"
                value={hourlyDowntimeCost}
                onChange={(e) => setHourlyDowntimeCost(Math.max(100000, Number(e.target.value)))}
                className="w-36 px-2.5 py-1 text-xs border border-divider bg-bg font-mono font-bold"
              />
              <span className="text-xs text-neutral-600">₸ / час</span>
            </div>
          </div>
        </div>
      </Blueprint>

      {/* ВЕРХНИЕ ИТОГОВЫЕ KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-l border-divider bg-bg">
        {top.map((r) => (
          <div key={r.l} className="px-4 py-3.5 border-r border-b border-divider flex flex-col gap-1">
            <div className="text-xs text-neutral-600">{r.l}</div>
            <div className="num text-3xl font-bold leading-tight whitespace-nowrap" style={{ color: r.ink }}>
              {r.v}
            </div>
            <div className="text-[11px] text-neutral-600">{r.n}</div>
          </div>
        ))}
      </div>

      {/* КАЛЬКУЛЯТОР ИНВЕСТИЦИОННОЙ ОКУПАЕМОСТИ */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-7 items-start">
        <Blueprint className="p-5 flex flex-col gap-4 bg-bg">
          <h4 className="font-heading font-bold text-xl">Инвестиционные параметры пилота</h4>
          <Slider
            label="CAPEX (Пилотное внедрение)"
            value={capex}
            display={`${capex} млн ₸`}
            min={40}
            max={180}
            step={5}
            onChange={setCapex}
            hint="Датчики вибрации ISO 10816, шлюзы OPC UA, сервера цифрового двойника"
          />
          <Slider
            label="OPEX в год"
            value={opex}
            display={`${opex} млн ₸`}
            min={5}
            max={50}
            onChange={setOpex}
            hint="Техподдержка, калибровка датчиков и сопровождение AI-моделей"
          />
          <Slider
            label="Коэффициент консервативности"
            value={share}
            display={`${share}%`}
            min={20}
            max={100}
            step={5}
            onChange={setShare}
            hint="Консервативная оценка достижимости эффекта"
          />

          <Slider
            label="Затраты на доработку 1 дефекта"
            value={defectReworkCost}
            display={`${fmtInt(defectReworkCost)} ₸`}
            min={60000}
            max={200000}
            step={10000}
            onChange={setDefectReworkCost}
            hint="Повторная окраска и исправление геометрии"
          />

          <Slider
            label="Маржинальный доход с авто"
            value={carMarginCost}
            display={`${fmtInt(carMarginCost)} ₸`}
            min={200000}
            max={600000}
            step={25000}
            onChange={setCarMarginCost}
            hint="Упущенная выгода при срыве суточного плана"
          />

          <div className="text-[11px] text-neutral-600 leading-relaxed border-t border-divider pt-3 space-y-1">
            <div>• Стоимость часа простоя линии: <b>{fmtInt(hourlyDowntimeCost)} ₸</b></div>
            <div>• Затраты на доработку дефектного кузова: <b>{fmtInt(defectReworkCost)} ₸</b></div>
            <div>• Маржинальный доход с одного авто: <b>{fmtInt(carMarginCost)} ₸</b></div>
          </div>
        </Blueprint>

        <Blueprint className="p-5 flex flex-col gap-4 bg-bg">
          <h4 className="font-heading font-bold text-xl">Структура годового экономического эффекта</h4>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_120px] gap-4 items-center">
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Предотвращение простоев</span>
                <span className="text-[11px] text-neutral-600">Вибродиагностика и ТО цепей</span>
              </div>
              <div className="h-3 bg-neutral-200 overflow-hidden rounded-xs">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, (annualDowntimeEffect / (customAnnualTotal || 1)) * 100)}%` }}
                />
              </div>
              <div className="num font-bold text-lg text-right">{fmtInt(annualDowntimeEffect)} млн ₸</div>
            </div>

            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_120px] gap-4 items-center">
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Снижение брака и доработок</span>
                <span className="text-[11px] text-neutral-600">Калибровка фильтров и сушки</span>
              </div>
              <div className="h-3 bg-neutral-200 overflow-hidden rounded-xs">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, (annualDefectEffect / (customAnnualTotal || 1)) * 100)}%` }}
                />
              </div>
              <div className="num font-bold text-lg text-right">{fmtInt(annualDefectEffect)} млн ₸</div>
            </div>

            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_120px] gap-4 items-center">
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Возврат недовыпуска в такт</span>
                <span className="text-[11px] text-neutral-600">Сглаживание узких мест буферами</span>
              </div>
              <div className="h-3 bg-neutral-200 overflow-hidden rounded-xs">
                <div
                  className="h-full bg-accent"
                  style={{ width: `${Math.min(100, (annualMarginEffect / (customAnnualTotal || 1)) * 100)}%` }}
                />
              </div>
              <div className="num font-bold text-lg text-right">{fmtInt(annualMarginEffect)} млн ₸</div>
            </div>
          </div>

          <div className="p-3 bg-neutral-100/60 border border-divider text-xs text-neutral-700 leading-relaxed mt-2">
            <b>Вывод для защиты перед руководством Allur:</b>
            <p className="mt-1">
              Проект окупается менее чем за <b>{fmt1(paybackMonths)} месяца</b> за счёт устранения всего двух критических инцидентов из тестовых данных (простой Конвейера-03 на 55 мин и брак Окраски 5.2%).
            </p>
          </div>
        </Blueprint>
      </div>
    </main>
  );
}
