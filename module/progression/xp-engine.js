// ============================================================================
// EQRMSS — XP & Organic Level-Up Engine
// ============================================================================
//
// Responsibilities:
// - Define XP thresholds per level (1-125)
// - Determine a character's level from total XP
// - Check for and apply level-ups when XP is awarded
// - Orchestrate per-level rewards: DP, tradeskill points, milestones
//
// Design notes:
// - XP curve: cumulative XP to reach level N = 1000 * (N-1)^2.
//   L2=1k, L10=81k, L50=2.4M, L60=3.5M, L125=15.4M. EQ-flavored scale.
// - Tables (martial-specialist, pure-channeling, etc.) share the curve for
//   now; the structure allows per-table multipliers later.
// - HP comes from Body Development ranks (RMSS §3.8), bought with the DP
//   granted here — no flat HP is awarded on level-up.
// - Mana max derives from level automatically (see mana pool rules).
//
// ============================================================================

// ----------------------------------------------------------------------------
// XP tables
// ----------------------------------------------------------------------------

const XP_TABLE_MULTIPLIERS = {
    "martial-specialist": 1.0,
    "pure-channeling":    1.0,
    "hybrid":             1.0,
    "default":            1.0
};

const MAX_LEVEL = 125;

// Cumulative XP required to REACH a given level (level 1 = 0).
export function xpForLevel(level, tableId = "default") {
    const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
    if (lvl <= 1) return 0;
    const mult = XP_TABLE_MULTIPLIERS[tableId] ?? XP_TABLE_MULTIPLIERS["default"];
    return Math.floor(1000 * Math.pow(lvl - 1, 2) * mult);
}

// XP needed to go from `level` to `level + 1`.
export function xpToNextLevel(level, tableId = "default") {
    const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
    if (lvl >= MAX_LEVEL) return 0;
    return xpForLevel(lvl + 1, tableId) - xpForLevel(lvl, tableId);
}

// What level does this total XP correspond to?
export function levelForXp(totalXp, tableId = "default") {
    const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
    let level = 1;
    // Walk up; 125 iterations max, cheap.
    while (level < MAX_LEVEL && xp >= xpForLevel(level + 1, tableId)) {
        level++;
    }
    return level;
}

// Which XP table does this actor use? Falls back to "default".
export function xpTableForActor(actor) {
    const classId = actor?.system?.origin?.classId
        ?? actor?.system?.fixed_info?.profession
        ?? null;
    const classData = classId
        ? (game?.eqrmss?.classes?.[classId] ?? CONFIG?.EQRMSS?.data?.classIndex?.[classId])
        : null;
    const table = classData?.experienceProgression?.table
        ?? classData?.system?.experienceProgression?.table
        ?? "default";
    return XP_TABLE_MULTIPLIERS[table] !== undefined ? table : "default";
}

// Canonical live level for an actor.
export function currentLevel(actor) {
    return Math.max(1, Math.floor(Number(
        actor?.system?.attributes?.level?.value
        ?? actor?.system?.level
        ?? 1
    ) || 1));
}

// ----------------------------------------------------------------------------
// Level-up orchestration
// ----------------------------------------------------------------------------

// Apply a single level-up. Returns a summary object for the notification.
export async function applyLevelUp(actor) {
    const level = currentLevel(actor);
    const nextLevel = level + 1;

    const summary = { from: level, to: nextLevel, dp: 0, tradeskillPoints: 5, abilities: [] };

    // --- Development points (via class data) ---
    try {
        if (typeof actor.awardLevelDevelopmentPoints === "function") {
            summary.dp = actor.awardLevelDevelopmentPoints() ?? 0;
        } else {
            // Fallback: sum class developmentPoints directly.
            const classes = typeof actor.getClasses === "function" ? actor.getClasses() : [];
            let pts = 0;
            for (const cls of classes) {
                const cd = game?.eqrmss?.classes?.[cls] ?? CONFIG?.EQRMSS?.data?.classIndex?.[cls];
                pts += Number(cd?.developmentPoints ?? 0);
            }
            if (pts > 0 && actor?.system?.character) {
                actor.system.character.developmentPoints =
                    Number(actor.system.character.developmentPoints ?? 0) + pts;
                summary.dp = pts;
            }
        }
    } catch (e) { console.warn("EQRMSS | XP engine: DP grant failed", e); }

    // --- Progression milestones (abilities, etc.) ---
    try {
        const pm = game?.eqrmss?.progressionManager;
        if (pm && typeof pm.processLevelUp === "function") {
            await pm.processLevelUp(actor, nextLevel);
        }
    } catch (e) { console.warn("EQRMSS | XP engine: progression milestones failed", e); }

    // --- Increment level (canonical field) ---
    const updates = { "system.attributes.level.value": nextLevel };
    // Keep legacy system.level in sync if present.
    if (actor?.system?.level !== undefined) updates["system.level"] = nextLevel;
    await actor.update(updates);

    // --- Tradeskill points: 5 dedicated points per level ---
    const tsPoints = Number(actor?.system?.tradeskillPoints ?? 0);
    await actor.update({ "system.tradeskillPoints": tsPoints + 5 });

    return summary;
}

// Check whether the actor's XP warrants level-ups; apply them all.
// Returns an array of per-level summaries (empty if none).
export async function checkAndApplyLevelUps(actor) {
    if (!actor) return [];

    const tableId = xpTableForActor(actor);
    const totalXp = Number(actor?.system?.logs?.xp ?? 0);

    const targetLevel = levelForXp(totalXp, tableId);
    let level = currentLevel(actor);

    // Expansion cap.
    let levelCap = MAX_LEVEL;
    try {
        const { EQRMSSExpansionManager } = await import("../expansions/expansion-manager.js");
        levelCap = EQRMSSExpansionManager.getLevelCap() ?? MAX_LEVEL;
    } catch (e) { /* fail-open */ }

    const summaries = [];
    let guard = 0;
    while (level < targetLevel && level < levelCap && guard < MAX_LEVEL) {
        guard++;
        const summary = await applyLevelUp(actor);
        summaries.push(summary);
        level = currentLevel(actor);
    }

    if (summaries.length > 0) {
        const first = summaries[0].from;
        const last = summaries[summaries.length - 1].to;
        const totalDp = summaries.reduce((s, x) => s + (x.dp ?? 0), 0);
        const totalTs = summaries.reduce((s, x) => s + (x.tradeskillPoints ?? 0), 0);
        const levelWord = summaries.length === 1 ? "level" : "levels";
        ui?.notifications?.info?.(
            `EQRMSS | ${actor.name} advanced ${first} → ${last} ` +
            `(${summaries.length} ${levelWord})! +${totalDp} DP, +${totalTs} tradeskill points.`
        );
    }

    return summaries;
}

export default {
    xpForLevel,
    xpToNextLevel,
    levelForXp,
    xpTableForActor,
    currentLevel,
    applyLevelUp,
    checkAndApplyLevelUps,
    MAX_LEVEL
};
