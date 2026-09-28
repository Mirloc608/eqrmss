/**
 * ============================================================
 * RMSS Progression Engine (EQRMSS-flavored)
 * ============================================================
 *
 * Responsibilities:
 * - Compute HP, Mana, DP gains per level
 * - Compute skill rank caps per level
 * - Provide class-based progression modifiers
 */

export class RMSSProgressionEngine {

  /**
   * Compute HP gain per level.
   * @param {Object} stats - RMSS stat block
   * @param {String} classKey - EQ class key
   * @param {Number} level
   */
  hpPerLevel(stats, classKey, level) {
    const Co = stats.Co ?? 50;
    const base = 5;

    let classMod = 0;
    switch (classKey) {
      case "warrior":
      case "paladin":
      case "shadowknight":
      case "monk":
        classMod = 3;
        break;

      case "ranger":
      case "rogue":
      case "beastlord":
        classMod = 2;
        break;

      default:
        classMod = 1;
        break;
    }

    return Math.round(base + classMod + Co / 20);
  }

  /**
   * Compute Mana gain per level.
   * @param {Object} stats
   * @param {String} classKey
   * @param {Number} level
   */
  manaPerLevel(stats, classKey, level) {
    const Em = stats.Em ?? 50;
    const In = stats.In ?? 50;
    const Me = stats.Me ?? 50;

    const avg = (Em + In + Me) / 3;

    let classMod = 0;
    switch (classKey) {
      case "wizard":
      case "magician":
      case "enchanter":
      case "necromancer":
        classMod = 3;
        break;

      case "cleric":
      case "druid":
      case "shaman":
      case "paladin":
      case "ranger":
      case "shadowknight":
        classMod = 2;
        break;

      default:
        classMod = 1;
        break;
    }

    return Math.round(classMod + avg / 25);
  }

  /**
   * Compute DP per level.
   * @param {Object} stats
   * @param {String} classKey
   * @param {Number} level
   */
  dpPerLevel(stats, classKey, level) {
    const Ag = stats.Ag ?? 50;
    const Co = stats.Co ?? 50;
    const Me = stats.Me ?? 50;
    const Re = stats.Re ?? 50;
    const SD = stats.SD ?? 50;

    const avg = (Ag + Co + Me + Re + SD) / 5;

    let classMod = 0;
    switch (classKey) {
      case "warrior":
      case "monk":
      case "rogue":
        classMod = 1;
        break;

      case "bard":
      case "ranger":
      case "beastlord":
        classMod = 2;
        break;

      default:
        classMod = 3;
        break;
    }

    return Math.round(classMod + avg / 10);
  }

  /**
   * Max skill ranks per level (RMSS-style).
   * @param {Number} level
   */
  maxSkillRanks(level) {
    if (level <= 1) return 2;
    if (level <= 5) return 3;
    if (level <= 10) return 4;
    return 5;
  }

  /**
   * Full progression block for a level.
   * @param {Object} stats
   * @param {String} classKey
   * @param {Number} level
   */
  computeLevelProgression(stats, classKey, level) {
    return {
      hpGain: this.hpPerLevel(stats, classKey, level),
      manaGain: this.manaPerLevel(stats, classKey, level),
      dpGain: this.dpPerLevel(stats, classKey, level),
      maxSkillRanks: this.maxSkillRanks(level)
    };
  }
}
