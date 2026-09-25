export class RMSSSkillCheckEngine {

  staticCheck(skillTotal, difficulty) {
    const margin = skillTotal - difficulty;
    return { success: margin >= 0, margin };
  }

  contestedCheck(attackerTotal, defenderTotal) {
    const margin = attackerTotal - defenderTotal;
    return {
      winner: margin > 0 ? "attacker" : "defender",
      margin
    };
  }

  applyEnvironment(baseTotal, envProfile) {
    const mod = envProfile?.modifier ?? 0;
    const desc = envProfile?.description ?? "";
    return {
      total: baseTotal + mod,
      breakdown: { baseTotal, mod, desc }
    };
  }

  resolve(skillTotal, difficulty, envProfile = null) {
    const env = this.applyEnvironment(skillTotal, envProfile);
    return this.staticCheck(env.total, difficulty);
  }
}
