/**
 * EQRMSS Worn-Effect Engine
 *
 * Armor, shields, and jewelry may carry worn effects (and, rarely, a
 * triggered effect alongside). A worn effect is passive while the item is
 * equipped. Regen payloads apply once per combat round (1 tick = 1 round =
 * 6 seconds); call applyWornRoundEffects(actor) from the combat round
 * engine's per-round step for each combatant.
 *
 * An item counts as worn per the shared isWorn rule (location
 * dropdown authoritative when set; equipped checkbox as fallback).
 */

import { getItemEffect } from "../data/item-effects/item-effect-loader.js";
import { applyEffectPayload } from "./damage-pipeline.js";
import { isWorn } from "../utils/equipment/equipment-utils.js";

/**
 * Apply one round of worn effects for an actor (regen ticks etc.).
 * @returns {Array} per-item results
 */
export async function applyWornRoundEffects(actor) {
    const worn = (actor?.items ?? []).filter(i => isWorn(i) && i.system?.wornEffect);
    // Resolve effects up front so non-stacking families can be deduplicated
    // before anything is applied.
    const resolved = worn.map(item => ({ item, effect: getItemEffect(item.system.wornEffect) }));
    // Group by family (effect.family ?? effect.id). Families flagged
    // stacking: "highest" keep only the highest-ranked entry (ties: first
    // found wins); every other family applies every worn instance as before.
    const suppressed = new Set();
    const groups = new Map();
    for (const r of resolved) {
        if (!r.effect || r.effect.kind !== "worn") continue;
        const key = r.effect.family ?? r.effect.id;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    for (const list of groups.values()) {
        if (list[0].effect.stacking !== "highest" || list.length < 2) continue;
        let best = list[0];
        for (const r of list) {
            if ((r.effect.rank ?? 0) > (best.effect.rank ?? 0)) best = r;
        }
        for (const r of list) if (r !== best) suppressed.add(r.item);
    }
    const out = [];
    for (const { item, effect } of resolved) {
        if (suppressed.has(item)) continue;
        if (!effect) { out.push({ item: item.name, applied: false, reason: "unknown-effect" }); continue; }
        if (effect.kind !== "worn") { out.push({ item: item.name, applied: false, reason: "not-a-worn-effect" }); continue; }
        const results = await applyEffectPayload({
            payload: effect.payload,
            caster: actor,
            target: actor,
            source: `worn:${effect.id}`
        });
        out.push({ item: item.name, effect: effect.id, applied: true, results });
    }
    return out;
}
