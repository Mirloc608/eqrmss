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

    const tgt = target ?? user;
    // Tick-regen clickies (the modulation rod line): a regen
    // payload with per-round pacing and a duration lands as a
    // timed regen entry instead of an instant burst.
    const timed = [];
    const instant = [];
    for (const e of effect.payload ?? []) {
        if (e?.type === "regen" && e?.per === "round" && Number(e?.duration) > 0) timed.push(e);
        else instant.push(e);
    }
    const results = await applyEffectPayload({
        payload: instant,
        caster: user,
        target: tgt,
        source: `triggered:${effect.id}`
    });
    for (const e of timed) {
        const amount = Number(e.amount ?? e.max ?? e.min) || 0;
        const rounds = Math.max(1, Math.ceil(Number(e.duration) / 6));
        if (!(amount > 0)) continue;
        const list = [...(Array.isArray(tgt.system?.status?.spellEffects) ? tgt.system.status.spellEffects : [])];
        list.push({
            kind: "regen", pool: e.pool ?? "mana", amount, roundsLeft: rounds,
            label: effect.name ?? item?.name ?? "item", source: `triggered:${effect.id}`
        });
        await tgt.update({ "system.status.spellEffects": list });
        results.push({
            type: "regen", pool: e.pool ?? "mana", final: 0,
            notes: [`timed: ${amount}/round for ${rounds} rounds`],
            source: `triggered:${effect.id}`
        });
    }

    console.log(`EQRMSS | Triggered effect fired: ${effect.name} (${user?.name ?? "?"})`, results);
    return { fired: true, effect, results };
}
