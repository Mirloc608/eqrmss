import { RMSS_STATS } from "./rmss-stats.js";

/**
 * RMSS Stat Rolling Engine
 * Supports:
 * - 3d10
 * - 2d10+10
 * - fixed array
 * - hybrid (dev stats roll, non-dev fixed)
 */

export class RMSSStatRollingEngine {

  constructor() {
    this.defaultMode = "3d10";

    this.fixedArray = {
      St: 90, Ag: 85, Co: 90, Qu: 80,
      Me: 75, Re: 75, SD: 80, Em: 70,
      In: 75, Pr: 70
    };
  }

  rollAll(mode = this.defaultMode) {
    const result = {};
    for (const key of Object.keys(RMSS_STATS)) {
      result[key] = this.rollSingle(key, mode);
    }
    return result;
  }

  rollSingle(key, mode) {
    switch (mode) {
      case "3d10":
        return this.#scale(this.#roll(3, 10));
      case "2d10+10":
        return this.#scale(this.#roll(2, 10) + 10);
      case "fixed":
        return this.fixedArray[key] ?? 50;
      case "hybrid":
        return this.#hybrid(key);
      default:
        return 50;
    }
  }

  #hybrid(key) {
    const dev = RMSS_STATS[key].isDevelopment;
    if (dev) return this.#scale(this.#roll(3, 10));
    return this.fixedArray[key] ?? this.#scale(this.#roll(2, 10) + 10);
  }

  #roll(count, sides) {
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += Math.floor(Math.random() * sides) + 1;
    }
    return total;
  }

  #scale(raw) {
    return Math.max(1, Math.min(100, raw * 3 + 10));
  }
}
