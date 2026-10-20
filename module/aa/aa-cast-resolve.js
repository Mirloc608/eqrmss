// ============================================================
// AA "Cast: X" RESOLUTION (2026-10-20)
// Most AA rank effects are descriptive "Cast: <name>" strings.
// When that name resolves to a real spell in the catalog —
// exactly, or with the roman-numeral tier stripped — the AA
// casts that spell. The other ~1,400 AA cast names are AA-only
// variants with no spell data and stay unresolved here.
// ============================================================

const ROMAN_TIER = /\s+(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)$/;

/**
 * Find the catalog spell for an AA "Cast:" name.
 * Exact name first; then the base name (tier stripped), picking
 * the highest-level variant the actor qualifies for.
 * @returns the spell data object, or null when unresolved.
 */
export function resolveAACastSpell(castName, actorLevel = 999) {
    const byClass = globalThis.game?.eqrmss?.spells ?? {};
    const all = [];
    for (const list of Object.values(byClass)) {
        for (const s of list ?? []) if (s?.name) all.push(s);
    }
    if (!all.length) return null;

    let cands = all.filter(s => s.name === castName);
    if (!cands.length) {
        const base = String(castName).replace(ROMAN_TIER, "").trim();
        if (base && base !== castName) cands = all.filter(s => s.name === base);
    }
    if (!cands.length) return null;

    cands.sort((a, b) => (Number(b?.system?.level) || 0) - (Number(a?.system?.level) || 0));
    return cands.find(s => (Number(s?.system?.level) || 0) <= actorLevel) ?? cands[0];
}
