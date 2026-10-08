"""
Прогноз What-If: «что будет, если…» на копии живого завода.

1. Берётся текущее состояние симуляции (оборудование, износ, буферы, идущие простои, смена).
2. Две копии прогоняются на HORIZON минут работы линии: базовая (ничего не меняем) и со сценарием
   оператора (простой, загрузка, брак окраски, аварии узлов, буфер, ТО). Несколько прогонов
   с одинаковыми случайными событиями — разница между ними и есть эффект сценария.
3. Claude по этим цифрам коротко объясняет: к чему приведёт, почему и как действовать.
   Без ключа или при сбое API — короткий текст по шаблону из тех же цифр.
"""
import asyncio
import copy
import logging
import random
import time
from datetime import datetime, timedelta

from pydantic import BaseModel, Field

from app.simulator import plant as P
from app.simulator.advisor import MODEL_LABELS, claude_json
from app.simulator.engine import PlantSimulator, iso
from app.simulator.forecast import CAR_MARGIN_KZT, DEFECT_KZT, MemoryStore, NullHub

logger = logging.getLogger(__name__)

HORIZON = 480  # мин работы линии (смена); ночи и выходные движок пропускает сам
RUNS = 6


class WhatIfScenario(BaseModel):
    """Рычаги экрана What-If. base_* — значения, с которых оператор начинал (меняются только сдвинутые рычаги)."""
    extra_downtime: int = Field(0, ge=-30, le=90, description="Внеплановый простой, мин (минус — меньше простоев)")
    load_delta: int = Field(0, ge=-30, le=15, description="Изменение загрузки линии, %")
    defect_rate: float = Field(..., ge=0.1, le=15, description="Брак на окраске, %")
    base_defect_rate: float = Field(..., ge=0.1, le=15, description="Брак на окраске до изменения, %")
    stopped_conveyor: bool = False
    stopped_paint: bool = False
    stopped_weld: bool = False
    maint: bool = False
    buf: int = Field(8, ge=0, le=30, description="Буфер кузовов перед сборкой, шт")
    base_buf: int = Field(8, ge=0, le=30)


STOPS = [  # аварийный останов узла: поле сценария, код оборудования, причина, минут
    ("stopped_conveyor", "ASM-CNV-03", "Обрыв цепи (сценарий What-If)", 55),
    ("stopped_paint", "PNT-CAB-02", "Отказ окрасочной камеры (сценарий What-If)", 40),
    ("stopped_weld", "WLD-ABB-01", "Отказ сварочного робота (сценарий What-If)", 25),
]


def describe(sc: WhatIfScenario) -> list[str]:
    """Сценарий словами — только то, что оператор изменил."""
    out = []
    if sc.extra_downtime > 0:
        out.append(f"дополнительный внеплановый простой самого изношенного критичного оборудования +{sc.extra_downtime} мин")
    elif sc.extra_downtime < 0:
        out.append(f"сокращение внеплановых простоев на {-sc.extra_downtime} мин в сутки (надёжнее обслуживание)")
    if sc.load_delta:
        out.append(f"загрузка линии {sc.load_delta:+d}%")
    if abs(sc.defect_rate - sc.base_defect_rate) >= 0.05:
        out.append(f"брак на окраске {sc.base_defect_rate:.1f}% → {sc.defect_rate:.1f}%")
    for field, code, reason, minutes in STOPS:
        if getattr(sc, field):
            out.append(f"аварийный останов {code}: {reason.split(' (')[0].lower()}, {minutes} мин")
    if sc.buf != sc.base_buf:
        out.append(f"буфер кузовов перед сборкой {sc.base_buf} → {sc.buf} шт")
    if sc.maint:
        out.append("превентивное ТО изношенного оборудования в пересменку (износ сбрасывается без остановки линии)")
    return out


async def _apply(sim: PlantSimulator, sc: WhatIfScenario) -> None:
    t = sim.now
    until = iso(t + timedelta(days=3))  # на весь горизонт, включая ночь
    mods = sim.st["mods"]
    if sc.load_delta:
        for area in P.LINE_AREAS:
            mods[f"perf:{area}"] = {"mul": 1 + sc.load_delta / 100, "until": until}
    if abs(sc.defect_rate - sc.base_defect_rate) >= 0.05:
        mods["scrap:PAINT"] = {"mul": sc.defect_rate / 100, "until": until}  # брак окраски ровно как задан
    if sc.extra_downtime < 0:
        for area in P.LINE_AREAS:
            mods[f"wear:{area}"] = {"mul": max(0.2, 1 + sc.extra_downtime / 60), "until": until}
    if sc.maint:
        for code, wear in sim.st["wear"].items():
            if wear["w"] > 0.4:
                wear["w"] = 0.05
    if sc.buf != sc.base_buf:
        sim.st["buffers"]["ASSY"] = sc.buf
    for field, code, reason, minutes in STOPS:
        if getattr(sc, field) and code in sim.refs["equipment"] and code not in sim.st["downtime"]:
            await sim._start_downtime(code, reason, "breakdown", minutes, t)
    if sc.extra_downtime > 0:
        line = [c for c in sim.codes if P.EQUIPMENT_BY_CODE[c][0] in P.LINE_AREAS and c not in sim.st["downtime"]
                and sim.refs["equipment"][c]["criticality"] == "high"]
        if line:
            target = max(line, key=lambda c: sim.st["wear"][c]["w"])
            await sim._start_downtime(target, "Внеплановый простой (сценарий What-If)", "breakdown", sc.extra_downtime, t)


async def _run(snapshot: dict, refs: dict, sc: WhatIfScenario | None, seed: int) -> dict:
    store = MemoryStore()
    sim = PlantSimulator(store, NullHub(), random.Random(seed))
    sim.refs = refs
    sim.codes = [c for c in refs["equipment"] if c in P.EQUIPMENT_BY_CODE]
    sim.code_by_id = {e["id"]: c for c, e in refs["equipment"].items()}
    sim.st = copy.deepcopy(snapshot)
    sim._ensure_state()
    sim.decisions_enabled = False
    sim.st["decisions"].clear()
    if sc:
        await _apply(sim, sc)
    for _ in range(HORIZON):
        await sim.step()
    s = sim.stats
    made = {a: s.get(f"made:{a}", 0) for a in P.LINE_AREAS}
    scrap = {a: s.get(f"scrap:{a}", 0) for a in P.LINE_AREAS}
    oee = [min(100.0, (made[a] - scrap[a]) / (P.HOURLY_PLAN / 60 * s[f"minutes:{a}"]) * 100)
           for a in P.LINE_AREAS if s.get(f"minutes:{a}")]
    minutes_qc = s.get("minutes:QC", 0)
    plan = P.HOURLY_PLAN * minutes_qc / 60
    return {
        "output": s.get("line_out", 0),
        "plan": plan,
        "fulfillment": s.get("line_out", 0) / plan * 100 if plan else 0,
        "oee": sum(oee) / len(oee) if oee else 0,
        "scrap_paint": scrap["PAINT"] / made["PAINT"] * 100 if made["PAINT"] else 0,
        "scrap_line": sum(scrap.values()) / sum(made.values()) * 100 if sum(made.values()) else 0,
        "scrap_count": sum(scrap.values()),
        "crit_downtime": s.get("crit_downtime", 0),
        "line_loss": max(0.0, minutes_qc - s.get("runtime:QC", 0)),
        "incidents": store.counts.get("incidents", 0),
    }


async def _forecast(snapshot: dict, refs: dict, sc: WhatIfScenario) -> tuple[dict, dict]:
    seeds = [random.randrange(10 ** 9) for _ in range(RUNS)]

    async def avg(scenario):
        runs = [await _run(snapshot, refs, scenario, seed) for seed in seeds]
        return {k: sum(r[k] for r in runs) / len(runs) for k in runs[0]}

    base, scen = await avg(None), await avg(sc)
    scen["money_mln"] = ((scen["output"] - base["output"]) * CAR_MARGIN_KZT
                         - (scen["scrap_count"] - base["scrap_count"]) * DEFECT_KZT) / 1e6
    return base, scen


LABELS = {  # показатель -> (подпись, единица, сколько знаков)
    "output": ("Выпуск годных авто за 8 ч", "авто", 0),
    "fulfillment": ("Выполнение плана", "%", 0),
    "oee": ("OEE линии", "%", 1),
    "scrap_paint": ("Брак на окраске", "%", 1),
    "scrap_line": ("Брак по линии", "%", 1),
    "crit_downtime": ("Простой критичного оборудования", "мин", 0),
    "line_loss": ("Потери времени на выходе линии", "мин", 0),
    "incidents": ("Новых инцидентов (в среднем)", "шт", 0),
}


def _view(values: dict) -> dict:
    return {f"{label}, {unit}": round(values[k], digits) if digits else round(values[k])
            for k, (label, unit, digits) in LABELS.items()}


def _plant_context(snapshot: dict, refs: dict) -> dict:
    now = datetime.fromisoformat(snapshot["sim_now"])
    shift = snapshot.get("shift") or {}
    qc = (snapshot.get("shift_totals") or {}).get("QC", {})
    down = []
    for code, d in snapshot.get("downtime", {}).items():
        if code in refs["equipment"] and d.get("id"):
            left = (datetime.fromisoformat(d["end"]) - now).total_seconds() / 60
            down.append(f"{refs['equipment'][code]['name']}: {d['reason']}, ещё ~{max(0, round(left))} мин")
    worn = sorted(((c, w["w"]) for c, w in snapshot["wear"].items() if c in refs["equipment"]), key=lambda x: -x[1])[:4]
    return {
        "время_завода": now.astimezone(P.TZ).strftime("%d.%m.%Y %H:%M"),
        "смена": {"план_смены_авто": shift.get("plan"), "выпущено_за_закрытые_часы": qc.get("total", 0) - qc.get("scrap", 0)},
        "идущие_простои": down or "нет",
        "межоперационные_буферы_кузовов": {P.AREA_NAMES[a]: v for a, v in snapshot.get("buffers", {}).items()},
        "самое_изношенное_оборудование": [f"{refs['equipment'][c]['name']} — износ {round(w * 100)}%" for c, w in worn],
        "простой_критичного_оборудования_сегодня_мин": sum(((snapshot.get("day") or {}).get("crit") or {}).values()),
        "нормативы": {"OEE_%": 85, "брак_%": 2.0, "лимит_простоя_критичного_оборудования_мин_в_сутки": 60,
                      "план_авто_в_час": P.HOURLY_PLAN},
    }


SYSTEM = """Ты — аналитик цифрового двойника автосборочного завода Allur (линия: Сварка → Окраска → Сборка → ОТК, межоперационные буферы кузовов).
Оператор проверяет сценарий «что будет, если…». Тебе дают текущее состояние завода, описание сценария и результаты имитационной модели завода на 8 часов работы линии: базовый прогноз (ничего не меняем) и прогноз со сценарием — средние по нескольким прогонам с одинаковыми случайными событиями.

Объясни оператору коротко и по делу:
- verdict — одна фраза до 140 символов: главный итог сценария.
- tone — good (сценарий улучшает положение), warn (смешанный итог или умеренный ущерб), bad (серьёзный ущерб плану, браку или лимиту простоя).
- key_figures — 3–4 самых важных для этого сценария показателя: label (короткое название), value (значение в сценарии с единицами), change (изменение к базовому прогнозу со знаком и единицами, например «−6 авто» или «+1,8 п.п.»), tone (good / warn / bad).
- consequences — 2–3 пункта «к чему приведёт»: что произойдёт с выпуском, планом, браком, простоем, деньгами.
- reasons — 2–3 пункта «почему»: причинно-следственная цепочка через участки, буферы, узкое место, износ.
- actions — 2–3 пункта «как действовать»: конкретные шаги для мастера смены.

Правила: опирайся только на переданные цифры и факты, не придумывай новых чисел и оборудования; цифры можно округлять. Если эффект сценария мал или в пределах случайного разброса, так и скажи. Каждый пункт — одно предложение до 160 символов. Пиши по-русски, языком мастера смены."""

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string"},
        "tone": {"type": "string", "enum": ["good", "warn", "bad"]},
        "key_figures": {"type": "array", "items": {
            "type": "object",
            "properties": {"label": {"type": "string"}, "value": {"type": "string"}, "change": {"type": "string"},
                           "tone": {"type": "string", "enum": ["good", "warn", "bad"]}},
            "required": ["label", "value", "change", "tone"], "additionalProperties": False}},
        "consequences": {"type": "array", "items": {"type": "string"}},
        "reasons": {"type": "array", "items": {"type": "string"}},
        "actions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "tone", "key_figures", "consequences", "reasons", "actions"],
    "additionalProperties": False,
}


def _num(v: float, digits: int = 0) -> str:
    return f"{v:.{digits}f}".replace(".", ",").replace("-", "−")


def _signed(v: float, digits: int = 0) -> str:
    s = _num(abs(v), digits)
    return f"+{s}" if v > 0 else f"−{s}" if v < 0 else "0"


def _rules(base: dict, scen: dict, changes: list[str]) -> dict:
    """Резервный текст без ИИ: те же цифры прогноза, короткие шаблонные выводы."""
    d_out = scen["output"] - base["output"]
    tone = "good" if d_out >= 1 and scen["money_mln"] > 0 else "bad" if d_out <= -3 or scen["crit_downtime"] > 60 else "warn"
    t = lambda better: "good" if better else "bad"  # noqa: E731
    return {
        "verdict": f"Выпуск за 8 ч {_signed(d_out)} авто к базовому прогнозу, эффект {_signed(scen['money_mln'], 2)} млн ₸.",
        "tone": tone,
        "key_figures": [
            {"label": "Выпуск за 8 ч", "value": f"{_num(scen['output'])} авто", "change": f"{_signed(d_out)} авто", "tone": t(d_out >= 0)},
            {"label": "OEE линии", "value": f"{_num(scen['oee'], 1)}%", "change": f"{_signed(scen['oee'] - base['oee'], 1)} п.п.", "tone": t(scen['oee'] >= base['oee'])},
            {"label": "Брак на окраске", "value": f"{_num(scen['scrap_paint'], 1)}%", "change": f"{_signed(scen['scrap_paint'] - base['scrap_paint'], 1)} п.п.", "tone": t(scen['scrap_paint'] <= base['scrap_paint'])},
            {"label": "Простой критичного оборудования", "value": f"{_num(scen['crit_downtime'])} мин", "change": f"{_signed(scen['crit_downtime'] - base['crit_downtime'])} мин", "tone": t(scen['crit_downtime'] <= base['crit_downtime'])},
        ],
        "consequences": [
            f"Выполнение плана за 8 ч — {_num(scen['fulfillment'])}% (без изменений — {_num(base['fulfillment'])}%).",
            f"Экономический эффект сценария — {_signed(scen['money_mln'], 2)} млн ₸ за 8 ч работы линии.",
        ],
        "reasons": [f"Сценарий: {', '.join(changes) if changes else 'без изменений'}."],
        "actions": ["Подробный разбор причин и рекомендации доступны при подключённом ИИ (ANTHROPIC_API_KEY)."],
    }


async def forecast_whatif(snapshot: dict, refs: dict, sc: WhatIfScenario) -> dict:
    started = time.monotonic()
    base, scen = await asyncio.to_thread(lambda: asyncio.run(_forecast(snapshot, refs, sc)))
    changes = describe(sc)
    context = {
        "состояние_завода": _plant_context(snapshot, refs),
        "сценарий": changes or ["без изменений (проверка базового прогноза)"],
        "горизонт_прогноза": "8 часов работы линии",
        "базовый_прогноз": _view(base),
        "прогноз_со_сценарием": {**_view(scen), "Эффект к базовому прогнозу, млн ₸": round(scen["money_mln"], 2)},
    }
    answer = await claude_json(SYSTEM, context, SCHEMA)
    if answer:
        source = answer.pop("model")
        label = MODEL_LABELS.get(source, source)
    else:
        source, label = "rules", "Резервный алгоритм (без ИИ)"
        answer = _rules(base, scen, changes)
    for key, limit in (("key_figures", 4), ("consequences", 3), ("reasons", 3), ("actions", 3)):
        answer[key] = answer[key][:limit]
    return {
        **answer,
        "scenario": changes,
        "horizon_h": HORIZON // 60,
        "sim_time": snapshot["sim_now"],
        "source": source,
        "source_label": label,
        "generated_ms": round((time.monotonic() - started) * 1000),
    }
