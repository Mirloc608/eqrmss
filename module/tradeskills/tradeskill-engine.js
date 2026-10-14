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
        // Critical failure: lose materials (user ruling: softer — only crit fail loses mats)
        await consumeComponents(recipe.components);
        return {
            success: false,
            critFail: true,
            roll: check.roll,
            total: check.total,
            message: `Critical failure! The ${recipe.name} combine destroys the materials.`
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

    // Success: consume components, create product
    await consumeComponents(recipe.components);
    await createProduct(recipe.product);

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
