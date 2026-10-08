"""
ИИ-советник по инцидентам: три варианта решения — «ничего не менять», A и Б — и рекомендация.

- Цифры таблицы считает имитационная модель (forecast.py): каждый вариант прогоняется на 3 часа вперёд.
- Claude выбирает из допустимых действий два варианта, формулирует их, аргументирует по цифрам прогноза
  и рекомендует один из трёх. Ответ — строго по JSON-схеме (structured outputs).
- Без ключа ANTHROPIC_API_KEY или при сбое API — резервный алгоритм по тем же цифрам, чтобы оператор
  всё равно получил варианты.
"""
import asyncio
import json
import logging
import time
from datetime import datetime

import anthropic

from app.core.config import get_settings
from app.simulator import plant as P
from app.simulator.engine import ACTIONS
from app.simulator.forecast import HORIZON, METRICS, forecast, round_metrics

logger = logging.getLogger(__name__)

MAX_PARALLEL = 2  # одновременных запросов к Claude
_semaphore = asyncio.Semaphore(MAX_PARALLEL)
_client: anthropic.AsyncAnthropic | None = None

TYPE_RU = {
    "equipment_failure": "отказ оборудования", "material_shortage": "нехватка комплектующих",
    "quality_deviation": "отклонение по качеству", "downtime_limit": "превышен лимит простоя критичного оборудования",
}
MODEL_LABELS = {"claude-opus-5-5": "Claude Opus 5.5", "claude-sonnet-5-5": "Claude Sonnet 5.5"}
CRIT_RU = {"high": "высокая", "medium": "средняя", "low": "низкая"}
NOTHING = {
    "equipment_failure": "Ремонт идёт штатной бригадой в обычном темпе, без дополнительных затрат.",
    "material_shortage": "Ждём плановую поставку комплектующих, сборка стоит до её прихода.",
    "quality_deviation": "Участок работает в прежнем режиме, отклонение проходит само со временем.",
    "downtime_limit": "Линия работает в обычном режиме, оборудование продолжает изнашиваться.",
}

SYSTEM = """Ты — ИИ-советник диспетчера автосборочного завода Allur (цифровой двойник линии: Сварка → Окраска → Сборка → ОТК).
По инциденту тебе дают состояние завода и список допустимых действий с прогнозом, который рассчитала имитационная модель завода на 3 часа вперёд (среднее по нескольким прогонам с одинаковыми случайными событиями).

Задача: предложить оператору два варианта решения — A и Б — из списка действий и рекомендовать один из трёх: «ничего не менять», A или Б.

Правила:
- A и Б — разные действия из списка. Если действий больше двух, выбери два самых разумных и разных по подходу (например, быстрое, но дорогое, и дешёвое щадящее).
- Опирайся только на переданные цифры и факты. Не придумывай новых чисел, показателей, оборудования или причин. Цифры можно округлять.
- Рекомендуй по совокупности: выпуск, простой, брак, затраты, эффект в тенге и риски (критичность и износ оборудования, лимит простоя критичного оборудования 60 мин/сутки, норма брака 2%). «Ничего не менять» рекомендуй, только если меры не окупаются и не снижают заметный риск.
- Пиши по-русски, коротко, языком мастера смены. Анализ — не больше 2 предложений: суть проблемы и главный риск. Название варианта — до 60 символов. Аргументация каждого варианта и причина рекомендации — 1–2 предложения с ключевыми цифрами прогноза."""


def _client_or_none() -> anthropic.AsyncAnthropic | None:
    global _client
    settings = get_settings()
    if not settings.anthropic_api_key:
        return None
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=60.0, max_retries=1)
    return _client


def _schema(candidates: list[str]) -> dict:
    option = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": candidates},
            "title": {"type": "string"},
            "rationale": {"type": "string"},
        },
        "required": ["action", "title", "rationale"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "properties": {
            "analysis": {"type": "string"},
            "nothing_rationale": {"type": "string"},
            "option_a": option,
            "option_b": option,
            "recommended": {"type": "string", "enum": ["none", "A", "B"]},
            "recommendation_reason": {"type": "string"},
        },
        "required": ["analysis", "nothing_rationale", "option_a", "option_b", "recommended", "recommendation_reason"],
        "additionalProperties": False,
    }


def _forecast_view(values: dict) -> dict:
    return {f"{m['label']}, {m['unit']}": values[m["key"]] for m in METRICS}


def _context(snapshot: dict, refs: dict, inc_id: int, candidates: list[str], results: dict) -> dict:
    """Данные для Claude: инцидент, состояние участка и смены, варианты с прогнозом."""
    d = snapshot["decisions"][str(inc_id)]
    now = datetime.fromisoformat(snapshot["sim_now"])
    area = d["area"]
    ctx: dict = {
        "время_завода": now.astimezone(P.TZ).strftime("%d.%m.%Y %H:%M"),
        "инцидент": {"тип": TYPE_RU[d["type"]], "важность": d.get("severity"), "заголовок": d.get("title"),
                     "описание": d.get("description"), "участок": P.AREA_NAMES[area]},
    }
    code = d.get("code")
    if code and code in refs["equipment"]:
        eq = refs["equipment"][code]
        info = {"название": eq["name"], "критичность": CRIT_RU[eq["criticality"]],
                "износ_%": round(snapshot["wear"].get(code, {}).get("w", 0) * 100)}
        down = snapshot["downtime"].get(code)
        if down:
            start, end = datetime.fromisoformat(down["start"]), datetime.fromisoformat(down["end"])
            info.update(причина=down["reason"], простой_идёт_мин=round((now - start).total_seconds() / 60),
                        оценка_оставшегося_ремонта_мин=max(0, round((end - now).total_seconds() / 60)))
        ctx["оборудование"] = info
    worn = sorted(((c, w["w"]) for c, w in snapshot["wear"].items() if P.EQUIPMENT_BY_CODE[c][0] == area),
                  key=lambda x: -x[1])[:3]
    ctx["самое_изношенное_оборудование_участка"] = [
        {"название": refs["equipment"][c]["name"], "износ_%": round(w * 100)} for c, w in worn if c in refs["equipment"]]
    totals = snapshot.get("shift_totals", {})
    shift = snapshot.get("shift") or {}
    if shift:
        qc = totals.get("QC", {})
        at = totals.get(area, {})
        ctx["смена"] = {
            "план_смены_авто": shift.get("plan"),
            "выпущено_за_закрытые_часы_авто": qc.get("total", 0) - qc.get("scrap", 0),
            "брак_участка_за_смену_%": round(at["scrap"] / at["total"] * 100, 1) if at.get("total") else None,
            "осталось_минут_смены": round((datetime.fromisoformat(shift["end"]) - now).total_seconds() / 60),
        }
    ctx["межоперационные_буферы_кузовов"] = {P.AREA_NAMES[a]: v for a, v in snapshot.get("buffers", {}).items()}
    day = snapshot.get("day") or {}
    ctx["простой_критичного_оборудования_за_сутки_мин"] = sum((day.get("crit") or {}).values())
    ctx["нормативы"] = {"лимит_простоя_критичного_оборудования_мин_в_сутки": 60, "норма_брака_%": 2.0, "целевой_OEE_%": 85}
    ctx["горизонт_прогноза_мин"] = HORIZON
    ctx["варианты"] = [{"id": "none", "название": "Ничего не менять", "что_делаем": NOTHING[d["type"]],
                        "прогноз": _forecast_view(results["none"])}]
    for a in candidates:
        ctx["варианты"].append({"id": a, "название": ACTIONS[a]["title"], "что_делаем": ACTIONS[a]["effect"],
                                "прогноз": _forecast_view(results[a])})
    return ctx


async def _ask_claude(context: dict, candidates: list[str]) -> dict | None:
    client = _client_or_none()
    if client is None:
        return None
    model = get_settings().decision_model
    async with _semaphore:
        try:
            response = await client.beta.messages.create(
                model=model,
                max_tokens=8000,
                # Если классификатор безопасности отклонит запрос, API сам повторит его на резервной модели
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": "medium", "format": {"type": "json_schema", "schema": _schema(candidates)}},
                system=SYSTEM,
                messages=[{"role": "user", "content": json.dumps(context, ensure_ascii=False, indent=1)}],
            )
        except anthropic.RateLimitError:
            logger.warning("Claude: превышен лимит запросов, варианты строит резервный алгоритм")
            return None
        except anthropic.APIStatusError as e:
            logger.warning("Claude: ошибка API %s: %s", e.status_code, e.message)
            return None
        except anthropic.APIConnectionError as e:
            logger.warning("Claude: нет соединения: %s", e)
            return None
    if response.stop_reason != "end_turn":
        logger.warning("Claude: ответ не завершён (%s), запрос %s", response.stop_reason, response._request_id)
        return None
    text = next((b.text for b in response.content if b.type == "text"), None)
    try:
        data = json.loads(text) if text else None
    except json.JSONDecodeError:
        data = None
    if not data or data["option_a"]["action"] == data["option_b"]["action"]:
        logger.warning("Claude: некорректный выбор вариантов, запрос %s", response._request_id)
        return None
    data["model"] = response.model
    return data


def _fmt_delta(value: float) -> str:
    return f"{round(value):+d}".replace("-", "−")


def _rules(d: dict, candidates: list[str], results: dict) -> dict:
    """Резервный алгоритм: два действия с лучшим эффектом в тенге, рекомендация — лучшее, если окупается."""
    ranked = sorted(candidates, key=lambda a: -results[a]["effect"])[:2]
    base = results["none"]

    def why(a: str) -> str:
        r = results[a]
        return (f"Прогноз на 3 ч: выпуск {r['output']:.0f} авто ({_fmt_delta(r['output'] - base['output'])}), "
                f"простой участка {r['area_downtime']:.0f} мин, брак {r['scrap_pct']:.1f}%, "
                f"эффект {_fmt_delta(r['effect'])} тыс. ₸ при затратах {r['cost']:.0f} тыс. ₸.")

    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else best  # одно действие — показываем только вариант A
    recommended = "A" if results[best]["effect"] > 50 else "none"
    return {
        "analysis": f"{d.get('title') or TYPE_RU[d['type']]}. Без мер прогноз выпуска линии на 3 ч — "
                    f"{base['output']:.0f} авто, простой участка {base['area_downtime']:.0f} мин.",
        "nothing_rationale": f"{NOTHING[d['type']]} Выпуск за 3 ч — {base['output']:.0f} авто.",
        "option_a": {"action": best, "title": ACTIONS[best]["title"], "rationale": why(best)},
        "option_b": {"action": second, "title": ACTIONS[second]["title"], "rationale": why(second)},
        "recommended": recommended,
        "recommendation_reason": (f"Наибольший экономический эффект: {_fmt_delta(results[best]['effect'])} тыс. ₸ за 3 ч."
                                  if recommended == "A" else "Меры не окупаются на горизонте 3 ч."),
    }


async def build_decision(snapshot: dict, refs: dict, inc_id: int, candidates: list[str]) -> dict:
    """Варианты решения инцидента: прогноз по каждому действию + выбор и аргументация Claude."""
    started = time.monotonic()
    d = snapshot["decisions"][str(inc_id)]
    results = await asyncio.to_thread(forecast, snapshot, refs, inc_id, d["area"], candidates)

    answer = None
    if len(candidates) >= 2:
        answer = await _ask_claude(_context(snapshot, refs, inc_id, candidates, results), candidates)
    if answer:
        source = answer.pop("model")
        label = MODEL_LABELS.get(source, source)
    else:
        source, label = "rules", "Резервный алгоритм (без ИИ)"
        answer = _rules(d, candidates, results)

    options = [{"key": "none", "action": "none", "title": "Ничего не менять", "rationale": answer["nothing_rationale"],
                "effect_text": NOTHING[d["type"]], "values": round_metrics(results["none"])}]
    seen = set()
    for key, opt in (("A", answer["option_a"]), ("B", answer["option_b"])):
        if opt["action"] in seen:
            continue
        seen.add(opt["action"])
        options.append({"key": key, "action": opt["action"], "title": opt["title"], "rationale": opt["rationale"],
                         "effect_text": ACTIONS[opt["action"]]["effect"], "values": round_metrics(results[opt["action"]])})
    recommended = answer["recommended"] if any(o["key"] == answer["recommended"] for o in options) else "none"
    return {
        "incident_title": d.get("title"),
        "analysis": answer["analysis"],
        "horizon_min": HORIZON,
        "metrics": [{k: m[k] for k in ("key", "label", "unit", "better")} for m in METRICS],
        "options": options,
        "recommended": recommended,
        "recommendation_reason": answer["recommendation_reason"],
        "source": source,
        "source_label": label,
        "generated_ms": round((time.monotonic() - started) * 1000),
    }
