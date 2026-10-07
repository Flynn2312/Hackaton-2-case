import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import { api } from "./api";
import BusinessRoiModal from "./components/BusinessRoiModal";
import WhatIfSimulatorModal from "./components/WhatIfSimulatorModal";
import AiForecastPanel from "./components/AiForecastPanel";
import AiCopilotChatModal from "./components/AiCopilotChatModal";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ───────────── 2. ЛОГИКА СТАТУСОВ И РИСКА ───────────── */

const STATUS = {
  ok:   { label: "В норме",   color: "#2E9E6A", soft: "#E3F3EA" },
  warn: { label: "Внимание",  color: "#D99A0B", soft: "#FBF0D4" },
  bad:  { label: "Критично",  color: "#D1402F", soft: "#F8E1DD" },
};

function statusOf(z) {
  if (z.equipment.some(([, s]) => s === "down") || z.quality < 94 || z.downtime > 60) return "bad";
  if (z.load > 90 || z.quality < 97.5 || z.downtime > 25 || z.output / z.plan < 0.88) return "warn";
  return "ok";
}

// Улучшенный расчет риска с учетом простоя, качества и перегрузки
function riskOf(z) {
  const r = (z.load - 60) * 0.9 + z.downtime * 0.55 + (100 - z.quality) * 4 + (1 - z.output / z.plan) * 60;
  return Math.round(clamp(r, 3, 97));
}

/* ───────────── 3. UI ЭЛЕМЕНТЫ ───────────── */

const Dot = ({ s, size = 10 }) => (
  <span className="inline-block rounded-full shrink-0"
        style={{ width: size, height: size, background: STATUS[s]?.color || "#5B6B79" }} />
);

function Kpi({ title, value, unit, hint, s, highlight }) {
  return (
    <div className={`bg-white rounded-xl p-4 border transition ${highlight ? "ring-2 ring-emerald-500 shadow-md" : ""}`}
         style={{ borderColor: "#C9D2DA" }}>
      <div className="flex items-center justify-between text-xs font-medium" style={{ color: "#5B6B79" }}>
        {title}<Dot s={s} />
      </div>
      <div className="mt-2 text-2xl md:text-3xl font-bold tabular-nums" style={{ color: "#17232F" }}>
        {value}<span className="text-sm font-normal ml-1" style={{ color: "#5B6B79" }}>{unit}</span>
      </div>
      <div className="mt-1 text-xs" style={{ color: "#5B6B79" }}>{hint}</div>
    </div>
  );
}

function ZoneNode({ z, selected, onClick }) {
  const s = statusOf(z);
  const pct = Math.round((z.output / z.plan) * 100);
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className="text-left rounded-xl p-3.5 w-full border-2 transition focus:outline-none focus-visible:ring-4 ring-sky-300 hover:shadow-md cursor-pointer"
      style={{
        background: STATUS[s].soft,
        borderColor: selected ? "#17232F" : "transparent",
        boxShadow: `inset 6px 0 0 ${STATUS[s].color}`,
      }}
    >
      <div className="pl-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-sm md:text-base text-[#17232F]">{z.name}</span>
          <span className="text-xs font-semibold" style={{ color: STATUS[s].color }}>{STATUS[s].label}</span>
        </div>
        <div className="mt-2 text-2xl font-bold tabular-nums text-[#17232F]">
          {z.output}<span className="text-xs font-normal text-[#5B6B79]"> / {z.plan} ед/ч</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-white overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${clamp(pct, 0, 100)}%`, background: STATUS[s].color }} />
        </div>
        <div className="mt-2 flex justify-between text-xs font-medium text-[#5B6B79]">
          <span>Загрузка: {z.load}%</span>
          <span>Брак: {(100 - z.quality).toFixed(1)}%</span>
        </div>
      </div>
    </button>
  );
}

const EQ = {
  run:   { t: "Работает", c: "#2E9E6A" },
  idle:  { t: "Простаивает", c: "#D99A0B" },
  maint: { t: "Обслуживание", c: "#5B6B79" },
  down:  { t: "Авария", c: "#D1402F" },
};

export default function PlantTwin() {
  const [zones, setZones] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [selId, setSelId] = useState(null); // null = весь завод
  const [histories, setHistories] = useState({});
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => new Date());

  // Модальные окна для защитной презентации (Задачи 4 и 5)
  const [isRoiOpen, setIsRoiOpen] = useState(false);
  const [isWhatIfOpen, setIsWhatIfOpen] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [appliedScenario, setAppliedScenario] = useState(null);

  // Загрузка данных с бэкенда, опрос каждые 10 секунд
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.getSnapshot()
        .then((d) => {
          if (!alive) return;
          setZones(d.zones);
          setIncidents(d.incidents);
          setHistories(d.history);
          setError(null);
        })
        .catch((e) => alive && setError(e.message));
    load();
    const poll = setInterval(load, 10000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { alive = false; clearInterval(poll); clearInterval(clock); };
  }, []);

  // Модификация зон в режиме симуляции What-If
  const displayZones = useMemo(() => {
    if (!zones.length) return [];
    if (!appliedScenario) return zones;

    return zones.map((z) => {
      const clone = { ...z };
      if (appliedScenario === "all" || appliedScenario === "conveyor") {
        if (clone.id === 4 || clone.name.includes("Сборка")) {
          clone.downtime = Math.max(12, clone.downtime - 43);
          clone.output = Math.min(clone.plan, clone.output + 8);
          clone.equipment = clone.equipment.map(([name]) => [name, "run"]);
        }
      }
      if (appliedScenario === "all" || appliedScenario === "paint") {
        if (clone.id === 3 || clone.name.includes("Окраска")) {
          clone.quality = 98.7;
          clone.output = Math.min(clone.plan, clone.output + 5);
        }
      }
      return clone;
    });
  }, [zones, appliedScenario]);

  const sel = displayZones.find((z) => z.id === selId) || null;
  const history = histories[selId ?? "all"] || [];

  const total = useMemo(() => {
    if (!displayZones.length) return null;
    const last = displayZones[displayZones.length - 1];
    const plan = displayZones[0].plan;
    const out = last.output;
    const avgLoad = Math.round(displayZones.reduce((a, z) => a + z.load, 0) / displayZones.length);
    const totalDowntime = displayZones.reduce((a, z) => a + z.downtime, 0);
    const qualityRate = displayZones.reduce((a, z) => a * (z.quality / 100), 1) * 100;

    // Расчет OEE: Availability * Performance * Quality
    const availability = Math.max(0.6, 1 - (totalDowntime / (480 * 2)));
    const performance = clamp(out / plan, 0.5, 1.0);
    const quality = clamp(qualityRate / 100, 0.7, 1.0);
    const oee = (availability * performance * quality * 100).toFixed(1);

    return {
      out,
      plan,
      load: avgLoad,
      downtime: totalDowntime,
      quality: qualityRate.toFixed(1),
      oee,
    };
  }, [displayZones]);

  if (!total) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white p-8">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-lg font-medium">{error ? `Ошибка подключения к API: ${error}` : "Синхронизация с цифровым двойником Allur…"}</p>
          <p className="text-xs text-slate-400">Бэкенд: https://stushniki.onrender.com</p>
        </div>
      </div>
    );
  }

  const risks = displayZones.map((z) => ({ name: z.name, id: z.id, risk: riskOf(z) })).sort((a, b) => b.risk - a.risk);
  const bottleneck = [...displayZones].sort((a, b) => a.output / a.plan - b.output / b.plan)[0];
  const shown = incidents.filter((i) => !sel || i.zone === sel.id);
  const outStatus = total.out / total.plan < 0.85 ? "bad" : total.out / total.plan < 0.95 ? "warn" : "ok";

  return (
    <div className="min-h-screen pb-12" style={{ background: "#F1F4F7", color: "#17232F", fontFamily: "'Onest', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700;800&display=swap');`}</style>

      {/* Шапка дашборда */}
      <header className="px-6 py-4 bg-[#17232F] text-white flex flex-wrap items-center justify-between gap-4 shadow-md sticky top-0 z-30">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🚗</span>
            <h1 className="text-lg md:text-xl font-bold tracking-tight">ALLUR DIGITAL TWIN | Цифровой двойник автозавода</h1>
          </div>
          <p className="text-xs text-slate-300">
            г. Костанай · Республиканский хакатон «Qostanai AI Industry 2026» · СарыаркаАвтоПром
          </p>
        </div>

        {/* Кнопки управления сценариями хакатона (Задачи 4 и 5) */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsWhatIfOpen(true)}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer ${
              appliedScenario
                ? "bg-emerald-500 hover:bg-emerald-600 text-white ring-2 ring-white"
                : "bg-slate-700 hover:bg-slate-600 text-white"
            }`}
          >
            <span>🔮</span>
            <span>{appliedScenario ? "Сценарий активен!" : "What-If Тренажер"}</span>
          </button>

          <button
            onClick={() => setIsRoiOpen(true)}
            className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <span>📊</span>
            <span>Эффект 1.2 млрд ₸</span>
          </button>

          <button
            onClick={() => setIsCopilotOpen(true)}
            className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <span>🤖</span>
            <span>AI Copilot & Харнесс</span>
          </button>

          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-slate-700 text-xs tabular-nums text-slate-300">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {now.toLocaleTimeString("ru-RU")}
          </div>
        </div>
      </header>

      {/* Баннер при активной What-If симуляции */}
      {appliedScenario && (
        <div className="bg-emerald-600 text-white px-6 py-2 text-xs flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2 font-medium">
            <span>✨</span>
            <span><b>Режим симуляции активен:</b> Моделирование предотвращения обрыва цепи и нормализации температуры камеры. Экономия: <b>+4.6 млн ₸ за смену</b>.</span>
          </div>
          <button
            onClick={() => setAppliedScenario(null)}
            className="underline font-bold hover:text-slate-100 cursor-pointer"
          >
            Сбросить на реальный факт
          </button>
        </div>
      )}

      <main className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
        {/* KPI Секция с OEE завода */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi title="Выпуск на выходе" value={total.out} unit="ед/ч" hint={`План ${total.plan} ед/ч`} s={outStatus} />
          <Kpi title="OEE предприятия" value={total.oee} unit="%" hint="Целевой ≥85.0%" s={Number(total.oee) >= 85 ? "ok" : "bad"} highlight={appliedScenario != null} />
          <Kpi title="Средняя загрузка" value={total.load} unit="%" hint="по участкам потока" s={total.load > 90 ? "warn" : "ok"} />
          <Kpi title="Простои за смену" value={total.downtime} unit="мин" hint="лимит 60 мин/сутки" s={total.downtime > 60 ? "bad" : total.downtime > 30 ? "warn" : "ok"} />
          <Kpi title="Качество (First Pass Yield)" value={total.quality} unit="%" hint="норма брака ≤2.0%" s={total.quality < 95 ? "warn" : "ok"} />
        </section>

        {/* AI Predictive Analytics */}
        <AiForecastPanel zones={displayZones} onSelectZone={(id) => setSelId(id)} />

        {/* Карта завода */}
        <section className="bg-white rounded-xl p-5 border shadow-xs" style={{ borderColor: "#C9D2DA" }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-base text-[#17232F]">Сквозная технологическая цепочка завода Allur</h2>
              <p className="text-xs text-[#5B6B79]">Нажмите на участок для детального просмотра оборудования и телеметрии</p>
            </div>
            <button onClick={() => setSelId(null)} className="text-xs font-semibold underline text-[#17232F] hover:text-emerald-700 cursor-pointer">
              {sel ? "Показать весь завод" : "Выбрано: Все участки"}
            </button>
          </div>

          <div className="flex flex-wrap justify-center gap-x-12 gap-y-10">
            {displayZones.map((z, i) => {
              const isLast = i === displayZones.length - 1;
              const endOfRow = (i + 1) % 3 === 0;
              return (
                <div key={z.id} className="relative w-full md:w-[calc((100%-6rem)/3)] flex">
                  <ZoneNode z={z} selected={z.id === selId} onClick={() => setSelId(z.id === selId ? null : z.id)} />
                  {!isLast && (
                    <>
                      {!endOfRow && (
                        <span className="hidden md:flex absolute -right-12 top-1/2 -translate-y-1/2 w-12 justify-center" style={{ color: "#17232F" }}>
                          <svg width="40" height="24" viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12h32M26 3l10 9-10 9" />
                          </svg>
                        </span>
                      )}
                      <span className="md:hidden absolute -bottom-10 left-0 right-0 h-10 flex justify-center items-center" style={{ color: "#17232F" }}>
                        <svg width="24" height="32" viewBox="0 0 24 32" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3v24M3 19l9 10 9-10" />
                        </svg>
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex gap-4 mt-4 pt-3 border-t border-slate-100 text-xs text-[#5B6B79]">
            {Object.entries(STATUS).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5"><Dot s={k} size={8} />{v.label}</span>
            ))}
          </div>
        </section>

        {/* График выпуска и Инциденты */}
        <section className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white rounded-xl p-5 border shadow-xs" style={{ borderColor: "#C9D2DA" }}>
            <h2 className="font-bold text-sm md:text-base mb-1 text-[#17232F]">
              {sel ? `Участок «${sel.name}»: почасовой выпуск (План vs Факт)` : "Сводный выпуск по часам"}
            </h2>
            <div className="h-64 mt-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ left: -15, right: 8, top: 10 }}>
                  <CartesianGrid stroke="#E1E6EA" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="plan" name="План выпуска" stroke="#8796A3" fill="none" strokeDasharray="5 4" strokeWidth={2} />
                  <Area type="monotone" dataKey="fact" name="Фактический выпуск" stroke="#17232F" fill="#17232F" fillOpacity={0.12} strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {sel && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#5B6B79] mb-2">Оборудование на участке:</h3>
                <ul className="grid sm:grid-cols-2 gap-2">
                  {sel.equipment.map(([name, st]) => (
                    <li key={name} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium" style={{ borderColor: "#C9D2DA" }}>
                      <span>{name}</span>
                      <span className="flex items-center gap-1.5 font-bold" style={{ color: EQ[st]?.c || "#5B6B79" }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: EQ[st]?.c || "#5B6B79" }} />
                        {EQ[st]?.t || st}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs mt-3 text-[#5B6B79]">
                  Простои участка: <b>{sel.downtime} мин</b> · Качество: <b>{sel.quality}%</b> · Загрузка: <b>{sel.load}%</b>
                </p>
              </div>
            )}
          </div>

          {/* Журнал инцидентов */}
          <div className="bg-white rounded-xl p-5 border shadow-xs" style={{ borderColor: "#C9D2DA" }}>
            <h2 className="font-bold text-sm md:text-base mb-3 text-[#17232F]">Оперативный журнал инцидентов</h2>
            {shown.length === 0 ? (
              <p className="text-xs text-[#5B6B79]">По выбранному участку инцидентов нет.</p>
            ) : (
              <ul className="space-y-2.5 max-h-80 overflow-y-auto">
                {shown.map((i) => (
                  <li key={i.id}>
                    <button
                      onClick={() => setSelId(i.zone)}
                      className="w-full text-left rounded-lg p-3 text-xs flex gap-2.5 transition hover:shadow-xs cursor-pointer"
                      style={{ background: STATUS[i.level]?.soft || "#F3F4F6" }}
                    >
                      <span className="mt-1"><Dot s={i.level} size={8} /></span>
                      <span className="flex-1">
                        <span className="block text-[11px] font-semibold text-[#5B6B79] mb-0.5">
                          {i.time} · {displayZones.find((z) => z.id === i.zone)?.name || `Участок ${i.zone}`}
                        </span>
                        <span className="font-medium text-[#17232F]">{i.text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Аналитика простоев и Risk Score */}
        <section className="grid lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl p-5 border shadow-xs" style={{ borderColor: "#C9D2DA" }}>
            <h2 className="font-bold text-sm md:text-base mb-1 text-[#17232F]">Сравнение простоев по участкам, мин</h2>
            <div className="h-56 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displayZones} margin={{ left: -15, top: 10 }}>
                  <CartesianGrid stroke="#E1E6EA" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="downtime" name="Простой, мин" radius={[4, 4, 0, 0]} onClick={(d) => setSelId(d.id)}>
                    {displayZones.map((z) => <Cell key={z.id} fill={STATUS[statusOf(z)].color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-xl p-5 border shadow-xs" style={{ borderColor: "#C9D2DA" }}>
            <h2 className="font-bold text-sm md:text-base text-[#17232F]">Прогноз рисков узких мест (Risk Score)</h2>
            <p className="text-xs mb-3 text-[#5B6B79]">
              Текущее узкое место потока: <b className="text-[#17232F]">{bottleneck?.name}</b>
              {" "}({Math.round((bottleneck?.output / bottleneck?.plan) * 100)}% от нормы такта).
            </p>
            <ul className="space-y-2.5">
              {risks.map((r) => {
                const s = r.risk > 65 ? "bad" : r.risk > 40 ? "warn" : "ok";
                return (
                  <li key={r.id} className="text-xs">
                    <div className="flex justify-between font-medium mb-1">
                      <span>{r.name}</span>
                      <span className="font-bold tabular-nums" style={{ color: STATUS[s].color }}>{r.risk}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${r.risk}%`, background: STATUS[s].color }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </main>

      {/* Плавающая кнопка для быстрого вызова ИИ */}
      <button
        onClick={() => setIsCopilotOpen(true)}
        className="fixed bottom-6 right-6 z-40 bg-[#17232F] text-white p-3.5 rounded-full shadow-2xl hover:scale-105 transition-all flex items-center gap-2.5 border-2 border-emerald-400 cursor-pointer hover:bg-slate-800"
      >
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
        <span className="text-xl">🤖</span>
        <span className="text-xs font-bold pr-1">Спросить ИИ</span>
      </button>

      {/* Модальные окна */}
      <BusinessRoiModal isOpen={isRoiOpen} onClose={() => setIsRoiOpen(false)} />
      <WhatIfSimulatorModal
        isOpen={isWhatIfOpen}
        onClose={() => setIsWhatIfOpen(false)}
        activeScenario={appliedScenario}
        onApplyScenario={(sc) => setAppliedScenario(sc)}
      />
      <AiCopilotChatModal
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        onApplyScenario={(sc) => setAppliedScenario(sc)}
      />
    </div>
  );
}
