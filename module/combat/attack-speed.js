// ============================================================
// Arms Companion §4.11 ATTACK SPEED VARIANCES.
//
// Trade preparation time for OB: a hasty half-prep strike
// lands at 40% OB but comes twice a round; a fully wound-up
// strike (+1/2 prep) hits at 150% OB every other round.
// Does not apply to missile weapons. The cadence (attacks per
// round) is declared state — the GM tracks the count.
// ============================================================

export const ATTACK_SPEEDS = {
    half: { name: "Half prep (40% OB, 2/round)", pct: 40, cadence: "2 attacks per round" },
    threeQuarter: { name: "3/4 prep (65% OB)", pct: 65, cadence: "3 attacks every 2 rounds" },
    full: { name: "Full prep (100% OB)", pct: 100, cadence: "1 attack per round" },
    plusQuarter: { name: "Full + 1/4 (125% OB)", pct: 125, cadence: "2 attacks every 3 rounds" },
    plusHalf: { name: "Full + 1/2 (150% OB)", pct: 150, cadence: "1 attack every 2 rounds" }
};

export function actorAttackSpeed(actor) {
    const id = actor?.system?.status?.attackSpeed;
    return ATTACK_SPEEDS[id] ? { id, ...ATTACK_SPEEDS[id] } : null;
}

/** Speed-scaled OB: the percentage applies to the base OB. */
export function speedScaledOb(baseOb, pct) {
    return Math.round(baseOb * pct / 100);
}

/**
 * Haste-adjusted OB percentage (2026-10-07).
 * Haste adds half its value to the attack speed OB%.
 */
export function hasteAdjustedPct(basePct, hastePct) {
    const haste = Math.max(0, Number(hastePct) || 0);
    return basePct + (haste / 2);
}
