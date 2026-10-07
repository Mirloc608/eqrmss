// ============================================================
// LEVITATE (2026-10-07). Wires EQ levitate spells to Foundry's
// `flying` status effect (custom icon — not in Foundry core).
//
// Levitate allows the bearer to pass through difficult or
// impossible terrain as if normal ground (user ruling 2026-10-07).
// The `flying` status provides the token marker; the movement
// rules integration is future work.
// ============================================================

import { applyStatusEffect } from "./status-wiring.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/**
 * Apply the `flying` status to a target via ActiveEffect.
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
    return `<p><em>${esc(target.name)} levitates for ${r} rounds (${esc(name)}).</em></p>`;
}
