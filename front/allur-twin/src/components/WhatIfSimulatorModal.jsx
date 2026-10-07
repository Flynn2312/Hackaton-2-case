import { useState } from "react";

export default function WhatIfSimulatorModal({ isOpen, onClose, onApplyScenario, activeScenario }) {
  const [selectedScenario, setSelectedScenario] = useState(activeScenario || "all");

  if (!isOpen) return null;

  const scenarios = [
    {
      id: "all",
      title: "🚀 Комплексная оптимизация Allur (Рекомендуемый)",
      desc: "Предотвращение обрыва цепи Конвейера-03 + коррекция температуры сушильной печи Камеры-02.",
      downtimeReduction: "-43 мин",
      qualityBoost: "+3.9%",
      oeeEffect: "88.5% → 93.8%",
      gainKZT: "+4 675 000 ₸ за смену",
    },
    {
      id: "conveyor",
      title: "⚙️ Предиктивный ремонт Конвейера-03",
      desc: "Замена дефектного звена тяговой цепи в окно пересменки (12 мин вместо 55 мин аварийного простоя).",
      downtimeReduction: "-43 мин",
      qualityBoost: "0.0%",
      oeeEffect: "88.5% → 91.2%",
      gainKZT: "+3 655 000 ₸ за смену",
    },
    {
      id: "paint",
      title: "🎨 Коррекция микроклимата Окрасочной камеры-02",
      desc: "Автоматическая стабилизация вязкости эмали и температуры сушки 142°C (снижение брака с 5.2% до 1.3%).",
      downtimeReduction: "0 мин",
      qualityBoost: "+3.9%",
      oeeEffect: "88.5% → 90.5%",
      gainKZT: "+1 020 000 ₸ за смену",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden border border-slate-200">
        <div className="px-6 py-4 bg-[#17232F] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔮</span>
            <div>
              <h2 className="text-lg font-bold">What-If Сценарный тренажер главного инженера</h2>
              <p className="text-xs text-slate-300">Моделирование управленческих решений для защиты на хакатоне</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl leading-none px-2 py-1">
            ×
          </button>
        </div>

        <div className="p-6 space-y-4 text-slate-800">
          <p className="text-xs text-slate-600">
            Выберите гипотезу для симуляции производственного процесса на основе тестовых данных за 2 октября:
          </p>

          <div className="space-y-3">
            {scenarios.map((sc) => (
              <label
                key={sc.id}
                className={`block p-4 rounded-xl border-2 cursor-pointer transition ${
                  selectedScenario === sc.id
                    ? "border-emerald-600 bg-emerald-50/50 shadow-sm"
                    : "border-slate-200 hover:border-slate-300 bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="scenario"
                    checked={selectedScenario === sc.id}
                    onChange={() => setSelectedScenario(sc.id)}
                    className="mt-1 accent-emerald-600"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-900">{sc.title}</span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        {sc.gainKZT}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{sc.desc}</p>
                    <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-slate-200/60 text-xs">
                      <div>Простои: <b className="text-emerald-700">{sc.downtimeReduction}</b></div>
                      <div>Качество: <b className="text-sky-700">{sc.qualityBoost}</b></div>
                      <div>OEE: <b className="text-indigo-700">{sc.oeeEffect}</b></div>
                    </div>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 bg-slate-100 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={() => {
              onApplyScenario(null);
              onClose();
            }}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
          >
            Сбросить на факт 2 октября
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Отмена
            </button>
            <button
              onClick={() => {
                onApplyScenario(selectedScenario);
                onClose();
              }}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition shadow-sm"
            >
              Применить симуляцию в MVP
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
