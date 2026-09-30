/**
 * EQRMSS Proc Engine
 *
 * Weapons may carry ONE proc (never worn/triggered effects). The proc id is
 * stored on the item's system data (system.proc) and resolved through the
 * item-effect catalog at fire time, so catalog tuning updates existing items
 * without recomposing them.
 *
 * The engine is thin by design: trigger check + dispatch. All effect math
 * lives in the shared damage pipeline, so a proc resolves exactly as a
 * player-cast effect would.
 */

import { getItemEffect } from "../data/item-effects/item-effect-loader.js";
import { applyEffectPayload } from "./damage-pipeline.js";

export function getWeaponProcId(weapon) {
    return weapon?.system?.proc ?? null;
}

/**
 * Fire a weapon's proc if its trigger matches the combat event.
 * @param {object} args { wielder, weapon, target, event }
 *   event: the combat trigger that occurred, e.g. "onCrit"
 * @returns {object} { fired, proc?, results?, reason? }
 */
export async function fireWeaponProc({ wielder, weapon, target, event }) {
    const procId = getWeaponProcId(weapon);
    if (!procId) return { fired: false, reason: "no-proc" };

    const proc = getItemEffect(procId);
    if (!proc) return { fired: false, reason: "unknown-proc", procId };
    if (proc.kind !== "proc") return { fired: false, reason: "not-a-proc", procId };
    if (proc.trigger !== event) return { fired: false, reason: "trigger-mismatch", procId };

    const results = await applyEffectPayload({
        payload: proc.payload,
        caster: wielder,
        target,
        source: `proc:${proc.id}`
    });

    console.log(`EQRMSS | Proc fired: ${proc.name} (${wielder?.name ?? "?"}) -> ${target?.name ?? "?"}`, results);
    return { fired: true, proc, results };
}
