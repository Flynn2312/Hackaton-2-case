"""
Модель завода: участки, оборудование, причины простоев, нормы брака и правила инцидентов.

Общая для сида исторических данных (scripts/seed.py) и симулятора реального времени (app/simulator/engine.py),
чтобы история и «живые» данные генерировались по одной модели.
"""

import math
import random
from datetime import datetime, timedelta, timezone


TZ = timezone(timedelta(hours=5))  # Asia/Qostanay

SHIFT_MINUTES = 8 * 60
HOURLY_PLAN = 15  # 120 авто за смену, как в тестовых данных
INITIAL_BUFFER = 10
MAX_BUFFER = 30

FACTORY = {"name": "СарыаркаАвтоПром", "location": "Казахстан, г. Костанай"}

CAR_MODELS = [
    ("Chevrolet Onix", "CHEV-ONIX"),
    ("Chevrolet Cobalt", "CHEV-COBALT"),
    ("JAC J7", "JAC-J7"),
    ("Chevrolet Tracker", "CHEV-TRACKER"),
]

# code, name, sequence — по схеме участков из тестовых данных
AREAS = [
    ("WH-IN", "Склад комплектующих", 1),
    ("WELD", "Сварка", 2),
    ("PAINT", "Окраска", 3),
    ("ASSY", "Сборка", 4),
    ("QC", "Контроль качества", 5),
    ("WH-OUT", "Склад готовой продукции", 6),
]
LINE_AREAS = ["WELD", "PAINT", "ASSY", "QC"]
AREA_NAMES = {code: name for code, name, _ in AREAS}

# area, code, name, criticality, kind, ожидаемое число остановок за смену
EQUIPMENT = [
    ("WH-IN", "WH-FL-01", "Погрузчик Toyota Погрузчик-01", "low", "forklift", 0.03),
    ("WH-IN", "WH-FL-02", "Погрузчик Toyota Погрузчик-02", "low", "forklift", 0.03),
    ("WH-IN", "WH-AGV-01", "Транспортная тележка AGV-01", "medium", "agv", 0.04),
    ("WH-IN", "WH-AGV-02", "Транспортная тележка AGV-02", "medium", "agv", 0.04),
    ("WELD", "WLD-ABB-01", "Сварочный робот ABB-01", "medium", "weld_robot", 0.07),
    ("WELD", "WLD-ABB-02", "Сварочный робот ABB-02", "medium", "weld_robot", 0.06),
    ("WELD", "WLD-ABB-03", "Сварочный робот ABB-03", "medium", "weld_robot", 0.06),
    ("WELD", "WLD-ABB-04", "Сварочный робот ABB-04", "medium", "weld_robot", 0.07),
    ("WELD", "WLD-ABB-05", "Сварочный робот ABB-05", "medium", "weld_robot", 0.06),
    ("WELD", "WLD-ABB-06", "Сварочный робот ABB-06", "medium", "weld_robot", 0.05),
    ("WELD", "WLD-JIG-01", "Сварочный кондуктор Кондуктор-01", "high", "jig", 0.03),
    ("WELD", "WLD-JIG-02", "Сварочный кондуктор Кондуктор-02", "high", "jig", 0.03),
    ("WELD", "WLD-CNV-01", "Конвейер кузовов Конвейер-01", "high", "conveyor", 0.04),
    ("PAINT", "PNT-ECOAT-01", "Ванна катафореза КТЛ-01", "high", "ecoat", 0.04),
    ("PAINT", "PNT-CAB-01", "Окрасочная камера Камера-01", "high", "paint_cabin", 0.08),
    ("PAINT", "PNT-CAB-02", "Окрасочная камера Камера-02", "high", "paint_cabin", 0.09),
    ("PAINT", "PNT-CAB-03", "Окрасочная камера Камера-03", "high", "paint_cabin", 0.07),
    ("PAINT", "PNT-OVEN-01", "Сушильная печь Печь-01", "high", "oven", 0.05),
    ("PAINT", "PNT-RBT-01", "Окрасочный робот Dürr-01", "medium", "paint_robot", 0.05),
    ("PAINT", "PNT-RBT-02", "Окрасочный робот Dürr-02", "medium", "paint_robot", 0.05),
    ("ASSY", "ASM-CNV-02", "Сборочный конвейер Конвейер-02", "high", "conveyor", 0.05),
    ("ASSY", "ASM-CNV-03", "Сборочный конвейер Конвейер-03", "high", "conveyor", 0.05),
    ("ASSY", "ASM-NUT-01", "Гайковёрт Atlas Copco ГВ-01", "medium", "nutrunner", 0.05),
    ("ASSY", "ASM-NUT-02", "Гайковёрт Atlas Copco ГВ-02", "medium", "nutrunner", 0.05),
    ("ASSY", "ASM-FILL-01", "Стенд заправки жидкостей Заправка-01", "high", "fill", 0.03),
    ("QC", "QC-ALIGN-01", "Стенд развал-схождения СРС-01", "high", "qc_stand", 0.03),
    ("QC", "QC-ROLL-01", "Роликовый тормозной стенд РТС-01", "high", "qc_stand", 0.03),
    ("QC", "QC-RAIN-01", "Камера дождевания КД-01", "medium", "qc_stand", 0.03),
    ("QC", "QC-LIGHT-01", "Туннель визуального контроля ТВК-01", "low", "qc_stand", 0.02),
    ("WH-OUT", "WH-FL-03", "Погрузчик Toyota Погрузчик-03", "low", "forklift", 0.03),
]
EQUIPMENT_BY_CODE = {e[1]: e for e in EQUIPMENT}

# reason, type, min_minutes, max_minutes, weight
REASONS = {
    "weld_robot": [
        ("Ошибка датчика", "breakdown", 10, 35, 4),
        ("Замена электродных колпачков", "changeover", 8, 15, 3),
        ("Сбой программы робота", "breakdown", 15, 40, 2),
        ("Плановое ТО", "planned_maintenance", 30, 45, 1),
        ("Столкновение робота с оснасткой", "breakdown", 40, 90, 0.5),
    ],
    "jig": [
        ("Износ фиксаторов кондуктора", "breakdown", 20, 45, 2),
        ("Переналадка под модель", "changeover", 15, 30, 2),
        ("Отказ пневмоцилиндра", "breakdown", 25, 60, 1),
    ],
    "conveyor": [
        ("Застревание кузова", "breakdown", 8, 20, 3),
        ("Перегрев привода конвейера", "breakdown", 10, 25, 2),
        ("Обрыв цепи", "breakdown", 45, 90, 0.5),
        ("Плановое ТО", "planned_maintenance", 30, 60, 1),
    ],
    "ecoat": [
        ("Отклонение параметров ванны", "quality_issue", 20, 45, 2),
        ("Замена фильтра", "planned_maintenance", 30, 50, 1),
    ],
    "paint_cabin": [
        ("Замена фильтра", "planned_maintenance", 30, 50, 3),
        ("Засорение форсунки", "breakdown", 15, 40, 2),
        ("Нарушение влажности в камере", "quality_issue", 15, 30, 2),
        ("Смена цвета", "changeover", 10, 20, 2),
    ],
    "oven": [
        ("Отклонение температуры в печи", "breakdown", 20, 60, 2),
        ("Отказ вентилятора рециркуляции", "breakdown", 30, 70, 1),
    ],
    "paint_robot": [
        ("Засорение распылителя", "breakdown", 10, 25, 3),
        ("Калибровка робота", "planned_maintenance", 20, 35, 1),
    ],
    "nutrunner": [
        ("Отказ гайковёрта", "breakdown", 10, 25, 3),
        ("Калибровка момента затяжки", "planned_maintenance", 15, 25, 1),
    ],
    "fill": [
        ("Утечка в контуре заправки", "breakdown", 20, 50, 2),
        ("Замена ёмкости с жидкостью", "changeover", 10, 20, 2),
    ],
    "qc_stand": [
        ("Калибровка стенда", "planned_maintenance", 20, 40, 2),
        ("Сбой ПО стенда", "breakdown", 10, 30, 2),
    ],
    "forklift": [
        ("Разряд АКБ погрузчика", "other", 15, 30, 3),
        ("Поломка гидравлики погрузчика", "breakdown", 40, 120, 1),
    ],
    "agv": [
        ("Ошибка навигации AGV", "breakdown", 10, 20, 3),
        ("Разряд АКБ", "other", 15, 30, 2),
    ],
}

# Причины, которые чаще проявляются в период деградации оборудования
TREND_REASONS = {
    "ASM-CNV-03": [("Застревание кузова", "breakdown", 8, 20), ("Перегрев привода конвейера", "breakdown", 10, 25)],
    "PNT-CAB-02": [("Засорение форсунки", "breakdown", 15, 40), ("Нарушение влажности в камере", "quality_issue", 15, 30)],
}

MATERIAL_SHORTAGE_REASONS = [
    "Нехватка комплектующих: задержка поставки жгутов проводки",
    "Нехватка комплектующих: задержка поставки сидений",
    "Нехватка комплектующих: не доставлены шины",
    "Нехватка комплектующих: ошибка комплектации на складе",
]

SCRAP_RATE = {"WELD": 0.017, "PAINT": 0.032, "ASSY": 0.009, "QC": 0.005}
REWORK_RATE = {"WELD": 0.015, "PAINT": 0.035, "ASSY": 0.02, "QC": 0.03}
QUALITY_INCIDENT_THRESHOLD = {"WELD": 0.03, "PAINT": 0.05, "ASSY": 0.03, "QC": 0.025}

SAFETY_INCIDENTS = [
    ("Нарушение ТБ: работа без СИЗ", "Сотрудник находился в зоне без защитных очков. Проведён внеплановый инструктаж."),
    ("Разлив технической жидкости", "Разлив жидкости на проходе. Зона огорожена, проведена уборка."),
    ("Срабатывание световой завесы", "Сотрудник вошёл в зону работы робота при активном цикле. Робот остановлен защитой."),
    ("Загромождение эвакуационного прохода", "Тара с комплектующими перекрыла проход. Тара перемещена."),
]

CRIT_WEIGHT = {"high": 1.0, "medium": 0.5, "low": 0.0}


def poisson(rng: random.Random, lam: float) -> int:
    threshold, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= threshold:
            return k
        k += 1


def binomial(rng: random.Random, n: int, p: float) -> int:
    return sum(rng.random() < p for _ in range(n))


def downtime_severity(crit: str, duration: int) -> str:
    if crit == "high":
        return "critical" if duration >= 60 else "high" if duration >= 30 else "medium"
    if crit == "medium":
        return "high" if duration >= 60 else "medium"
    return "low"


# ---------------------------------------------------------------- расписание и правила симулятора

SHIFT_STARTS = {1: 8, 2: 16}  # номер смены -> час начала (местное время)
# Праздники РК (месяц, день): в эти дни, как и в выходные, линия не работает
KZ_HOLIDAYS = {(1, 1), (1, 2), (1, 7), (3, 8), (3, 21), (3, 22), (3, 23), (5, 1), (5, 7), (5, 9),
               (7, 6), (8, 30), (10, 25), (12, 16)}

# Какой статус получает оборудование на время простоя данного типа
STATUS_BY_DOWNTIME = {
    "breakdown": "breakdown", "planned_maintenance": "maintenance", "changeover": "idle",
    "material_shortage": "idle", "quality_issue": "idle", "other": "idle",
}


def shift_name(number: int) -> str:
    return "Смена 1 (дневная)" if number == 1 else "Смена 2 (вечерняя)"


def is_workday(day) -> bool:
    return day.weekday() < 5 and (day.month, day.day) not in KZ_HOLIDAYS


def shift_bounds(day, number: int) -> tuple:
    start = datetime(day.year, day.month, day.day, SHIFT_STARTS[number], tzinfo=TZ)
    return start, start + timedelta(minutes=SHIFT_MINUTES)


def current_or_next_shift(t: datetime) -> tuple[int, datetime, datetime]:
    """Смена, идущая в момент t, или ближайшая следующая: (номер, начало, конец)."""
    t = t.astimezone(TZ)
    day = t.date()
    for _ in range(30):
        if is_workday(day):
            for number in SHIFT_STARTS:
                start, end = shift_bounds(day, number)
                if t < end:
                    return number, start, end
        day += timedelta(days=1)
    raise RuntimeError("Не найдено рабочей смены в ближайшие 30 дней")


def major_reason(kind: str) -> tuple:
    """Тяжёлый отказ, которым заканчивается деградация: самый длительный breakdown типа оборудования."""
    options = ([r for r in REASONS[kind] if r[1] == "breakdown"]
               or [r for r in REASONS[kind] if r[1] != "planned_maintenance"])
    return max(options, key=lambda r: r[3])


def micro_reasons(kind: str, code: str) -> list[tuple]:
    """Короткие остановки — предвестники отказа при износе."""
    if code in TREND_REASONS:
        return [(*r, 1) for r in TREND_REASONS[code]]
    short = [r for r in REASONS[kind] if r[1] != "planned_maintenance" and r[3] <= 40]
    return short or [r for r in REASONS[kind] if r[1] != "planned_maintenance"]
