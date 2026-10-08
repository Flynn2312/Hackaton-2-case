// Выпуск и потери по участкам на живых данных дашборда (model.areas).
// Та же логика, что в backend/app/services/losses.py:
//   план − годные = простой + скорость + брак
// Окно расчёта — реально прошедшее время (runtime / A), поэтому работает и посреди смены.
import { ECON } from './model';

export function lossesFromModel(model) {
  const rows = model.areas
    .filter((a) => a.hasRec && a.A > 0 && a.plan > 0)
    .map((a) => {
      const availMin = a.runtime / a.A;        // сколько минут участок мог работать
      const rate = a.plan / availMin;          // идеальная скорость, авто/мин
      const downtime = rate * (availMin - a.runtime);
      const speed = rate * a.runtime - a.actual; // < 0, если работали быстрее нормы
      const defect = a.scrap;
      const good = a.actual - a.scrap;
      const lostUnits = downtime + speed;
      const lostMoney = Math.max(0, lostUnits) * ECON.carMarginKzt;
      const reworkMoney = defect * ECON.defectKzt;
      return {
        id: a.id, name: a.name, plan: a.plan, good,
        planPct: (good / a.plan) * 100,
        gap: a.plan - good,
        downtime, speed, defect,
        money: lostMoney + reworkMoney,
      };
    });
  const worst = rows.reduce((w, r) => (!w || r.money > w.money ? r : w), null);
  return {
    rows,
    bottleneck: worst,
    gap: rows.reduce((s, r) => s + r.gap, 0),
    money: rows.reduce((s, r) => s + r.money, 0),
  };
}
