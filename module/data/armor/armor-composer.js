// ============================================================
// EQRMSS Armor Composer
// Location + Category + Material + Condition -> finished armor piece
//
// The location is the base item (slot, base weight/cost, name nouns).
// The category is the armor class (cloth, leather, chain, plate) and
// gates which materials are valid: cloth takes cloth, leather takes
// leather, chain and plate take metals. No adamantine cloth shirts.
// The material carries the stats that make each piece what it is:
// AT, weight multiplier, maneuver modifier, cost multiplier.
// The condition modifies as before.
// ============================================================

let locations = {};
let categories = {};
let materials = {};
let conditions = {};
let loaded = false;

export async function loadArmorData() {
    if (loaded) return;
    const lRes = await fetch("systems/eqrmss/module/data/armor/locations.json");
    if (!lRes.ok) throw new Error("Armor locations file missing");
    const lData = await lRes.json();
    for (const l of lData.locations) locations[l.id] = l;

    const gRes = await fetch("systems/eqrmss/module/data/armor/categories.json");
    if (!gRes.ok) throw new Error("Armor categories file missing");
    const gData = await gRes.json();
    for (const g of gData.categories) categories[g.id] = g;

    const mRes = await fetch("systems/eqrmss/module/data/armor/materials.json");
    if (!mRes.ok) throw new Error("Armor materials file missing");
    const mData = await mRes.json();
    for (const m of mData.materials) materials[m.id] = m;

    const cRes = await fetch("systems/eqrmss/module/data/armor/conditions.json");
    if (!cRes.ok) throw new Error("Armor conditions file missing");
    const cData = await cRes.json();
    for (const c of cData.conditions) conditions[c.id] = c;

    loaded = true;
    console.log(`EQRMSS | Armor loaded: ${Object.keys(locations).length} locations, ${Object.keys(categories).length} categories, ${Object.keys(materials).length} materials, ${Object.keys(conditions).length} conditions`);
}

// --- Coin helpers: costs are strings like "15bp" or "1sp" (1sp = 10bp, 1gp = 10sp) ---
function parseCostToBp(str) {
    const m = /^\s*([\d.]+)\s*(bp|sp|gp|cp|pp)?\s*$/i.exec(str ?? "");
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = (m[2] ?? "bp").toLowerCase();
    if (unit === "sp") return n * 10;
    if (unit === "gp") return n * 100;
    if (unit === "pp") return n * 1000;
    return n; // bp (and cp treated as bp)
}

function formatBp(bp) {
    bp = Math.round(bp);
    if (bp >= 100 && bp % 100 === 0) return `${bp / 100}gp`;
    if (bp >= 10 && bp % 10 === 0) return `${bp / 10}sp`;
    return `${bp}bp`;
}

export function composeArmor(locationId, categoryId, materialId, conditionId) {
    const loc = locations[locationId];
    if (!loc) throw new Error(`Unknown armor location: ${locationId}`);
    const cat = categories[categoryId];
    if (!cat) throw new Error(`Unknown armor category: ${categoryId}`);
    const m = materials[materialId];
    if (!m) throw new Error(`Unknown armor material: ${materialId}`);
    if (!(m.categories ?? []).includes(categoryId))
        throw new Error(`${m.name} cannot be used for ${cat.name} armor`);
    const c = conditions[conditionId];
    if (!c) throw new Error(`Unknown armor condition: ${conditionId}`);

    // Name: "[Condition] [Material] [noun]" (e.g. "Worn Steel Breastplate").
    // The noun is per-material when the location defines one, else the
    // category default for the location, else the location's plain name.
    const noun = loc.names?.[materialId] ?? categories[categoryId]?.nouns?.[locationId] ?? loc.name;
    const parts = [];
    if (c.prefix) parts.push(c.prefix);
    if (m.prefix) parts.push(m.prefix);
    parts.push(noun);
    const name = parts.join(" ");

    // AT comes from the material; weight scales the location's base weight;
    // maneuver and cost combine location base with material/condition mods.
    const weight = Math.round(loc.baseWeight * (m.weightMult ?? 1) * (c.weightMult ?? 1) * 10) / 10;
    const armorType = Math.max(1, (m.baseAT ?? 1) + (c.atMod ?? 0));
    const maneuverPenalty = (loc.baseManeuver ?? 0) + (m.maneuverMod ?? 0) + (c.maneuverMod ?? 0);
    const cost = formatBp(parseCostToBp(loc.baseCost) * (m.costMult ?? 1));

    return {
        name,
        locationId,
        categoryId,
        materialId,
        conditionId,
        armorType,
        weight,
        maneuverPenalty,
        slot: loc.slot,
        cost,
        prodTime: loc.baseProdTime ?? "",
        notes: loc.notes ?? null
    };
}

export function getArmorOptions() {
    return {
        locations: Object.values(locations).map(l => ({ id: l.id, name: l.name })),
        categories: Object.values(categories).map(g => ({ id: g.id, name: g.name })),
        materials: Object.values(materials).map(m => ({ id: m.id, name: m.name, categories: m.categories ?? [] })),
        conditions: Object.values(conditions).map(c => ({ id: c.id, name: c.name }))
    };
}

export function getMaterialsForCategory(categoryId) {
    return Object.values(materials)
        .filter(m => (m.categories ?? []).includes(categoryId))
        .map(m => ({ id: m.id, name: m.name, categories: m.categories ?? [] }));
}
