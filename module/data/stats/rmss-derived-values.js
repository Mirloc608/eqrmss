/**
 * RMSS Derived Value Engine (EQRMSS-flavored)
 */

import { isEquipped } from "../../utils/equipment/equipment-utils.js";
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

    // Armor, maneuver penalties, and shield DB are derived from equipped
    // gear every prepare. An item counts as equipped via the item-sheet
    // checkbox (system.equipped) or the player-sheet location dropdown
    // (system.location === "equipped").
    const combat = system.combat || {};
    const rawItems = actorData.items;
    const itemList = Array.isArray(rawItems)
        ? rawItems
        : (rawItems?.contents ?? []);
    const isWorn = (i) => isEquipped(i) || i?.system?.location === "equipped";

    const wornArmor = itemList.filter((i) => i?.type === "armor" && isWorn(i));
    const wornShields = itemList.filter((i) => i?.type === "shield" && isWorn(i));

    let armorType = "No Armor";
    let mmp = 0;
    if (wornArmor.length > 0) {
        const ats = wornArmor
            .map((i) => Number(i.system?.at))
            .filter((n) => Number.isFinite(n) && n > 0);
        if (ats.length > 0) armorType = `AT ${Math.max(...ats)}`;
        mmp = wornArmor.reduce((sum, i) => sum + (Number(i.system?.maneuverPenalty) || 0), 0);
    }

    let shieldBonus = 0;
    if (wornShields.length > 0) {
        shieldBonus = Math.max(...wornShields.map((i) => Number(i.system?.meleeDB) || 0));
    }

    const quPenalty = Number(combat.penalties?.quickness ?? combat.quPenalty ?? 0);
    
    // Quickness Bonus derived from engine Qu or base stat bonus mapping
    const baseQUBonus = Math.floor(((stats.QU ?? stats.Qu ?? 50) - 50) / 5);
    const quicknessBonus = baseQUBonus - quPenalty;

    // Additional DB components (stored; armor itself grants no DB in RMSS)
    const adrenalDefense = Number(combat.adrenalDefense ?? 0);
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