// EQRMSS Skill Check Engine
// Runs skill checks and returns structured results.

import { resolveSkillProfile } from "./skill-profile-resolver.js";

export class SkillCheckEngine {
  constructor({ registry, roller }) {
    this.registry = registry;
    this.roller = roller; // abstraction over Foundry's dice roller
  }

  /**
   * Roll a skill check.
   * difficulty: { target: number, label?: string }
   * context: { advantage?, disadvantage?, situationalModifiers? }
   */
  async rollSkillCheck(actor, skillId, difficulty, context = {}) {
    const profile = resolveSkillProfile(actor, skillId, this.registry);
    if (!profile) throw new Error(`Unknown skill: ${skillId}`);

    const roll = await this.roller.roll("1d100");
    const situational = this.computeSituationalModifiers(actor, skillId, context);

    const total = roll.total + profile.totalBonus + situational;
    const success = total >= difficulty.target;
    const degree = total - difficulty.target;

    return {
      roll,
      profile,
      situational,
      total,
      success,
      degree,
      difficulty
    };
  }

  computeSituationalModifiers(actor, skillId, context) {
    // TODO: terrain, lighting, fatigue, spell school synergy, etc.
    return Number(context.situationalModifiers ?? 0);
  }
}
