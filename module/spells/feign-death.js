// ============================================================
// FEIGN DEATH (2026-10-07). EQ Feign Death mechanics.
//
// The actor falls prone and appears dead. Every other actor's
// aggro record is wiped of the feigner (like memblur, but for ALL
// attackers, not just one caster).
//
// - Success chance: d100 vs chance (spell data: amount/successRate;
//   clickies default 95).
// - While feigned the actor is prone and cannot act: any attack or
//   spell cast breaks the feign first (the action then proceeds).
// - The feign lasts until broken — the prone tracker does not tick
//   down while system.status.feigned is set (see crit-conditions.js).
//
// Spell data shapes:
//   { type: "control", effect: "feign-death", amount: <chance> }   — necromancer
//   { type: "utility", effect: "feign-death", successRate: <n> }   — shadowknight
// Clicky payload:
//   { type: "feign", chance: <0-100> }
// ============================================================

import { clearAggro } from "./memblur.js";
import { removeStatusEffect } from "./status-wiring.js";
import { combatCard } from "../combat/chat-card.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

// Prone duration while feigning. The prone tracker in
// tickConditions() skips decrementing while system.status.feigned
// is set, so this only needs to be positive.
const FEIGN_PRONE_ROUNDS = 9999;

/**
 * Is the actor currently feigning death?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isFeigning(actor) {
    try {
        return !!actor?.system?.status?.feigned;
    } catch (e) {
        return false;
    }
}

/**
 * Apply Feign Death to an actor (always self-targeted).
 *
 * @param {Actor} actor - the actor feigning death
 * @param {object} opts - { chance = 95, sourceName = "Feign Death" }
 * @returns {Promise<string>} HTML chat note
 */
export async function applyFeignDeath(actor, { chance = 95, sourceName = "Feign Death" } = {}) {
    if (!actor) return `<p><em>Feign Death not applied — no actor.</em></p>`;
    const canTouch = actor.isOwner || globalThis.game?.user?.isGM;
    if (!canTouch) return `<p><em>Feign Death not applied — you don't control ${esc(actor.name)}.</em></p>`;

    // Re-feigning while already down is a no-op (no new roll).
    if (isFeigning(actor)) {
        return `<p><em>${esc(actor.name)} is already feigning death (${esc(sourceName)}).</em></p>`;
    }

    const pct = Math.max(0, Math.min(100, Number(chance) || 0));
    const roll = Math.ceil(Math.random() * 100);
    const rollStr = `${roll} vs ${pct}%`;

    if (roll > pct) {
        return `<p><em>Feign Death: ${rollStr} — ${esc(actor.name)}'s feign fails! The enemies see through the ruse (${esc(sourceName)}).</em></p>`;
    }

    // Success: fall prone and wipe the feigner from EVERY actor's
    // aggro record. NPC updates are best-effort (non-GM clients
    // cannot write NPC actors); failures are silently skipped.
    const fid = String(actor.id);
    try {
        const allActors = [...(globalThis.game?.actors?.contents ?? [])];
        for (const a of allActors) {
            if (String(a?.id) === fid) continue;
            try { await clearAggro(a, fid); } catch (e) { /* non-fatal */ }
        }
    } catch (e) { /* non-fatal */ }

    try {
        await actor.update({
            "system.status.feigned": { source: sourceName },
            "system.status.prone": { rounds: FEIGN_PRONE_ROUNDS }
        });
    } catch (e) { /* non-fatal */ }

    return `<p><em>Feign Death: ${rollStr} — ${esc(actor.name)} falls to the ground, playing dead (${esc(sourceName)}).</em></p>`;
}

/**
 * Break an active feign because the actor took an action.
 * The prone marker is cleared immediately so the token visibly
 * stands back up.
 *
 * @param {Actor} actor - the actor acting
 * @param {string} reason - "attack" | "casting" | "action"
 * @returns {Promise<boolean>} true if a feign was broken
 */
export async function breakFeignDeath(actor, reason = "action") {
    if (!actor || !isFeigning(actor)) return false;
    try {
        await actor.update({
            "system.status.feigned": null,
            "system.status.prone": null
        });
    } catch (e) { /* non-fatal */ }
    try {
        await removeStatusEffect(actor, "prone");
    } catch (e) { /* non-fatal */ }
    const msg = `${esc(actor.name)} stands back up.`;
    try {
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Feign Death", `<p><em>${msg}</em></p>`)
        });
    } catch (e) {
        console.log(`EQRMSS | ${actor?.name} stands back up (${reason}).`);
    }
    return true;
}
