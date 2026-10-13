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

// ============================================================
// Effect pickers (item sheets)
//
// The worn catalog (247 entries across 28 families) and the triggered
// catalog (150 clickies) are too long for a single flat dropdown, so the
// item sheets render them as two linked selects:
//
//   worn:      [Family ▾] [Rank ▾]        e.g. [Affliction Haste] [Rank IV]
//   triggered: [Category ▾] [Effect ▾]    e.g. [Buff] [Jonathan's Whistling Warsong]
//
// The stored document value is unchanged (the effect id), so engines that
// read system.wornEffect / system.triggeredEffect are untouched.
// ============================================================

const ROMAN_TABLE = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

function toRoman(n) {
    if (!Number.isFinite(n) || n < 1) return String(n ?? "");
    let out = "";
    for (const [v, s] of ROMAN_TABLE) { while (n >= v) { out += s; n -= v; } }
    return out;
}

function titleCaseKey(key) {
    return String(key ?? "").split(/[-_\s]+/).filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Payload types whose title-cased form is wrong or unclear get an override;
// everything else falls back to titleCaseKey(type).
const TRIGGERED_CATEGORY_LABELS = {
    manaregen: "Mana Regen",
    damageshield: "Damage Shield",
    dot: "Damage over Time",
    hot: "Heal over Time",
    "see-invisible": "See Invisible",
    "summon-item": "Summon Item"
};

function triggeredCategoryLabel(type) {
    return TRIGGERED_CATEGORY_LABELS[type] ?? titleCaseKey(type);
}

function primaryPayloadType(effect) {
    const p = Array.isArray(effect?.payload) ? effect.payload[0] : effect?.payload;
    return p?.type ?? "other";
}

/**
 * Worn-effect picker data. Returns:
 *   { families: [{ id, label, selected, ranks: [{ id, label, selected }] }],
 *     selectedFamily, selectedRank }
 * `ranks` on the top level is the rank list for the selected family (or a
 * single "None" entry when no family is selected).
 */
export function getWornEffectPicker(selectedId) {
    const famMap = new Map();
    for (const e of getItemEffectsByKind("worn")) {
        const famId = e.family ?? e.id;
        if (!famMap.has(famId)) famMap.set(famId, { id: famId, label: titleCaseKey(famId), ranks: [] });
        famMap.get(famId).ranks.push({
            id: e.id,
            rank: e.rank ?? 0,
            label: `Rank ${toRoman(e.rank ?? 0)}`,
            selected: e.id === selectedId
        });
    }
    const families = [...famMap.values()]
        .map(f => ({ ...f, ranks: f.ranks.sort((a, b) => a.rank - b.rank) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    const sel = selectedId ? getItemEffect(selectedId) : null;
    const selFamily = sel?.family ?? "";
    const selectedFamily = families.some(f => f.id === selFamily) ? selFamily : "";
    for (const f of families) f.selected = (f.id === selectedFamily);
    const ranks = families.find(f => f.id === selectedFamily)?.ranks
        ?? [{ id: "", rank: 0, label: "None", selected: true }];
    return { families, selectedFamily, ranks, selectedRank: selectedId ?? "" };
}

/**
 * Triggered-effect picker data. Returns:
 *   { categories: [{ id, label, selected, effects: [{ id, name, selected }] }],
 *     selectedCategory, selectedEffect }
 * `effects` on the top level is the effect list for the selected category (or
 * a single "None" entry when no category is selected). Effects with several
 * payload types are filed under their first payload's type.
 */
export function getTriggeredEffectPicker(selectedId) {
    const catMap = new Map();
    for (const e of getItemEffectsByKind("triggered")) {
        const type = primaryPayloadType(e);
        if (!catMap.has(type)) catMap.set(type, { id: type, label: triggeredCategoryLabel(type), effects: [] });
        catMap.get(type).effects.push({ id: e.id, name: e.name ?? e.id, selected: e.id === selectedId });
    }
    const categories = [...catMap.values()].sort((a, b) => a.label.localeCompare(b.label));
    const sel = selectedId ? getItemEffect(selectedId) : null;
    const selType = sel ? primaryPayloadType(sel) : "";
    const selectedCategory = categories.some(c => c.id === selType) ? selType : "";
    for (const c of categories) c.selected = (c.id === selectedCategory);
    const effects = categories.find(c => c.id === selectedCategory)?.effects
        ?? [{ id: "", name: "None", selected: true }];
    return { categories, selectedCategory, effects, selectedEffect: selectedId ?? "" };
}
