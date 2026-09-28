/**
 * RMSS Derived Value Engine (EQRMSS-flavored)
 */
export class RMSSDerivedValueEngine {
  compute(stats) {
    const St = stats.St ?? 50;
    const Ag = stats.Ag ?? 50;
    const Co = stats.Co ?? 50;
    const Me = stats.Me ?? 50;
    const Re = stats.Re ?? 50;
    const SD = stats.SD ?? 50;
    const Em = stats.Em ?? 50;
    const In = stats.In ?? 50;
    const Pr = stats.Pr ?? 50;
    const Qu = stats.Qu ?? 50;

    return {
      HP: Math.round(Co * 2 + St / 2),
      Mana: Math.round(((Me + Em + In) / 3) * 1.5),
      Initiative: Math.round(Qu + Ag + SD / 4),
      Attack: Math.round(St + Ag + Qu / 2),
      Defense: Math.round(Qu + Ag + SD),
      Perception: Math.round((In + Re) / 2),
      Resistance: Math.round((Co + SD + Em) / 3)
    };
  }
}

/**
 * Calculates comprehensive actor defenses including Armor, Penalties, and Total DB.
 * @param {Object} actorData - The actor document or system data object.
 * @returns {Object} Updated combat/defense attributes.
 */
export function calculateArmorAndDefenses(actorData) {
    const system = actorData.system ?? actorData;
    
    // Extract stats safely for the engine
    const stats = {};
    if (system.stats) {
        for (const [key, val] of Object.entries(system.stats)) {
            stats[key] = val.total ?? val.temp ?? 50;
        }
    }

    // Run the RMSS Derived Value Engine
    const engine = new RMSSDerivedValueEngine();
    const derivedStats = engine.compute(stats);

    // Armor and Penalties retrieval
    const combat = system.combat || {};
    const armorType = combat.armorType ?? "No Armor";
    const mmp = Number(combat.mmp ?? 0);
    const quPenalty = Number(combat.penalties?.quickness ?? combat.quPenalty ?? 0);
    
    // Quickness Bonus derived from engine Qu or base stat bonus mapping
    const baseQUBonus = Math.floor(((stats.Qu ?? 50) - 50) / 5); // Standard RMSS stat bonus formula approximation
    const quicknessBonus = baseQUBonus - quPenalty;

    // Additional DB components
    const adrenalDefense = Number(combat.adrenalDefense ?? 0);
    const shieldBonus = Number(combat.shieldBonus ?? 0);
    const otherDB = Number(combat.otherDB ?? 0);
    const armorDB = Number(combat.armorDB ?? 0);

    // Total DB Calculation
    const totalDB = quicknessBonus + adrenalDefense + shieldBonus + otherDB + armorDB;

    return {
        derived: derivedStats,
        armorType,
        mmp,
        penalties: {
            action: mmp,
            quickness: quPenalty
        },
        quicknessBonus,
        adrenalDefense,
        shieldBonus,
        otherDB,
        armorDB,
        totalDB
    };
}