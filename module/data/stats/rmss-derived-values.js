/**
 * RMSS Derived Value Engine (EQRMSS-flavored)
 */

import { isWorn } from "../../utils/equipment/equipment-utils.js";
import { rmssStatBonus } from "./rmss-stat-bonus.js";
import { stanceDBBonus } from "../../combat/stance.js";

/**
 * Shared "is this item worn?" check: the location dropdown is
 * authoritative when set; the equipped checkbox is the fallback.
 */
function isWornItem(item) {
    return isWorn(item);
}

function itemListOf(actorData) {
    const rawItems = actorData.items;
    return Array.isArray(rawItems) ? rawItems : (rawItems?.contents ?? []);
}

// Arms Companion §5.6, Shield Effects on DB Chart: the ADDITIONAL DB
// from adjacent shield-bearing allies ("1 Side" values), by the
// ally's shield type. Mixed flanks add both 1-Side values; two of the
// same shield use the chart's "2 Sides" column (Target missile +5,
// not 2×+2 — chart governs).
export const FORMATION_SHIELD_DB = {
    target: { melee: 5, missile: 2, twoMelee: 10, twoMissile: 5 },
    normal: { melee: 10, missile: 10, twoMelee: 20, twoMissile: 20 },
    full: { melee: 15, missile: 15, twoMelee: 30, twoMissile: 30 },
    wall: { melee: 20, missile: 25, twoMelee: 40, twoMissile: 50 }
};

// Arms Companion §5.2 (APAC — Armor Pick and Choose): the chest armor
// sets the base AT/stage; other areas add DB per stage of difference
// (Mixed Armor DB Modification Chart, Full Body column, per shift).
// Stages: Plate 4, Chain 3, Rigid Leather 2, Soft Leather 1,
// No Armor 0 (by AT band). Missing areas count as No Armor, so
// inferior or absent pieces shift DB down (book default). The
// chart's Torso cover row is unused: the chest piece IS the base.
// Neck cover has no composer location; bracers (wrist) share the
// arm-greaves area.
export const APAC_STAGE_BANDS = [
    { minAT: 17, stage: 4 },
    { minAT: 13, stage: 3 },
    { minAT: 9, stage: 2 },
    { minAT: 5, stage: 1 },
    { minAT: 1, stage: 0 }
];
export function apacStageOfAT(at) {
    const n = Number(at) || 0;
    for (const band of APAC_STAGE_BANDS) if (n >= band.minAT) return band.stage;
    return 0;
}
export const APAC_AREAS = [
    { locations: ["head"], dbPerShift: 3 },
    { locations: ["arms", "wrist"], dbPerShift: 3 },
    { locations: ["legs"], dbPerShift: 2 },
    { locations: ["hands"], dbPerShift: 2 },
    { locations: ["feet"], dbPerShift: 1 }
];
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
    let mixedArmorDB = 0;
    let helmetDF = 0;
    if (wornArmor.length > 0) {
        const ats = wornArmor
            .map((i) => Number(i.system?.at))
            .filter((n) => Number.isFinite(n) && n > 0);
        // APAC §5.2: the chest armor sets the base AT; with no chest
        // piece, fall back to the best worn AT (pre-APAC behavior).
        const chestPieces = wornArmor.filter((i) => i.system?.armorLocation === "chest");
        const chestAts = chestPieces
            .map((i) => Number(i.system?.at))
            .filter((n) => Number.isFinite(n) && n > 0);
        const baseAts = chestAts.length > 0 ? chestAts : ats;
        if (baseAts.length > 0) armorType = `AT ${Math.max(...baseAts)}`;
        mmp = wornArmor.reduce((sum, i) => sum + (Number(i.system?.maneuverPenalty) || 0), 0);
        // Mixed-armor DB: each area shifts by its stage difference
        // from the base stage (missing areas count as No Armor).
        const baseStage = baseAts.length > 0 ? apacStageOfAT(Math.max(...baseAts)) : 0;
        for (const area of APAC_AREAS) {
            const pieces = wornArmor.filter((i) => area.locations.includes(i.system?.armorLocation));
            const stage = pieces.length > 0
                ? Math.max(...pieces.map((i) => apacStageOfAT(i.system?.at)))
                : 0;
            mixedArmorDB += area.dbPerShift * (stage - baseStage);
        }

        // Helmet Defense Factor (HELMET CHART): the Body DF feeds
        // DB only when the helmet's armor type differs from the
        // worn AT's type; flagged items apply half even when the
        // types match. Head DF is stored on the item for area
        // targeting (§4.15) and is not added here.
        for (const piece of wornArmor.filter((i) => i.system?.armorLocation === "head")) {
            const dfBody = Number(piece.system?.dfBody) || 0;
            if (dfBody === 0) continue;
            const pieceStage = apacStageOfAT(piece.system?.at);
            if (pieceStage !== baseStage) helmetDF += dfBody;
            else if (piece.system?.dfHalfSameType === true) helmetDF += Math.floor(dfBody / 2);
        }
    }

    // Sollerets (§5.8): worn spiked boots cost -20 maneuvering
    // on foot (mounted use is exempt — GM adjudicates).
    if (itemList.some((i) => i?.type === "weapon" && i.system?.sollerets && isWornItem(i))) mmp += 20;

    let shieldBonus = 0;
    let shieldMissileBonus = 0;
    if (wornShields.length > 0) {
        shieldBonus = Math.max(...wornShields.map((i) => Number(i.system?.meleeDB) || 0));
        shieldMissileBonus = Math.max(...wornShields.map((i) => Number(i.system?.missileDB) || 0));
    }

    const quPenalty = Number(combat.penalties?.quickness ?? combat.quPenalty ?? 0);
    // Penalties chart (§5.1, ruling 2026-10-04): worn enhancements'
    // Quickness mod cuts the wearer's Qu bonus (hence DB), and the
    // Missile mod cuts missile DB. Chart values are negative mods
    // baked onto the items at compose time. (Armor worn in the pack
    // does not count; isWornItem already filtered wornArmor.)
    const enhQuicknessPenalty = wornArmor.reduce((sum, i) => sum + (Number(i.system?.quicknessPenalty) || 0), 0);
    const enhMissilePenalty = wornArmor.reduce((sum, i) => sum + (Number(i.system?.missilePenalty) || 0), 0);

    // Arms Companion §5.6 (Multiple Shield DB): a shield-bearing ally
    // on each flank adds DB by THEIR shield type (Shield Effects on DB
    // Chart, "1 Side" values; two sides add both). GM-declared on the
    // Combat tab (system.combat.formationLeft / formationRight).
    const formationChart = FORMATION_SHIELD_DB[combat.formationLeft] ?? null;
    const formationChartR = FORMATION_SHIELD_DB[combat.formationRight] ?? null;
    const sameFlankShield = formationChart && formationChartR && combat.formationLeft === combat.formationRight;
    const formationDB = sameFlankShield
        ? formationChart.twoMelee
        : (formationChart?.melee ?? 0) + (formationChartR?.melee ?? 0);
    const formationMissileDB = sameFlankShield
        ? formationChart.twoMissile
        : (formationChart?.missile ?? 0) + (formationChartR?.missile ?? 0);
    
    // Quickness Bonus derived from engine Qu or base stat bonus mapping
    const baseQUBonus = Math.floor(((stats.QU ?? stats.Qu ?? 50) - 50) / 5);
    const quicknessBonus = baseQUBonus - quPenalty + enhQuicknessPenalty;

    // Additional DB components (stored; plain armor grants no DB in RMSS)
    const storedAdrenal = Number(combat.adrenalDefense ?? 0);
    const otherDB = Number(combat.otherDB ?? 0);
    const armorDB = Number(combat.armorDB ?? 0);
    // Arms Companion 5.1/6.23: worn armor's enhancement/quality DB bonus.
    const enhancedArmorDB = wornArmor.reduce((sum, i) => sum + (Number(i.system?.dbBonus) || 0), 0);

    // Adrenal Defense (§4.4.3): the skill's bonus adds to DB, but the
    // skill is restrictive — it does not work while wearing armor.
    // (Awareness of the attacker and heavy/non-kata weapon carriage
    // are per-attack GM adjudications, not derivation state.) Actors
    // with the adrenalDefense skill item use its bonus; actors without
    // it keep the stored manual field as a fallback.
    const adrenalSkill = itemList.find(
        (i) => i?.type === "skill" && i.system?.slug === "adrenalDefense"
    ) ?? null;
    const adrenalSkillBonus = Number(adrenalSkill?.system?.bonus) || 0;
    // Ruling (2026-10-04): worn AT 1-4 (clothing-grade) does not count
    // as "wearing armor" for the §4.4.3 restriction; only a worn piece
    // of AT 5 or higher blocks Adrenal Defense.
    const blocksAdrenal = (item) => {
        const raw = item?.system?.at ?? item?.system?.armorType;
        const at = typeof raw === "number" ? raw : (Number((String(raw ?? "").match(/\d+/))?.[0]) || 0);
        return at >= 5;
    };
    const adrenalBlockedByArmor = !!adrenalSkill && wornArmor.some(blocksAdrenal);
    const adrenalEffective = adrenalSkill
        ? (adrenalBlockedByArmor ? 0 : adrenalSkillBonus)
        : storedAdrenal;

    // Total DB Calculation. A chart animal uses its chart DB as the natural
    // defensive base; external components (shield, stored extras) still
    // add normally. Melee and missile attacks use the equipped shield's
    // DB for that attack type; the Adrenal Defense component counts in
    // full against melee and at half against missile attacks (§4.4.3).
    const naturalDB = chartDB ?? quicknessBonus;
    const stanceDB = stanceDBBonus(actorData);
    const totalDB = naturalDB + adrenalEffective + shieldBonus + otherDB + armorDB + enhancedArmorDB + formationDB + mixedArmorDB + stanceDB + helmetDF;
    const totalMissileDB = naturalDB + (adrenalEffective / 2) + shieldMissileBonus + otherDB + armorDB + enhancedArmorDB + formationMissileDB + mixedArmorDB + stanceDB + helmetDF + enhMissilePenalty;

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
        adrenalDefense: storedAdrenal,
        adrenalSkillBonus,
        adrenalBlockedByArmor,
        adrenalEffective,
        shieldBonus,
        shieldMissileBonus,
        formationDB,
        formationMissileDB,
        mixedArmorDB,
        stanceDB,
        helmetDF,
        otherDB,
        armorDB,
        enhancedArmorDB,
        enhQuicknessPenalty,
        enhMissilePenalty,
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

    // Snare: movement penalty from snare effects (e.g., Fungal Regrowth).
    const snarePenalty = Math.abs(Number(system.movement?.snarePenalty ?? 0));

    // Root: immobilized — no movement at all while rooted.
    const rooted = Number(system.status?.rooted?.rounds ?? 0) > 0;

    const baseRate = rooted ? 0 : chartBase + racialMod - armorApplied + strideMod + encPenalty - snarePenalty;

    return {
        quTotal, quBonus, chartBase, racialMod,
        armorPen, armorApplied, strideMod, encPenalty, snarePenalty, rooted, baseRate
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