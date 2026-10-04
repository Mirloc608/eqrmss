// ============================================================
// Subduing Attacks — Arms Companion §4.9 Option 2 / §4.10
// "Causing Exhaustion in Melee" (printed p.28).
//
// An attacker who has declared Subdue (system.status.subduing,
// melee weapons only) resolves strikes as follows:
// - concussion hits are halved (floored);
// - every critical ALSO converts to Exhaustion Points by
//   severity: A 3, B 6, C 10, D 15, E 21; F and above stack
//   (book example: F = E + A = 24);
// - the critical's text effects still apply normally (user
//   ruling 2026-10-04 — conversion is in addition to, not
//   instead of, the crit text);
// - a target reduced to 0 Exhaustion Points cannot continue
//   fighting (system.status.exhausted; blocks offensive action
//   until the pool rises above 0 again);
// - each loss triggers the book's Resistance Roll vs SD
//   (adopted 2026-10-04): failure falls unconscious;
// - the victim's per-round exhaustion costs double while
//   they are being subdued (§4.10; see round costs below).
// ============================================================

import { isWorn } from "../utils/equipment/equipment-utils.js";

export const EXHAUSTION_POINTS_BY_SEVERITY = Object.freeze({
    A: 3,
    B: 6,
    C: 10,
    D: 15,
    E: 21,
    F: 24
});

/** Exhaustion Points a critical of this severity costs the target. */
export function subdueCritPoints(severity) {
    return EXHAUSTION_POINTS_BY_SEVERITY[severity] ?? 0;
}

/** Is this actor declaring subduing strikes with this weapon type? */
export function isSubduing(actor, weaponType, missileTypes) {
    if (actor?.system?.status?.subduing !== true) return false;
    return !(missileTypes?.has?.(weaponType) ?? false);
}

/**
 * Exhaustion maximum: 40 + (3 × CO bonus) — the same formula the
 * Status tab derives. The stored basic bonus wins; otherwise the
 * temp-stat heuristic the actor document uses.
 */
export function exhaustionMaxFor(actor) {
    const co = actor?.system?.stats?.CO;
    let coBonus = 0;
    if (co && typeof co === "object") {
        const stored = Number(co.basic_bonus ?? co.basicBonus ?? 0) || 0;
        if (stored !== 0) coBonus = stored;
        else if (co.temp != null) coBonus = Math.floor((Number(co.temp) - 50) / 5);
    }
    return 40 + 3 * coBonus;
}

/** Current exhaustion remaining (the pool starts full). */
export function exhaustionCurrent(actor) {
    const value = actor?.system?.exhaustion?.value;
    return value == null || !Number.isFinite(Number(value))
        ? exhaustionMaxFor(actor)
        : Number(value);
}

/** Exhausted = flagged and still at 0 (so GM-restored points unblock). */
export function isExhausted(actor) {
    return actor?.system?.status?.exhausted === true && exhaustionCurrent(actor) <= 0;
}

/**
 * Apply an exhaustion loss to the target. Returns
 * {before, after, exhausted} or null when there is nothing to do.
 * Never raises the pool; floors at 0 and flags the target.
 */
export async function applySubdueExhaustion(targetActor, points) {
    if (!targetActor || !(points > 0)) return null;
    const before = exhaustionCurrent(targetActor);
    const after = Math.max(0, before - points);
    const update = { "system.exhaustion.value": after };
    if (after <= 0) update["system.status.exhausted"] = true;
    await targetActor.update(update);
    return { before, after, exhausted: after <= 0 };
}

// ------------------------------------------------------------
// Resistance Roll vs SD (book option, adopted 2026-10-04)
// A character who loses Exhaustion Points in combat rolls to
// remain conscious whether or not points remain: d100 + SD
// bonus - points lost; 50+ stays conscious, failure falls
// unconscious. (Plain d100 per the book example.)
// ------------------------------------------------------------

/** SD (Self Discipline) bonus: stored basic bonus, else temp heuristic. */
export function sdBonusFor(actor) {
    const sd = actor?.system?.stats?.SD;
    if (!sd || typeof sd !== "object") return 0;
    const stored = Number(sd.basic_bonus ?? sd.basicBonus ?? 0) || 0;
    if (stored !== 0) return stored;
    if (sd.temp == null) return 0;
    return Math.floor((Number(sd.temp) - 50) / 5);
}

export async function rollExhaustionResistance(actor, pointsLost) {
    const sdBonus = sdBonusFor(actor);
    const r = await new Roll("1d100").evaluate();
    const total = r.total + sdBonus - (pointsLost || 0);
    return { roll: r.total, sdBonus, total, success: total >= 50 };
}

// ------------------------------------------------------------
// Per-round exhaustion costs — Character Law §7.2.3 Combat
// Exhaustion Chart (melee 1 pt per 2 rounds) plus the Arms
// Companion ARMOR AND EXHAUSTION rates (printed p.38):
// wearing armor costs its AT's EF per round, plus the worn
// helmet's EF; thicker armor multiplies the armor portion
// (ARMOR THICKNESS CHART EP Cost). While a combatant is being
// subdued (status.subdueDoubled, set by a landed subduing
// strike) all of their costs double (§4.10). Fractions accrue
// in system.exhaustion.fraction and deduct as whole points.
// Not modeled: pace/movement rates, missile/concentration
// rates, and the ChL modifier chart (wounds, terrain, heat).
// ------------------------------------------------------------

/** Armor EF (exhaustion points per round) by armor type, p.38. */
export const ARMOR_EF_BY_AT = Object.freeze({
    1: 1 / 20, 2: 1 / 8, 3: 1 / 15, 4: 1 / 20, 5: 1 / 15,
    6: 1 / 12, 7: 1 / 10, 8: 1 / 8, 9: 1 / 12, 10: 1 / 10,
    11: 1 / 8, 12: 1 / 7, 13: 1 / 10, 14: 1 / 8, 15: 1 / 4,
    16: 1 / 2, 17: 1 / 12, 18: 1 / 10, 19: 1 / 3, 20: 1 / 2
});

/** Parse an EF value ("1/8", 0.125, 2) into points per round. */
export function efValue(raw) {
    if (raw == null) return 0;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
    const m = String(raw).trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (m) return Number(m[1]) / Number(m[2]);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

/** Worn AT number from the derived armor type ("AT 19" -> 19). */
export function wornAtNumber(actor) {
    const raw = actor?.system?.combat?.armorType ?? actor?.system?.combat?.chartArmorType;
    const n = typeof raw === "number" ? raw : Number((String(raw ?? "").match(/\d+/))?.[0]);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Per-round exhaustion cost for this combatant (before the tick's fraction handling). */
export function roundExhaustionCost(actor) {
    const armorEf = ARMOR_EF_BY_AT[wornAtNumber(actor)] ?? 0;
    const items = actor?.items?.contents ?? actor?.items ?? [];
    const list = Array.isArray(items) ? items : [...items];
    let helmetEf = 0;
    let epMult = 1;
    for (const i of list) {
        if (i?.type !== "armor" || !isWorn(i)) continue;
        if (i.system?.armorLocation === "head") helmetEf += efValue(i.system?.ef);
        if (i.system?.armorLocation === "chest" && Number(i.system?.epCostMult) > 0) epMult = Number(i.system.epCostMult);
    }
    const armorCost = (armorEf + helmetEf) * epMult;
    let cost = 0.5 + armorCost; // melee: 1 pt per 2 rounds (ChL Combat Exhaustion Chart)
    if (actor?.system?.status?.subdueDoubled === true) cost *= 2; // §4.10 doubling
    return cost;
}
