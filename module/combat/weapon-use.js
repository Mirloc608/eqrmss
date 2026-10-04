// ============================================================
// Arms Companion §4.8 WEAPON USE.
//
// A weapon's weight as a percentage of the wielder's body
// weight determines OB penalties, an expanded fumble range,
// and an initiative penalty. Weapons normally wielded with
// two hands (two-handed, pole arms, missile weapons) use the
// 2-Hand column. The Weapon Usage skill offsets the OB
// penalty, but never below the chart's Min. Penalty.
// Initiative penalty is returned for display/GM use; the
// §6.1 initiative engine is unaffected.
// ============================================================

const ZERO = { ob1: 0, ob2: 0, min1: 0, min2: 0, fumble: 0, initiative: 0 };

// Upper bound of the band, then the row's values.
const BANDS = [
    { max: 15, ob1: -10, ob2: 0, min1: 0, min2: 0, fumble: 0, initiative: 0 },
    { max: 19, ob1: -20, ob2: -10, min1: -5, min2: 0, fumble: 0, initiative: -5 },
    { max: 24, ob1: -35, ob2: -15, min1: -10, min2: 0, fumble: 1, initiative: -15 },
    { max: 29, ob1: -50, ob2: -25, min1: -20, min2: -5, fumble: 2, initiative: -30 },
    { max: 39, ob1: -75, ob2: -40, min1: -30, min2: -10, fumble: 3, initiative: -40 },
    { max: 49, ob1: -100, ob2: -60, min1: -45, min2: -20, fumble: 5, initiative: -50 },
    { max: 75, ob1: -150, ob2: -80, min1: -60, min2: -30, fumble: 7, initiative: -75 }
];

export function weaponUseBand(pct) {
    const p = Number(pct);
    if (!Number.isFinite(p) || p < 10) return { ...ZERO };
    for (const band of BANDS) if (p <= band.max) return { ...band };
    // Each additional 5% beyond 75% (76-80 = first step, etc.).
    const steps = Math.ceil((p - 75) / 5);
    const base = BANDS[BANDS.length - 1];
    return {
        ob1: base.ob1 - 80 * steps,
        ob2: base.ob2 - 40 * steps,
        min1: base.min1 - 25 * steps,
        min2: base.min2 - 5 * steps,
        fumble: base.fumble + 2 * steps,
        initiative: base.initiative - 20 * steps
    };
}

const TWO_HANDED_TYPES = new Set(["two-handed", "polearm", "missile"]);

function skillBonusOf(actor, slug) {
    const items = [...(actor?.items?.contents ?? actor?.items ?? [])];
    const skill = items.find(i => i?.type === "skill" && i.system?.slug === slug);
    return skill ? Math.max(0, Number(skill.system?.bonus) || 0) : 0;
}

/**
 * @returns {{ob: number, fumbleBonus: number, initiativePenalty: number, pct: number|null}}
 */
export function weaponUsePenalty(actor, weaponItem) {
    const weaponWeight = Math.max(0, Number(weaponItem?.system?.weight) || 0);
    const bodyWeight = Number(actor?.system?.physical?.weight);
    if (!weaponWeight || !Number.isFinite(bodyWeight) || bodyWeight <= 0) {
        return { ob: 0, fumbleBonus: 0, initiativePenalty: 0, pct: null };
    }
    const pct = (weaponWeight / bodyWeight) * 100;
    const band = weaponUseBand(pct);
    const twoHanded = TWO_HANDED_TYPES.has(String(weaponItem?.system?.type ?? ""));
    const raw = twoHanded ? band.ob2 : band.ob1;
    const minPenalty = twoHanded ? band.min2 : band.min1;
    const skill = skillBonusOf(actor, "weaponUsage");
    // The skill offsets the penalty but never past the Min. Penalty.
    const ob = skill > 0 ? Math.min(minPenalty, raw + skill) : raw;
    return { ob, fumbleBonus: band.fumble, initiativePenalty: band.initiative, pct };
}
