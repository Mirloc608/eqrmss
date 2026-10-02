/**
 * RMSS Derived Value Engine (EQRMSS-flavored)
 */

import { isEquipped } from "../../utils/equipment/equipment-utils.js";
import { rmssStatBonus } from "./rmss-stat-bonus.js";

/**
 * Shared "is this item worn?" check. An item counts as equipped via the
 * item-sheet checkbox (system.equipped) or the player-sheet location
 * dropdown (system.location === "equipped").
 */
function isWornItem(item) {
    return isEquipped(item) || item?.system?.location === "equipped";
}

function itemListOf(actorData) {
    const rawItems = actorData.items;
    return Array.isArray(rawItems) ? rawItems : (rawItems?.contents ?? []);
}
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

    // NPC Wizard chart animals carry their RMSS Animal Statistics Chart
    // defenses in flags. The chart AT is the creature's natural armor type;
    // the chart DB already bundles its natural quickness/toughness, so it
    // replaces (rather than stacks with) the stat-derived Quickness DB.
    const chartStats =
        actorData?.flags?.eqrmss?.chartStats ??
        actorData?.system?.flags?.eqrmss?.chartStats ??
        null;
    const chartAtNumber = Number(chartStats?.at);
    const chartArmorType = Number.isFinite(chartAtNumber) && chartAtNumber >= 1 && chartAtNumber <= 20
        ? Math.round(chartAtNumber)
        : null;
    const chartDbNumber = Number(chartStats?.db);
    const chartDB = chartStats && chartStats.db != null && Number.isFinite(chartDbNumber)
        ? chartDbNumber
        : null;
    
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
    const itemList = itemListOf(actorData);

    const wornArmor = itemList.filter((i) => i?.type === "armor" && isWornItem(i));
    const wornShields = itemList.filter((i) => i?.type === "shield" && isWornItem(i));

    let armorType = chartArmorType ? `AT ${chartArmorType}` : "No Armor";
    let mmp = 0;
    if (wornArmor.length > 0) {
        const ats = wornArmor
            .map((i) => Number(i.system?.at))
            .filter((n) => Number.isFinite(n) && n > 0);
        if (ats.length > 0) armorType = `AT ${Math.max(...ats)}`;
        mmp = wornArmor.reduce((sum, i) => sum + (Number(i.system?.maneuverPenalty) || 0), 0);
    }

    let shieldBonus = 0;
    let shieldMissileBonus = 0;
    if (wornShields.length > 0) {
        shieldBonus = Math.max(...wornShields.map((i) => Number(i.system?.meleeDB) || 0));
        shieldMissileBonus = Math.max(...wornShields.map((i) => Number(i.system?.missileDB) || 0));
    }

    const quPenalty = Number(combat.penalties?.quickness ?? combat.quPenalty ?? 0);
    
    // Quickness Bonus derived from engine Qu or base stat bonus mapping
    const baseQUBonus = Math.floor(((stats.QU ?? stats.Qu ?? 50) - 50) / 5);
    const quicknessBonus = baseQUBonus - quPenalty;

    // Additional DB components (stored; armor itself grants no DB in RMSS)
    const adrenalDefense = Number(combat.adrenalDefense ?? 0);
    const otherDB = Number(combat.otherDB ?? 0);
    const armorDB = Number(combat.armorDB ?? 0);

    // Total DB Calculation. A chart animal uses its chart DB as the natural
    // defensive base; external components (shield, stored extras) still
    // add normally. Melee and missile attacks use the equipped shield's
    // DB for that attack type; the Adrenal Defense component counts in
    // full against melee and at half against missile attacks (§4.4.3).
    const naturalDB = chartDB ?? quicknessBonus;
    const totalDB = naturalDB + adrenalDefense + shieldBonus + otherDB + armorDB;
    const totalMissileDB = naturalDB + (adrenalDefense / 2) + shieldMissileBonus + otherDB + armorDB;

    return {
        derived: derivedStats,
        armorType,
        chartArmorType,
        chartDB,
        mmp,
        penalties: {
            action: mmp,
            quickness: quPenalty
        },
        quicknessBonus,
        adrenalDefense,
        shieldBonus,
        shieldMissileBonus,
        otherDB,
        armorDB,
        totalDB,
        totalMissileDB
    };
}

/**
 * ENCUMBRANCE — RMSS §7.2.2
 *
 * BWA ("weight allowance") = 10% of body weight (system.physical.weight, lbs).
 * Load ("dead weight") = carried weight in pounds. Worn armor is excluded:
 * it is "non-dead" weight covered by maneuver penalties (ChL Tables
 * 15.3.1/15.3.3), not by encumbrance.
 *
 * The chart penalty is reduced by the Strength stat bonus (Table 15.1.3).
 * Any excess ST bonus is reported but NOT auto-applied; per the rule it may
 * cancel armor Quickness penalty instead. The penalty's application to Base
 * Movement Rate (§7.2.1) is left to the GM — moveRate is not modified here.
 */
export function calculateEncumbrance(actorData) {
    const system = actorData.system ?? {};
    const bodyWeight = Number(system.physical?.weight);
    const itemList = itemListOf(actorData);

    let load = 0;
    for (const item of itemList) {
        if (item?.type === "armor" && isWornItem(item)) continue;
        const w = Number(item?.system?.weight);
        if (!Number.isFinite(w) || w <= 0) continue;
        const qty = Number(item?.system?.quantity ?? 1);
        load += w * (Number.isFinite(qty) && qty > 0 ? qty : 1);
    }

    if (!Number.isFinite(bodyWeight) || bodyWeight <= 0) {
        return { bwa: null, load, chartPenalty: 0, stBonus: 0, penalty: 0, excessST: 0 };
    }

    const bwa = bodyWeight * 0.10;
    const chartPenalty = encumbranceChartPenalty(bwa > 0 ? load / bwa : 0);

    const stats = system.stats ?? {};
    const st = stats.ST ?? stats.St ?? {};
    const stBonus = rmssStatBonus(st.total ?? st.temp ?? 50);
    const penalty = Math.min(0, chartPenalty + stBonus);
    const excessST = Math.max(0, chartPenalty + stBonus);

    return { bwa, load, chartPenalty, stBonus, penalty, excessST };
}

/**
 * BASE MOVEMENT RATE — RMSS §7.2.1
 *
 * Chart lookup on the Quickness STAT value, then:
 *  (+) racial Quickness modification (ChL 6.2 / Table 15.5.1)
 *  (-) armor Quickness penalty = worn-armor maneuver penalty (mmp),
 *      reduced by excess ST bonus (§7.2.2); it can only cancel the QU
 *      stat bonus (+ racial), so armor alone cannot drop the rate below
 *      50'/rnd
 *  (+/-) stride modification from height (inches)
 *  (-) encumbrance penalty (§7.2.2), applied directly
 *
 * Stride/encumbrance CAN take the rate below 50. Pace is a per-round
 * choice and is not computed here.
 */
export function calculateBaseMovementRate(actorData) {
    const system = actorData.system ?? {};
    const stats = system.stats ?? {};
    const qu = stats.QU ?? stats.Qu ?? {};
    const quTotal = qu.total ?? qu.temp ?? 50;
    const quBonus = rmssStatBonus(quTotal);

    const chartBase = movementRateChart(quTotal);

    // Racial QU modification: race stat-mod semantics are undecided
    // (open design question #6), so this is 0 until racial mods reach
    // the actor. It slots into both the bonus and the rate here.
    const racialMod = 0;

    const mmp = Number(system.combat?.mmp ?? 0);
    const armorPen = Math.max(0, -mmp);
    const excessST = Number(system.encumbrance?.excessST ?? 0);
    const armorPenAfterST = Math.max(0, armorPen - excessST);
    const cancellable = Math.max(0, quBonus + racialMod);
    const armorApplied = Math.min(armorPenAfterST, cancellable);

    const heightIn = Number(system.physical?.height);
    const strideMod = strideModification(
        Number.isFinite(heightIn) && heightIn > 0 ? heightIn : null);

    const encPenalty = Number(system.encumbrance?.penalty ?? 0);

    const baseRate = chartBase + racialMod - armorApplied + strideMod + encPenalty;

    return {
        quTotal, quBonus, chartBase, racialMod,
        armorPen, armorApplied, strideMod, encPenalty, baseRate
    };
}

/**
 * RMSS §7.2.1 Movement Rate Chart. Lookup is on the Quickness stat
 * value (not the bonus). Values below 1 clamp to the bottom row.
 */
function movementRateChart(qu) {
    if (qu >= 102) return 85;
    if (qu >= 101) return 80;
    if (qu >= 100) return 75;
    if (qu >= 98) return 70;
    if (qu >= 95) return 65;
    if (qu >= 90) return 60;
    if (qu >= 75) return 55;
    if (qu >= 25) return 50;
    if (qu >= 10) return 45;
    if (qu >= 5) return 40;
    if (qu >= 3) return 35;
    if (qu >= 2) return 30;
    return 25;
}

/**
 * RMSS §7.2.1 Stride Modification Chart. Height in inches, compared
 * against the 6' norm in 6" bands. Outside the chart, clamps to the
 * nearest band.
 */
function strideModification(heightIn) {
    if (heightIn == null) return 0;
    if (heightIn >= 94) return 20;   // 7'10" - 8'3"
    if (heightIn >= 88) return 15;   // 7'4" - 7'9"
    if (heightIn >= 82) return 10;   // 6'10" - 7'3"
    if (heightIn >= 76) return 5;    // 6'4" - 6'9"
    if (heightIn >= 70) return 0;    // 5'10" - 6'3"
    if (heightIn >= 64) return -5;   // 5'4" - 5'9"
    if (heightIn >= 58) return -10;  // 4'10" - 5'3"
    if (heightIn >= 52) return -15;  // 4'4" - 4'9"
    if (heightIn >= 46) return -20;  // 3'10" - 4'3"
    if (heightIn >= 40) return -25;  // 3'4" - 3'9"
    if (heightIn >= 34) return -30;  // 2'10" - 3'3"
    if (heightIn >= 28) return -35;  // 2'4" - 2'9"
    return -40;                      // 1'10" - 2'3" (and below)
}

/**
 * RMSS §7.2.2 Encumbrance Chart. ratio = load / weight allowance.
 * Bands are (lower, upper]: e.g. (1x, 2x] -> -10.
 */
function encumbranceChartPenalty(ratio) {
    if (ratio <= 1) return 0;
    if (ratio <= 2) return -10;
    if (ratio <= 3) return -20;
    if (ratio <= 4) return -25;
    if (ratio <= 5) return -30;
    if (ratio <= 6) return -35;
    if (ratio <= 7) return -40;
    if (ratio <= 8) return -50;
    if (ratio <= 9) return -60;
    if (ratio <= 10) return -70;
    if (ratio <= 11) return -80;
    if (ratio <= 12) return -90;
    if (ratio <= 13) return -100;
    if (ratio <= 14) return -110;
    return -120;
}