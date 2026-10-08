// Лендинг: коротко презентует цифровой двойник и ведёт в дашборд (#/app/<вкладка>).
// Данные — только лёгкий /digital-twin/live-status: он же будит free-инстанс Render, пока читают страницу.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ECON } from '../lib/model';
import { S, fmtDate, fmtInt, fmtTime } from '../lib/format';
import { appHref } from '../lib/route';
import { Blueprint } from '../components/ui';

const POLL_MS = 15_000;

// Порядок и подписи участков совпадают с симулятором (backend/app/simulator/plant.py)
const FALLBACK_AREAS = ['Склад комплектующих', 'Сварка', 'Окраска', 'Сборка', 'Контроль качества', 'Склад готовой продукции']
  .map((name, i) => ({ id: -i - 1, name, sequence: i + 1 }));

const PROBLEMS = [
  { v: '55 мин', l: 'обрыв цепи Конвейера-03', n: 'при суточном нормативе простоя ≤ 60 мин' },
  { v: '5,2%', l: 'брак ЛКП в Камере-02', n: 'при норме ≤ 2,0%' },
  { v: '81%', l: 'OEE сварки', n: 'кузовов не хватает сборке' },
  { v: '4 800', l: 'авто за месяц', n: 'при плане ≥ 5 500' },
];

const MODULES = [
  { view: 'flow', t: 'Живой завод', d: 'Шесть участков и оборудование со статусами в реальном времени. Клик по участку — показатели, тренды и паспорт узла.' },
  { view: 'whatif', t: 'What-If', d: 'Что будет, если остановить узел, поднять загрузку или сократить буфер? Сценарий прогоняется на копии живого завода.' },
  { view: 'airisk', t: 'AI Risk Center', d: 'Предиктивные алерты: износ, вибрация, температура сушки — до того, как узел встанет.' },
  { view: 'log', t: 'Инциденты и решения', d: 'Журнал отклонений. По новому инциденту ИИ предлагает варианты и прогноз их последствий.' },
  { view: 'roi', t: 'Экономика & ROI', d: 'Калькулятор эффекта: стоимость часа простоя, брака и недовыпуска, CAPEX и срок окупаемости.' },
  { view: 'chat', t: 'ИИ Ассистент', d: 'Вопросы о смене, участках и простоях. Отвечает только по данным двойника.' },
];

const AI = [
  {
    t: 'Решения по инцидентам',
    d: 'Каждый вариант — «ничего не менять», A и Б — прогоняется имитационной моделью на 3 часа вперёд с одинаковыми случайными событиями. Claude формулирует варианты и рекомендует один, а цифры в таблице считает модель, не языковая модель.',
  },
  {
    t: 'What-If на копии завода',
    d: 'Берётся текущее состояние линии: износ, буферы, идущие простои. Базовая копия и копия со сценарием считаются параллельно, разница — эффект решения. ИИ коротко объясняет, к чему это приведёт.',
  },
  {
    t: 'Предиктивная диагностика',
    d: 'Вибродиагностика конвейера по зонам ISO 10816 и контроль параметров окрасочной камеры: риск аварии и брака виден заранее, ремонт планируется в пересменку.',
  },
];

const ARCH = [
  { t: 'Цех', d: 'Датчики, ПЛК Siemens, роботы Fanuc/ABB · OPC UA / MQTT без вмешательства в логику ПЛК' },
  { t: 'Симулятор', d: 'Событийная модель линии: смены, износ, аварии, брак — сейчас вместо живой телеметрии' },
  { t: 'Backend', d: 'FastAPI · PostgreSQL (Supabase) · WebSocket-поток событий · Claude API' },
  { t: 'Дашборд', d: 'React · Tailwind · Recharts · обновление без перезагрузки' },
];

function areaStatus(eqs) {
  if (eqs.some((e) => e.status === 'breakdown' && e.criticality === 'high')) return 'r';
  if (eqs.some((e) => e.status === 'breakdown' || (e.status === 'maintenance' && e.criticality === 'high'))) return 'y';
  return 'g';
}

function useLivePlant() {
  const [live, setLive] = useState(null);
  const [areas, setAreas] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer;
    const load = async () => {
      try {
        const data = await api.liveStatus();
        if (alive) { setLive({ ...data, at: Date.now() }); setError(null); }
      } catch (e) {
        if (alive) setError(e);
      }
      if (alive) timer = setTimeout(load, POLL_MS);
    };
    load();
    api.areas().then((a) => alive && setAreas([...a].sort((x, y) => x.sequence - y.sequence))).catch(() => {});
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  return { live, areas, error };
}

// Часы симуляции идут между опросами: sim_now + прошедшее время × скорость
function useSimClock(sim, at) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!sim?.sim_now) return null;
  const base = Date.parse(sim.sim_now);
  return sim.active && sim.running ? base + (now - at) * (sim.speed ?? 1) : base;
}

const Section = ({ id, kicker, title, sub, children }) => (
  <section id={id} className="px-4 md:px-7 py-14 md:py-20 scroll-mt-16">
    <div className="max-w-[1180px] mx-auto flex flex-col gap-8">
      <div className="flex flex-col gap-2 max-w-[720px]">
        {kicker && <h6 className="text-brand">{kicker}</h6>}
        <h2 className="text-[30px] md:text-[40px]">{title}</h2>
        {sub && <p className="m-0 text-neutral-700">{sub}</p>}
      </div>
      {children}
    </div>
  </section>
);

function LivePanel({ live, error, simMs }) {
  const sim = live?.simulator;
  const eq = live?.equipment ?? [];
  const running = eq.filter((e) => e.status === 'running').length;
  const incidents = live?.open_incidents ?? [];
  const critical = incidents.filter((i) => i.severity === 'critical' || i.severity === 'high').length;
  const downtime = live?.active_downtime?.length ?? 0;
  const online = Boolean(live && !error && sim?.active);

  const stats = [
    { l: 'Оборудование в работе', v: live ? `${running} / ${eq.length}` : '—', st: running === eq.length ? 'g' : 'y' },
    { l: 'Идущие простои', v: live ? fmtInt(downtime) : '—', st: downtime ? 'y' : 'g' },
    { l: 'Открытые инциденты', v: live ? fmtInt(incidents.length) : '—', st: incidents.length ? 'y' : 'g' },
    { l: 'Из них критичных', v: live ? fmtInt(critical) : '—', st: critical ? 'r' : 'g' },
  ];

  return (
    <Blueprint as="div" className="bg-neutral-100 flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-divider text-[13px]">
        <span className="flex items-center gap-2 font-medium">
          <span
            className={`w-2 h-2 rounded-full ${online ? 'animate-pulse-dot' : ''}`}
            style={{ background: online ? S.g.fill : live ? S.y.fill : 'var(--color-neutral-500)' }}
          />
          {online ? 'Завод онлайн' : error ? 'Сервер просыпается…' : live ? 'Симуляция на паузе' : 'Подключаюсь к заводу…'}
        </span>
        <span className="text-neutral-700">линия 1 · Костанай</span>
      </div>
      <div className="px-5 py-5 flex items-baseline gap-3 border-b border-divider">
        <span className="num text-[48px] leading-none">{simMs ? fmtTime(simMs) : '--:--'}</span>
        <span className="text-[13px] text-neutral-700">
          {simMs ? `${fmtDate(simMs)} · время завода` : 'время завода'}
          {sim?.speed ? ` · ×${fmtInt(sim.speed)}` : ''}
        </span>
      </div>
      <div className="grid grid-cols-2">
        {stats.map((s, i) => (
          <div key={s.l} className={`px-5 py-4 flex flex-col gap-0.5 border-divider ${i % 2 === 0 ? 'border-r' : ''} ${i < 2 ? 'border-b' : ''}`}>
            <span className="text-[11px] tracking-[.08em] uppercase text-neutral-700">{s.l}</span>
            <span className="num text-[28px] leading-[1.1]" style={{ color: live ? S[s.st].ink : undefined }}>{s.v}</span>
          </div>
        ))}
      </div>
    </Blueprint>
  );
}

function PlantFlow({ areas, equipment }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {areas.map((a, i) => {
        const eqs = equipment.filter((e) => e.production_area_id === a.id);
        const st = equipment.length ? areaStatus(eqs) : null;
        const running = eqs.filter((e) => e.status === 'running').length;
        return (
          <div key={a.id} className="relative bg-bg rounded-2xl p-4 flex flex-col gap-3 min-h-[150px] overflow-hidden shadow-[var(--shadow-card)]">
            <div className="h-1 -mx-4 -mt-4" style={{ background: st ? S[st].fill : 'var(--color-neutral-300)' }} />
            <span className="num text-[13px] text-neutral-600">{String(i + 1).padStart(2, '0')}</span>
            <span className="font-heading font-semibold text-xl leading-tight">{a.name}</span>
            <span className="mt-auto text-xs text-neutral-700">
              {st ? `${S[st].l} · ${running}/${eqs.length} в работе` : 'нет данных'}
            </span>
            {i < areas.length - 1 && (
              <span className="hidden lg:block absolute right-0 bottom-0 w-full h-0.5 overflow-hidden">
                <span className="block w-1/3 h-full bg-brand animate-convey" style={{ animationDelay: `${i * 0.35}s` }} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Scenarios({ sim }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const list = sim?.scenarios ?? [];

  const run = async (key) => {
    setBusy(key);
    setMsg(null);
    try {
      await api.simInject(key);
      window.location.assign(appHref('flow'));
    } catch (e) {
      setMsg(e.message);
      setBusy(null);
    }
  };

  if (!sim?.active) {
    return <div className="text-sm text-neutral-700">Сценарии доступны, когда симуляция запущена. Откройте дашборд, чтобы посмотреть текущее состояние.</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {list.map((s) => (
          <button key={s.key} type="button" className="btn btn-secondary" disabled={busy != null} onClick={() => run(s.key)}>
            {busy === s.key ? 'Запускаю…' : s.title}
          </button>
        ))}
      </div>
      <div className="text-xs text-neutral-700">Сценарий запускается на общей симуляции: его увидят все, у кого открыт дашборд.</div>
      {msg && <div className="text-sm" style={{ color: S.r.ink }}>{msg}</div>}
    </div>
  );
}

export default function LandingView() {
  const { live, areas, error } = useLivePlant();
  const simMs = useSimClock(live?.simulator, live?.at);

  const levers = [
    { v: `−${ECON.downtimeCut * 100}%`, l: 'внеплановых простоев', n: `предиктивное ТО · ${fmtInt(ECON.downtimeMinKzt)} ₸ за минуту простоя` },
    { v: `−${ECON.defectCut * 100}%`, l: 'брака и доработок', n: `контроль параметров · ${fmtInt(ECON.defectKzt)} ₸ за кузов` },
    { v: `+${ECON.shortfallCut * 100}%`, l: 'недовыпуска возвращается', n: `балансировка потока · ${fmtInt(ECON.carMarginKzt)} ₸ маржи с авто` },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-bg/95 backdrop-blur border-b border-divider">
        <div className="max-w-[1180px] mx-auto flex items-center gap-6 px-4 md:px-7 h-16">
          <a href="#/" className="flex items-baseline gap-1 leading-none">
            <span className="font-bold text-[28px] tracking-[-0.05em] text-brand">allur</span>
            <span className="font-medium text-[17px] tracking-[-0.02em] text-neutral-600">twin</span>
          </a>
          <nav className="hidden md:flex gap-5 text-sm text-neutral-700">
            <a href="#modules" className="hover:text-text">Возможности</a>
            <a href="#ai" className="hover:text-text">ИИ</a>
            <a href="#effect" className="hover:text-text">Эффект</a>
            <a href="#arch" className="hover:text-text">Архитектура</a>
          </nav>
          <a href={appHref('flow')} className="btn btn-primary ml-auto shrink-0"><span className="hidden sm:inline">Открыть&nbsp;</span>дашборд</a>
        </div>
      </header>

      {/* Hero */}
      <section className="px-4 md:px-7 pt-12 md:pt-20 pb-14 md:pb-20 bg-bg">
        <div className="max-w-[1180px] mx-auto grid lg:grid-cols-[1.25fr_1fr] gap-10 lg:gap-14 items-center">
          <div className="flex flex-col gap-6">
            <h6 className="text-brand">Кейс АО «Группа компаний АЛЛЮР» · Qostanai AI Industry Hackathon 2026</h6>
            <h1 className="text-[38px] sm:text-[48px] md:text-[68px] leading-[1.02] break-words">Цифровой двойник автомобильного завода</h1>
            <p className="m-0 text-lg text-neutral-800 max-w-[560px]">
              Вся линия — от склада комплектующих до готовых машин — на одном экране. Простои, брак и узкие места видны
              до того, как сорвут план, а ИИ предлагает решение с прогнозом последствий.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href={appHref('flow')} className="btn btn-primary !text-base !px-5 !py-2.5">Смотреть живой завод</a>
              <a href="#modules" className="btn btn-secondary !text-base !px-5 !py-2.5">Что умеет</a>
            </div>
          </div>
          <LivePanel live={live} error={error} simMs={simMs} />
        </div>
      </section>

      {/* Проблема */}
      <Section
        kicker="Задача"
        title="Сбой на одном участке срывает план всей линии"
        sub="Участки связаны в цепочку: авария конвейера, раскалибровка печи или нехватка кузовов останавливают всё, что ниже по потоку. Так выглядели данные кейса:"
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {PROBLEMS.map((p) => (
            <div key={p.l} className="bg-bg rounded-2xl p-5 flex flex-col gap-1 shadow-[var(--shadow-card)]">
              <span className="num text-[40px] leading-none" style={{ color: S.r.ink }}>{p.v}</span>
              <span className="font-medium">{p.l}</span>
              <span className="text-xs text-neutral-700">{p.n}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Поток */}
      <Section
        kicker="Поток"
        title="Шесть участков — одна цепочка"
        sub="Статусы ниже — прямо с работающего двойника. Они обновляются, пока открыта страница."
      >
        <PlantFlow areas={areas ?? FALLBACK_AREAS} equipment={live?.equipment ?? []} />
      </Section>

      {/* Модули */}
      <Section id="modules" kicker="Возможности" title="Что внутри" sub="Каждая карточка открывает соответствующий раздел дашборда.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {MODULES.map((m, i) => (
            <a key={m.view} href={appHref(m.view)} className="group bg-bg rounded-2xl p-6 flex flex-col gap-3 shadow-[var(--shadow-card)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg">
              <span className="num text-[13px] text-neutral-600">{String(i + 1).padStart(2, '0')}</span>
              <h3>{m.t}</h3>
              <p className="m-0 text-sm text-neutral-800">{m.d}</p>
              <span className="mt-auto pt-2 font-semibold text-brand group-hover:underline">Открыть →</span>
            </a>
          ))}
        </div>
      </Section>

      {/* ИИ */}
      <Section
        id="ai"
        kicker="Аналитика и ИИ"
        title="ИИ объясняет, модель считает"
        sub="Языковая модель не придумывает цифры: прогнозы считает имитационная модель завода, а Claude выбирает варианты и объясняет их."
      >
        <div className="grid md:grid-cols-3 gap-6">
          {AI.map((a) => (
            <Blueprint key={a.t} as="div" className="p-6 flex flex-col gap-3">
              <h4>{a.t}</h4>
              <p className="m-0 text-sm text-neutral-800">{a.d}</p>
            </Blueprint>
          ))}
        </div>
        <div className="flex flex-col gap-3 pt-2">
          <h4>Попробуйте сами</h4>
          <p className="m-0 text-sm text-neutral-700">Запустите аварию — двойник покажет инцидент, а ИИ предложит варианты решения.</p>
          <Scenarios sim={live?.simulator} />
        </div>
      </Section>

      {/* Эффект */}
      <Section
        id="effect"
        kicker="Эффект для бизнеса"
        title="Три рычага экономии"
        sub="Допущения расчёта. Годовой эффект считается по фактическим простоям, браку и недовыпуску двойника — цифры и параметры можно менять в калькуляторе."
      >
        <div className="grid md:grid-cols-3 gap-3">
          {levers.map((l) => (
            <div key={l.l} className="bg-bg rounded-2xl p-6 flex flex-col gap-1 shadow-[var(--shadow-card)]">
              <span className="num text-[44px] leading-none" style={{ color: S.g.ink }}>{l.v}</span>
              <span className="font-medium">{l.l}</span>
              <span className="text-xs text-neutral-700">{l.n}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <a href={appHref('roi')} className="btn btn-primary">Открыть калькулятор ROI</a>
          <span className="text-sm text-neutral-700">Пилот: CAPEX 85 млн ₸, OPEX 20 млн ₸ в год, развёртывание за 4 недели.</span>
        </div>
      </Section>

      {/* Архитектура */}
      <Section
        id="arch"
        kicker="Архитектура"
        title="От датчика до решения"
        sub="Телеметрия снимается поверх существующей автоматики, управляющая логика ПЛК не меняется."
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {ARCH.map((a, i) => (
            <div key={a.t} className="bg-bg rounded-2xl p-5 flex flex-col gap-2 shadow-[var(--shadow-card)]">
              <span className="num text-[13px] text-neutral-600">{String(i + 1).padStart(2, '0')}{i < ARCH.length - 1 ? ' →' : ''}</span>
              <h4>{a.t}</h4>
              <p className="m-0 text-sm text-neutral-800">{a.d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Финал */}
      <section className="px-4 md:px-7 py-16 md:py-24 bg-accent-800 text-bg">
        <div className="max-w-[1180px] mx-auto flex flex-col md:flex-row md:items-end gap-8 justify-between">
          <div className="flex flex-col gap-3 max-w-[640px]">
            <h2 className="text-[34px] md:text-[48px]">Завод уже работает — посмотрите</h2>
            <p className="m-0 text-accent-200">Симуляция идёт непрерывно: смены, аварии, брак и решения появляются в реальном времени.</p>
          </div>
          <a href={appHref('flow')} className="btn btn-primary !bg-bg !border-bg !text-accent-900 !text-base !px-6 !py-3 hover:!bg-accent-100">
            Открыть дашборд →
          </a>
        </div>
      </section>

      <footer className="px-4 md:px-7 py-6 text-[13px] text-neutral-700">
        <div className="max-w-[1180px] mx-auto flex flex-wrap gap-x-6 gap-y-1 justify-between">
          <span>Команда STUshniki · Кейс №2 «Цифровой двойник автомобильного завода»</span>
          <span>Demo Day — 16 октября 2026, Костанай</span>
        </div>
      </footer>
    </div>
  );
}
