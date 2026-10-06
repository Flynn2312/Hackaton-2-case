import { useEffect, useMemo, useState } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Cell, Legend,
} from "recharts";
import { api } from "./api";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ───────────── 2. ЛОГИКА СТАТУСОВ ───────────── */

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

// Простая эвристика риска. Позже заменить на ответ ML-модели: POST /predict
function riskOf(z) {
  const r = (z.load - 60) * 0.9 + z.downtime * 0.55 + (100 - z.quality) * 4 + (1 - z.output / z.plan) * 60;
  return Math.round(clamp(r, 3, 97));
}

/* ───────────── 3. UI ───────────── */

const Dot = ({ s, size = 10 }) => (
  <span className="inline-block rounded-full shrink-0"
        style={{ width: size, height: size, background: STATUS[s].color }} />
);

function Kpi({ title, value, unit, hint, s }) {
  return (
    <div className="bg-white rounded-lg p-4 border" style={{ borderColor: "#C9D2DA" }}>
      <div className="flex items-center justify-between text-sm" style={{ color: "#5B6B79" }}>
        {title}<Dot s={s} />
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums" style={{ color: "#17232F" }}>
        {value}<span className="text-base font-normal ml-1" style={{ color: "#5B6B79" }}>{unit}</span>
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
      className="text-left rounded-lg p-3 w-full border-2 transition focus:outline-none focus-visible:ring-4 ring-sky-300"
      style={{
        background: STATUS[s].soft,
        borderColor: selected ? "#17232F" : "transparent",
        boxShadow: `inset 6px 0 0 ${STATUS[s].color}`,
      }}
    >
      <div className="pl-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold" style={{ color: "#17232F" }}>{z.name}</span>
          <span className="text-xs" style={{ color: STATUS[s].color }}>{STATUS[s].label}</span>
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums" style={{ color: "#17232F" }}>
          {z.output}<span className="text-sm font-normal" style={{ color: "#5B6B79" }}> / {z.plan} ед/ч</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-white overflow-hidden">
          <div className="h-full" style={{ width: `${clamp(pct, 0, 100)}%`, background: STATUS[s].color }} />
        </div>
        <div className="mt-2 flex justify-between text-xs" style={{ color: "#5B6B79" }}>
          <span>Загрузка {z.load}%</span><span>Брак {(100 - z.quality).toFixed(1)}%</span>
        </div>
      </div>
    </button>
  );
}

const EQ = {
  run:  { t: "Работает", c: "#2E9E6A" },
  idle: { t: "Простаивает", c: "#D99A0B" },
  maint: { t: "Обслуживание", c: "#5B6B79" },
  down: { t: "Авария", c: "#D1402F" },
};

export default function PlantTwin() {
  const [zones, setZones] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [selId, setSelId] = useState(null); // null = весь завод
  const [histories, setHistories] = useState({});
  const [error, setError] = useState(null);
  const [now, setNow] = useState(new Date());

  // загрузка данных с бэкенда, обновление каждые 10 секунд
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.getSnapshot()
        .then((d) => {
          if (!alive) return;
          setZones(d.zones); setIncidents(d.incidents); setHistories(d.history); setError(null);
        })
        .catch((e) => alive && setError(e.message));
    load();
    const poll = setInterval(load, 10000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { alive = false; clearInterval(poll); clearInterval(clock); };
  }, []);

  const sel = zones.find((z) => z.id === selId) || null;

  const history = histories[selId ?? "all"] || [];

  const total = useMemo(() => {
    if (!zones.length) return null;
    const last = zones[zones.length - 1];
    const plan = zones[0].plan;
    const out = last.output;
    return {
      out, plan,
      load: Math.round(zones.reduce((a, z) => a + z.load, 0) / zones.length),
      downtime: zones.reduce((a, z) => a + z.downtime, 0),
      quality: (zones.reduce((a, z) => a * (z.quality / 100), 1) * 100).toFixed(1),
    };
  }, [zones]);

  if (!total) return <div className="p-8">{error ? `Не удалось получить данные: ${error}` : "Загрузка данных…"}</div>;

  const risks = zones.map((z) => ({ name: z.name, id: z.id, risk: riskOf(z) })).sort((a, b) => b.risk - a.risk);
  const bottleneck = [...zones].sort((a, b) => a.output / a.plan - b.output / b.plan)[0];
  const shown = incidents.filter((i) => !sel || i.zone === sel.id);
  const outStatus = total.out / total.plan < 0.85 ? "bad" : total.out / total.plan < 0.95 ? "warn" : "ok";

  return (
    <div className="min-h-screen" style={{ background: "#E8ECEF", color: "#17232F", fontFamily: "'Onest', system-ui, sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap');`}</style>

      <header className="px-6 py-4 flex flex-wrap items-center justify-between gap-3" style={{ background: "#17232F", color: "#fff" }}>
        <div>
          <h1 className="text-xl font-semibold">Цифровой двойник автозавода</h1>
          <p className="text-sm" style={{ color: "#9FB0BF" }}>Костанай · смена 1 · данные обновляются каждые 10 с</p>
        </div>
        <div className="flex items-center gap-3 text-sm tabular-nums">
          <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: "#2E9E6A" }} />
          {now.toLocaleTimeString("ru-RU")}
        </div>
      </header>

      <main className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
        {/* KPI */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi title="Выпуск на выходе" value={total.out} unit="ед/ч" hint={`План ${total.plan} ед/ч`} s={outStatus} />
          <Kpi title="Средняя загрузка" value={total.load} unit="%" hint="по пяти участкам" s={total.load > 90 ? "warn" : "ok"} />
          <Kpi title="Простои за смену" value={total.downtime} unit="мин" hint="суммарно по оборудованию" s={total.downtime > 100 ? "bad" : total.downtime > 60 ? "warn" : "ok"} />
          <Kpi title="Выход годных с 1-го раза" value={total.quality} unit="%" hint="цель 95%" s={total.quality < 90 ? "bad" : total.quality < 95 ? "warn" : "ok"} />
        </section>

        {/* Карта завода */}
        <section className="bg-white rounded-lg p-4 border" style={{ borderColor: "#C9D2DA" }}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Карта завода</h2>
            <button onClick={() => setSelId(null)} className="text-sm underline" style={{ color: "#5B6B79" }}>
              {sel ? "Показать весь завод" : "Выберите участок"}
            </button>
          </div>
          <div className="flex flex-wrap justify-center gap-x-12 gap-y-10">
            {zones.map((z, i) => {
              const isLast = i === zones.length - 1;
              const endOfRow = (i + 1) % 3 === 0;
              return (
                <div key={z.id} className="relative w-full md:w-[calc((100%-6rem)/3)] flex">
                  <ZoneNode z={z} selected={z.id === selId} onClick={() => setSelId(z.id === selId ? null : z.id)} />
                  {!isLast && (
                    <>
                      {/* стрелка вправо между карточками в ряду */}
                      {!endOfRow && (
                        <span className="hidden md:flex absolute -right-12 top-1/2 -translate-y-1/2 w-12 justify-center" style={{ color: "#17232F" }}>
                          <svg width="40" height="24" viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12h32M26 3l10 9-10 9" />
                          </svg>
                        </span>
                      )}
                      {/* стрелка вниз на телефоне */}
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
          <div className="flex gap-4 mt-3 text-xs" style={{ color: "#5B6B79" }}>
            {Object.entries(STATUS).map(([k, v]) => (<span key={k} className="flex items-center gap-1.5"><Dot s={k} size={8} />{v.label}</span>))}
          </div>
        </section>

        {/* Детали + график */}
        <section className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 bg-white rounded-lg p-4 border" style={{ borderColor: "#C9D2DA" }}>
            <h2 className="font-semibold mb-1">{sel ? `Участок «${sel.name}»: выпуск по часам` : "Весь завод: выпуск по часам"}</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ left: -15, right: 8, top: 10 }}>
                  <CartesianGrid stroke="#E1E6EA" vertical={false} />
                  <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="plan" name="План" stroke="#8796A3" fill="none" strokeDasharray="5 4" />
                  <Area type="monotone" dataKey="fact" name="Факт" stroke="#17232F" fill="#17232F" fillOpacity={0.12} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {sel && (
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2">Оборудование</h3>
                <ul className="grid sm:grid-cols-2 gap-2">
                  {sel.equipment.map(([name, st]) => (
                    <li key={name} className="flex items-center justify-between rounded border px-3 py-2 text-sm" style={{ borderColor: "#C9D2DA" }}>
                      {name}
                      <span className="flex items-center gap-1.5" style={{ color: EQ[st].c }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: EQ[st].c }} />{EQ[st].t}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm mt-3" style={{ color: "#5B6B79" }}>
                  Простои: {sel.downtime} мин · Качество: {sel.quality}% · Загрузка: {sel.load}%
                </p>
              </div>
            )}
          </div>

          {/* Инциденты */}
          <div className="bg-white rounded-lg p-4 border" style={{ borderColor: "#C9D2DA" }}>
            <h2 className="font-semibold mb-3">Инциденты и отклонения</h2>
            {shown.length === 0 ? (
              <p className="text-sm" style={{ color: "#5B6B79" }}>По этому участку отклонений нет.</p>
            ) : (
              <ul className="space-y-2">
                {shown.map((i) => (
                  <li key={i.id}>
                    <button onClick={() => setSelId(i.zone)} className="w-full text-left rounded p-2.5 text-sm flex gap-2.5"
                            style={{ background: STATUS[i.level].soft }}>
                      <span className="mt-1.5"><Dot s={i.level} size={8} /></span>
                      <span>
                        <span className="block text-xs" style={{ color: "#5B6B79" }}>
                          {i.time} · {zones.find((z) => z.id === i.zone)?.name}
                        </span>
                        {i.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Аналитика и прогноз */}
        <section className="grid lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-lg p-4 border" style={{ borderColor: "#C9D2DA" }}>
            <h2 className="font-semibold mb-1">Простои по участкам, мин</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={zones} margin={{ left: -15, top: 10 }}>
                  <CartesianGrid stroke="#E1E6EA" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="downtime" name="Простой, мин" radius={[3, 3, 0, 0]} onClick={(d) => setSelId(d.id)}>
                    {zones.map((z) => <Cell key={z.id} fill={STATUS[statusOf(z)].color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 border" style={{ borderColor: "#C9D2DA" }}>
            <h2 className="font-semibold">Прогноз рисков на ближайшие 2 часа</h2>
            <p className="text-sm mb-3" style={{ color: "#5B6B79" }}>
              Узкое место сейчас: <b style={{ color: "#17232F" }}>{bottleneck.name}</b>
              {" "}({Math.round((bottleneck.output / bottleneck.plan) * 100)}% от плана).
            </p>
            <ul className="space-y-2.5">
              {risks.map((r) => {
                const s = r.risk > 65 ? "bad" : r.risk > 40 ? "warn" : "ok";
                return (
                  <li key={r.id} className="text-sm">
                    <div className="flex justify-between mb-1"><span>{r.name}</span><span className="tabular-nums">{r.risk}%</span></div>
                    <div className="h-2 rounded-full" style={{ background: "#E8ECEF" }}>
                      <div className="h-full rounded-full" style={{ width: `${r.risk}%`, background: STATUS[s].color }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs mt-3" style={{ color: "#5B6B79" }}>
              Сейчас риск считается по простым правилам. Подключим ИИ-модель, как только будут исторические данные.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
