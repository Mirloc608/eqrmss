// ============================================================
// SHRINK (2026-10-08). EQ Shrink: reduces the target's physical
// size (height -34% on the Shrink clicky; Shaman Shrink 15,
// Beastlord Shrink 23, SK Tiny Companion 19, Shaman Tiny Terror 64).
//
// Primarily visual in EQ — the character becomes smaller, which
// helps in tight quarters. The token's Foundry scale is reduced
// while shrunk and restored on expiry.
//
// Stores system.status.shrink = { scale, scalePct, roundsLeft,
// source } for tick-based expiry (see tickConditions).
// ============================================================

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/** Default duration in rounds when the source has no duration. */
export const SHRINK_DEFAULT_ROUNDS = 270;

/** Default size reduction percent when the source has no amount. */
export const SHRINK_DEFAULT_PCT = 34;

/**
 * Convert a shrink percentage to a token scale factor.
 * 34% reduction -> 0.66 scale. Clamped to [0.1, 1].
 * @param {number} pct - percent reduction (sign-insensitive)
 * @returns {number} token scale factor
 */
export function shrinkScaleFor(pct) {
    const p = Math.abs(Number(pct) || 0);
    return Math.min(1, Math.max(0.1, 1 - p / 100));
}

/**
 * Apply Shrink to a target: reduces token scale and stores the
 * system.status.shrink tracker for tick expiry.
 * Re-applying refreshes (replaces) rather than stacking.
 * @param {Actor} target - the actor being shrunk
 * @param {object} opts
 * @param {number} opts.scalePct - percent height reduction (default 34)
 * @param {number} opts.rounds - duration in combat rounds (default 270)
 * @param {string} opts.sourceName - display name (spell/clicky name)
 * @returns {Promise<string>} HTML note for the chat card ("" if not applied)
 */
export async function applyShrink(target, { scalePct = SHRINK_DEFAULT_PCT, rounds = SHRINK_DEFAULT_ROUNDS, sourceName = "Shrink" } = {}) {
    if (!target) return "";
    const canTouch = target.isOwner || globalThis.game?.user?.isGM;
    if (!canTouch) return `<p><em>Shrink not applied — you don't control ${esc(target.name)}.</em></p>`;

    const r = Math.max(1, Math.round(Number(rounds) || SHRINK_DEFAULT_ROUNDS));
    const scale = shrinkScaleFor(scalePct);
    const pct = Math.abs(Number(scalePct) || SHRINK_DEFAULT_PCT);

    try {
        await target.update({
            "system.status.shrink": { scale, scalePct: pct, roundsLeft: r, source: String(sourceName ?? "Shrink") }
        });
    } catch (e) { /* non-fatal */ }

    // Visual: scale the active token(s) down. Restored on expiry.
    try {
        for (const tok of target.getActiveTokens?.() ?? []) {
            await tok.document.update({ "texture.scaleX": scale, "texture.scaleY": scale });
        }
    } catch (e) { /* non-fatal — status tracker is the mechanical record */ }

    return `<p><em>${esc(target.name)} shrinks to ${Math.round(scale * 100)}% of normal size for ${r} rounds (${esc(sourceName)}).</em></p>`;
}

/**
 * Remove Shrink: restores token scale to 1 and clears the
 * system.status.shrink tracker. Used on tick expiry.
 * @param {Actor} actor - the actor returning to normal size
 * @returns {Promise<boolean>} true if anything was removed
 */
export async function removeShrink(actor) {
    if (!actor) return false;
    let removed = false;
    try {
        for (const tok of actor.getActiveTokens?.() ?? []) {
            await tok.document.update({ "texture.scaleX": 1, "texture.scaleY": 1 });
        }
        removed = true;
    } catch (e) { /* ignore */ }
    try {
        if (actor.system?.status?.shrink) {
            await actor.update({ "system.status.shrink": null });
            removed = true;
        }
    } catch (e) { /* ignore */ }
    return removed;
}

/**
 * Check if an actor is currently shrunk.
 * @param {Actor} actor - the actor to check
 * @returns {boolean}
 */
export function isShrunk(actor) {
    return !!(actor?.system?.status?.shrink && typeof actor.system.status.shrink === "object");
}
