// ============================================================================
// EQRMSS — XP Calculator (RMSS Table 15.4.2, Experience Guideline Table)
// ============================================================================
//
// Pure functions implementing the book's XP award categories. All functions
// take structured input and return integer XP. No side effects.
//
// Basic multipliers (novelty of the event), applied to kill/hit/crit values:
//   1st Time x5 | 2nd Time x2 | Subsequent x1 | Routine x1/2
//
// ============================================================================

export const XP_MULTIPLIERS = {
    first: 5,
    second: 2,
    subsequent: 1,
    routine: 0.5
};

export const XP_MULTIPLIER_LABELS = {
    first: "1st time (x5)",
    second: "2nd time (x2)",
    subsequent: "Subsequent (x1)",
    routine: "Routine (x1/2)"
};

/** Apply a novelty multiplier key to a base value. Floors fractional results. */
export function applyMultiplier(base, multiplierKey = "subsequent") {
    const m = XP_MULTIPLIERS[multiplierKey] ?? 1;
    return Math.floor(Number(base ?? 0) * m);
}

// ----------------------------------------------------------------------------
// 1) Kill Points
// ----------------------------------------------------------------------------
// (# hits the foe could take) + (20 x foe level) + racial bonus.
// Racial bonus is added BEFORE multipliers. Non-cumulative (highest applies).
// Own Race 150 | Human/Dwarf/Elf/Hobbit 100 | Orc 75 | Troll 200
// Eagle 200 | Dragon 2000 | Demon (Pale/Type)^2 x 50
// ----------------------------------------------------------------------------

export const KILL_RACE_BONUSES = {
    own_race: 150,
    human: 100,
    dwarf: 100,
    elf: 100,
    hobbit: 100,
    halfling: 100,
    orc: 75,
    troll: 200,
    eagle: 200,
    dragon: 2000
};

/** Demon bonus: (Type)^2 x 50. */
export function demonKillBonus(type) {
    return Math.pow(Number(type ?? 0), 2) * 50;
}

/**
 * @param {object} foe - { hits, level, raceKey?, raceBonus?, demonPale?, demonType? }
 * @returns {number} base kill points (before novelty multiplier)
 */
export function killPoints(foe = {}) {
    const hits = Math.max(0, Math.floor(Number(foe.hits ?? 0)));
    const level = Math.max(0, Math.floor(Number(foe.level ?? 0)));
    let raceBonus = 0;
    if (foe.raceKey === "demon") {
        raceBonus = demonKillBonus(foe.demonType);
    } else if (foe.raceBonus != null) {
        raceBonus = Number(foe.raceBonus);
    } else if (foe.raceKey && KILL_RACE_BONUSES[foe.raceKey] != null) {
        raceBonus = KILL_RACE_BONUSES[foe.raceKey];
    }
    return hits + (20 * level) + Math.max(0, Math.floor(raceBonus));
}

// ----------------------------------------------------------------------------
// 2) Hit Points — 1 XP per hit delivered or received.
// 1/2x if the character is knocked out; 2x if the foe is knocked out.
// ----------------------------------------------------------------------------

/**
 * @param {object} o - { delivered, received, charKnockedOut, foeKnockedOut }
 */
export function hitPoints(o = {}) {
    const delivered = Math.max(0, Math.floor(Number(o.delivered ?? 0)));
    const received = Math.max(0, Math.floor(Number(o.received ?? 0)));
    let total = delivered + received;
    if (o.charKnockedOut) total *= 0.5;
    if (o.foeKnockedOut) total *= 2;
    return Math.floor(total);
}

// ----------------------------------------------------------------------------
// 3) Critical Points — for any criticals inflicted on a foe.
// A=5xlvl | B=10xlvl | C=15xlvl | D=20xlvl | E=25xlvl
// Large creature=20xlvl | Super-Large=40xlvl (replaces severity)
// Modifiers: 1/10x foe unconscious | 1/5x foe stunned | 2x single combat
// ----------------------------------------------------------------------------

const CRIT_SEVERITY_MULT = { A: 5, B: 10, C: 15, D: 20, E: 25 };

/**
 * @param {object} o - { severity: 'A'-'E', foeLevel, large, superLarge,
 *                       foeUnconscious, foeStunned, singleCombat }
 * @returns {number} XP for ONE critical (caller sums multiple crits)
 */
export function criticalPoints(o = {}) {
    const foeLevel = Math.max(0, Math.floor(Number(o.foeLevel ?? 0)));
    let per;
    if (o.superLarge) per = 40;
    else if (o.large) per = 20;
    else per = CRIT_SEVERITY_MULT[String(o.severity ?? "").toUpperCase()] ?? 0;
    let total = per * foeLevel;
    if (o.foeUnconscious) total *= 0.1;
    if (o.foeStunned) total *= 0.2;
    if (o.singleCombat) total *= 2;
    return Math.floor(total);
}

// ----------------------------------------------------------------------------
// 4) Idea Points — 1/2 of the group's total (non-idea) points, rounded up,
// divided among the planners who conceived the successful plan.
// ----------------------------------------------------------------------------

export function ideaPoints(groupTotal, planners = 1) {
    const p = Math.max(1, Math.floor(Number(planners ?? 1)));
    return Math.ceil(Number(groupTotal ?? 0) / 2 / p);
}

// ----------------------------------------------------------------------------
// 5) Maneuver Points — bonus equal to the XP resulting from the maneuver.
// 1/2x routine/medium | 1x hard/very hard | 2x sheer folly and absurd
// ----------------------------------------------------------------------------

export const MANEUVER_DIFFICULTY_MULT = {
    routine: 0.5,
    medium: 0.5,
    hard: 1,
    very_hard: 1,
    folly: 2
};

export function maneuverPoints(resultingXp, difficulty = "hard") {
    const m = MANEUVER_DIFFICULTY_MULT[difficulty] ?? 1;
    return Math.floor(Number(resultingXp ?? 0) * m);
}

// ----------------------------------------------------------------------------
// 6) Death Points — the character's own kill point value.
// 1/2x "near death" | 2x killed and resurrected
// ----------------------------------------------------------------------------

export function deathPoints(ownKillValue, { nearDeath = false, resurrected = false } = {}) {
    let total = Math.max(0, Math.floor(Number(ownKillValue ?? 0)));
    if (nearDeath) total *= 0.5;
    if (resurrected) total *= 2;
    return Math.floor(total);
}

// ----------------------------------------------------------------------------
// 7) Travel Points — 1 XP per mile of conscious travel.
// 2x rugged/moderately dangerous | 3x extremely dangerous.
// Air/sea travel: 1 XP per 10 miles.
// ----------------------------------------------------------------------------

export function travelPoints(miles, { airOrSea = false, terrain = "normal" } = {}) {
    let base = Number(miles ?? 0);
    if (airOrSea) base = base / 10;
    const terrainMult = terrain === "extreme" ? 3 : terrain === "rugged" ? 2 : 1;
    return Math.floor(base * terrainMult);
}

// ----------------------------------------------------------------------------
// 8) Spell Points (optional) — 1 XP per power point (mana) spent.
// ----------------------------------------------------------------------------

export function spellPoints(powerPoints) {
    return Math.max(0, Math.floor(Number(powerPoints ?? 0)));
}

// ----------------------------------------------------------------------------
// Full breakdown driver
// ----------------------------------------------------------------------------
// Input shape (all fields optional; only present categories are scored):
// {
//   novelty: 'first'|'second'|'subsequent'|'routine'   (applies to kill/hit/crit),
//   kill:   { hits, level, raceKey?, raceBonus?, demonType? },
//   hits:   { delivered, received, charKnockedOut?, foeKnockedOut? },
//   crits:  [ { severity, foeLevel, large?, superLarge?,
//               foeUnconscious?, foeStunned?, singleCombat? }, ... ],
//   maneuver: { resultingXp, difficulty },
//   idea:   { groupTotal, planners },
//   death:  { ownKillValue, nearDeath?, resurrected? },
//   travel: { miles, airOrSea?, terrain },
//   spell:  { powerPoints },
//   religious: { points },      // GM-assigned
//   misc:   { points, label }   // GM discretionary
// }
// Returns { lines: [{ key, label, detail, xp }], total }
// ----------------------------------------------------------------------------

const CATEGORY_LABELS = {
    kill: "Kill Points",
    hits: "Hit Points",
    crits: "Critical Points",
    maneuver: "Maneuver Points",
    idea: "Idea Points",
    death: "Death Points",
    travel: "Travel Points",
    spell: "Spell Points",
    religious: "Religious Points",
    misc: "Miscellaneous"
};

export function calculateXpBreakdown(input = {}) {
    const novelty = input.novelty ?? "subsequent";
    const lines = [];
    const push = (key, detail, xp) => {
        xp = Math.max(0, Math.floor(xp));
        if (xp > 0 || detail) lines.push({ key, label: CATEGORY_LABELS[key] ?? key, detail: detail ?? "", xp });
    };

    if (input.kill) {
        const base = killPoints(input.kill);
        const xp = applyMultiplier(base, novelty);
        push("kill", `${input.kill.hits ?? 0} hits + 20x${input.kill.level ?? 0} lvl` +
            (input.kill.raceKey ? ` + ${input.kill.raceKey} bonus` : "") +
            ` = ${base} x ${XP_MULTIPLIER_LABELS[novelty]}`, xp);
    }

    if (input.hits) {
        const base = hitPoints({ ...input.hits, charKnockedOut: false, foeKnockedOut: false });
        const mods = [];
        if (input.hits.charKnockedOut) mods.push("char KO x1/2");
        if (input.hits.foeKnockedOut) mods.push("foe KO x2");
        let xp = applyMultiplier(base, novelty);
        if (input.hits.charKnockedOut) xp = Math.floor(xp * 0.5);
        if (input.hits.foeKnockedOut) xp = Math.floor(xp * 2);
        push("hits", `${input.hits.delivered ?? 0} delivered + ${input.hits.received ?? 0} received` +
            (mods.length ? ` (${mods.join(", ")})` : "") +
            ` x ${XP_MULTIPLIER_LABELS[novelty]}`, xp);
    }

    if (Array.isArray(input.crits) && input.crits.length) {
        let subtotal = 0;
        const parts = [];
        for (const c of input.crits) {
            const sev = String(c.severity ?? "").toUpperCase();
            const base = criticalPoints({ ...c, foeUnconscious: false, foeStunned: false, singleCombat: false });
            let xp = applyMultiplier(base, novelty);
            const mods = [];
            if (c.foeUnconscious) { xp = Math.floor(xp * 0.1); mods.push("unconscious x1/10"); }
            if (c.foeStunned) { xp = Math.floor(xp * 0.2); mods.push("stunned x1/5"); }
            if (c.singleCombat) { xp = Math.floor(xp * 2); mods.push("single combat x2"); }
            subtotal += xp;
            parts.push(`${sev} (lvl ${c.foeLevel ?? 0})${mods.length ? " " + mods.join(",") : ""} = ${xp}`);
        }
        push("crits", parts.join("; "), subtotal);
    }

    if (input.maneuver) {
        const xp = maneuverPoints(input.maneuver.resultingXp, input.maneuver.difficulty);
        push("maneuver", `${input.maneuver.resultingXp ?? 0} resulting XP x ${input.maneuver.difficulty ?? "hard"}`, xp);
    }

    if (input.idea) {
        const xp = ideaPoints(input.idea.groupTotal, input.idea.planners);
        push("idea", `1/2 of ${input.idea.groupTotal ?? 0} split ${input.idea.planners ?? 1} way(s), rounded up`, xp);
    }

    if (input.death) {
        const xp = deathPoints(input.death.ownKillValue, input.death);
        const mods = [];
        if (input.death.nearDeath) mods.push("near death x1/2");
        if (input.death.resurrected) mods.push("resurrected x2");
        push("death", `own kill value ${input.death.ownKillValue ?? 0}${mods.length ? " (" + mods.join(", ") + ")" : ""}`, xp);
    }

    if (input.travel) {
        const xp = travelPoints(input.travel.miles, input.travel);
        push("travel", `${input.travel.miles ?? 0} miles${input.travel.airOrSea ? " (air/sea)" : ""}` +
            (input.travel.terrain && input.travel.terrain !== "normal" ? `, ${input.travel.terrain}` : ""), xp);
    }

    if (input.spell) {
        push("spell", `${input.spell.powerPoints ?? 0} power points`, spellPoints(input.spell.powerPoints));
    }

    if (input.religious) {
        push("religious", "GM-assigned", Math.max(0, Math.floor(Number(input.religious.points ?? 0))));
    }

    if (input.misc) {
        push("misc", input.misc.label ?? "GM discretionary", Math.max(0, Math.floor(Number(input.misc.points ?? 0))));
    }

    const total = lines.reduce((s, l) => s + l.xp, 0);
    return { lines, total };
}

export default {
    XP_MULTIPLIERS,
    XP_MULTIPLIER_LABELS,
    KILL_RACE_BONUSES,
    applyMultiplier,
    killPoints,
    demonKillBonus,
    hitPoints,
    criticalPoints,
    ideaPoints,
    maneuverPoints,
    MANEUVER_DIFFICULTY_MULT,
    deathPoints,
    travelPoints,
    spellPoints,
    calculateXpBreakdown
};
