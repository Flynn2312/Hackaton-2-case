import { useEffect, useState } from "react";
import { api } from "../api";

export default function AiForecastPanel({ onSelectZone }) {
  const [alerts, setAlerts] = useState([
    {
      id: "alert-1",
      zoneId: 4, // Сборка
      zoneName: "Сборка-1",
      equipment: "Главный Конвейер-03",
      severity: "critical",
      metric: "Вибрация: 6.8 мм/с (Норма ISO: ≤2.5 мм/с)",
      riskScore: 88,
      cause: "Усталостное растяжение тяговой цепи после 8 905 ч наработки",
      recommendation: "Превентивная замена дефектного звена в окно пересменки (12 мин). Предотвратит аварию на 55 минут.",
    },
    {
      id: "alert-2",
      zoneId: 3, // Окраска
      zoneName: "Окраска-1",
      equipment: "Камера окраски-02",
      severity: "warning",
      metric: "Температура сушки: 147.5°C (Норма: 140±2°C)",
      riskScore: 72,
      cause: "Дрейф термодатчика после замены фильтра привел к шагрени и браку 5.2%",
      recommendation: "Калибровка термостата и коррекция вязкости эмали до 21с. Снизит брак до нормы ≤2.0%.",
    },
  ]);

  useEffect(() => {
    let alive = true;
    api.getAiForecast().then((data) => {
      if (!alive || !data || !data.alerts) return;
      const mapped = data.alerts.map((a) => ({
        id: a.id,
        zoneId: a.production_area_id,
        zoneName: a.production_area_name,
        equipment: a.equipment_name,
        severity: a.severity,
        metric: a.metric_summary,
        riskScore: a.risk_score,
        cause: a.root_cause,
        recommendation: a.recommendation,
      }));
      if (mapped.length > 0) setAlerts(mapped);
    });
    return () => { alive = false; };
  }, []);

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
          <h2 className="font-bold text-slate-900 text-sm md:text-base">
            AI Predictive Engine · Раннее предупреждение аварий
          </h2>
        </div>
        <span className="text-xs bg-indigo-50 text-indigo-700 font-semibold px-2.5 py-1 rounded-full border border-indigo-200">
          ISO 10816 + Anomaly Detection
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {alerts.map((a) => (
          <div
            key={a.id}
            onClick={() => onSelectZone(a.zoneId)}
            className={`p-4 rounded-xl border transition cursor-pointer hover:shadow-md ${
              a.severity === "critical"
                ? "bg-rose-50/60 border-rose-200 hover:border-rose-400"
                : "bg-amber-50/60 border-amber-200 hover:border-amber-400"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                {a.zoneName} · {a.equipment}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  a.severity === "critical"
                    ? "bg-rose-100 text-rose-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                Риск: {a.riskScore}%
              </span>
            </div>

            <div className="text-xs font-semibold text-slate-900 mb-1">{a.metric}</div>
            
            <p className="text-xs text-slate-600 mb-2">
              <b>Корневая причина (Explainable AI):</b> {a.cause}
            </p>

            <div className="p-2.5 bg-white/80 rounded-lg border border-slate-200 text-xs text-slate-800">
              💡 <b>Предписание ИИ:</b> {a.recommendation}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
