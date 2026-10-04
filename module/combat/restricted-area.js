// ============================================================
// Arms Companion §4.12 RESTRICTED AREA COMBAT (RAC).
//
// Fighting without room to maneuver: height, width, and
// weapon-space restrictions each carry an OB penalty; all
// that apply are cumulative. Characters with the Restricted
// Area Combat skill offset the penalties with their bonus.
// The situation is declared per combatant (Combat tab), since
// two fighters in the same corridor may be restricted
// differently (weapon space depends on the weapon).
// ============================================================

export const RAC_HEIGHT = [
    { id: "", name: "Full clearance", mod: 0 },
    { id: "full", name: "Character's height", mod: -10 },
    { id: "h75", name: "75% of height", mod: -20 },
    { id: "h50", name: "50% of height", mod: -45 },
    { id: "h25", name: "25% of height", mod: -80 }
];

export const RAC_WIDTH = [
    { id: "", name: "Arm's length to wall", mod: 0 },
    { id: "w75", name: "75% arm's length", mod: -5 },
    { id: "w50", name: "50% arm's length", mod: -10 },
    { id: "w25", name: "25% arm's length", mod: -20 },
    { id: "pressed", name: "Arms pressed against side", mod: -45 }
];

export const RAC_WEAPON_SPACE = [
    { id: "", name: "Full swing room", mod: 0 },
    { id: "s75", name: "75% weapon space", mod: -10 },
    { id: "s50", name: "50% weapon space", mod: -20 },
    { id: "s25", name: "25% weapon space", mod: -45 },
    { id: "s0", name: "No space available", mod: -80 }
];

function tableMod(table, id) {
    return table.find(r => r.id === (id ?? ""))?.mod ?? 0;
}

function skillBonus(actor, slug) {
    const items = [...(actor?.items?.contents ?? actor?.items ?? [])];
    const skill = items.find(i => i?.type === "skill" && i.system?.slug === slug);
    return skill ? Math.max(0, Number(skill.system?.bonus) || 0) : 0;
}

/** Total restricted-area OB penalty for an attacker (never positive). */
export function restrictedAreaPenalty(actor) {
    const rac = actor?.system?.status?.restrictedArea ?? {};
    const sum = tableMod(RAC_HEIGHT, rac.height)
        + tableMod(RAC_WIDTH, rac.width)
        + tableMod(RAC_WEAPON_SPACE, rac.weaponSpace);
    if (sum >= 0) return 0;
    return Math.min(0, sum + skillBonus(actor, "restrictedAreaCombat"));
}
