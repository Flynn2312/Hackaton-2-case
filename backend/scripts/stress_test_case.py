#!/usr/bin/env python3
"""
Стресс-тест решения по Кейсу №2 «Цифровой двойник автозавода Allur»
и Положению Qostanai AI Industry Hackathon 2026.

Запуск из папки backend:
    python scripts/stress_test_case.py                     # только логика
    python scripts/stress_test_case.py --url http://127.0.0.1:8000   # + нагрузка на API
    python scripts/stress_test_case.py --url https://stushniki.onrender.com

Блоки:
  A. Верность данным кейса (официальная таблица vs данные в коде)
  B. Пересчет KPI из официальных данных (OEE, простои, брак, план 5500)
  C. Самосогласованность бизнес-модели (окупаемость, эффект)
  D. Робастность AI-движка (граничные/невалидные входы, монотонность)
  E. Маршрутизация Copilot (подсказки UI, ложные срабатывания)
  F. Чувствительность What-If к входным параметрам
  G. HTTP-нагрузка: холодный старт, p50/p95, конкурентность, ошибки
"""
import argparse
import json
import math
import os
import statistics
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

RESULTS = []  # (block, name, status, detail)  status: PASS | FAIL | WARN


def rec(block, name, status, detail=""):
    RESULTS.append((block, name, status, detail))
    icon = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️"}[status]
    print(f"  {icon} [{block}] {name}" + (f" — {detail}" if detail else ""))


# ── Официальные данные из «Кейс_Цифровой_двойник_Тестовые_данные.docx» ──
OFF_PROD = [
    ("01.10.2026", "Сварка-1", 120, 118, 7.8, 98),
    ("01.10.2026", "Окраска-1", 120, 115, 7.5, 94),
    ("01.10.2026", "Сборка-1", 120, 121, 8.0, 100),
    ("02.10.2026", "Сварка-1", 120, 111, 7.2, 91),
    ("02.10.2026", "Окраска-1", 120, 116, 7.7, 96),
    ("02.10.2026", "Сборка-1", 120, 119, 7.9, 99),
]
OFF_DOWN = [
    ("01.10.2026", "Сварка", "ABB-01", "Ошибка датчика", 25),
    ("01.10.2026", "Окраска", "Камера-02", "Замена фильтра", 40),
    ("02.10.2026", "Сборка", "Конвейер-03", "Обрыв цепи", 55),
    ("02.10.2026", "Сварка", "ABB-04", "Плановое ТО", 30),
]
OFF_QUAL = [
    ("01.10.2026", "Сварка", 118, 2, 1.7),
    ("01.10.2026", "Окраска", 115, 4, 3.5),
    ("01.10.2026", "Сборка", 121, 1, 0.8),
    ("02.10.2026", "Сварка", 111, 3, 2.7),
    ("02.10.2026", "Окраска", 116, 6, 5.2),
    ("02.10.2026", "Сборка", 119, 2, 1.7),
]
OFF_PLAN = {"Chevrolet Onix": 2500, "Chevrolet Cobalt": 1800, "JAC J7": 500}
TARGET_OEE, MAX_SCRAP, MAX_DOWN, MONTH_PLAN = 85.0, 2.0, 60, 5500


# ───────────────────────── A ─────────────────────────
def block_a():
    print("\nA. ВЕРНОСТЬ ДАННЫМ КЕЙСА")
    from scripts import analyze_case_data as acd

    for off, mine in zip(OFF_PROD, acd.PRODUCTION_DATA):
        d, line, plan, fact, rt, load = off
        diffs = []
        if mine["fact"] != fact:
            diffs.append(f"факт {mine['fact']}≠{fact}")
        if mine["runtime_h"] != rt:
            diffs.append(f"время {mine['runtime_h']}≠{rt}")
        if mine["load_pct"] != load:
            diffs.append(f"загрузка {mine['load_pct']}≠{load}")
        rec("A", f"analyze_case_data PRODUCTION {d} {line}",
            "FAIL" if diffs else "PASS", ", ".join(diffs))

    for off, mine in zip(OFF_QUAL, acd.QUALITY_DATA):
        d, area, out, scrap, pct = off
        diffs = []
        if mine["good"] != out:
            diffs.append(f"выпуск {mine['good']}≠{out}")
        if mine["scrap"] != scrap:
            diffs.append(f"брак {mine['scrap']}≠{scrap}")
        if abs(mine["scrap_pct"] - pct) > 0.05:
            diffs.append(f"%брака {mine['scrap_pct']}≠{pct}")
        rec("A", f"analyze_case_data QUALITY {d} {area}",
            "FAIL" if diffs else "PASS", ", ".join(diffs))

    # analytics.py — захардкоженный «срез» участков
    import inspect
    from app.services import analytics as an
    src = inspect.getsource(an.AnalyticsService.get_plant_oee)
    official_02 = {"Сварка": (111, 2.7), "Окраска": (116, 5.2), "Сборка": (119, 1.7)}
    for name, (fact, scrap) in official_02.items():
        line = next((l for l in src.splitlines() if f'"name": "{name}"' in l), "")
        ok = f'"fact": {fact}' in line and f'"scrap": {scrap}' in line
        rec("A", f"analytics.get_plant_oee: {name} = данные 02.10?",
            "PASS" if ok else "FAIL", "" if ok else line.strip()[:140])
    rec("A", "ОТК / склады в get_plant_oee", "WARN",
        "в кейсе нет данных по ОТК и складам — значения выдуманы, OEE ОТК входит в средний OEE завода")
    rec("A", "Телеметрия (вибрация 6.8 мм/с, печь 147.5°C, наработка 8905 ч)", "WARN",
        "в исходных данных кейса отсутствует — обязательно маркировать как синтетическую")


# ───────────────────────── B ─────────────────────────
def oee_row(plan, fact, rt, scrap):
    a = rt / 8.0
    p = min(1.0, fact / plan)
    q = (fact - scrap) / fact
    return a, p, q, a * p * q * 100


def block_b():
    print("\nB. ПЕРЕСЧЕТ KPI ИЗ ОФИЦИАЛЬНЫХ ДАННЫХ")
    qmap = {(d, a): s for d, a, _, s, _ in OFF_QUAL}
    table = []
    for d, line, plan, fact, rt, load in OFF_PROD:
        area = line.split("-")[0]
        a, p, q, o = oee_row(plan, fact, rt, qmap[(d, area)])
        table.append((d, line, a, p, q, o))
        print(f"     {d} {line:10s} A={a*100:5.1f}% P={p*100:5.1f}% Q={q*100:5.1f}%  OEE={o:5.1f}%")
    worst = min(table, key=lambda r: r[5])
    rec("B", "Реальное узкое место по OEE", "WARN",
        f"{worst[1]} {worst[0]} (OEE {worst[5]:.1f}%), а НЕ Сборка — у Сборки-1 OEE 96–99%")

    avg = statistics.mean(r[5] for r in table)
    rec("B", "Средний OEE линий за 2 дня", "PASS" if avg >= TARGET_OEE else "FAIL",
        f"{avg:.1f}% при цели ≥{TARGET_OEE}% (в коде Copilot заявлено 81.2%, What-If — 78.3%)")

    # Согласованность простоев и времени работы
    dmap = {}
    for d, area, *_rest, mins in OFF_DOWN:
        dmap[(d, area)] = dmap.get((d, area), 0) + mins
    for d, line, plan, fact, rt, load in OFF_PROD:
        area = line.split("-")[0]
        lost = round((8.0 - rt) * 60)
        logged = dmap.get((d, area), 0)
        if abs(lost - logged) > 10:
            rec("B", f"Сверка простоев {d} {line}", "WARN",
                f"по времени работы потеряно {lost} мин, в журнале простоев {logged} мин — противоречие в данных")

    for d, area, eq, reason, mins in OFF_DOWN:
        st = "FAIL" if mins > MAX_DOWN else ("WARN" if mins >= 0.75 * MAX_DOWN else "PASS")
        rec("B", f"Простой {eq} {d} vs лимит {MAX_DOWN} мин/сутки", st,
            f"{mins} мин ({reason}), запас {MAX_DOWN - mins} мин")
    for day in ("01.10.2026", "02.10.2026"):
        total = sum(m for dd, *_r, m in OFF_DOWN if dd == day)
        rec("B", f"Суммарные простои {day}", "WARN" if total > MAX_DOWN else "PASS",
            f"{total} мин по заводу (лимит задан на единицу критичного оборудования)")

    over = [(d, a, p) for d, a, _o, _s, p in OFF_QUAL if p > MAX_SCRAP]
    rec("B", "Участки с браком > 2%", "FAIL" if over else "PASS",
        "; ".join(f"{a} {d}: {p}%" for d, a, p in over))

    s = sum(OFF_PLAN.values())
    rec("B", "Сумма плана по моделям vs «≥5 500 авто/мес»", "FAIL" if s < MONTH_PLAN else "PASS",
        f"{s} авто — дефицит {MONTH_PLAN - s}; ловушка кейса, нужно иметь ответ")
    days_needed = MONTH_PLAN / (120 * 2)
    rec("B", "Мощность 120 авто/смена × 2 смены", "WARN",
        f"для 5 500/мес нужно {days_needed:.1f} рабочих дней без потерь — запаса практически нет")


# ───────────────────────── C ─────────────────────────
def block_c():
    print("\nC. САМОСОГЛАСОВАННОСТЬ БИЗНЕС-МОДЕЛИ")
    from app.services.analytics import AnalyticsService
    be = AnalyticsService.get_business_effect()
    calc = 85_000_000 / (be.annual_economic_effect_kzt / 12)
    txt_ok = f"{be.payback_period_months}" in be.justification
    rec("C", "Окупаемость: поле vs текст обоснования", "PASS" if txt_ok else "FAIL",
        f"payback_period_months={be.payback_period_months}, расчет {calc:.2f} мес")
    with_opex = be.capex_kzt / ((be.annual_economic_effect_kzt - be.annual_opex_kzt) / 12)
    opex_ok = abs(be.payback_period_months - round(with_opex, 1)) < 0.05
    rec("C", "OPEX учтен в окупаемости?", "PASS" if opex_ok else "WARN",
        f"да, срок с OPEX {with_opex:.2f} мес (в ответе {be.payback_period_months} мес)")
    rec("C", "Двойной счет: простой (5.1 млн ₸/ч) + доп. маржа +240 авто", "WARN",
        "стоимость часа простоя обычно и есть потерянная маржа — эффект 348 млн может дублировать 739.5 млн")
    logged_year = sum(m for *_r, m in OFF_DOWN) / 2 * 250 / 60
    rec("C", "База 780 ч простоев/год", "WARN",
        f"из данных кейса ≈{logged_year:.0f} ч/год (75 мин/сутки × 250 дн) — 780 ч не обоснованы")
    eff_ratio = be.annual_economic_effect_kzt / (MONTH_PLAN * 12 * 1_450_000)
    rec("C", "Эффект относительно маржи завода", "WARN",
        f"1.2 млрд ₸ = {eff_ratio*100:.1f}% годовой маржи (66 000 авто × 1.45 млн) — жюри спросит источник констант")


# ───────────────────────── D ─────────────────────────
def block_d():
    print("\nD. РОБАСТНОСТЬ AI-ДВИЖКА")
    from app.services.ai_engine import ai_engine
    from app.schemas.ai import ConveyorTelemetryRequest as CR, PaintTelemetryRequest as PR

    weird = [
        ("отрицательная вибрация", {"vibration_rms": -5, "temp_celsius": 20, "operating_hours": -100}),
        ("нули", {"vibration_rms": 0, "temp_celsius": 0, "operating_hours": 0}),
        ("огромные значения", {"vibration_rms": 1e9, "temp_celsius": 1e6, "operating_hours": 10**9}),
        ("NaN", {"vibration_rms": float("nan"), "temp_celsius": 50, "operating_hours": 1000}),
    ]
    for name, kwargs in weird:
        try:
            req = CR(**kwargs)
            r = ai_engine.predict_conveyor_failure(req)
            bad = r.risk_score_percent < 0 or r.risk_score_percent > 100
            rec("D", f"Конвейер: {name}", "FAIL" if bad else "WARN",
                f"принято → risk={r.risk_score_percent}, status={r.status}")
        except Exception as e:
            rec("D", f"Конвейер: {name}", "PASS", f"успешно отклонено валидацией: {type(e).__name__}")

    paint_cases = [
        ("отрицательное давление", {"drying_temp_celsius": 140, "enamel_viscosity_sec": 21,
                                      "relative_humidity_pct": 65, "filter_pressure_kpa": -200}),
        ("влажность 500%", {"drying_temp_celsius": 140, "enamel_viscosity_sec": 21,
                              "relative_humidity_pct": 500, "filter_pressure_kpa": 10}),
        ("печь 20°C (холодная)", {"drying_temp_celsius": 20, "enamel_viscosity_sec": 21,
                                     "relative_humidity_pct": 65, "filter_pressure_kpa": 10}),
    ]
    for name, kwargs in paint_cases:
        try:
            req = PR(**kwargs)
            r = ai_engine.predict_paint_quality_scrap(req)
            detail = f"risk={r.risk_score_percent}, status={r.status}"
            if "влажность" in name:
                rec("D", f"Окраска: {name}", "FAIL" if r.status == "NORMAL" else "PASS",
                    detail + " — влажность учтена в модели")
            elif "холодная" in name:
                has_cold = "недогрев" in r.root_cause_explanation.lower()
                rec("D", f"Окраска: {name}", "PASS" if has_cold else "WARN",
                    detail + ("; корректно распознан недогрев" if has_cold else "; текст говорит о перегреве"))
            else:
                rec("D", f"Окраска: {name}", "FAIL" if r.risk_score_percent < 0 else "WARN", detail)
        except Exception as e:
            rec("D", f"Окраска: {name}", "PASS", f"успешно отклонено валидацией: {type(e).__name__}")

    # Монотонность риска по вибрации
    prev, mono = -1, True
    for v in [x / 10 for x in range(0, 120)]:
        r = ai_engine.predict_conveyor_failure(CR(vibration_rms=v, temp_celsius=55, operating_hours=5000))
        if r.risk_score_percent < prev:
            mono = False
        prev = r.risk_score_percent
    rec("D", "Монотонность риска по вибрации 0→12 мм/с", "PASS" if mono else "FAIL")

    r = ai_engine.predict_conveyor_failure(CR())
    txt = r.root_cause_explanation
    rec("D", "Текст «превышает порог ISO (6.0) на N%»", "FAIL" if "на 172%" in txt else "PASS",
        "172% считается от 2.5 мм/с, а не от 6.0 (реально +13%)" if "на 172%" in txt else "")

    rep = ai_engine.run_harness_evaluation()
    rec("D", "Evaluation Harness", "WARN",
        f"{rep.passed_cases}/{rep.total_cases}, F1={rep.f1_score} — 8 кейсов, подобранных под те же пороги; "
        "это unit-тест правил, не валидация модели")
    # Независимые кейсы (на границах порогов)
    indep = [
        (CR(vibration_rms=4.4, temp_celsius=70, operating_hours=9000), "WARNING/CRITICAL"),
        (CR(vibration_rms=2.0, temp_celsius=75, operating_hours=500), "WARNING/CRITICAL"),
        (CR(vibration_rms=5.9, temp_celsius=40, operating_hours=100), "WARNING"),
    ]
    for req, exp in indep:
        r = ai_engine.predict_conveyor_failure(req)
        ok = r.status in exp.split("/")
        rec("D", f"Независимый кейс v={req.vibration_rms} T={req.temp_celsius} h={req.operating_hours}",
            "PASS" if ok else "WARN", f"ожидали {exp}, получили {r.status} (risk {r.risk_score_percent})")

    # Прогноз-сводка — проверка чувствительности к телеметрии
    f1 = ai_engine.get_forecast_summary().model_dump()
    f2 = ai_engine.get_forecast_summary(conveyor_telemetry=CR(vibration_rms=1.5, temp_celsius=50.0, operating_hours=1000)).model_dump()
    is_dynamic = (f1["alerts"][0]["risk_score"] != f2["alerts"][0]["risk_score"])
    rec("D", "/ai/forecast зависит от данных?", "PASS" if is_dynamic else "FAIL",
        f"при v=6.8 risk={f1['alerts'][0]['risk_score']}%, при v=1.5 risk={f2['alerts'][0]['risk_score']}% (динамический пересчет)")


# ───────────────────────── E ─────────────────────────
UI_SUGGESTIONS = [
    "Как повлияет превентивный ремонт на OEE смены?",
    "Какая стоимость простоя конвейера в минуту?",
    "Что происходит в окрасочном цехе?",
    "Сколько стоит перекрас одного кузова?",
    "Каков суммарный экономический эффект внедрения?",
    "Покажи статус сборочного цеха",
    "Запусти комплексную оптимизацию What-If",
    "Как рассчитывается OEE предприятия?",
    "Проведи бенчмарк AI модели",
    "Что делать с конвейером сборки?",
    "Запусти симуляцию What-If",
    "Покажи экономический эффект 1.2 млрд ₸",
    "Что сейчас с конвейером сборки?",
    "Почему вырос брак в окрасочном цехе?",
    "Какой экономический эффект внедрения?",
    "Запусти бенчмарк модели (AI Harness)",
]
JURY_QUESTIONS = [
    ("Расскажи концепцию решения", "concept"),
    ("Какие контакты у ответственного?", "contact"),
    ("Какой брак на сварке 02.10?", "weld"),
    ("Что с роботом ABB-04?", "weld"),
    ("Какая загрузка линии сварки?", "weld|oee"),
    ("Сколько JAC J7 в плане?", "oee"),
]


def route_of(resp):
    a = resp.answer
    if "Приветствую" in a:
        return "greeting"
    if "Концепция цифрового двойника" in a:
        return "concept"
    if "Контакты Организационного" in a or "Контакты оргкомитета" in a:
        return "contact"
    if "Evaluation Harness" in a:
        return "harness"
    if "Финансово-экономическое" in a:
        return "finance"
    if "Производственный баланс" in a:
        return "oee"
    if "Статус участка Сварка" in a:
        return "weld"
    if "Окрасочной камере" in a:
        return "paint"
    if "Конвейеру-03" in a or "Конвейер" in a:
        return "conveyor"
    return "other"


def block_e():
    print("\nE. МАРШРУТИЗАЦИЯ COPILOT")
    from app.services.ai_engine import ai_engine
    from app.schemas.ai import CopilotChatRequest
    for q in UI_SUGGESTIONS:
        r = route_of(ai_engine.chat_with_copilot(CopilotChatRequest(message=q)))
        rec("E", f"Подсказка UI: «{q}»", "FAIL" if r == "greeting" else "PASS", f"→ {r}")
    for q, exp in JURY_QUESTIONS:
        r = route_of(ai_engine.chat_with_copilot(CopilotChatRequest(message=q)))
        ok = any(e == r for e in exp.split("|"))
        rec("E", f"Вопрос жюри: «{q}»", "PASS" if ok else "WARN", f"→ {r} (ожидали {exp})")
    a = ai_engine.chat_with_copilot(CopilotChatRequest(message="конвейер", history=[], area_id=3))
    b = ai_engine.chat_with_copilot(CopilotChatRequest(message="конвейер", history=[], area_id=None))
    rec("E", "history / area_id влияют на ответ?", "FAIL" if a == b else "PASS",
        "игнорируются — нет контекста диалога" if a == b else "")


# ───────────────────────── F ─────────────────────────
def block_f():
    print("\nF. ЧУВСТВИТЕЛЬНОСТЬ WHAT-IF")
    from app.services.analytics import AnalyticsService
    from app.schemas.analytics import WhatIfSimulationRequest as W
    for sc in ("conveyor_predictive", "paint_stabilization", "conveyor_and_paint"):
        r1 = AnalyticsService.simulate_what_if(W(scenario=sc, downtime_reduction_minutes=1, quality_boost_percent=0.1))
        r2 = AnalyticsService.simulate_what_if(W(scenario=sc, downtime_reduction_minutes=400, quality_boost_percent=50))
        same = (r1.simulated_oee, r1.shift_economic_gain_kzt) == (r2.simulated_oee, r2.shift_economic_gain_kzt)
        rec("F", f"What-If «{sc}»: 1 мин vs 400 мин", "FAIL" if same else "PASS",
            f"OEE {r1.simulated_oee} / {r2.simulated_oee}, эффект {r1.shift_economic_gain_kzt} / {r2.shift_economic_gain_kzt}")
    r = AnalyticsService.simulate_what_if(W(scenario="garbage", downtime_reduction_minutes=-50, quality_boost_percent=-10))
    rec("F", "Неизвестный сценарий / отрицательные входы", "PASS" if r.status == "error" else "FAIL",
        f"status={r.status}, title={r.scenario_title}")
    r0 = AnalyticsService.simulate_what_if(W(scenario="conveyor_and_paint", downtime_reduction_minutes=0, quality_boost_percent=0))
    rec("F", "downtime_reduction_minutes=0", "FAIL" if r0.downtime_saved_minutes != 0 else "PASS",
        f"сохранено {r0.downtime_saved_minutes} мин")
    from app.services.analytics import AnalyticsService as A
    plant = A.get_plant_oee(db=None)
    w_check = A.simulate_what_if(W(scenario="conveyor_and_paint"))
    oee_synced = (w_check.original_oee == plant.actual_oee)
    rec("F", "Базовый OEE: дашборд vs What-If", "PASS" if oee_synced else "FAIL",
        f"дашборд={plant.actual_oee}%, What-If={w_check.original_oee}% (единый источник истины)")


# ───────────────────────── G ─────────────────────────
def http(method, url, body=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read()
            return r.status, (time.perf_counter() - t) * 1000
    except urllib.error.HTTPError as e:
        return e.code, (time.perf_counter() - t) * 1000
    except Exception as e:
        return f"ERR:{type(e).__name__}", (time.perf_counter() - t) * 1000


def block_g(base, n, conc):
    print(f"\nG. HTTP-НАГРУЗКА  {base}  (запросов на эндпоинт={n}, параллельно={conc})")
    code, ms = http("GET", base + "/health")
    rec("G", "Первый запрос (холодный старт)", "FAIL" if ms > 10000 or code != 200 else ("WARN" if ms > 3000 else "PASS"),
        f"{code}, {ms:.0f} мс")
    endpoints = [
        ("GET", "/analytics/oee", None),
        ("GET", "/analytics/business-effect", None),
        ("POST", "/analytics/what-if", {"scenario": "conveyor_and_paint"}),
        ("GET", "/ai/forecast", None),
        ("POST", "/ai/predict-conveyor", {}),
        ("POST", "/ai/copilot/chat", {"message": "Что с конвейером?"}),
        ("GET", "/ai/harness/evaluate", None),
        ("GET", "/production-records", None),
        ("GET", "/downtime-events", None),
    ]
    for m, path, body in endpoints:
        with ThreadPoolExecutor(conc) as ex:
            res = list(ex.map(lambda _: http(m, base + path, body, 30), range(n)))
        lat = sorted(x[1] for x in res)
        errs = [x[0] for x in res if x[0] != 200]
        p50 = lat[len(lat) // 2]
        p95 = lat[min(len(lat) - 1, math.ceil(len(lat) * 0.95) - 1)]
        st = "FAIL" if errs else ("WARN" if p95 > 1500 else "PASS")
        rec("G", f"{m} {path}", st,
            f"p50={p50:.0f} мс p95={p95:.0f} мс ошибок={len(errs)}/{n}" + (f" {set(errs)}" if errs else ""))
    bad = [
        ("POST", "/ai/predict-conveyor", {"vibration_rms": "abc"}, 422),
        ("POST", "/ai/copilot/chat", {"message": "x" * 200_000}, 200),
        ("GET", "/production-areas/999999", None, 404),
        ("GET", "/production-records?limit=100000", None, 422),
    ]
    for m, path, body, exp in bad:
        code, ms = http(m, base + path, body, 30)
        rec("G", f"Невалидный ввод {m} {path[:40]}", "PASS" if code == exp else "FAIL",
            f"ожидали {exp}, получили {code} ({ms:.0f} мс)")


def summary():
    print("\n" + "=" * 78)
    for s in ("FAIL", "WARN", "PASS"):
        print(f"  {s}: {sum(1 for r in RESULTS if r[2] == s)}")
    out = os.path.join(os.path.dirname(__file__), "stress_test_report.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump([dict(block=b, name=n, status=s, detail=d) for b, n, s, d in RESULTS],
                  f, ensure_ascii=False, indent=2)
    print(f"  Отчет: {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="Базовый URL API, например http://127.0.0.1:8000")
    ap.add_argument("-n", type=int, default=30)
    ap.add_argument("-c", type=int, default=10)
    args = ap.parse_args()
    for blk in (block_a, block_b, block_c, block_d, block_e, block_f):
        try:
            blk()
        except Exception as e:
            rec(blk.__name__[-1].upper(), "Блок упал", "FAIL", f"{type(e).__name__}: {e}")
    if args.url:
        block_g(args.url.rstrip("/"), args.n, args.c)
    summary()
