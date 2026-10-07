/**
 * EQRMSS Item Effect Loader
 * Loads the item-effect catalog (procs, worn effects, triggered effects).
 * Item effects are SEPARATE from spells: a proc borrows no spell entry and
 * references no spell id. Each catalog entry owns its payload outright.
 *
 * Item types and their allowed effect kinds:
 *   weapon                -> proc only
 *   armor/shield/jewelry  -> worn and/or triggered (both allowed, rare), never proc
 * (Charms ride as jewelry items; no separate charm type exists.)
 */

const EFFECTS = {};

/**
 * Load the catalog. Call once at init.
 */
export async function loadItemEffectData() {
    const base = "systems/eqrmss/module/data/item-effects";
    const res = await fetch(`${base}/item-effects.json`);
    const data = await res.json();
    for (const e of data.effects ?? []) EFFECTS[e.id] = e;
    console.log(`EQRMSS | Item effects loaded: ${Object.keys(EFFECTS).length}`);
}

/**
 * Get one effect by id, e.g. "velium-shards".
 */
export function getItemEffect(id) {
    return EFFECTS[id] ?? null;
}

/**
 * Get all effects of one kind: "proc", "worn", or "triggered".
 */
export function getItemEffectsByKind(kind) {
    return Object.values(EFFECTS)
        .filter(e => e.kind === kind)
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
}


/**
 * Get all effects, for UI dropdowns.
 */
export function getItemEffectOptions() {
    return Object.values(EFFECTS);
}
