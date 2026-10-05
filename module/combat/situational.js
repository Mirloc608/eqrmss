// ============================================================
// Arms Companion §4.2 OPTIONAL OFFENSIVE BONUSES AND PENALTIES
// (printed p.25). Two halves:
//
// AUTOMATIC (from live state, no declaration needed):
// - Exhaustion tiers: based on remaining Exhaustion Points
//   ("at the beginning of the combat round" — read live at
//   attack time). Down to 50%: -10, 25%: -20, 10%: -40,
//   5%: -80, 1%: -160.
// - Bleeding: the attacker's own bleeding costs OB —
//   1-4 hits/round: -5, 5-7: -10, 8-10: -25, each additional
//   point per round -5 more. (The book doubles these for head,
//   heart or vital-artery wounds; no wound-location tracking
//   exists yet, so that clause is GM adjudication.)
//
// DECLARED (per attacker, system.status.situational, set on the
// Combat tab / NPC sheet):
// - Charging into combat by pace (1.5x +5 ... 5.0x +45)
// - Higher ground +5 / lower ground -5
// - Longer weapon +5 / shorter weapon -5
//   (Pole Arm > Two Handed > One Handed)
// - Advancing +5 / retreating -5 in melee — NOT cumulative
//   with charging (book note; charge wins)
// - Facing multiple opponents alone: -5 per opponent
// - Multiple attackers on one foe: +5 per ally
// - Opportunity Action Strike (held attack): +5
// - Unstable ground: -20; unbearable temperature: -35
// - Weapon Brawl / Melee Scuffle in the same round: -20
//
// "Foe Unbalanced or Disoriented" (+10) is a DEFENDER state:
// system.status.unbalanced (toggle on the foe's own sheet).
// ============================================================

import { exhaustionCurrent, exhaustionMaxFor } from "./subdue.js";

export const CHARGE_PACES = Object.freeze([
    { id: "", name: "No charge", mod: 0 },
    { id: "1.5", name: "Charging 1.5x pace (+5)", mod: 5 },
    { id: "2", name: "Charging 2.0x pace (+10)", mod: 10 },
    { id: "3", name: "Charging 3.0x pace (+20)", mod: 20 },
    { id: "4", name: "Charging 4.0x pace (+30)", mod: 30 },
    { id: "5", name: "Charging 5.0x pace (+45)", mod: 45 }
]);

/** Exhaustion OB penalty for a percentage of points remaining. */
export function exhaustionTierPenalty(percentRemaining) {
    const p = Number(percentRemaining);
    if (!Number.isFinite(p)) return 0;
    if (p <= 1) return -160;
    if (p <= 5) return -80;
    if (p <= 10) return -40;
    if (p <= 25) return -20;
    if (p <= 50) return -10;
    return 0;
}

/** Bleeding OB penalty for the attacker's own bleed rate (hits/round). */
export function bleedingObPenalty(ratePerRound) {
    const r = Math.floor(Number(ratePerRound) || 0);
    if (r <= 0) return 0;
    if (r <= 4) return -5;
    if (r <= 7) return -10;
    if (r <= 10) return -25;
    return -25 - 5 * (r - 10);
}

function count(value, min, max) {
    const n = Math.floor(Number(value) || 0);
    return Math.max(min, Math.min(max, n));
}

/**
 * Declared situational modifiers for an attacker (optionally vs a
 * specific target, for the foe-unbalanced clause).
 * Returns { total, parts: [{ label, value }] }.
 */
export function situationalOb(actor, targetActor = null) {
    const s = actor?.system?.status?.situational ?? {};
    const parts = [];
    const add = (label, value) => { if (value) parts.push({ label, value }); };

    const charge = CHARGE_PACES.find(c => c.id === String(s.charge ?? ""))?.mod ?? 0;
    add("charge", charge);

    const ground = { higher: 5, lower: -5 }[s.ground] ?? 0;
    add(s.ground === "higher" ? "higher ground" : "lower ground", ground);

    const length = { longer: 5, shorter: -5 }[s.weaponLength] ?? 0;
    add(s.weaponLength === "longer" ? "longer weapon" : "shorter weapon", length);

    // Book note: Advancing while in melee and Charging into Combat
    // are NOT cumulative — charging supersedes advancing/retreating.
    if (!charge) {
        const move = { advancing: 5, retreating: -5 }[s.advance] ?? 0;
        add(s.advance === "advancing" ? "advancing" : "retreating", move);
    }

    const foes = count(s.foesAlone, 0, 8);
    if (foes >= 2) add(`outnumbered ${foes} foes`, -5 * foes);

    const allies = count(s.alliesOnFoe, 0, 8);
    if (allies >= 1) add(`allies on foe x${allies}`, 5 * allies);

    if (s.opportunity === true) add("opportunity strike", 5);
    if (targetActor?.system?.status?.unbalanced === true) add("foe unbalanced", 10);
    if (s.unstableGround === true) add("unstable ground", -20);
    if (s.temperature === true) add("unbearable temperature", -35);
    if (s.brawlScuffle === true) add("brawl/scuffle", -20);

    return { total: parts.reduce((sum, p) => sum + p.value, 0), parts };
}

/** Automatic situational modifiers (exhaustion + bleeding) for an attacker. */
export function situationalAutoOb(actor) {
    const parts = [];
    const max = exhaustionMaxFor(actor);
    const pct = max > 0 ? Math.floor((100 * exhaustionCurrent(actor)) / max) : 100;
    const ex = exhaustionTierPenalty(pct);
    if (ex) parts.push({ label: `exhaustion ${pct}%`, value: ex });
    const rate = Math.floor(Number(actor?.system?.status?.bleed?.perRound) || 0);
    const bl = bleedingObPenalty(rate);
    if (bl) parts.push({ label: `bleeding ${rate}/round`, value: bl });
    return { total: parts.reduce((sum, p) => sum + p.value, 0), parts };
}

/** Compact annotation for the attack card's OB line: "(+20 charge, -10 bleeding 6/round)". */
export function situationalNote(parts) {
    if (!parts?.length) return "";
    const inner = parts.map(p => `${p.value >= 0 ? "+" : ""}${p.value} ${p.label}`).join(", ");
    return ` (${inner})`;
}
