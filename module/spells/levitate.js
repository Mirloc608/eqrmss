// ============================================================
// LEVITATE (2026-10-07). Wires EQ levitate spells to Foundry's
// `flying` status effect (custom icon — not in Foundry core).
//
// Levitate allows the Bearer <redacted> pass through difficult or
// impossible terrain as if normal ground (user ruling 2026-10-07).
// The `flying` status provides the token marker; use isLevitating()
// to check for the difficult-terrain bypass in movement code.
// ============================================================

import { applyStatusEffect, hasStatusEffect, removeStatusEffect } from "./status-wiring.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/**
 * Apply the `flying` status to a target via ActiveEffect.
 * Also stores system.status.levitate = { roundsLeft, source } for
 * tick-based expiry with chat note (see tickConditions).
 * @param {Actor} target - the actor gaining levitation
 * @param {string} name - display name (spell name)
 * @param {number} rounds - duration in combat rounds
 * @returns {Promise<string>} HTML note for the chat card ("" if not applied)
 */
export async function applyLevitate(target, name, rounds = 200) {
    if (!target) return "";
    const canTouch = target.isOwner || globalThis.game?.user?.isGM;
    if (!canTouch) return `<p><em>Levitate not applied — you don't control ${esc(target.name)}.</em></p>`;

    const r = Math.max(1, Math.round(Number(rounds) || 200));
    const ok = await applyStatusEffect(
        target,
        "flying",
        `${name} (Levitate)`,
        r,
        "icons/svg/wing.svg",
        { source: "spell", category: "buff" }
    );
    if (!ok) return `<p><em>Levitate failed.</em></p>`;
    try {
        await target.update({
            "system.status.levitate": { roundsLeft: r, source: String(name ?? "Levitate") }
        });
    } catch (e) { /* non-fatal */ }
    return `<p><em>${esc(target.name)} levitates for ${r} rounds (${esc(name)}).</em></p>`;
}

/**
 * Check if an actor is currently levitating (has the `flying` status).
 * Movement code should call this to bypass difficult/impossible terrain:
 * levitating characters treat all terrain as normal ground.
 * @param {Actor} actor - the actor to check
 * @returns {boolean}
 */
export function isLevitating(actor) {
    return hasStatusEffect(actor, "flying");
}

/**
 * Remove levitation: clears the `flying` status and the
 * system.status.levitate tracker. Used on tick expiry.
 * @param {Actor} actor - the actor losing levitation
 * @returns {Promise<boolean>} true if anything was removed
 */
export async function removeLevitate(actor) {
    if (!actor) return false;
    let removed = false;
    try {
        if (await removeStatusEffect(actor, "flying")) removed = true;
    } catch (e) { /* ignore */ }
    try {
        if (actor.system?.status?.levitate) {
            await actor.update({ "system.status.levitate": null });
            removed = true;
        }
    } catch (e) { /* ignore */ }
    return removed;
}
