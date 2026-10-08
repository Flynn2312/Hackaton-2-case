"""
Движок симуляции работы завода. Один шаг (step) — одна минута заводского времени.

Что происходит каждую минуту:
- смены: в начале смены создаются shifts и production_plans, между сменами и в выходные время перескакивает
  к следующей смене (ночью и в выходные линия не работает, ждать нечего);
- выработка: участки Сварка -> Окраска -> Сборка -> ОТК работают через межоперационные буферы,
  простой выше по потоку «голодит» участки ниже, переполненный буфер блокирует участок выше.
  Почасовые production_records/quality_records создаются в начале часа и дописываются по ходу часа;
- оборудование: случайные остановки по частотам из модели завода. Каждая единица изнашивается,
  с ростом износа учащаются короткие остановки-предвестники, при износе 100% — тяжёлый отказ.
  Плановое ТО сбрасывает износ;
- инциденты: по тем же правилам, что история в сиде (отказы, брак выше порога, невыполнение плана смены,
  лимит простоя критичного оборудования, ТБ) и с жизненным циклом open -> in_progress -> resolved -> closed.

Все изменения пишутся в БД и сразу публикуются в EventHub для WebSocket-клиентов.
"""
import logging
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from decimal import Decimal

from app.simulator import plant as P
from app.simulator.hub import EventHub
from app.simulator.store import SimStore

logger = logging.getLogger(__name__)

STATE_VERSION = 1
MINUTE = timedelta(minutes=1)
HOUR = timedelta(hours=1)

ACTIVITY = 1.2                                 # частота остановок относительно истории — чтобы демо было живым
WEAR_RATE = 1 / (P.SHIFT_MINUTES * 14)         # средний износ за минуту: до тяжёлого отказа ~1 неделя работы
DEGRADATION_CHANCE = 0.1                       # на смену: у случайной единицы начинается ускоренная деградация
PREVENTIVE_CHANCE = 0.3                        # на смену: изношенное оборудование уходит на ТО в начале смены
SHORTAGE_PER_MIN = 0.12 / P.SHIFT_MINUTES      # нехватка комплектующих на сборке
SAFETY_PER_MIN = 0.05 / P.SHIFT_MINUTES        # нарушение ТБ
PAINT_WEAR_SCRAP = 0.02                        # прирост брака окраски при полном износе камеры
CRIT_DOWNTIME_LIMIT = 60                       # мин/сутки простоя критичного оборудования (норматив кейса)
SEVERITY_LEVEL = {"critical": "r", "high": "r", "medium": "y", "low": "n"}

# Сценарии, которые можно вызвать вручную (кнопки на дашборде, POST /api/sim/inject)
SCENARIOS = {
    "conveyor_break": {"title": "Обрыв цепи Конвейера-03", "code": "ASM-CNV-03",
                       "reason": "Обрыв цепи", "type": "breakdown", "minutes": 55},
    "paint_defects": {"title": "Рост брака ЛКП в Камере-02", "code": "PNT-CAB-02",
                      "reason": "Нарушение влажности в камере", "type": "quality_issue", "minutes": 20,
                      "boost": ("PAINT", 0.08, 120)},
    "weld_robot": {"title": "Столкновение робота ABB-04 с оснасткой", "code": "WLD-ABB-04",
                   "reason": "Столкновение робота с оснасткой", "type": "breakdown", "minutes": 60},
    "material_shortage": {"title": "Нехватка комплектующих на сборке", "code": "ASM-CNV-02",
                          "reason": "Нехватка комплектующих: задержка поставки жгутов проводки",
                          "type": "material_shortage", "minutes": 35},
    "safety": {"title": "Нарушение техники безопасности"},
}

# ---------------------------------------------------------------- решения по инцидентам
# По этим инцидентам оператор выбирает «ничего не менять», вариант A или Б (варианты готовит ИИ — advisor.py).
# Только для участков линии: там у действия есть измеримый эффект на выпуск, брак и простой.
DECISION_TYPES = {"equipment_failure", "material_shortage", "quality_deviation", "downtime_limit"}
DECISION_WINDOW = 30   # мин завода на выбор после появления вариантов, затем применяется «ничего не менять»
DECISION_GIVE_UP = 90  # мин завода: варианты так и не появились — инцидент идёт своим ходом
CHOICES = ("none", "A", "B")
# Проверка прогноза: через HORIZON минут работы линии после инцидента (forecast.py) факт сравнивается
# с прогнозом выбранного варианта. Окно — от момента инцидента, как у прогноза: задержка решения входит в факт.
CHECK_METRICS = {"output": 0, "area_downtime": 0, "scrap_pct": 1}  # метрика -> знаков после запятой

# Действия, которые движок умеет применить. Варианты A и Б — два действия из подходящих к инциденту.
# cost — прямые затраты на меру, ₸ (допущение команды, как и прочие экономические параметры)
ACTIONS = {
    "emergency_crew": {
        "types": {"equipment_failure"}, "cost": 180_000, "title": "Вызвать аварийную бригаду",
        "effect": "Вторая ремонтная бригада: оставшееся время ремонта сокращается примерно вдвое."},
    "replace_module": {
        "types": {"equipment_failure"}, "cost": 650_000, "title": "Заменить узел из ЗИП",
        "effect": "Неисправный узел меняется на новый со склада запчастей: ремонт около 20 мин, "
                  "износ единицы обнуляется, новый узел изнашивается медленнее."},
    "redistribute": {
        "types": {"equipment_failure"}, "cost": 60_000, "title": "Перераспределить нагрузку",
        "effect": "Поток переводится на соседние единицы участка: участок работает примерно на 60% мощности, "
                  "ремонт идёт на 15% дольше (часть людей занята перенастройкой)."},
    "expedite_delivery": {
        "types": {"material_shortage"}, "cost": 250_000, "title": "Срочная доставка спецрейсом",
        "effect": "Комплектующие доставляются спецрейсом: оставшийся простой сокращается примерно втрое."},
    "resequence": {
        "types": {"material_shortage"}, "cost": 40_000, "title": "Перестроить очередь моделей",
        "effect": "Сборка переключается на модели, комплектующие которых есть на складе: "
                  "участок работает примерно на 65% мощности до поставки."},
    "recalibrate": {
        "types": {"quality_deviation"}, "cost": 30_000, "title": "Остановить и перекалибровать",
        "effect": "Ключевая единица участка останавливается на 15 мин для перекалибровки: отклонение устраняется, "
                  "износ единицы сбрасывается, следующие 4 ч брак примерно на 40% ниже."},
    "slow_inspect": {
        "types": {"quality_deviation"}, "cost": 50_000, "title": "Снизить темп и усилить контроль",
        "effect": "Темп участка −10% на 2 ч и сплошной контроль: брак примерно вдвое ниже, линия не останавливается."},
    "preventive_to": {
        "types": {"downtime_limit"}, "cost": 40_000, "title": "Внеплановое ТО изношенной единицы",
        "effect": "Самая изношенная критичная единица участка уходит на ТО на 30 мин сейчас: "
                  "износ сбрасывается, риск следующего отказа ниже."},
    "gentle_mode": {
        "types": {"downtime_limit"}, "cost": 0, "title": "Щадящий режим на 4 часа",
        "effect": "Темп участка −7% на 4 ч: износ и частота отказов критичного оборудования участка примерно вдвое ниже."},
}


def iso(dt: datetime) -> str:
    return dt.astimezone(P.TZ).isoformat()


def parse(value: str | datetime) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(value)


def eq_short(name: str) -> str:
    return name.split(" ")[-1]


class PlantSimulator:
    def __init__(self, store: SimStore, hub: EventHub, rng: random.Random | None = None):
        self.store = store
        self.hub = hub
        self.rng = rng or random.Random()
        # Отдельный поток случайностей для брака: тогда в прогнозах сценарий с другим браком
        # не сдвигает последовательность отказов, и сравнение с базовым прогнозом честное
        self.qrng = random.Random(self.rng.random())
        self.refs: dict = {}
        self.st: dict = {}
        self.finished_rows: list[tuple[dict, dict]] = []  # итоговые значения закрытых часов, ждут сохранения
        self.decisions_enabled = True     # в прогнозе (forecast.py) инциденты не ждут решения оператора
        self.decision_requests: list[int] = []  # инциденты, для которых нужно сгенерировать варианты
        self.stats: defaultdict[str, float] = defaultdict(float)  # накопленные показатели — для прогноза

    # ---------------------------------------------------------------- запуск

    @property
    def now(self) -> datetime:
        return parse(self.st["sim_now"])

    @property
    def started_at(self) -> datetime:
        return parse(self.st["started_at"])

    async def init(self, saved_state: dict | None, real_now: datetime) -> str:
        """Продолжает с сохранённого состояния или начинает симуляцию с текущего момента."""
        self.refs = await self.store.load_refs()
        self.codes = [c for c in self.refs["equipment"] if c in P.EQUIPMENT_BY_CODE]
        self.code_by_id = {e["id"]: c for c, e in self.refs["equipment"].items()}
        st = saved_state or {}
        shift = st.get("shift")
        if st.get("version") == STATE_VERSION and (shift is None or await self.store.shift_exists(shift["id"])):
            self.st = st
            self._ensure_state()
            await self._adopt_orphans(self.now)
            # Варианты, которые не успели сгенерировать до перезапуска, генерируем заново
            self.decision_requests = [int(k) for k, d in self.st["decisions"].items() if d["status"] == "generating"]
            return "resumed"
        await self._fresh_start(real_now)
        return "fresh"

    def _ensure_state(self) -> None:
        """Ключи, появившиеся в состоянии позже (состояние с Render переживает деплой новой версии)."""
        self.st.setdefault("decisions", {})
        self.st.setdefault("mods", {})
        self.st.setdefault("ai_decisions", True)
        self.st.setdefault("checks", {})

    async def _fresh_start(self, real_now: datetime) -> None:
        latest = await self.store.latest_shift_end(self.refs["factory_id"])
        start = max(real_now, latest) if latest else real_now
        start = start.astimezone(P.TZ)
        if start.minute or start.second or start.microsecond:  # с ближайшего целого часа — часы выработки полные
            start = start.replace(minute=0, second=0, microsecond=0) + HOUR
        rng = self.rng
        self.st = {
            "version": STATE_VERSION, "sim_now": iso(start), "started_at": iso(start),
            "shift": None, "hour": None, "day": None, "shift_totals": {}, "quality_flags": [],
            "buffers": {a: P.INITIAL_BUFFER for a in P.LINE_AREAS[1:]},
            "progress": {a: 0.0 for a in P.LINE_AREAS},
            "wear": {c: {"w": round(rng.uniform(0, 0.5), 4), "rate": WEAR_RATE * rng.uniform(0.5, 1.5)}
                     for c in self.codes},
            "status": {c: e["status"] for c, e in self.refs["equipment"].items()},
            "downtime": {}, "pending": [], "incidents": {}, "boost": {}, "decisions": {}, "mods": {}, "checks": {},
        }
        await self._adopt_orphans(start)
        # Оборудование не в работе без открытого простоя (статус из сида) — вернётся в строй в первые минуты
        for code, status in self.st["status"].items():
            if status != "running" and code not in self.st["downtime"]:
                self.st["downtime"][code] = {"id": None, "type": "other", "reason": "", "start": iso(start),
                                             "end": iso(start + MINUTE * rng.randint(5, 40))}
        logger.info("Симулятор: новый старт с %s", start)

    async def _adopt_orphans(self, t: datetime) -> None:
        """Открытые простои и инциденты в БД, которых нет в состоянии движка, доводим до закрытия."""
        tracked = {d["id"] for d in self.st["downtime"].values()}
        for row in await self.store.active_downtime():
            code = self.code_by_id.get(row["equipment_id"])
            if code is None or row["id"] in tracked:
                continue
            self.st["downtime"][code] = {
                "id": row["id"], "type": row["type"], "reason": row["reason"], "start": iso(row["started_at"]),
                "end": iso(max(t, row["started_at"]) + MINUTE * self.rng.randint(10, 60)),
            }
        for row in await self.store.open_incidents():
            if str(row["id"]) not in self.st["incidents"]:
                self.st["incidents"][str(row["id"])] = {
                    "status": row["status"], "code": None,
                    "next": iso(t + MINUTE * self.rng.randint(10, 240)),
                }

    # ---------------------------------------------------------------- шаг симуляции

    async def step(self) -> None:
        # Проверки прогнозов ведёт только живой завод: в копиях для прогноза и What-If решения выключены
        checks = self.st.get("checks") if self.decisions_enabled else None
        before = dict(self.stats) if checks else None
        await self._step()
        if checks:
            await self._track_checks(before)

    async def _step(self) -> None:
        t = self.now
        shift = self.st["shift"]
        if shift is None or t >= parse(shift["end"]):
            if self.st["hour"]:
                await self._end_hour(parse(shift["end"]))
            if shift:
                await self._end_shift(parse(shift["end"]))
            number, start, end = P.current_or_next_shift(t)
            t = max(t, start)  # ночь и выходные пропускаем
            self.st["sim_now"] = iso(t)
            await self._process_due(t)
            await self._start_shift(number, start, end, t)

        hour = self.st["hour"]
        if hour is None or t >= parse(hour["ts"]) + HOUR:
            if hour:
                await self._end_hour(t)
            await self._start_hour(t)

        self._roll_day(t)
        await self._process_due(t)
        await self._equipment_events(t)
        self._produce(t)
        await self._count_critical_downtime(t)
        if self.rng.random() < SAFETY_PER_MIN * ACTIVITY:
            await self._safety_incident(t)
        self.st["sim_now"] = iso(t + MINUTE)

    # ---------------------------------------------------------------- смены и часы

    async def _start_shift(self, number: int, start: datetime, end: datetime, t: datetime) -> None:
        rng = self.rng
        last = rng.choice(["JAC-J7", "CHEV-TRACKER"])
        models = ["CHEV-ONIX"] * 4 + ["CHEV-COBALT"] * 3 + [last]
        first_hour = int((t - start) / HOUR)  # если стартовали посреди смены — план только на оставшиеся часы
        remaining = models[first_hour:]

        shift = await self.store.insert("shifts", {
            "factory_id": self.refs["factory_id"], "name": P.shift_name(number), "start_at": start, "end_at": end})
        plans = await self.store.insert_many("production_plans", [
            {"factory_id": self.refs["factory_id"], "shift_id": shift["id"],
             "car_model_id": self.refs["model_ids"][m], "planned_quantity": P.HOURLY_PLAN * n}
            for m, n in Counter(remaining).items() if m in self.refs["model_ids"]])
        self.hub.upsert("shifts", shift)
        self.hub.upsert("production_plans", *plans)

        self.st["shift"] = {"id": shift["id"], "number": number, "start": iso(start), "end": iso(end),
                            "models": models, "plan": P.HOURLY_PLAN * len(remaining)}
        self.st["shift_totals"] = {a: {"actual": 0, "total": 0, "scrap": 0} for a in P.LINE_AREAS}
        self.st["quality_flags"] = []
        self.hub.notice("n", f"{P.shift_name(number)} началась",
                        f"{start:%d.%m.%Y}, план {self.st['shift']['plan']} авто")

        # Ускоренная деградация у случайной единицы — материал для прогноза отказов
        if self.codes and rng.random() < DEGRADATION_CHANCE:
            code = rng.choice(self.codes)
            self.st["wear"][code]["rate"] = min(self.st["wear"][code]["rate"] * 4, WEAR_RATE * 8)
        # Изношенное оборудование иногда успевают поставить на плановое ТО в начале смены
        for code in self.codes:
            if self.st["wear"][code]["w"] > 0.6 and code not in self.st["downtime"] and rng.random() < PREVENTIVE_CHANCE:
                kind = P.EQUIPMENT_BY_CODE[code][4]
                options = [r for r in P.REASONS[kind] if r[1] == "planned_maintenance"]
                if options:
                    reason, type_, lo, hi, _ = rng.choice(options)
                    await self._start_downtime(code, reason, type_, rng.randint(lo, hi), t)

    async def _end_shift(self, end: datetime) -> None:
        shift, totals = self.st["shift"], self.st["shift_totals"]
        planned = shift["plan"]
        output = totals["QC"]["total"] - totals["QC"]["scrap"]
        level = "g" if output >= planned * 0.95 else "y" if output >= planned * 0.85 else "r"
        self.hub.notice(level, f"{P.shift_name(shift['number'])} завершена", f"Выпуск {output} из {planned} авто")
        if planned and output < planned * 0.85:
            bottleneck = min(P.LINE_AREAS, key=lambda a: totals[a]["actual"])
            await self._incident(
                end, bottleneck, "plan_deviation", "high" if output < planned * 0.75 else "medium",
                f"Невыполнение сменного плана: {output} из {planned}",
                f"Выполнение {output / planned:.0%}. Узкое место смены — участок «{P.AREA_NAMES[bottleneck]}». "
                f"{P.shift_name(shift['number'])}, {parse(shift['start']):%d.%m.%Y}.")
        self.st["shift"] = None

    async def _start_hour(self, t: datetime) -> None:
        shift = self.st["shift"]
        start = parse(shift["start"])
        index = min(int((t - start) / HOUR), len(shift["models"]) - 1)
        ts = start + HOUR * index
        model_id = self.refs["model_ids"][shift["models"][index]]
        base = {"shift_id": shift["id"], "car_model_id": model_id, "timestamp": ts}
        areas = [a for a in P.LINE_AREAS if a in self.refs["area_ids"]]
        prod = await self.store.insert_many("production_records", [
            {**base, "production_area_id": self.refs["area_ids"][a], "planned_quantity": 0, "actual_quantity": 0,
             "runtime_minutes": 0, "load_percent": 0} for a in areas])
        qual = await self.store.insert_many("quality_records", [
            {**base, "production_area_id": self.refs["area_ids"][a], "total_quantity": 0, "good_quantity": 0,
             "scrap_quantity": 0, "rework_quantity": 0} for a in areas])
        self.hub.upsert("production_records", *prod)
        self.hub.upsert("quality_records", *qual)

        penalty = 0.012 if shift["number"] == 2 else 0.0  # вечером чуть ниже темп, как в истории
        self.st["hour"] = {"ts": iso(ts), "model_id": model_id, "areas": {
            a: {"prod": p["id"], "qual": q["id"], "minutes": 0, "actual": 0, "runtime": 0.0, "scrap": 0, "rework": 0,
                "perf": min(max(self.rng.gauss(0.99 - penalty, 0.03), 0.85), 1.08)}
            for a, p, q in zip(areas, prod, qual)}}

    async def _end_hour(self, t: datetime) -> None:
        """Итоги часа: фиксируем записи, копим итоги смены и проверяем брак (инцидент — раз за смену на участок)."""
        self.finished_rows.extend(self.current_rows())
        hour, self.st["hour"] = self.st["hour"], None
        for area, h in hour["areas"].items():
            tot = self.st["shift_totals"][area]
            tot["actual"] += h["actual"]
            tot["total"] += h["actual"]
            tot["scrap"] += h["scrap"]
            rate = tot["scrap"] / tot["total"] if tot["total"] else 0
            threshold = P.QUALITY_INCIDENT_THRESHOLD[area]
            if tot["total"] >= 40 and tot["scrap"] >= 3 and rate > threshold and area not in self.st["quality_flags"]:
                self.st["quality_flags"].append(area)
                await self._incident(
                    t, area, "quality_deviation", "high" if rate > threshold * 1.5 else "medium",
                    f"Превышение уровня брака на участке «{P.AREA_NAMES[area]}»: {rate:.1%}",
                    f"Брак {tot['scrap']} из {tot['total']} ед. с начала смены "
                    f"(порог инцидента {threshold:.0%}, допустимый уровень 2%).")

    def current_rows(self) -> list[tuple[dict, dict]]:
        """Почасовые записи текущего часа в том виде, в каком они лежат в БД."""
        hour = self.st.get("hour")
        if not hour:
            return []
        rows = []
        for area, h in hour["areas"].items():
            base = {"shift_id": self.st["shift"]["id"], "production_area_id": self.refs["area_ids"][area],
                    "car_model_id": hour["model_id"], "timestamp": hour["ts"]}
            runtime = round(h["runtime"])
            load = round(min(100.0, h["runtime"] / h["minutes"] * 100), 2) if h["minutes"] else 0
            rows.append((
                {**base, "id": h["prod"], "planned_quantity": round(P.HOURLY_PLAN * h["minutes"] / 60),
                 "actual_quantity": h["actual"], "runtime_minutes": runtime, "load_percent": Decimal(str(load))},
                {**base, "id": h["qual"], "total_quantity": h["actual"],
                 "good_quantity": h["actual"] - h["scrap"] - h["rework"],
                 "scrap_quantity": h["scrap"], "rework_quantity": h["rework"]},
            ))
        return rows

    def _roll_day(self, t: datetime) -> None:
        day = t.astimezone(P.TZ).date().isoformat()
        if not self.st["day"] or self.st["day"]["date"] != day:
            self.st["day"] = {"date": day, "crit": {}, "limit": False}

    # ---------------------------------------------------------------- выработка

    def _produce(self, t: datetime) -> None:
        hour, buffers, progress, stats = self.st["hour"], self.st["buffers"], self.st["progress"], self.stats
        stop = {a: 0.0 for a in P.LINE_AREAS}
        for code, d in self.st["downtime"].items():
            eq = self.refs["equipment"].get(code)
            if eq and eq["area"] in stop and parse(d["start"]) <= t:
                default = 1.0 if d["type"] == "material_shortage" else P.CRIT_WEIGHT[eq["criticality"]]
                stop[eq["area"]] = max(stop[eq["area"]], d.get("weight", default))  # weight — решение оператора

        cab_wear = max((w["w"] for c, w in self.st["wear"].items() if c.startswith("PNT-CAB")), default=0)
        for idx, area in enumerate(P.LINE_AREAS):
            h = hour["areas"].get(area)
            if h is None:
                continue
            h["minutes"] += 1
            stats[f"minutes:{area}"] += 1
            factor = 1.0 - stop[area]
            if factor <= 0:
                continue
            nxt = P.LINE_AREAS[idx + 1] if idx + 1 < len(P.LINE_AREAS) else None
            progress[area] += P.HOURLY_PLAN / 60 * h["perf"] * factor * self._mod("perf", area, t)
            quality = self._mod("quality", area, t)
            blocked = False
            while progress[area] >= 1:
                if (area in buffers and buffers[area] < 1) or (nxt and buffers[nxt] >= P.MAX_BUFFER):
                    progress[area] = 1.0  # голодает или заблокирован — ждёт
                    blocked = True
                    break
                progress[area] -= 1
                if area in buffers:
                    buffers[area] -= 1
                scrap_p, rework_p = P.SCRAP_RATE[area], P.REWORK_RATE[area]
                if area == "PAINT":
                    scrap_p += PAINT_WEAR_SCRAP * cab_wear
                boost = self.st["boost"].get(area)
                if boost and parse(boost["until"]) > t:
                    scrap_p += boost["extra"]
                    rework_p += boost["extra"] / 2
                scrap_p *= quality
                fixed = self._mod("scrap", area, t, None)  # брак задан сценарием What-If
                if fixed is not None:
                    scrap_p = fixed
                h["actual"] += 1
                stats[f"made:{area}"] += 1
                if self.qrng.random() < scrap_p:
                    h["scrap"] += 1
                    stats[f"scrap:{area}"] += 1
                    continue
                if self.qrng.random() < rework_p:
                    h["rework"] += 1
                if nxt:
                    buffers[nxt] += 1
                else:
                    stats["line_out"] += 1  # годный автомобиль после ОТК
            if not blocked:
                h["runtime"] += factor
                stats[f"runtime:{area}"] += factor

    def _mod(self, kind: str, area: str, t: datetime, default: float | None = 1.0) -> float | None:
        """
        Временный режим участка (решение оператора или сценарий What-If): множитель темпа (perf),
        брака (quality), износа (wear) или фиксированная вероятность брака (scrap).
        """
        mod = self.st["mods"].get(f"{kind}:{area}")
        if not mod:
            return default
        if parse(mod["until"]) <= t:
            del self.st["mods"][f"{kind}:{area}"]
            return default
        return mod["mul"]

    # ---------------------------------------------------------------- оборудование

    async def _equipment_events(self, t: datetime) -> None:
        rng = self.rng
        for code in self.codes:
            if code in self.st["downtime"]:
                continue
            area, _, _, _, kind, rate = P.EQUIPMENT_BY_CODE[code]
            gentle = self._mod("wear", area, t)
            wear = self.st["wear"][code]
            wear["w"] = round(wear["w"] + wear["rate"] * gentle * rng.uniform(0.5, 1.5), 6)
            if wear["w"] >= 1:
                reason, type_, lo, hi, _ = P.major_reason(kind)
                await self._start_downtime(code, reason, type_, rng.randint(lo, hi), t, major=True)
                continue
            if rng.random() < rate * ACTIVITY * gentle * (1 + 4 * wear["w"] ** 3) / P.SHIFT_MINUTES:
                if wear["w"] > 0.35 and rng.random() < 0.6:
                    reason, type_, lo, hi, _ = rng.choice(P.micro_reasons(kind, code))
                else:
                    options = P.REASONS[kind]
                    reason, type_, lo, hi, _ = rng.choices(options, weights=[o[4] for o in options])[0]
                await self._start_downtime(code, reason, type_, rng.randint(lo, hi), t)

        if "ASM-CNV-02" in self.codes and "ASM-CNV-02" not in self.st["downtime"] \
                and rng.random() < SHORTAGE_PER_MIN * ACTIVITY:
            await self._start_downtime("ASM-CNV-02", rng.choice(P.MATERIAL_SHORTAGE_REASONS), "material_shortage",
                                       rng.randint(15, 60), t)

    async def _start_downtime(self, code: str, reason: str, type_: str, minutes: int, t: datetime,
                              major: bool = False) -> None:
        eq = self.refs["equipment"][code]
        row = await self.store.insert("downtime_events", {
            "equipment_id": eq["id"], "shift_id": self.st["shift"]["id"] if self.st["shift"] else None,
            "started_at": t, "reason": reason, "type": type_})
        self.hub.upsert("downtime_events", row)
        self.st["downtime"][code] = {"id": row["id"], "type": type_, "reason": reason, "start": iso(t),
                                     "end": iso(t + MINUTE * minutes), "major": major}
        await self._set_status(code, P.STATUS_BY_DOWNTIME[type_])

        if major or (type_ == "breakdown" and minutes >= 25) or (type_ == "material_shortage" and minutes >= 20):
            self.st["pending"].append({"at": iso(t + MINUTE * self.rng.randint(1, 5)), "code": code,
                                       "minutes": minutes})
        if eq["criticality"] == "high" or minutes >= 25 or major:
            level = "r" if type_ == "breakdown" and eq["criticality"] == "high" else "y"
            if type_ == "planned_maintenance":
                level = "n"
            self.hub.notice(level, f"{eq_short(eq['name'])}: {reason.lower()}",
                            f"{P.AREA_NAMES[eq['area']]} · оценка простоя {minutes} мин",
                            area_id=self.refs["area_ids"].get(eq["area"]), equipment_id=eq["id"])

    async def _set_status(self, code: str, status: str) -> None:
        if self.st["status"].get(code) == status:
            return
        self.st["status"][code] = status
        row = await self.store.update("equipment", self.refs["equipment"][code]["id"], {"status": status})
        self.hub.upsert("equipment", row)

    async def _count_critical_downtime(self, t: datetime) -> None:
        """Правило кейса: простой критичного оборудования не более 60 мин в сутки."""
        day = self.st["day"]
        for code in self.st["downtime"]:
            eq = self.refs["equipment"].get(code)
            if eq and eq["criticality"] == "high":
                day["crit"][eq["area"]] = day["crit"].get(eq["area"], 0) + 1
                self.stats["crit_downtime"] += 1
        total = sum(day["crit"].values())
        if total > CRIT_DOWNTIME_LIMIT and not day["limit"]:
            day["limit"] = True
            area = max(day["crit"], key=day["crit"].get)
            await self._incident(
                t, area, "downtime_limit", "high",
                f"Превышен лимит простоя критичного оборудования: {total} мин за сутки",
                f"Лимит — {CRIT_DOWNTIME_LIMIT} мин/сутки. Основной вклад — участок «{P.AREA_NAMES[area]}» ({day['crit'][area]} мин).")

    # ---------------------------------------------------------------- события по времени

    async def _process_due(self, t: datetime) -> None:
        # Окончание простоев
        for code, d in list(self.st["downtime"].items()):
            end = parse(d["end"])
            if end > t:
                continue
            del self.st["downtime"][code]
            if d["id"]:
                self.hub.upsert("downtime_events", await self.store.update("downtime_events", d["id"], {"ended_at": end}))
            await self._set_status(code, "running")
            if code in self.st["wear"]:
                wear = self.st["wear"][code]
                if d.get("major") or d["type"] == "planned_maintenance":
                    wear["w"], wear["rate"] = 0.0, WEAR_RATE * self.rng.uniform(0.5, 1.5)
                elif d["type"] == "breakdown":
                    wear["w"] = round(wear["w"] * 0.7, 6)
            for inc_id, inc in list(self.st["incidents"].items()):
                if inc.get("code") != code:
                    continue
                if inc.get("wait"):
                    inc["wait"] = False
                    inc["next"] = iso(end + MINUTE * self.rng.randint(2, 10))
                elif inc.get("decision"):  # оборудование заработало раньше, чем выбрали решение
                    await self._close_decision(int(inc_id), "expired", t)
                    inc["next"] = iso(end + MINUTE * self.rng.randint(2, 10))
            eq = self.refs["equipment"].get(code)
            if d["id"] and eq and (d.get("major") or eq["criticality"] == "high"):
                minutes = int((end - parse(d["start"])) / MINUTE)
                self.hub.notice("g", f"{eq_short(eq['name'])} снова в работе", f"Простой {minutes} мин · {d['reason']}",
                                area_id=self.refs["area_ids"].get(eq["area"]), equipment_id=eq["id"])

        # Инциденты по отказам: регистрируются через несколько минут после начала простоя
        for p in [p for p in self.st["pending"] if parse(p["at"]) <= t]:
            self.st["pending"].remove(p)
            await self._downtime_incident(parse(p["at"]), p["code"], p["minutes"])

        # Жизненный цикл инцидентов
        for inc_id, inc in list(self.st["incidents"].items()):
            if not inc.get("next") or parse(inc["next"]) > t:
                continue
            await self._advance_incident(int(inc_id), inc, t)

        for area, boost in list(self.st["boost"].items()):
            if parse(boost["until"]) <= t:
                del self.st["boost"][area]

        # Решения: оператор не успел — «ничего не менять»; варианты так и не появились — инцидент идёт своим ходом
        for inc_id, d in list(self.st["decisions"].items()):
            if d["status"] == "ready" and parse(d["deadline"]) <= t:
                await self.apply_decision(int(inc_id), "none", "auto")
            elif d["status"] == "generating" and t - parse(d["created"]) >= MINUTE * DECISION_GIVE_UP:
                await self._close_decision(int(inc_id), "expired", t)
                inc = self.st["incidents"].get(inc_id)
                if inc:
                    inc["next"] = iso(t + MINUTE * self.rng.randint(3, 10))

    async def _downtime_incident(self, t: datetime, code: str, minutes: int) -> None:
        eq = self.refs["equipment"][code]
        d = self.st["downtime"].get(code)
        if d is None:
            return
        if d["type"] == "material_shortage":
            await self._incident(t, eq["area"], "material_shortage", "high" if minutes >= 45 else "medium", d["reason"],
                                 f"Сборочная линия остановлена: нет комплектующих. Оценка простоя {minutes} мин.",
                                 code=code)
        else:
            await self._incident(t, eq["area"], "equipment_failure", P.downtime_severity(eq["criticality"], minutes),
                                 f"Отказ: {eq['name']} — {d['reason']}",
                                 f"Оценка простоя {minutes} мин. Участок «{P.AREA_NAMES[eq['area']]}».", code=code)

    async def _incident(self, t: datetime, area: str, type_: str, severity: str, title: str, description: str,
                        code: str | None = None) -> None:
        shift = self.st["shift"]
        row = await self.store.insert("incidents", {
            "production_area_id": self.refs["area_ids"][area],
            "equipment_id": self.refs["equipment"][code]["id"] if code else None,
            "shift_id": shift["id"] if shift else None, "created_at": t,
            "severity": severity, "type": type_, "title": title, "description": description, "status": "open"})
        self.hub.upsert("incidents", row)
        self.hub.notice(SEVERITY_LEVEL[severity], title, description, incident_id=row["id"],
                        area_id=row["production_area_id"], kind="incident")
        tracker = {"status": "open", "code": code,
                   "next": iso(t + MINUTE * (self.rng.randint(3, 10) if code else self.rng.randint(10, 30)))}
        self.st["incidents"][str(row["id"])] = tracker
        if self.ai_decisions and type_ in DECISION_TYPES and area in P.LINE_AREAS:
            tracker.update(next=None, decision=True)  # ждёт решения оператора
            self.st["decisions"][str(row["id"])] = {"status": "generating", "created": iso(t), "type": type_,
                                                    "area": area, "code": code, "title": title,
                                                    "severity": severity, "description": description}
            self.st["checks"][str(row["id"])] = {"area": area, "from": iso(t), "new": True, "acc": {}}
            decision = await self.store.insert("incident_decisions", {
                "id": row["id"], "status": "generating", "created_at": t})
            self.hub.upsert("incident_decisions", decision)
            self.decision_requests.append(row["id"])

    async def _advance_incident(self, inc_id: int, inc: dict, t: datetime) -> None:
        rng = self.rng
        if inc["status"] == "open":
            inc["status"] = "in_progress"  # бригада назначена
            if inc.get("code") in self.st["downtime"]:
                inc["wait"], inc["next"] = True, None  # закроется после окончания простоя
            else:
                inc["next"] = iso(t + MINUTE * (rng.randint(2, 10) if inc.get("code") else rng.randint(60, 180)))
        elif inc["status"] == "in_progress":
            inc["status"] = "resolved"
            inc["next"] = iso(t + MINUTE * rng.randint(240, 480))
        else:
            inc["status"] = "closed"
            del self.st["incidents"][str(inc_id)]
        row = await self.store.update("incidents", inc_id, {"status": inc["status"]})
        if row is None:  # инцидент удалили из БД вручную
            self.st["incidents"].pop(str(inc_id), None)
            return
        self.hub.upsert("incidents", row)

    async def _safety_incident(self, t: datetime) -> None:
        title, description = self.rng.choice(P.SAFETY_INCIDENTS)
        area = self.rng.choice([a for a in P.AREA_NAMES if a in self.refs["area_ids"]])
        await self._incident(t, area, "safety", self.rng.choice(["low", "medium"]), title,
                             f"{description} Участок «{P.AREA_NAMES[area]}».")

    # ---------------------------------------------------------------- решения по инцидентам

    def candidate_actions(self, inc_id: int) -> list[str]:
        """Действия, применимые к инциденту прямо сейчас (из них ИИ выбирает варианты A и Б)."""
        d = self.st["decisions"][str(inc_id)]
        out = [a for a, spec in ACTIONS.items() if d["type"] in spec["types"]]
        eq = self.refs["equipment"].get(d.get("code") or "")
        if "redistribute" in out and (not eq or eq["criticality"] == "low"):
            out.remove("redistribute")
        if "preventive_to" in out and not self._maintenance_target(d["area"]):
            out.remove("preventive_to")
        return out

    def _maintenance_target(self, area: str) -> str | None:
        """Самая изношенная работающая критичная единица участка — кандидат на ТО или перекалибровку."""
        options = [c for c in self.codes if P.EQUIPMENT_BY_CODE[c][0] == area and c not in self.st["downtime"]
                   and self.refs["equipment"][c]["criticality"] != "low"]
        return max(options, key=lambda c: self.st["wear"][c]["w"], default=None)

    async def apply_action(self, action: str, inc_id: int, t: datetime) -> None:
        """Применяет действие к состоянию завода. Используется и в живой симуляции, и в прогнозе вариантов."""
        d = self.st["decisions"][str(inc_id)]
        area, code = d["area"], d.get("code")
        down = self.st["downtime"].get(code) if code else None
        mods = self.st["mods"]

        def shorten(factor: float, floor: int = 5) -> None:
            remaining = parse(down["end"]) - t
            down["end"] = iso(t + max(MINUTE * floor, remaining * factor))

        if action == "emergency_crew" and down:
            shorten(0.5)
        elif action == "replace_module":
            if down:
                down["end"] = iso(min(parse(down["end"]), t + MINUTE * 20))
                down["major"] = True  # после ремонта износ обнулится
            if code in self.st["wear"]:
                self.st["wear"][code]["rate"] *= 0.6
        elif action == "redistribute" and down:
            down["weight"] = 0.4
            shorten(1.15)
        elif action == "expedite_delivery" and down:
            shorten(0.35)
        elif action == "resequence" and down:
            down["weight"] = 0.35
        elif action == "recalibrate":
            self.st["boost"].pop(area, None)
            target = self._maintenance_target(area)
            if target:
                await self._start_downtime(target, "Перекалибровка по решению оператора", "planned_maintenance", 15, t)
            mods[f"quality:{area}"] = {"mul": 0.6, "until": iso(t + HOUR * 4)}
        elif action == "slow_inspect":
            mods[f"perf:{area}"] = {"mul": 0.9, "until": iso(t + HOUR * 2)}
            mods[f"quality:{area}"] = {"mul": 0.5, "until": iso(t + HOUR * 2)}
        elif action == "preventive_to":
            target = self._maintenance_target(area)
            if target:
                await self._start_downtime(target, "Внеплановое ТО по решению оператора", "planned_maintenance", 30, t)
        elif action == "gentle_mode":
            mods[f"perf:{area}"] = {"mul": 0.93, "until": iso(t + HOUR * 4)}
            mods[f"wear:{area}"] = {"mul": 0.4, "until": iso(t + HOUR * 4)}

    async def decision_ready(self, inc_id: int, payload: dict) -> bool:
        """Варианты сгенерированы: показываем оператору и запускаем отсчёт до автоматического «ничего не менять»."""
        d = self.st["decisions"].get(str(inc_id))
        if not d or d["status"] != "generating":
            return False
        deadline = self.now + MINUTE * DECISION_WINDOW
        d.update(status="ready", deadline=iso(deadline),
                 actions={o["key"]: o["action"] for o in payload["options"]},
                 forecast={o["key"]: {k: o["values"][k] for k in CHECK_METRICS} for o in payload["options"]})
        row = await self.store.update("incident_decisions", inc_id, {
            "status": "ready", "payload": payload, "recommended": payload["recommended"],
            "source": payload["source"], "deadline_at": deadline})
        self.hub.upsert("incident_decisions", row)
        self.hub.notice("y", "Нужно решение оператора", payload.get("incident_title", ""),
                        incident_id=inc_id, area_id=self.refs["area_ids"].get(d["area"]), kind="decision")
        return True

    async def apply_decision(self, inc_id: int, choice: str, by: str) -> str:
        """Применяет выбранный вариант (оператор или автоматически по истечении времени)."""
        d = self.st["decisions"].get(str(inc_id))
        if not d or d["status"] != "ready":
            raise ValueError("Решение по этому инциденту уже принято или варианты ещё не готовы")
        if choice not in CHOICES:
            raise ValueError(f"Вариант должен быть одним из: {', '.join(CHOICES)}")
        t = self.now
        action = d["actions"][choice]
        if action != "none":
            await self.apply_action(action, inc_id, t)
        check = self.st["checks"].get(str(inc_id))
        if check is not None and "forecast" in d:  # решения из состояния до появления проверок не проверяем
            check.update(choice=choice, forecast=d["forecast"][choice])
        await self._close_decision(inc_id, "applied", t, choice=choice, by=by)

        # Инцидент — в работу; закроется, когда закончится простой (или через обычное время для прочих)
        inc = self.st["incidents"].get(str(inc_id))
        if inc and inc["status"] == "open":
            inc["status"] = "in_progress"
            if inc.get("code") in self.st["downtime"]:
                inc["wait"], inc["next"] = True, None
            else:
                inc["next"] = iso(t + MINUTE * (self.rng.randint(2, 10) if inc.get("code") else self.rng.randint(60, 180)))
            self.hub.upsert("incidents", await self.store.update("incidents", inc_id, {"status": "in_progress"}))
        title = ACTIONS[action]["title"] if action != "none" else "Ничего не менять"
        self.hub.notice("g" if action != "none" else "n",
                        f"Решение применено: {title}",
                        "Выбрано оператором" if by == "operator" else "Время на выбор истекло — применено автоматически",
                        incident_id=inc_id, area_id=self.refs["area_ids"].get(d["area"]), kind="incident")
        return title

    @property
    def ai_decisions(self) -> bool:
        """Ждать ли решения оператора: выключатель в панели симуляции (в прогнозе всегда нет)."""
        return self.decisions_enabled and self.st.get("ai_decisions", True)

    async def set_ai_decisions(self, enabled: bool) -> None:
        """Выключатель ИИ-решений. При выключении открытые выборы закрываются вариантом «ничего не менять»."""
        self.st["ai_decisions"] = enabled
        if enabled:
            return
        t = self.now
        for inc_id, d in list(self.st["decisions"].items()):
            if d["status"] == "ready":
                await self.apply_decision(int(inc_id), "none", "auto")
                continue
            # Варианты ещё не готовы: решения не будет, инцидент идёт своим ходом — как «ничего не менять»
            await self._close_decision(int(inc_id), "expired", t)
            inc = self.st["incidents"].get(inc_id)
            if inc:
                inc["next"] = iso(t + MINUTE * self.rng.randint(3, 10))
        self.decision_requests.clear()

    async def _close_decision(self, inc_id: int, status: str, t: datetime, choice: str | None = None,
                              by: str = "auto") -> None:
        self.st["decisions"].pop(str(inc_id), None)
        check = self.st["checks"].get(str(inc_id))
        if check is not None and "choice" not in check:  # решения не было — проверять нечего
            del self.st["checks"][str(inc_id)]
        inc = self.st["incidents"].get(str(inc_id))
        if inc:
            inc.pop("decision", None)
        fields = {"status": status, "decided_at": t, "decided_by": by}
        if choice:
            fields["chosen"] = choice
        row = await self.store.update("incident_decisions", inc_id, fields)
        self.hub.upsert("incident_decisions", row)

    # ---------------------------------------------------------------- проверка прогнозов

    async def _track_checks(self, before: dict) -> None:
        from app.simulator.forecast import HORIZON  # forecast импортирует движок

        for inc_id, c in list(self.st["checks"].items()):
            if c.pop("new", False):  # инцидент появился на этом шаге: окно, как и прогноз, начинается после него
                continue
            area, acc = c["area"], c["acc"]
            for key in ("line_out", f"minutes:{area}", f"runtime:{area}", f"made:{area}", f"scrap:{area}"):
                acc[key] = acc.get(key, 0) + self.stats[key] - before.get(key, 0)
            c["steps"] = c.get("steps", 0) + 1
            if c["steps"] >= HORIZON:
                del self.st["checks"][inc_id]
                if "choice" in c:
                    await self._finish_check(int(inc_id), c, HORIZON)

    async def _finish_check(self, inc_id: int, c: dict, horizon: int) -> None:
        from app.simulator.forecast import outcome_metrics

        fact = outcome_metrics(c["acc"], c["area"], "none")
        forecast = c["forecast"]
        # Точность — по выпуску линии: главная метрика, от неё зависит эффект в тенге
        accuracy = max(0.0, 1 - abs(fact["output"] - forecast["output"]) / max(forecast["output"], 1)) * 100
        check = {
            "choice": c["choice"], "from": c["from"], "to": iso(self.now), "horizon_min": horizon,
            "forecast": forecast,
            "fact": {k: round(fact[k], digits) if digits else round(fact[k]) for k, digits in CHECK_METRICS.items()},
            "accuracy": round(accuracy),
        }
        row = await self.store.merge_payload("incident_decisions", inc_id, {"check": check})
        if row:
            self.hub.upsert("incident_decisions", row)
        area_id = self.refs["area_ids"].get(c["area"])
        self.hub.notice("n", f"Прогноз проверен: точность {check['accuracy']}%",
                        f"Выпуск за {horizon // 60} ч: прогноз {forecast['output']}, факт {check['fact']['output']} авто",
                        incident_id=inc_id, area_id=area_id, kind="decision")

    # ---------------------------------------------------------------- ручные сценарии

    async def inject(self, scenario: str) -> str:
        spec = SCENARIOS.get(scenario)
        if spec is None:
            raise ValueError(f"Неизвестный сценарий: {scenario}")
        if not self.st.get("shift"):
            raise ValueError("Смена ещё не началась — повторите через пару секунд")
        t = self.now
        if scenario == "safety":
            await self._safety_incident(t)
            return spec["title"]
        code = spec["code"]
        if code not in self.refs["equipment"]:
            raise ValueError(f"В БД нет оборудования {code}")
        if code in self.st["downtime"] and self.st["downtime"][code]["id"]:
            raise ValueError(f"{eq_short(self.refs['equipment'][code]['name'])} уже стоит")
        self.st["downtime"].pop(code, None)
        await self._start_downtime(code, spec["reason"], spec["type"], spec["minutes"], t, major=True)
        if "boost" in spec:
            area, extra, minutes = spec["boost"]
            self.st["boost"][area] = {"extra": extra, "until": iso(t + MINUTE * minutes)}
            await self._incident(t, area, "quality_deviation", "high", f"Рост брака на участке «{P.AREA_NAMES[area]}»",
                                 f"{spec['reason']}: дефекты ЛКП выше нормы, ожидаемая длительность отклонения "
                                 f"{minutes} мин. Проверить параметры сушки и вязкость эмали.")
        return spec["title"]

