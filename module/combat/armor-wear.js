// ============================================================
// Arms Companion §5.9 MAINTENANCE AND BREAKAGE (armor wear).
//
// Every critical strike also damages the armor it lands on:
// the amount depends on the crit's family and severity
// (A Slash +0.25 ... E Puncture +2.5). The accumulated wear
// lets further strikes of the same family leak extra hits
// through the weakened armor (wear rounded down). A hit that
// yields no critical does no armor damage. Wear accrues on the
// worn chest piece (or the best worn piece) until repaired.
// ============================================================

import { isWorn } from "../utils/equipment/equipment-utils.js";

// Crit type codes (attack-resolver) to wear family, with the
// book's critical reductions for the other crit kinds:
// Grappling/Unbalancing count as Crush (-4), Tiny as Slash (-2).
const WEAR_BY_TYPE = {
    S: { family: "slash", shift: 0 },
    T: { family: "slash", shift: -2 },
    K: { family: "crush", shift: 0 },
    G: { family: "crush", shift: -4 },
    U: { family: "crush", shift: -4 },
    P: { family: "puncture", shift: 0 }
};

const SEVERITY_INDEX = { A: 0, B: 1, C: 2, D: 3, E: 4 };
// Type of Hit chart (rows are crit family, columns A-E).
const WEAR_AMOUNTS = {
    slash: [0.25, 0.5, 0.75, 1, 1.5],
    crush: [0.5, 0.75, 1, 1.5, 2],
    puncture: [0.75, 1, 1.5, 2, 2.5]
};

export const ARMOR_WEAR_FAMILY_LABEL = { slash: "Slash", crush: "Crush", puncture: "Puncture" };

/**
 * Wear done by one critical: { family, amount } or null when the
 * crit kind does no armor damage (Cold/Stun/Shock and friends).
 */
export function armorWearEffect(typeCode, severity) {
    const kind = WEAR_BY_TYPE[String(typeCode ?? "").toUpperCase()];
    if (!kind) return null;
    const idx = SEVERITY_INDEX[String(severity ?? "").toUpperCase()];
    if (idx == null) return null;
    const effective = idx + kind.shift;
    if (effective < 0) return null;
    return { family: kind.family, amount: WEAR_AMOUNTS[kind.family][effective] };
}

/** The worn piece that carries the suit's wear: chest first, else best AT. */
export function armorWearPiece(targetActor) {
    const items = [...(targetActor?.items?.contents ?? targetActor?.items ?? [])];
    const worn = items.filter(i => i?.type === "armor" && isWorn(i));
    if (!worn.length) return null;
    const chest = worn.find(i => i.system?.armorLocation === "chest");
    if (chest) return chest;
    return worn.reduce((best, i) => ((Number(i.system?.at) || 0) > (Number(best?.system?.at) || 0) ? i : best), null);
}

/**
 * Record one critical against the target's armor. Returns
 * { family, leaked, wear, piece } or null when no wear accrued.
 * `leaked` is the extra hits this strike gains from prior wear.
 */
export async function applyArmorWear(targetActor, typeCode, severity) {
    const effect = armorWearEffect(typeCode, severity);
    if (!effect) return null;
    const piece = armorWearPiece(targetActor);
    if (!piece) return null;
    const pool = piece.system?.armorWear ?? {};
    const prior = Number(pool[effect.family]) || 0;
    const leaked = Math.floor(prior);
    const wear = Math.round((prior + effect.amount) * 100) / 100;
    await piece.update({ [`system.armorWear.${effect.family}`]: wear });
    return { family: effect.family, leaked, wear, piece };
}