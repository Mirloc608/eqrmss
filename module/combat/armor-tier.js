// ============================================================
// ARMOR TIER RESTRICTIONS (2026-10-07).
//
// EQ armor tiers by class: wearing armor above your class's max
// tier imposes -30 to all actions per tier above. Training the
// matching "Armor: X" maneuver skill mitigates the penalty at
// 5 points per rank (18 ranks eliminates a -90 Plate penalty).
//
// Tiers: cloth (0) < leather (1) < chain (2) < plate (3)
// ============================================================

export const ARMOR_TIERS = {
    cloth: 0,
    leather: 1,
    chain: 2,
    plate: 3
};

// Class max armor tier (lowercase class IDs from system.origin.classId).
export const CLASS_MAX_TIER = {
    // Cloth
    wizard: 0,
    magician: 0,
    necromancer: 0,
    enchanter: 0,
    // Leather
    druid: 1,
    monk: 1,
    beastlord: 1,
    // Chain
    cleric: 2,
    ranger: 2,
    shaman: 2,
    rogue: 2,
    bard: 2,
    berserker: 2,
    // Plate
    warrior: 3,
    paladin: 3,
    shadowknight: 3
};

// Armor category -> maneuver skill name for mitigation.
const TIER_SKILL = {
    leather: "Armor: Light",
    chain: "Armor: Medium",
    plate: "Armor: Heavy"
    // cloth (tier 0) is the minimum; nothing can be "above tier" in cloth.
};

const PENALTY_PER_TIER = 30;
const MITIGATION_PER_RANK = 5;

/**
 * Get the highest tier of equipped armor on an actor.
 * @param {Actor} actor
 * @returns {{ tier: number, category: string|null }} Highest equipped tier, or tier -1 if none.
 */
export function getEquippedArmorTier(actor) {
    const items = actor?.items?.contents ?? actor?.items ?? [];
    let best = { tier: -1, category: null };
    for (const item of items) {
        if (item?.type !== "armor") continue;
        if (!isEquipped(item)) continue;
        const cat = String(item?.system?.categoryId ?? "").toLowerCase();
        const tier = ARMOR_TIERS[cat];
        if (tier === undefined) continue;
        if (tier > best.tier) best = { tier, category: cat };
    }
    return best;
}

/**
 * Minimal equipped check (mirrors equipment-utils isWorn without the import).
 */
function isEquipped(item) {
    const loc = item?.system?.location;
    if (typeof loc === "string" && loc.length) return loc === "equipped";
    return item?.system?.equipped === true || item?.system?.worn === true;
}

/**
 * Get ranks in the maneuver skill for a given armor category.
 * @param {Actor} actor
 * @param {string} category - "leather", "chain", or "plate"
 * @returns {number} Total ranks.
 */
export function getArmorSkillRanks(actor, category) {
    const skillName = TIER_SKILL[category];
    if (!skillName) return 0;
    const items = actor?.items?.contents ?? actor?.items ?? [];
    let ranks = 0;
    const want = skillName.toLowerCase();
    for (const item of items) {
        if (item?.type !== "skill") continue;
        const name = String(item?.name ?? "").toLowerCase();
        if (name !== want) continue;
        ranks += Math.max(0, Number(item?.system?.ranks) || 0);
    }
    return ranks;
}

/**
 * Calculate the armor tier penalty for an actor.
 *
 * -30 to all actions per tier above the class max; each rank in the
 * matching Armor maneuver skill mitigates 5 points.
 *
 * @param {Actor} actor
 * @returns {{ penalty: number, tiersAbove: number, armorCategory: string|null, skillRanks: number }}
 *          penalty is 0 (or negative). tiersAbove 0 means within tier.
 */
export function getArmorTierPenalty(actor) {
    const empty = { penalty: 0, tiersAbove: 0, armorCategory: null, skillRanks: 0 };
    try {
        const sys = actor?.system ?? {};
        const classId = String(sys.origin?.classId ?? sys.fixed_info?.classId ?? "").toLowerCase();
        const maxTier = CLASS_MAX_TIER[classId];
        // Unknown class: no penalty (don't punish NPCs/creatures without a class).
        if (maxTier === undefined) return empty;

        const { tier, category } = getEquippedArmorTier(actor);
        if (tier < 0) return empty; // no armor worn

        const tiersAbove = tier - maxTier;
        if (tiersAbove <= 0) return { ...empty, armorCategory: category };

        const skillRanks = getArmorSkillRanks(actor, category);
        const rawPenalty = tiersAbove * -PENALTY_PER_TIER;
        const mitigation = skillRanks * MITIGATION_PER_RANK;
        const penalty = Math.min(0, rawPenalty + mitigation);
        return { penalty, tiersAbove, armorCategory: category, skillRanks };
    } catch (e) {
        return empty;
    }
}
