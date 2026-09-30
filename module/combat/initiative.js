// ============================================================
// EQRMSS Combat Initiative — pure resolver (RMSS §6.1,
// Initiative Determination Table 8.2.8).
//
// Initiative is NOT a die roll: each combatant totals initiative
// points from the table; the largest total swings first, then the
// second largest, and so on. After all combatants that have melee
// attacks have made one attack, those capable of a second melee
// attack (two weapons, or hasted) total again for their second
// attacks — same table — and those resolve in the same order.
//
// computeInitiative(input) → { total, breakdown: [{label, mod}] }
// ============================================================

/**
 * @param {object} input
 * @param {number} input.quickness      Quickness stat, 1–100 base
 * @param {number} [input.strength]     Strength stat (for the stronger-combatant check)
 * @param {boolean} [input.weaponReady] +30 weapon ready
 * @param {number} [input.hands]       1 or 2; two-handed weapon −10
 * @param {boolean} [input.isPolearm]   pole arm: +40 1st round / −20 later rounds
 * @param {number} [input.round]        combat round (1 = first)
 * @param {number|null} [input.weaponLength]  for the longer-weapon check
 * @param {boolean} [input.twoWeapon]   −5 two-weapon combination
 * @param {boolean} [input.shield]      −10 shield
 * @param {boolean} [input.surprised]   −40
 * @param {boolean} [input.encumbered]  −40
 * @param {boolean} [input.woundedOverHalf]  −40 (concussion hits over 50%)
 * @param {number} [input.movementPct]  −N, subtraction equal to % of movement expended
 * @param {boolean} [input.charging]
 * @param {object|null} [input.opponent]  { strength, weaponLength, charging }
 *        — the engaged opponent, for the pairwise stronger-combatant
 *        and longer-weapon checks. When absent those checks are skipped.
 */
export function computeInitiative(input = {}) {
    const {
        quickness = 50,
        strength = 50,
        weaponReady = false,
        hands = 1,
        isPolearm = false,
        round = 1,
        weaponLength = null,
        twoWeapon = false,
        shield = false,
        surprised = false,
        encumbered = false,
        woundedOverHalf = false,
        movementPct = 0,
        charging = false,
        opponent = null
    } = input;

    const breakdown = [];
    const add = (label, mod) => { if (mod) breakdown.push({ label, mod }); };

    // Quickness stat is the base every combatant totals from — always shown.
    breakdown.push({ label: `Quickness ${quickness}`, mod: Number(quickness) || 0 });

    // +10 Strength — applies to the stronger combatant of the pairing.
    if (opponent && Number(strength) > Number(opponent.strength)) {
        add("Stronger combatant", 10);
    }

    if (weaponReady) add("Weapon ready", 30);

    // Weapon class rows are exclusive: a pole arm uses the pole-arm row,
    // a two-handed weapon takes −10, anything else +0.
    if (isPolearm) {
        add(round === 1 ? "Pole arm, 1st round" : "Pole arm, later rounds", round === 1 ? 40 : -20);
    } else if (hands === 2) {
        add("Two-handed weapon", -10);
    }

    // Longer weapon — pairwise against the engaged opponent.
    const wl = weaponLength == null ? null : Number(weaponLength);
    const owl = opponent?.weaponLength == null ? null : Number(opponent.weaponLength);
    if (opponent && wl != null && owl != null && wl > owl) {
        const charge = charging || opponent.charging;
        add(`Longer weapon${charge ? " (charging)" : ""}`, charge ? 30 : 10);
    }

    if (twoWeapon) add("Two-weapon combination", -5);
    if (shield) add("Shield", -10);
    if (surprised) add("Surprised", -40);
    if (encumbered) add("Encumbered", -40);
    if (woundedOverHalf) add("Wounded over 50%", -40);

    const move = Math.max(0, Math.min(100, Number(movementPct) || 0));
    if (move > 0) add(`Moving (${move}% expended)`, -move);

    const total = breakdown.reduce((sum, b) => sum + b.mod, 0);
    return { total, breakdown };
}
