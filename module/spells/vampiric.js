/**
 * Vampiric Embrace (2026-10-08): melee lifetap proc buff.
 *
 * EQ: "Gives your attacks a vampiric property for 7.5 minutes, allowing a
 * chance to steal life from your target." (Necromancer 7 / Shadowknight,
 * plus the Vampiric Embrace clicky.)
 *
 * Stored at system.status.vampiric = { procChance, amount, percent,
 * roundsLeft, source }. On each successful melee hit the attacker rolls
 * d100 vs procChance; on success the target takes `amount` bonus magic
 * damage and the attacker heals `percent`% of it.
 *
 * NOTE (2026-10-08): procChance/amount/percent are NOT in the source data
 * (spell data only carries effect + duration). Defaults below are
 * mechanical placeholders, flagged for EQ canon review:
 *   procChance 15, amount 30, percent 100.
 * This module has zero imports (cycle-safe for combat-rolls.js).
 */

export const VAMPIRIC_DEFAULTS = { procChance: 15, amount: 30, percent: 100 };

/**
 * Apply (or refresh) Vampiric Embrace on the target. Re-casting refreshes
 * rather than stacking.
 * @returns {string} chat note (plain text)
 */
export async function applyVampiric(target, { procChance, amount, percent, rounds, sourceName } = {}) {
    if (!target) return "Vampiric Embrace fizzles — no target.";
    const pc = Math.max(0, Math.min(100, Number(procChance) || VAMPIRIC_DEFAULTS.procChance));
    const amt = Math.max(1, Math.round(Number(amount) || VAMPIRIC_DEFAULTS.amount));
    const pctRaw = Number(percent);
    const pct = Math.max(0, Math.min(100, Number.isFinite(pctRaw) ? pctRaw : VAMPIRIC_DEFAULTS.percent));
    const rl = Math.max(1, Math.round(Number(rounds) || 75));
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
