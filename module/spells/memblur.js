// ============================================================
// MEMBLUR (2026-10-07). EQ memory-blur mechanics.
//
// Memblur removes the caster from the target's "memory" — the
// target forgets that the caster harmed them.
//
// This builds on a minimal aggro/offense record stored at
// system.status.aggro, keyed by attacker actor ID:
//   { <attackerId>: { damage: <total>, debuffs: <count>, lastRound: <n> } }
//
// This is the foundation for the user's planned "offense record on
// NPC cards" (damage to the target, debuffs on the target, healing
// someone attacking the target). Healing-aggro is not yet tracked.
//
// User ruling (2026-10-07): "Memblur: Remove the caster from the
// NPC/PC's 'memory.'"
// ============================================================

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/**
 * Get the current combat round for aggro timestamps.
 * @returns {number} combat round, or 0 if not in combat
 */
function currentRound() {
    try {
        return Number(globalThis.game?.combat?.round) || 0;
    } catch (e) {
        return 0;
    }
}

/**
 * Record an offensive action against a target. Called when an actor
 * damages or debuffs another actor.
 *
 * @param {Actor} target - the actor that was harmed
 * @param {Actor} attacker - the actor doing the harming
 * @param {object} opts - { damage = 0, debuffs = 0 }
 * @returns {Promise<void>}
 */
export async function recordAggro(target, attacker, { damage = 0, debuffs = 0, heal = 0 } = {}) {
    if (!target || !attacker) return;
    // Don't record self-inflicted damage as aggro
    if (target.id === attacker.id) return;
    // Pacified targets ignore new offenses while the effect lasts (2026-10-07).
    try {
        const p = target.system?.status?.pacified;
        if (p && typeof p === "object" && (Number(p.roundsLeft) || 0) > 0) return;
    } catch (e) { /* ignore */ }
    const dmg = Number(damage) || 0;
    const deb = Number(debuffs) || 0;
    const hl = Number(heal) || 0;
    if (dmg <= 0 && deb <= 0 && hl <= 0) return;

    let aggro = {};
    try {
        aggro = { ...(target.system?.status?.aggro ?? {}) };
    } catch (e) { /* ignore */ }

    const key = String(attacker.id);
    const existing = aggro[key] ?? { damage: 0, debuffs: 0, heal: 0, lastRound: 0, name: String(attacker.name ?? "unknown") };
    aggro[key] = {
        damage: (Number(existing.damage) || 0) + dmg,
        debuffs: (Number(existing.debuffs) || 0) + deb,
        heal: (Number(existing.heal) || 0) + hl,
        lastRound: currentRound(),
        name: String(attacker.name ?? existing.name ?? "unknown")
    };

    try {
        await target.update({ "system.status.aggro": aggro });
    } catch (e) { /* non-fatal */ }
}

/**
 * Record healing aggro (2026-10-08). When a healer restores hits on a
 * target, mobs with the target on their hate list gain hate towards
 * the healer. Amount is the hits restored (1:1).
 */
export async function recordHealAggro(healer, healTarget, healAmount) {
    const amt = Math.max(0, Math.round(Number(healAmount) || 0));
    if (amt <= 0 || !healer || !healTarget) return;
    if (healer.id === healTarget.id) return; // self-heals: no new aggro
    let actors = [];
    try {
        actors = [...(globalThis.game?.actors?.contents ?? [])];
    } catch (e) { return; }
    for (const mob of actors) {
        if (!mob || mob.id === healer.id || mob.id === healTarget.id) continue;
        const aggro = mob.system?.status?.aggro ?? {};
        if (aggro[healTarget.id]) {
            await recordAggro(mob, healer, { heal: amt });
        }
    }
}

/**
 * Get the aggro record for a target.
 * @param {Actor} target
 * @returns {object} aggro record keyed by attacker ID
 */
export function getAggro(target) {
    try {
        return { ...(target?.system?.status?.aggro ?? {}) };
    } catch (e) {
        return {};
    }
}

/**
 * Remove one attacker's entry from a target's aggro record.
 * @param {Actor} target - the actor forgetting
 * @param {string} attackerId - the actor ID to forget
 * @returns {Promise<boolean>} true if an entry was removed
 */
export async function clearAggro(target, attackerId) {
    if (!target || !attackerId) return false;
    let aggro = {};
    try {
        aggro = { ...(target.system?.status?.aggro ?? {}) };
    } catch (e) { /* ignore */ }
    const key = String(attackerId);
    if (!(key in aggro)) return false;
    delete aggro[key];
    try {
        await target.update({ "system.status.aggro": aggro });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Apply memblur: the target has a chance to forget the caster.
 *
 * @param {Actor} caster - the actor casting memblur (will be forgotten)
 * @param {Actor} target - the actor whose memory is blurred
 * @param {number} chancePct - % chance of success (0-100)
 * @param {string} sourceName - spell/clicky/song name for messages
 * @returns {Promise<string>} HTML note for the chat card
 */
export async function applyMemblur(caster, target, chancePct = 50, sourceName = "Memory Blur") {
    if (!target) return "";
    const canTouch = target.isOwner || globalThis.game?.user?.isGM;
    if (!canTouch) return `<p><em>Memblur not applied — you don't control ${esc(target.name)}.</em></p>`;

    const chance = Math.max(0, Math.min(100, Number(chancePct) || 0));
    const roll = Math.ceil(Math.random() * 100);
    const rollStr = `${roll} vs ${chance}%`;

    if (roll > chance) {
        return `<p><em>Memblur: ${rollStr} — resisted, ${esc(target.name)} remembers (${esc(sourceName)}).</em></p>`;
    }

    const casterId = caster ? String(caster.id) : null;
    const casterName = caster ? String(caster.name ?? "unknown") : "unknown";
    let forgot = false;
    if (casterId) {
        forgot = await clearAggro(target, casterId);
    }

    if (forgot) {
        return `<p><em>Memblur: ${rollStr} — ${esc(target.name)} forgets about ${esc(casterName)} (${esc(sourceName)}).</em></p>`;
    }
    // Success but the caster had no aggro on the target — nothing to forget
    return `<p><em>Memblur: ${rollStr} — ${esc(target.name)}'s memory blurs, but ${esc(casterName)} had done them no harm (${esc(sourceName)}).</em></p>`;
}
