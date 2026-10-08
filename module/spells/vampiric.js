/**
 * Vampiric Embrace (2026-10-08): melee lifetap proc buff.
 *
 * EQ (Lucy Spell View, Live 12/03):
 *   Buff: "Add Proc: Vampiric Embrace" — Self, Beneficial, Alteration,
 *     30 mana. "Gives your attacks a vampiric property for 1.7 mins @L7
 *     to 7.5 mins @L65, allowing a chance to steal life from your target."
 *   Proc: "Decrease Hitpoints by 12" — Lifetap.
 * (Necromancer 7 / Shadowknight, plus the Vampiric Embrace clicky.)
 *
 * Stored at system.status.vampiric = { procChance, amount, percent,
 * roundsLeft, source }. On each successful melee hit the attacker rolls
 * d100 vs procChance; on success the target takes `amount` bonus magic
 * damage and the attacker heals `percent`% of it (lifetap).
 *
 * Duration is level-scaled per EQ: 17 rounds @L7 → 75 rounds @L65
 * (1.7 min → 7.5 min), linear: rounds = level + 10, clamped [17, 75].
 *
 * NOTE (2026-10-08): procChance is NOT in the source data — EQ only says
 * "a chance". The 15 default is a mechanical placeholder, flagged for EQ
 * canon review. amount (12) and the duration curve are real EQ data.
 * This module has zero imports (cycle-safe for combat-rolls.js).
 */

export const VAMPIRIC_DEFAULTS = { procChance: 15, amount: 12, percent: 100 };

/**
 * EQ duration curve: 17 rounds @L7 → 75 rounds @L65, linear.
 * @param {number} level caster level
 * @returns {number} rounds, clamped [17, 75]
 */
export function vampiricRoundsForLevel(level) {
    const lv = Math.max(1, Math.round(Number(level) || 1));
    return Math.min(75, Math.max(17, lv + 10));
}

/**
 * Apply (or refresh) Vampiric Embrace on the target. Re-casting refreshes
 * rather than stacking. Duration: explicit `rounds` (spell/clicky data)
 * acts as a cap over the EQ level-scaled curve when `casterLevel` is given.
 * @returns {string} chat note (plain text)
 */
export async function applyVampiric(target, { procChance, amount, percent, rounds, casterLevel, sourceName } = {}) {
    if (!target) return "Vampiric Embrace fizzles — no target.";
    const pc = Math.max(0, Math.min(100, Number(procChance) || VAMPIRIC_DEFAULTS.procChance));
    const amt = Math.max(1, Math.round(Number(amount) || VAMPIRIC_DEFAULTS.amount));
    const pctRaw = Number(percent);
    const pct = Math.max(0, Math.min(100, Number.isFinite(pctRaw) ? pctRaw : VAMPIRIC_DEFAULTS.percent));
    const explicit = Number(rounds);
    const rl = Number.isFinite(casterLevel) && casterLevel > 0
        ? Math.max(1, Math.round(Math.min(Number.isFinite(explicit) && explicit > 0 ? explicit : Infinity, vampiricRoundsForLevel(casterLevel))))
        : Math.max(1, Math.round(Number.isFinite(explicit) && explicit > 0 ? explicit : 75));
    const src = String(sourceName ?? "Vampiric Embrace");
    await target.update({
        "system.status.vampiric": { procChance: pc, amount: amt, percent: pct, roundsLeft: rl, source: src }
    });
    return `${target.name} gains Vampiric Embrace (${pc}% chance to drain ${amt} life for ${rl} rounds).`;
}

/**
 * Pure roll for the melee-hit proc. No actor access, no imports needed.
 * @param {object} status the system.status.vampiric object
 * @returns {object|null} { roll, damage, heal } on proc, null otherwise
 */
export function vampiricProcFor(status) {
    if (!status || typeof status !== "object") return null;
    const pc = Number(status.procChance) || 0;
    if (!(pc > 0)) return null;
    const roll = 1 + Math.floor(Math.random() * 100);
    if (roll > pc) return null;
    const damage = Math.max(1, Math.round(Number(status.amount) || VAMPIRIC_DEFAULTS.amount));
    const pct = Number(status.percent);
    const healPct = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : VAMPIRIC_DEFAULTS.percent;
    const heal = Math.max(1, Math.round(damage * healPct / 100));
    return { roll, damage, heal };
}

/** @returns {boolean} */
export function isVampiric(actor) {
    const v = actor?.system?.status?.vampiric;
    return !!(v && typeof v === "object" && (Number(v.roundsLeft) || 0) > 0);
}
