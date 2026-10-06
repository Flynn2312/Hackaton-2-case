#!/usr/bin/env python3
"""
AI Evaluation Harness & Benchmark Suite
Роль: 3. AI / Аналитика + 4. Data / Бизнес-логика

Запуск из папки backend:
    python scripts/ai_eval_harness.py

Назначение:
Автоматизированный бенчмарк и оценка качества предиктивного ИИ Allur:
- Валидация детекции аномалий по стандарту ISO 10816 (Конвейер-03)
- Валидация прогнозирования брака ЛКП (Камера-02)
- Расчет метрик: Accuracy, Precision, Recall, F1-Score, Latency
- Формирование отчета для комиссии жюри
"""

import os
import sys
import json
import time

# Настройка UTF-8 для консоли Windows
if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Добавляем родительскую директорию в путь импорта
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.ai_engine import ai_engine


def run_benchmark():
    print("=" * 80)
    print("🧪 ALLUR AI EVALUATION HARNESS | ПРОМЫШЛЕННЫЙ ТЕСТОВЫЙ СТЕНД ИИ")
    print("    Объекты: ISO 10816 Вибродиагностика + Модель качества ЛКП Allur")
    print("=" * 80)

    report = ai_engine.run_harness_evaluation()

    print(f"\n📋 СЮИТА ТЕСТОВ: {report.test_suite_name}")
    print(f"⏱  Дата и время запуска: {report.timestamp}")
    print("-" * 80)
    print(f"{'ID':<7} | {'Название кейса':<35} | {'Ожидание':<9} | {'Факт':<9} | {'Статус':<7} | {'Задержка'}")
    print("-" * 80)

    for c in report.cases:
        status_icon = "✅ PASS" if c.is_passed else "❌ FAIL"
        print(f"{c.case_id:<7} | {c.name[:35]:<35} | {c.expected_status:<9} | {c.predicted_status:<9} | {status_icon:<7} | {c.latency_ms:.2f} ms")

    print("-" * 80)
    print("\n📊 ИТОГОВЫЕ МЕТРИКИ КАЧЕСТВА ИИ (BENCHMARK SCORE):")
    print(f"   • Всего тест-кейсов:     {report.total_cases}")
    print(f"   • Пройдено успешно:      {report.passed_cases} / {report.total_cases}")
    print(f"   • Точность (Accuracy):   {report.accuracy_percent}% 🌟")
    print(f"   • Точность (Precision):  {report.precision_score}")
    print(f"   • Полнота (Recall):      {report.recall_score}")
    print(f"   • F1-Score:              {report.f1_score}")
    print(f"   • Средняя задержка:      {report.mean_latency_ms:.2f} мс (Real-time Edge Ingestion)")
    print(f"   • Итоговый вердикт:      🏆 {report.benchmark_status}")

    print("\n📝 ЭКСПЕРТНОЕ ЗАКЛЮЧЕНИЕ:")
    print(f"   {report.summary_verdict}")

    out_file = os.path.join(os.path.dirname(__file__), "ai_harness_report.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(report.model_dump(), f, ensure_ascii=False, indent=2)

    print(f"\n💾 Полный отчет сохранен в: {out_file}")
    print("=" * 80)
    return report


if __name__ == "__main__":
    run_benchmark()
