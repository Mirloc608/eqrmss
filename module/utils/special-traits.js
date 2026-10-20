// ============================================================
// EQRMSS — NPC special-attack traits (2026-10-20)
//
// The NPC wizard grants step-3 picks as "feature" items whose
// flags.eqrmss.specialAttack holds the catalog id from
// module/data/creatures/special-attacks.json (e.g. "fear-immunity",
// "stun-immunity"). Engine gates consult these helpers so trait
// picks actually apply in play instead of being display-only.
//
// Works for world actors and unlinked token actors alike: both
// carry the actor's embedded items.
// ============================================================

/** The actor's granted special-attack feature item for a catalog
 *  id, or null when the actor does not hold that trait. */
export function specialTraitItem(actor, traitId) {
    if (!actor || !traitId) return null;
    for (const item of actor.items ?? []) {
        if (item?.type === "feature" && item?.flags?.eqrmss?.specialAttack === traitId) return item;
    }
    return null;
}

/** True when the actor holds the given special-attack trait. */
export function hasSpecialTrait(actor, traitId) {
    return !!specialTraitItem(actor, traitId);
}
