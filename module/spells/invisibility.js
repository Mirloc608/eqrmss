// ============================================================
// INVISIBILITY (2026-10-07). Wires EQ invisibility spells/clickies
// to Foundry's native `invisible` ActiveEffect status.
//
// Invisibility types (user ruling 2026-10-07):
// - "general": invisible to most, but undead AND animals can sense
// - "undead":   only undead cannot see/sense (Invisibility to Undead)
// - "animals":  only animals cannot see/sense (Invisibility to Animals)
//
// The Foundry `invisible` status provides the token marker and the
// "is invisible" flag. The EQ-specific sensing exceptions (undead /
// animals sensing through general invis) are future targeting logic;
// the type is stored in flags.eqrmss.invisType for that work.
// ============================================================

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/**
 * Determine the invisibility type from a spell effect object.
 * Spell data shapes:
 *   { type: "invisibility", vs: "undead" }        -> "undead"
 *   { type: "invisibility", vs: "animals" }       -> "animals"
 *   { type: "invisibility", effect: "unstable" }  -> "general"
 *   { type: "invisibility" }                      -> "general"
 */
export function invisTypeOf(effect) {
    const vs = String(effect?.vs ?? "").toLowerCase();
    if (vs.includes("undead")) return "undead";
    if (vs.includes("animal")) return "animals";
    return "general";
}

/**
 * Apply the Foundry `invisible` status to a target via ActiveEffect.
 * @param {Actor} target - the actor gaining invisibility
 * @param {string} name - display name (spell/clicky name)
 * @param {string} invisType - "general" | "undead" | "animals"
 * @param {number} rounds - duration in combat rounds
 * @returns {Promise<string>} HTML note for the chat card ("" if not applied)
 */
export async function applyInvisibility(target, name, invisType = "general", rounds = 200) {
    if (!target) return "";
    const canTouch = target.isOwner || globalThis.game?.user?.isGM;
    if (!canTouch) return `<p><em>Invisibility not applied — you don't control ${esc(target.name)}.</em></p>`;

    const r = Math.max(1, Math.round(Number(rounds) || 200));
    const typeLabel = invisType === "undead"
        ? " versus undead"
        : invisType === "animals"
            ? " versus animals"
            : "";

    try {
        await target.createEmbeddedDocuments("ActiveEffect", [{
            name: `${name}`,
            img: "icons/svg/invisible.svg",
            statuses: ["invisible"],
            duration: { rounds: r },
            flags: {
                eqrmss: {
                    category: "buff",
                    invisType,
                    source: "spell"
                }
            }
        }]);
    } catch (e) {
        return `<p><em>Invisibility failed: ${esc(e?.message ?? e)}.</em></p>`;
    }

    return `<p><em>${esc(target.name)}: invisible${typeLabel} for ${r} rounds (${esc(name)}).</em></p>`;
}