// ============================================================
// EQRMSS — Combat XP Tracker (feeds the XP Scoreboard dialog)
// ============================================================
// During combat, automatically records per-character XP-relevant
// events (kills, hits delivered/received, criticals, knockouts)
// so the GM doesn't have to hand-enter everything in the
// XP Scoreboard (Table 15.4.2).
//
// Data lives on actor flags: actor.flags.eqrmss.xpTracker
// Shape:
// {
//   kills: [{ name, hits, level, raceKey, timestamp }],
//   hitsDelivered: 0,
//   hitsReceived: 0,
//   healingDelivered: 0,
//   charKnockedOut: false,
//   foeKnockedOut: false,
//   crits: [{ severity, foeLevel, foeName,
//             foeUnconscious, foeStunned, singleCombat }]
// }
//
// Lifecycle:
// - Cleared when a combat encounter starts (register-hooks.js).
// - Accumulated by rollWeaponAttack in combat-rolls.js.
// - Read by XPScoreboardDialog to pre-fill its form.
// - Cleared for an actor after the GM awards XP from the dialog.
// ============================================================

import { KILL_RACE_BONUSES } from "./xp-calculator.js";

const FLAG_SCOPE = "eqrmss";
const FLAG_KEY = "xpTracker";

function emptyTracker() {
    return {
        kills: [],
        hitsDelivered: 0,
        hitsReceived: 0,
        healingDelivered: 0,
        charKnockedOut: false,
        foeKnockedOut: false,
        crits: []
    };
}

// XP tracking accumulates per CHARACTER, so reads/writes resolve a
// token's synthetic actor to its world (base) actor. Without this,
// actions taken from an unlinked token's sheet record to the token
// delta — invisible to the GM Screen and every world-actor reader
// (found 2026-10-20: HT hits sat on the token copy, GM form empty).
function baseActor(actor) {
    if (!actor) return actor;
    try {
        if (actor.isToken) {
            return globalThis.game?.actors?.get?.(actor.id) ?? actor;
        }
    } catch (e) { /* fall through to the actor itself */ }
    return actor;
}

/** Read the tracker for an actor (returns a fresh empty shape if none). */
export function getXPTracker(actor) {
    actor = baseActor(actor);
    try {
        const raw = actor?.getFlag?.(FLAG_SCOPE, FLAG_KEY);
        if (!raw || typeof raw !== "object") return emptyTracker();
        const t = emptyTracker();
        if (Array.isArray(raw.kills)) t.kills = raw.kills;
        t.hitsDelivered = Number(raw.hitsDelivered) || 0;
        t.hitsReceived = Number(raw.hitsReceived) || 0;
        t.healingDelivered = Number(raw.healingDelivered) || 0;
        t.charKnockedOut = !!raw.charKnockedOut;
        t.foeKnockedOut = !!raw.foeKnockedOut;
        if (Array.isArray(raw.crits)) t.crits = raw.crits;
        return t;
    } catch (e) {
        return emptyTracker();
    }
}

/** Persist tracker data for an actor. */
async function setXPTracker(actor, data) {
    actor = baseActor(actor);
    if (!actor?.setFlag) return;
    try {
        await actor.setFlag(FLAG_SCOPE, FLAG_KEY, data);
    } catch (e) {
        console.warn("EQRMSS | XP tracker save failed", e);
    }
}

/** Reset an actor's tracker (combat start, or after awarding). */
export async function clearXPTracker(actor) {
    await setXPTracker(actor, emptyTracker());
}

/** Does this tracker hold any data worth pre-filling? */
export function trackerHasData(t) {
    if (!t) return false;
    return (t.kills?.length ?? 0) > 0
        || (t.hitsDelivered ?? 0) > 0
        || (t.hitsReceived ?? 0) > 0
        || (t.healingDelivered ?? 0) > 0
        || (t.crits?.length ?? 0) > 0
        || !!t.charKnockedOut
        || !!t.foeKnockedOut;
}

// ----------------------------------------------------------------------------
// Race mapping — foe race name to KILL_RACE_BONUSES key.
// Returns "" when no mapping applies (GM fills it in manually).
// ----------------------------------------------------------------------------

const RACE_NAME_TO_KEY = {
    human: "human",
    dwarf: "dwarf",
    dwarves: "dwarf",
    elf: "elf",
    elves: "elf",
    "high-elf": "elf",
    "high elf": "elf",
    "wood-elf": "elf",
    "wood elf": "elf",
    "dark-elf": "elf",
    "dark elf": "elf",
    "half-elf": "elf",
    "half elf": "elf",
    hobbit: "hobbit",
    halfling: "halfling",
    orc: "orc",
    "orc-": "orc",
    troll: "troll",
    eagle: "eagle",
    dragon: "dragon",
    drake: "dragon",
    wurm: "dragon",
    wyvern: "dragon",
    demon: "demon"
};

export function mapRaceToKillBonusKey(raceName, killerActor, foeActor) {
    try {
        // Own race: slaying one of your own kind (non-cumulative 150).
        const killerRace = String(killerActor?.system?.fixed_info?.race_name
            ?? killerActor?.system?.fixed_info?.race ?? "").toLowerCase().trim();
        const foeRace = String(raceName ?? "").toLowerCase().trim();
        if (killerRace && foeRace && killerRace === foeRace) return "own_race";
        // Direct name mapping.
        if (RACE_NAME_TO_KEY[foeRace]) return RACE_NAME_TO_KEY[foeRace];
        // Substring fallback ("orc warrior" -> orc, "fire dragon" -> dragon).
        for (const [name, key] of Object.entries(RACE_NAME_TO_KEY)) {
            if (foeRace.includes(name)) return key;
        }
    } catch (e) { /* non-fatal */ }
    return "";
}

function foeRaceName(foeActor) {
    return String(
        foeActor?.system?.fixed_info?.race_name
        ?? foeActor?.system?.fixed_info?.race
        ?? foeActor?.system?.race
        ?? ""
    ).trim();
}

function foeLevel(foeActor) {
    return Math.max(0, Math.floor(Number(foeActor?.system?.attributes?.level?.value ?? 0)));
}

function foeMaxHits(foeActor) {
    return Math.max(0, Math.floor(Number(foeActor?.system?.hits?.max ?? 0)));
}

// ----------------------------------------------------------------------------
// Recording — called from combat-rolls.js during attack resolution.
// All functions are safe to call with null actors (no-op).
// ----------------------------------------------------------------------------

/** Record concussion hits dealt by attacker and received by target. */
export async function trackXPHits(attacker, target, hits) {
    const n = Math.max(0, Math.floor(Number(hits ?? 0)));
    if (n <= 0) return;
    try {
        if (attacker) {
            const t = getXPTracker(attacker);
            t.hitsDelivered += n;
            await setXPTracker(attacker, t);
        }
        if (target && target !== attacker) {
            const t = getXPTracker(target);
            t.hitsReceived += n;
            await setXPTracker(target, t);
        }
    } catch (e) {
        console.warn("EQRMSS | XP hit tracking failed", e);
    }
}

/**
 * Record hits restored by a healer (user ruling 2026-10-25: healing
 * earns XP on par with offensive casting — 1 XP per hit healed,
 * scored in the scoreboard's Healing Points category). Only the
 * actual amount restored counts; callers pass the capped amount.
 */
export async function trackXPHealing(healer, amount) {
    const n = Math.max(0, Math.floor(Number(amount ?? 0)));
    if (!healer || n <= 0) return;
    try {
        const t = getXPTracker(healer);
        t.healingDelivered += n;
        await setXPTracker(healer, t);
    } catch (e) {
        console.warn("EQRMSS | XP healing tracking failed", e);
    }
}

/**
 * Record a critical inflicted by attacker on target.
 * @param {object} o - { severity: 'A'-'E', large?, superLarge? }
 * Foe unconscious/stunned state is read from the target at call time.
 */
export async function trackXPCrit(attacker, target, o = {}) {
    const severity = String(o.severity ?? "").toUpperCase();
    if (!attacker || !["A", "B", "C", "D", "E"].includes(severity)) return;
    try {
        const t = getXPTracker(attacker);
        const st = target?.system?.status ?? {};
        t.crits.push({
            severity,
            foeLevel: foeLevel(target),
            foeName: target?.name ?? "Foe",
            large: !!o.large,
            superLarge: !!o.superLarge,
            foeUnconscious: !!st.unconscious,
            foeStunned: !!(st.stun?.stunned || st.stun?.stunNoParry || st.stun?.downOrOut),
            singleCombat: false // GM sets this manually — can't auto-detect
        });
        // Foe knocked out by this attack counts for the x2 hit-point bonus.
        if (st.unconscious) t.foeKnockedOut = true;
        await setXPTracker(attacker, t);
    } catch (e) {
        console.warn("EQRMSS | XP crit tracking failed", e);
    }
}

/** Record a kill: foe's max hits, level, and race for the kill-point formula. */
export async function trackXPKill(killer, foe) {
    if (!killer || !foe) return;
    try {
        const t = getXPTracker(killer);
        const raceName = foeRaceName(foe);
        t.kills.push({
            name: foe?.name ?? "Foe",
            hits: foeMaxHits(foe),
            level: foeLevel(foe),
            raceKey: mapRaceToKillBonusKey(raceName, killer, foe),
            raceName,
            timestamp: Date.now()
        });
        await setXPTracker(killer, t);
        console.log(`EQRMSS | XP tracker: ${killer.name} killed ${foe?.name} (lvl ${foeLevel(foe)}, ${foeMaxHits(foe)} hits)`);
    } catch (e) {
        console.warn("EQRMSS | XP kill tracking failed", e);
    }
}

/** Mark a character as knocked out (x1/2 on their hit points). */
export async function trackXPCharKnockedOut(actor) {
    if (!actor) return;
    try {
        const t = getXPTracker(actor);
        t.charKnockedOut = true;
        await setXPTracker(actor, t);
    } catch (e) { /* non-fatal */ }
}
