import { useState } from "react";

export default function BusinessRoiModal({ isOpen, onClose }) {
  const [downtimeReduction, setDowntimeReduction] = useState(18.5); // %
  const [paintScrapTarget, setPaintScrapTarget] = useState(1.3); // %
  const [hourlyDowntimeCost, setHourlyDowntimeCost] = useState(5.1); // млн KZT

  if (!isOpen) return null;

  // Расчет годового эффекта в KZT:
  // 1. Сокращение простоев: 780 ч/год * (reduction / 100) * hourlyDowntimeCost млн
  const savedDowntimeHours = Math.round(780 * (downtimeReduction / 100));
  const downtimeSavings = Math.round(savedDowntimeHours * hourlyDowntimeCost * 1_000_000);

  // 2. Снижение брака ЛКП: с 4.2% до target (на 25 000 авто/год) по 120 000 KZT перекрас
  const scrapDeltaPercent = Math.max(0, 4.2 - paintScrapTarget);
  const savedBodies = Math.round(25000 * (scrapDeltaPercent / 100));
  const scrapSavings = savedBodies * 120_000;

  // 3. Выравнивание такта сборки (+240 авто * маржа 1.45 млн)
  const capacityGain = 240 * 1_450_000;

  const totalAnnualEffect = downtimeSavings + scrapSavings + capacityGain;
  const capex = 85_000_000; // 85 млн тенге внедрение
  const paybackMonths = ((capex / (totalAnnualEffect / 12))).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden border border-slate-200">
        <div className="px-6 py-4 bg-[#17232F] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📊</span>
            <div>
              <h2 className="text-lg font-bold">Экономический эффект внедрения для АО «Allur»</h2>
              <p className="text-xs text-slate-300">Кейс №2 · Оценка производственного эффекта (Критерий 20 баллов)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none px-2 py-1 rounded"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto text-slate-800">
          {/* Сводка эффекта */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
              <span className="text-xs uppercase font-semibold text-emerald-700">Годовой эффект</span>
              <div className="text-2xl font-extrabold text-emerald-800 mt-1">
                {(totalAnnualEffect / 1_000_000_000).toFixed(2)} млрд ₸
              </div>
              <span className="text-xs text-emerald-600">чистая экономия и доход</span>
            </div>
            <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 text-center">
              <span className="text-xs uppercase font-semibold text-sky-700">Окупаемость (Payback)</span>
              <div className="text-2xl font-extrabold text-sky-800 mt-1">
                {paybackMonths} мес
              </div>
              <span className="text-xs text-sky-600">CAPEX 85 млн ₸</span>
            </div>
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center">
              <span className="text-xs uppercase font-semibold text-amber-700">Сэкономлено времени</span>
              <div className="text-2xl font-extrabold text-amber-800 mt-1">
                +{savedDowntimeHours} часов
              </div>
              <span className="text-xs text-amber-600">простоев линии в год</span>
            </div>
          </div>

          {/* Интерактивные ползунки */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Интерактивная модель окупаемости:</h3>
            
            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>Сокращение аварийных простоев оборудования:</span>
                <span className="font-bold text-emerald-700">-{downtimeReduction}% ({savedDowntimeHours} ч/год)</span>
              </div>
              <input
                type="range"
                min="5"
                max="35"
                step="0.5"
                value={downtimeReduction}
                onChange={(e) => setDowntimeReduction(Number(e.target.value))}
                className="w-full accent-emerald-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>Целевой уровень брака окрасочного цеха:</span>
                <span className="font-bold text-sky-700">{paintScrapTarget}% (было 4.2% – 5.2%)</span>
              </div>
              <input
                type="range"
                min="0.8"
                max="3.0"
                step="0.1"
                value={paintScrapTarget}
                onChange={(e) => setPaintScrapTarget(Number(e.target.value))}
                className="w-full accent-sky-600 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>Стоимость 1 часа простоя главного конвейера Allur:</span>
                <span className="font-bold text-amber-700">{hourlyDowntimeCost} млн ₸/час (~85 тыс ₸/мин)</span>
              </div>
              <input
                type="range"
                min="3.0"
                max="8.0"
                step="0.2"
                value={hourlyDowntimeCost}
                onChange={(e) => setHourlyDowntimeCost(Number(e.target.value))}
                className="w-full accent-amber-600 cursor-pointer"
              />
            </div>
          </div>

          {/* Структура источников дохода */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 font-semibold text-slate-700">
                <tr>
                  <th className="p-3">Направление оптимизации</th>
                  <th className="p-3">Физический объем</th>
                  <th className="p-3 text-right">Эффект в год (KZT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="p-3 font-medium">1. Сокращение простоев главного конвейера и роботов</td>
                  <td className="p-3 text-slate-600">+{savedDowntimeHours} часов непрерывной работы</td>
                  <td className="p-3 text-right font-bold text-emerald-700">
                    +{(downtimeSavings / 1_000_000).toFixed(1)} млн ₸
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-medium">2. Ликвидация брака ЛКП (Окрасочная камера-02)</td>
                  <td className="p-3 text-slate-600">+{savedBodies} кузовов без повторного перекраса</td>
                  <td className="p-3 text-right font-bold text-sky-700">
                    +{(scrapSavings / 1_000_000).toFixed(1)} млн ₸
                  </td>
                </tr>
                <tr>
                  <td className="p-3 font-medium">3. Выравнивание такта и устранение голодания сборки</td>
                  <td className="p-3 text-slate-600">+240 выпущенных автомобилей (Onix/Cobalt)</td>
                  <td className="p-3 text-right font-bold text-indigo-700">
                    +{(capacityGain / 1_000_000).toFixed(1)} млн ₸
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-600">
            💡 <b>Факторы доверия для экспертов Allur:</b> Решение не требует остановки завода. Интеграция выполняется поверх контроллеров Siemens/Fanuc через OPC UA за 4 недели пилотного внедрения.
          </div>
        </div>

        <div className="px-6 py-3 bg-slate-100 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#17232F] text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
