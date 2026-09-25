import { rmssStatBonus } from "./rmss-stat-bonus.js";

export class RMSSSpellResolutionEngine {

  computeCastingBonus(stats, list, misc = 0) {
    const realm = list?.realm ?? "essence";
    const ranks = list?.ranks ?? 0;

    const primary = {
      essence: "In",
      channeling: "Em",
      mental: "Re"
    }[realm] ?? "In";

    const PB = rmssStatBonus(stats[primary] ?? 50);
    const MeB = rmssStatBonus(stats.Me ?? 50);
    const SDB = rmssStatBonus(stats.SD ?? 50);

    return {
      total: ranks + PB + MeB + SDB + misc,
      breakdown: { ranks, PB, MeB, SDB, misc }
    };
  }

  computeFumbleChance(base, armorPenalty = 0, misc = 0) {
    return Math.max(0, Math.min(100, base + Math.abs(armorPenalty) + misc));
  }

  resolveSuccess(castingTotal, difficulty) {
    const margin = castingTotal - difficulty;
    return { success: margin >= 0, margin };
  }

  resolveEffect(margin, spellProfile) {
    const base = spellProfile.baseEffect ?? 10;
    const scale = spellProfile.scale ?? 1.0;
    const effect = Math.max(1, Math.round(base + margin * scale));
    return { effect, breakdown: { base, margin, scale } };
  }

  resolveResistance(targetStats, spellProfile) {
    const resKey = spellProfile.resistStat ?? "SD";
    const resBonus = rmssStatBonus(targetStats[resKey] ?? 50);
    return { resistance: resBonus, stat: resKey };
  }
}
