/**
 * Tradeskill Combine Engine (2026-10-14)
 *
 * User rulings:
 * - EQ tradeskills after the 2026-10-22 purge (fletching, jewelcraft,
 *   smithing, tailoring, tinkering, alchemy, poison making, research);
 *   baking, brewing, pottery and fishing were removed entirely.
 * - d100 RMSS-style skill check vs. recipe difficulty
 * - Softer failure: regular failure keeps materials; ONLY critical failure
 *   (natural 01-05) loses materials
 * - Critical results (2026-10-28, user rulings): natural 01-05 = critical
 *   failure (consume DOUBLE components, no product); natural 96-100 =
 *   critical success (always succeeds; consumes 1 of any component that
 *   requires multiples, and nothing for single-quantity components)
 */

export const CRIT_FAIL_RANGE = [1, 5];
export const CRIT_SUCCESS_RANGE = [96, 100];

// Quality bands (2026-10-14, user rulings; crit band aligned 2026-10-28):
// 96-100: Pristine (crit success), 60-95: Normal, 30-59: Worn, 06-29: Tarnished, 01-05: Broken (crit fail)
export function qualityForRoll(natural) {
    if (natural >= 96) return "pristine";
    if (natural >= 60) return "normal";
    if (natural >= 30) return "worn";
    if (natural >= 6) return "tarnished";
    return "broken";
}

// Difficulty scaling (2026-10-28, user ruling): catalog difficulties are
// raw EQ trivials (median ~355, cap 510), which no RMSS skill bonus can
// reach as a d100 target. Combines roll against a scaled target; the raw
// EQ trivial stays in the recipe data. Reforge Technique recipes carry
// the evolution ladder values and map ladder-to-ladder (the ladder in
// evolution-lines.json moved from step 60 to step 40 the same day).
export const DIFFICULTY_SCALE = 0.30;
const TECHNIQUE_LADDER = { 25: 25, 85: 65, 145: 105, 205: 145, 265: 185, 325: 225, 385: 265, 445: 305, 505: 345 };
export function effectiveDifficulty(recipe) {
    const raw = Number(recipe?.difficulty) || 0;
    if (String(recipe?.id ?? "").startsWith("technique-") && TECHNIQUE_LADDER[raw] != null) {
        return TECHNIQUE_LADDER[raw];
    }
    return Math.max(5, Math.round(raw * DIFFICULTY_SCALE));
}

// Component quantities for a combine outcome (2026-10-28, user rulings):
// critical failure consumes double; critical success consumes 1 of any
// component requiring multiples and nothing for single-quantity ones.
// Non-consumed components (containers, molds) pass through untouched.
export function componentsForOutcome(components, outcome) {
    return (components ?? []).map(c => {
        if (c.consume === false || outcome === "normal") return c;
        const qty = Number(c.qty ?? 1) || 0;
        if (outcome === "critFail") return { ...c, qty: qty * 2 };
        if (outcome === "critSuccess") return { ...c, qty: qty > 1 ? 1 : 0 };
        return c;
    }).filter(c => c.consume === false || (Number(c.qty) || 0) > 0);
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
    "skill-poison-making": { classes: ["rogue"], races: null },
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

    // Tool bonus (2026-10-16): tools in the actor's inventory whose
    // system.tradeskillId matches this recipe's skill grant their
    // system.skillBonus as a situational modifier on the combine roll.
    let toolBonus = 0;
    try {
        const tools = actor.items.filter(i =>
            i.type === "tool" && String(i.system?.tradeskillId ?? "") === recipe.skill
        );
        for (const t of tools) toolBonus += Number(t.system?.skillBonus ?? 0);
    } catch (e) { /* inventory unavailable; no tool bonus */ }

    // Roll d100 + skill bonus vs the scaled difficulty (raw EQ trivials
    // in the data are not reachable d100 targets — see effectiveDifficulty)
    const check = await skillEngine.rollSkillCheck(
        actor,
        recipe.skill,
        { target: effectiveDifficulty(recipe), label: recipe.name, situationalModifiers: toolBonus }
    );

    const natural = check.roll.total;
    const isCritFail = natural >= CRIT_FAIL_RANGE[0] && natural <= CRIT_FAIL_RANGE[1];
    const isCritSuccess = natural >= CRIT_SUCCESS_RANGE[0] && natural <= CRIT_SUCCESS_RANGE[1];
    // Critical success (natural 96-100) always succeeds, whatever the total
    const succeeded = (check.success || isCritSuccess) && !isCritFail;
    const outcome = isCritFail ? "critFail" : isCritSuccess ? "critSuccess" : "normal";

    // Component recipes (2026-10-15): shafts, fletchings, arrow/bolt heads
    // - Crit success: 40, Normal success: 20, Regular failure: 10 (materials consumed), Crit fail: 0 (double materials consumed)
    if (recipe.componentYield) {
        if (isCritFail) {
            // Critical failure (2026-10-28): double materials consumed, no product
            await consumeComponents(componentsForOutcome(recipe.components, outcome));
            return {
                success: false,
                critFail: true,
                critSuccess: false,
                roll: check.roll,
                total: check.total,
                message: `Critical failure! Double materials consumed; nothing is produced.`
            };
        }
        if (!succeeded) {
            // Regular failure: materials consumed, salvaged 10
            await consumeComponents(recipe.components);
            await createProduct(recipe.product, "tarnished");
            return {
                success: false,
                critFail: false,
                critSuccess: false,
                roll: check.roll,
                total: check.total,
                message: `Failed to create ${recipe.name}. Salvaged 10.`
            };
        }
        // Success: quality determines yield (pristine: 40, else 20)
        const quality = qualityForRoll(natural);
        await consumeComponents(componentsForOutcome(recipe.components, outcome));
        await createProduct(recipe.product, quality);
        return {
            success: true,
            critFail: false,
            critSuccess: isCritSuccess,
            roll: check.roll,
            total: check.total,
            message: isCritSuccess
                ? `Critical success! Created ${recipe.name} with barely any materials.`
                : `Successfully created ${recipe.name}!`
        };
    }

    if (isCritFail) {
        // Critical failure (2026-10-28): double materials consumed, no combine
        await consumeComponents(componentsForOutcome(recipe.components, outcome));
        return {
            success: false,
            critFail: true,
            critSuccess: false,
            roll: check.roll,
            total: check.total,
            message: `Critical failure! The ${recipe.name} combine fails. Double materials consumed; nothing produced.`
        };
    }

    if (!succeeded) {
        // Regular failure: keep materials
        return {
            success: false,
            critFail: false,
            critSuccess: false,
            roll: check.roll,
            total: check.total,
            message: `Failed to create ${recipe.name}. Materials salvaged.`
        };
    }

    // Success: consume components (reduced on a critical success), create
    // product with quality from natural roll
    const quality = qualityForRoll(natural);
    await consumeComponents(componentsForOutcome(recipe.components, outcome));
    await createProduct(recipe.product, quality);

    return {
        success: true,
        critFail: false,
        critSuccess: isCritSuccess,
        roll: check.roll,
        total: check.total,
        message: isCritSuccess
            ? `Critical success! Created ${recipe.name} with barely any materials.`
            : `Successfully created ${recipe.name}!`
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
        "skill-fletching",
        "skill-jewelcraft",
        "skill-smithing",
        "skill-tailoring",
        "skill-tinkering",
        "skill-alchemy",
        "skill-poison-making",
        "skill-research"
    ];
}
