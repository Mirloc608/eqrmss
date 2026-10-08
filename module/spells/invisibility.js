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

import { hasStatusEffect, removeStatusEffect } from "./status-wiring.js";
import { combatCard } from "../combat/chat-card.js";
import { getItemEffect } from "../data/item-effects/item-effect-loader.js";
import { isWorn } from "../utils/equipment/equipment-utils.js";

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
/**
 * Break invisibility on offensive action (user ruling 2026-10-07).
 * Any offensive action — casting any spell, activating a clicky,
 * making a melee/missile attack — immediately fades invisibility.
 * Only the ACTOR taking the action is affected; targets keep theirs.
 * @param {Actor} actor - the actor taking the action
 * @param {string} reason - "casting" | "clicky" | "attack" (for logging)
 * @returns {Promise<boolean>} true if invisibility was broken
 */
export async function breakInvisibility(actor, reason = "action") {
    if (!actor) return false;
    if (!hasStatusEffect(actor, "invisible")) return false;
    const removed = await removeStatusEffect(actor, "invisible");
    if (removed) {
        const msg = `${esc(actor.name)}'s invisibility fades.`;
        try {
            ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: combatCard("Invisibility", `<p><em>${msg}</em></p>`)
            });
        } catch (e) {
            console.log(`EQRMSS | ${msg} (${reason})`);
        }
    }
    return removed;
}

/**
 * Get the invisibility type from a target's ActiveEffect.
 * Reads flags.eqrmss.invisType set by applyInvisibility().
 * @param {Actor} target
 * @returns {"general"|"undead"|"animals"}
 */
function invisTypeOfTarget(target) {
    try {
        for (const fx of target?.effects ?? []) {
            let isInvis = false;
            try {
                const st = fx.statuses;
                if (st && typeof st.has === "function") isInvis = st.has("invisible");
                else if (Array.isArray(st)) isInvis = st.includes("invisible");
                else if (typeof fx.getFlag === "function") isInvis = !!fx.getFlag("eqrmss", "invisType");
            } catch { /* ignore */ }
            if (!isInvis && fx?.name) {
                // Fallback: check flags directly
                try { isInvis = !!fx.getFlag?.("eqrmss", "invisType"); } catch { /* ignore */ }
            }
            if (isInvis) {
                const t = String(fx?.flags?.eqrmss?.invisType ?? "general").toLowerCase();
                if (t === "undead" || t === "animals") return t;
                return "general";
            }
        }
    } catch { /* ignore */ }
    return "general";
}

/**
 * Does the viewer have See Invisible active? Checks the timed
 * system.status.seeInvisible as well as worn items carrying a
 * vision modifier for see-invisible (worn effects are persistent
 * while equipped, so they are checked live rather than via status).
 * @param {Actor} viewer
 * @returns {boolean}
 */
export function hasSeeInvisible(viewer) {
    if (!viewer) return false;
    if (viewer.system?.status?.seeInvisible) return true;
    try {
        for (const item of viewer.items ?? []) {
            if (!isWorn(item)) continue;
            const eff = getItemEffect(item.system?.wornEffect);
            for (const p of eff?.payload ?? []) {
                if (String(p?.type ?? "").toLowerCase() !== "modifier") continue;
                if (String(p?.modifier ?? "").toLowerCase() !== "vision") continue;
                if (String(p?.value ?? "").toLowerCase().includes("see-invisible")) return true;
            }
        }
    } catch { /* ignore */ }
    return false;
}

/**
 * Can the viewer sense/see the target? (2026-10-07)
 *
 * User rulings:
 * - General invisibility does NOT fool undead or animals — they sense
 *   through it. Only other creature types are fooled.
 * - Invisibility to Undead fools only undead; everyone else senses.
 * - Invisibility to Animals fools only animals; everyone else senses.
 * - See Invisible (spell/clicky/worn) bypasses ALL invisibility types.
 *
 * @param {Actor} viewer - the actor trying to sense
 * @param {Actor} target - the actor being sensed
 * @returns {boolean} true if the viewer can sense the target
 */
export function canSenseTarget(viewer, target) {
    if (!target) return false;
    // Not invisible → always sensible
    if (!hasStatusEffect(target, "invisible")) return true;
    // See Invisible bypasses all invisibility types
    if (hasSeeInvisible(viewer)) return true;
    // Invisibility type rules
    const invisType = invisTypeOfTarget(target);
    const viewerType = String(
        viewer?.system?.details?.creatureType
        ?? viewer?.flags?.eqrmss?.creatureType
        ?? "sentient"
    ).toLowerCase();
    const isUndead = viewerType.includes("undead");
    const isAnimal = viewerType.includes("animal");
    if (invisType === "general") {
        // Undead and animals sense through general invisibility
        return isUndead || isAnimal;
    } else if (invisType === "undead") {
        // Only undead are fooled
        return !isUndead;
    } else if (invisType === "animals") {
        // Only animals are fooled
        return !isAnimal;
    }
    return false;
}
