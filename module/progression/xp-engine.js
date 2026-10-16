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
// - XP thresholds: RMSS Character Law Table 15.4.1 (book-pure).
//   1st level starts at 10,000 XP. +10k/level for 1-5, +20k for 6-10,
//   +30k for 11-15, +40k for 16-20, +50k/level from 21 on.
// - Tables (martial-specialist, pure-channeling, etc.) share the table for
//   now; the structure allows per-table multipliers later.
// - HP comes from Body Development ranks (RMSS §3.8), bought with the DP
//   granted here — no flat HP is awarded on level-up.
// - Mana max derives from level automatically (see mana pool rules).
// - Level combat bonuses (RMSS §5.2.1) use the user's EQ class mapping
//   (2026-10-16): fighters +3/level uncapped; rogues +3 (max +60);
//   warrior monks +2 (max +40); bards +1 (max +20); pure casters +0.
// - Level spell bonuses (RMSS §5.2.2, user-modified 2026-10-16):
//   pure casters +2/level, hybrids +1/level, bards +1/level to songs;
//   all capped at +20. Applied to the ESF casting roll.
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

// RMSS Character Law Table 15.4.1 (book-pure). Cumulative XP required to
// REACH a given level. Index 0 = level 1 (10,000 XP starting base).
const XP_THRESHOLDS = [
    10000, 20000, 30000, 40000, 50000,          // 1-5   (+10k)
    70000, 90000, 110000, 130000, 150000,       // 6-10  (+20k)
    180000, 210000, 240000, 270000, 300000,     // 11-15 (+30k)
    340000, 380000, 420000, 460000, 500000,     // 16-20 (+40k)
    550000                                      // 21    (+50k)
];
// 22+: +50,000 per level.

// Cumulative XP required to REACH a given level.
export function xpForLevel(level, tableId = "default") {
    const lvl = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
    const mult = XP_TABLE_MULTIPLIERS[tableId] ?? XP_TABLE_MULTIPLIERS["default"];
    let base;
    if (lvl <= XP_THRESHOLDS.length) {
        base = XP_THRESHOLDS[lvl - 1];
    } else {
        base = XP_THRESHOLDS[XP_THRESHOLDS.length - 1] + (lvl - XP_THRESHOLDS.length) * 50000;
    }
    return Math.floor(base * mult);
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
// Level bonuses (RMSS §5.2.1 / §5.2.2, user EQ-class mapping 2026-10-16)
// ----------------------------------------------------------------------------

// Canonical class id for an actor (e.g. "warrior", "wizard").
function classIdOf(actor) {
    return String(
        actor?.system?.origin?.classId
        ?? actor?.system?.fixed_info?.profession
        ?? ""
    ).toLowerCase();
}

// Level combat bonus (§5.2.1): added to ALL melee and missile OBs.
// User mapping: fighters +3/level uncapped; rogues +3 (max +60);
// warrior monks +2 (max +40); bards +1 (max +20); pure casters +0.
const LEVEL_COMBAT_BONUS = {
    warrior:      { perLevel: 3, cap: Infinity },
    berserker:    { perLevel: 3, cap: Infinity },
    paladin:      { perLevel: 3, cap: Infinity },
    shadowknight: { perLevel: 3, cap: Infinity },
    ranger:       { perLevel: 3, cap: Infinity },
    rogue:        { perLevel: 3, cap: 60 },
    monk:         { perLevel: 2, cap: 40 },
    beastlord:    { perLevel: 2, cap: 40 },
    bard:         { perLevel: 1, cap: 20 }
    // Pure casters (wizard, magician, enchanter, necromancer, cleric,
    // druid, shaman) get +0 — absent from the map.
};

export function levelCombatBonus(actor) {
    const spec = LEVEL_COMBAT_BONUS[classIdOf(actor)];
    if (!spec) return 0;
    return Math.min(spec.perLevel * currentLevel(actor), spec.cap);
}

// Level spell bonus (§5.2.2, user-modified): added to the spell casting
// die roll (the ESF roll in this system). Pure casters +2/level,
// hybrids +1/level, all capped at +20.
const LEVEL_SPELL_BONUS_PER_LEVEL = {
    wizard: 2, magician: 2, enchanter: 2, necromancer: 2,
    cleric: 2, druid: 2, shaman: 2,
    paladin: 1, shadowknight: 1, beastlord: 1, ranger: 1
};
const LEVEL_SPELL_BONUS_CAP = 20;

export function levelSpellBonus(actor) {
    const per = LEVEL_SPELL_BONUS_PER_LEVEL[classIdOf(actor)];
    if (!per) return 0;
    return Math.min(per * currentLevel(actor), LEVEL_SPELL_BONUS_CAP);
}

// Level song bonus (user ruling 2026-10-16): bards get +1/level to song
// casting rolls, max +20. NOTE: songs currently have no casting roll in
// this system (no ESF gate — see module/spells/songs.js), so this bonus
// is computed and exposed but dormant until a song roll exists.
export function levelSongBonus(actor) {
    if (classIdOf(actor) !== "bard") return 0;
    return Math.min(currentLevel(actor), 20);
}

// ----------------------------------------------------------------------------
// Level-up orchestration
// ----------------------------------------------------------------------------

// Apply a single level-up (RMSS §5.3). Returns a summary object.
//  A. Stat gain rolls (Table 15.1.2) — TODO: table data not yet in the
//     system; stubbed, does not block level-up.
//  B. Skill rank benefits: granted via DP below; multi-level jumps grant
//     DP per level through the checkAndApplyLevelUps loop (book: double
//     ranks when jumping 2+ levels without developing between).
//  C. Level combat/spell/song bonuses: computed at roll time via
//     levelCombatBonus()/levelSpellBonus()/levelSongBonus() — always
//     in sync with the actor's level, no stored value to drift.
//  D. Spell list updates — TODO: not yet wired.
//  E. Development points + 5 tradeskill points (below).
export async function applyLevelUp(actor) {
    const level = currentLevel(actor);
    const nextLevel = level + 1;

    const summary = {
        from: level, to: nextLevel, dp: 0, tradeskillPoints: 5, abilities: [],
        combatBonus: levelCombatBonus(actor),
        spellBonus: levelSpellBonus(actor),
        songBonus: levelSongBonus(actor)
    };

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
        const fin = summaries[summaries.length - 1];
        const bonusBits = [];
        if (fin.combatBonus > 0) bonusBits.push(`+${fin.combatBonus} OB (level)`);
        if (fin.spellBonus > 0) bonusBits.push(`+${fin.spellBonus} spell rolls (level)`);
        if (fin.songBonus > 0) bonusBits.push(`+${fin.songBonus} song rolls (level)`);
        const bonusText = bonusBits.length ? ` [${bonusBits.join(", ")}]` : "";
        ui?.notifications?.info?.(
            `EQRMSS | ${actor.name} advanced ${first} → ${last} ` +
            `(${summaries.length} ${levelWord})! +${totalDp} DP, +${totalTs} tradeskill points${bonusText}.`
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
    levelCombatBonus,
    levelSpellBonus,
    levelSongBonus,
    applyLevelUp,
    checkAndApplyLevelUps,
    MAX_LEVEL
};
