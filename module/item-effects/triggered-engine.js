/**
 * EQRMSS Triggered-Effect Engine ("clickies")
 *
 * Armor, shields, and jewelry may carry a triggered effect, fired by player
 * activation (item sheet button / macro). Like procs, the payload resolves
 * through the shared damage pipeline "as if cast", minus mana cost and cast
 * time (instant unless the catalog entry says otherwise).
 */

import { getItemEffect } from "../data/item-effects/item-effect-loader.js";
import { applyEffectPayload } from "./damage-pipeline.js";

/**
 * Fire an item's triggered effect.
 * @param {object} args { user, item, target }
 *   target defaults to the user (self-buff clickies like Grim Aura).
 * @returns {object} { fired, effect?, results?, reason? }
 */
export async function fireTriggeredEffect({ user, item, target }) {
    const effectId = item?.system?.triggeredEffect ?? null;
    if (!effectId) return { fired: false, reason: "no-triggered-effect" };

    const effect = getItemEffect(effectId);
    if (!effect) return { fired: false, reason: "unknown-effect", effectId };
    if (effect.kind !== "triggered") return { fired: false, reason: "not-a-triggered-effect", effectId };

    const results = await applyEffectPayload({
        payload: effect.payload,
        caster: user,
        target: target ?? user,
        source: `triggered:${effect.id}`
    });

    console.log(`EQRMSS | Triggered effect fired: ${effect.name} (${user?.name ?? "?"})`, results);
    return { fired: true, effect, results };
}
