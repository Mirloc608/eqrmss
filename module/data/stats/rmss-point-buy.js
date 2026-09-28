import { RMSS_STATS } from "./rmss-stats.js";

/**
 * RMSS Point-Buy Engine
 */

export class RMSSPointBuyEngine {

  constructor(totalPoints = 500) {
    this.totalPoints = totalPoints;
  }

  costForValue(value) {
    if (value <= 50) return value;
    if (value <= 75) return 50 + (value - 50) * 2;
    if (value <= 90) return 100 + (value - 75) * 3;
    return 145 + (value - 90) * 4;
  }

  totalCost(stats) {
    return Object.entries(stats).reduce((sum, [, v]) => sum + this.costForValue(v), 0);
  }

  isAffordable(stats) {
    return this.totalCost(stats) <= this.totalPoints;
  }

  normalize(stats) {
    const cost = this.totalCost(stats);
    if (cost <= this.totalPoints) return stats;

    const factor = this.totalPoints / cost;
    const normalized = {};

    for (const [key, value] of Object.entries(stats)) {
      normalized[key] = Math.max(1, Math.min(100, Math.round(value * factor)));
    }

    return normalized;
  }

  createDefault() {
    const stats = {};
    for (const [key, meta] of Object.entries(RMSS_STATS)) {
      stats[key] = meta.default;
    }
    return stats;
  }
}
