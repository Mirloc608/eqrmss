// ============================================================
// PACIFY / SOOTHE (2026-10-07). EQ aggro-reduction mechanics.
//
// Pacify lowers the target's aggressiveness — a pacified NPC won't
// attack unless directly attacked or approached very closely.
//
// Mechanics:
// - Applies system.status.pacified = { roundsLeft, source } to the target
// - Reduces existing aggro by half (partial memblur, not a full wipe)
// - While pacified, recordAggro() skips new entries (target ignores
//   new offenses) — see the pacified check in memblur.js
// - Level cap: Pacify affects creatures up to level 55, Soothe up to 40.
//   Higher-level targets resist outright.
//
// There is no aggro-radius runtime system (reduce-aggro-radius exists
// only as data). The pacified status is the mechanical record; when an
// aggro-radius/detection system is built, it should check isPacified().
// ============================================================

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/**
 * Check if an actor is currently pacified.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isPacified(actor) {
    try {
        const p = actor?.system?.status?.pacified;
        return !!(p && typeof p === "object" && (Number(p.roundsLeft) || 0) > 0);
    } catch (e) {
        return false;
    }
}

/**
 * Get the actor's level for the pacify level-cap check.
 */
function actorLevel(actor) {
    try {
        return Number(actor?.system?.attributes?.level?.value)
            || Number(actor?.system?.level)
            || 1;
    } catch (e) {
        return 1;
    }
}

/**
 * Apply pacify to a target: halves existing aggro and marks them pacified
 * so new aggro isn't recorded while the effect lasts.
 *
 * @param {Actor} caster - the actor applying pacify
 * @param {Actor} target - the actor being pacified
 * @param {object} opts - { rounds, levelCap, sourceName }
 * @returns {Promise<string>} HTML chat note
 */
export async function applyPacify(caster, target, { rounds = 7, levelCap = 55, sourceName = "Pacify" } = {}) {
    if (!target) return `<p><em>Pacify not applied — no target.</em></p>`;
    const tName = String(target.name ?? "target");
    const cName = String(caster?.name ?? "someone");

    // Level cap: too-powerful creatures resist outright.
    const tLevel = actorLevel(target);
    if (tLevel > levelCap) {
        return `<p><em>${esc(sourceName)}: ${esc(tName)} (level ${tLevel}) is too powerful to pacify (max ${levelCap}).</em></p>`;
    }

    // Halve existing aggro — pacify calms but doesn't erase memory
    // (that's memblur's job).
    try {
        const aggro = { ...(target.system?.status?.aggro ?? {}) };
        let hadAggro = false;
        for (const k of Object.keys(aggro)) {
            const e = aggro[k];
            const dmg = Number(e?.damage) || 0;
            if (dmg > 0) hadAggro = true;
            aggro[k] = { ...e, damage: Math.floor(dmg / 2) };
        }
        if (hadAggro) {
            await target.update({ "system.status.aggro": aggro });
        }
    } catch (e) { /* non-fatal */ }

    // Mark pacified. New aggro won't be recorded while this lasts
    // (see the isPacified check in recordAggro).
    try {
        await target.update({
            "system.status.pacified": { roundsLeft: Math.max(1, Number(rounds) || 7), source: String(sourceName) }
        });
    } catch (e) { /* non-fatal */ }

    return `<p><em>${esc(sourceName)}: ${esc(tName)} is pacified for ${Math.max(1, Number(rounds) || 7)} rounds — aggressiveness lowered.</em></p>`;
}
