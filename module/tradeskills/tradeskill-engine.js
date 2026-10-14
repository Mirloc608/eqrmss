/**
 * Tradeskill Combine Engine (2026-10-14)
 *
 * User rulings:
 * - All 11 EQ tradeskills (baking, brewing, fletching, jewelcraft, pottery,
 *   smithing, tailoring, tinkering, alchemy, poison making, research)
 * - d100 RMSS-style skill check vs. recipe difficulty
 * - Softer failure: regular failure keeps materials; ONLY critical failure
 *   (natural 01-05) loses materials
 */

export const CRIT_FAIL_RANGE = [1, 5];
export const CRIT_SUCCESS_RANGE = [96, 100];

// Quality bands (2026-10-14, user rulings):
// 96-100: Pristine (crit success), 60-95: Normal, 30-59: Worn, 06-29: Tarnished, 01-05: Broken (crit fail)
export function qualityForRoll(natural) {
    if (natural >= 96) return "pristine";
    if (natural >= 60) return "normal";
    if (natural >= 30) return "worn";
    if (natural >= 6) return "tarnished";
    return "broken";
}

/**
 * Tradeskill restrictions (2026-10-14, user rulings — EQ canon).
 * - Alchemy: Shamans only
 * - Poison Making: Rogues only
 * - Tinkering: Gnomes only (race)
 * All others: unrestricted.
 */
export const TRADESKILL_RESTRICTIONS = {
    "skill-alchemy": { classes: ["shaman"], races: null },
    "skill-poison": { classes: ["rogue"], races: null },
    "skill-tinkering": { classes: null, races: ["gnome"] }
};

/**
 * Check if an actor may use a tradeskill.
 * @param {Actor} actor
 * @param {string} skillId
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function canUseTradeskill(actor, skillId) {
    const restriction = TRADESKILL_RESTRICTIONS[skillId];
    if (!restriction) return { allowed: true, reason: null };

    const sys = actor?.system ?? {};
    const classId = String(sys.origin?.classId ?? sys.fixed_info?.profession ?? "").toLowerCase();
    const raceId = String(sys.origin?.raceId ?? sys.fixed_info?.race ?? "").toLowerCase();

    if (restriction.classes && !restriction.classes.includes(classId)) {
        return {
            allowed: false,
            reason: `Requires ${restriction.classes.join("/")} class.`
        };
    }
    if (restriction.races && !restriction.races.includes(raceId)) {
        return {
            allowed: false,
            reason: `Requires ${restriction.races.join("/")} race.`
        };
    }
    return { allowed: true, reason: null };
}

/**
 * Attempt a tradeskill combine.
 *
 * @param {Actor} actor - The crafting actor
 * @param {Object} recipe - Recipe from the catalog
 * @param {Function} hasComponents - (components) => boolean, checks inventory
 * @param {Function} consumeComponents - (components) => Promise, removes from inventory
 * @param {Function} createProduct - (product) => Promise, adds to inventory
 * @param {Object} skillEngine - SkillCheckEngine instance
 * @returns {Object} { success, critFail, roll, total, message }
 */
export async function attemptCombine(actor, recipe, hasComponents, consumeComponents, createProduct, skillEngine) {
    // Check class/race restriction first (2026-10-14)
    const access = canUseTradeskill(actor, recipe.skill);
    if (!access.allowed) {
        return {
            success: false,
            critFail: false,
            restricted: true,
            message: `Cannot attempt ${recipe.name}: ${access.reason}`
        };
    }

    // Verify components available
    if (!hasComponents(recipe.components)) {
        return {
            success: false,
            critFail: false,
            message: `Missing components for ${recipe.name}.`
        };
    }

    // Roll d100 + skill bonus vs difficulty
    const check = await skillEngine.rollSkillCheck(
        actor,
        recipe.skill,
        { target: recipe.difficulty, label: recipe.name }
    );

    const natural = check.roll.total;
    const isCritFail = natural >= CRIT_FAIL_RANGE[0] && natural <= CRIT_FAIL_RANGE[1];

    if (isCritFail) {
        // Critical failure (2026-10-14): lose materials, but produce a Broken quality item
        await consumeComponents(recipe.components);
        await createProduct(recipe.product, "broken");
        return {
            success: false,
            critFail: true,
            roll: check.roll,
            total: check.total,
            message: `Critical failure! The ${recipe.name} combine produces a broken result.`
        };
    }

    if (!check.success) {
        // Regular failure: keep materials
        return {
            success: false,
            critFail: false,
            roll: check.roll,
            total: check.total,
            message: `Failed to create ${recipe.name}. Materials salvaged.`
        };
    }

    // Success: consume components, create product with quality from natural roll
    const quality = qualityForRoll(natural);
    await consumeComponents(recipe.components);
    await createProduct(recipe.product, quality);

    return {
        success: true,
        critFail: false,
        roll: check.roll,
        total: check.total,
        message: `Successfully created ${recipe.name}!`
    };
}

/**
 * Get all recipes for a tradeskill.
 * @param {string} skillId - e.g. "skill-smithing"
 * @returns {Array} recipes
 */
export function getRecipesForSkill(skillId) {
    const recipes = game.eqrmss?.tradeskills?.recipes ?? [];
    return recipes.filter(r => r.skill === skillId);
}

/**
 * Get all tradeskill skill ids.
 */
export function getTradeskillIds() {
    return [
        "skill-baking",
        "skill-brewing",
        "skill-fletching",
        "skill-jewelcraft",
        "skill-pottery",
        "skill-smithing",
        "skill-tailoring",
        "skill-tinkering",
        "skill-alchemy",
        "skill-poison",
        "skill-research"
    ];
}
