import { rmssStatBonus } from "./rmss-stat-bonus.js";

export class RMSSCombatRoundEngine {

  computeInitiative(stats, misc = 0) {
    const QuB = rmssStatBonus(stats.Qu ?? 50);
    const AgB = rmssStatBonus(stats.Ag ?? 50);
    const SDB = rmssStatBonus(stats.SD ?? 50);
    return {
      total: QuB + AgB + Math.floor(SDB / 2) + misc,
      breakdown: { QuB, AgB, SDB, misc }
    };
  }

  resolveAttack(stats, weaponSkill, misc = 0) {
    const StB = rmssStatBonus(stats.St ?? 50);
    const AgB = rmssStatBonus(stats.Ag ?? 50);
    const QuB = rmssStatBonus(stats.Qu ?? 50);
    const ranks = weaponSkill?.ranks ?? 0;
    return {
      total: ranks + StB + AgB + QuB + misc,
      breakdown: { ranks, StB, AgB, QuB, misc }
    };
  }

  resolveDefense(stats, defenseSkill, armorPenalty = 0, misc = 0) {
    const AgB = rmssStatBonus(stats.Ag ?? 50);
    const QuB = rmssStatBonus(stats.Qu ?? 50);
    const SDB = rmssStatBonus(stats.SD ?? 50);
    const ranks = defenseSkill?.ranks ?? 0;
    return {
      total: ranks + AgB + QuB + SDB + misc - Math.abs(armorPenalty),
      breakdown: { ranks, AgB, QuB, SDB, armorPenalty, misc }
    };
  }

  determineHit(attackTotal, defenseTotal) {
    const margin = attackTotal - defenseTotal;
    return { hit: margin > 0, margin };
  }

  applyDamage(margin, weaponProfile) {
    const base = weaponProfile.baseDamage ?? 5;
    const scale = weaponProfile.scale ?? 1.0;
    const dmg = Math.max(1, Math.round(base + margin * scale));
    return { damage: dmg, breakdown: { base, margin, scale } };
  }
}
