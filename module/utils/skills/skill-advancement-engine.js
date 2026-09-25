// EQRMSS Skill Advancement Engine
// Handles buying ranks, training packages, and DP spending.

import { getSkillCost } from "./skill-cost-resolver.js";

export class SkillAdvancementEngine {
  constructor({ registry }) {
    this.registry = registry;
  }

  /**
   * Buy ranks in a skill for an actor.
   * options: { ranks: number }
   */
  buySkillRanks(actor, skillId, options = {}) {
    const ranksToBuy = Number(options.ranks ?? 1);
    const currentDp = Number(actor?.system?.developmentPoints ?? 0);

    const costPerRank = getSkillCost(actor, skillId, this.registry);
    const totalCost = costPerRank * ranksToBuy;

    if (totalCost > currentDp) {
      throw new Error(`Not enough development points (need ${totalCost}, have ${currentDp})`);
    }

    const skills = actor.system.skills ?? {};
    const existing = skills[skillId] ?? { ranks: 0 };
    const newRanks = Number(existing.ranks ?? 0) + ranksToBuy;

    skills[skillId] = { ...existing, ranks: newRanks };
    actor.system.skills = skills;
    actor.system.developmentPoints = currentDp - totalCost;

    return {
      skillId,
      ranksBought: ranksToBuy,
      newRanks,
      costPerRank,
      totalCost,
      remainingDp: actor.system.developmentPoints
    };
  }

  /**
   * Apply a training package (bundle of skill ranks).
   * package: { id, name, entries: [{ skillId, ranks }] }
   */
  applyTrainingPackage(actor, trainingPackage) {
    const results = [];
    for (const entry of trainingPackage.entries ?? []) {
      const res = this.buySkillRanks(actor, entry.skillId, { ranks: entry.ranks });
      results.push(res);
    }
    return { trainingPackage, results };
  }
}
