// ============================================================
// EQRMSS Armor Composer
// Location + Material + Condition -> finished armor piece
//
// The location is the base item (slot, base weight/cost, name nouns).
// The material carries the stats that make each piece what it is:
// AT, weight multiplier, maneuver modifier, cost multiplier.
// The condition modifies as before.
// ============================================================

let locations = {};
let materials = {};
let conditions = {};
let loaded = false;

export async function loadArmorData() {
    if (loaded) return;
    const lRes = await fetch("systems/eqrmss/module/data/armor/locations.json");
    if (!lRes.ok) throw new Error("Armor locations file missing");
    const lData = await lRes.json();
    for (const l of lData.locations) locations[l.id] = l;

    const mRes = await fetch("systems/eqrmss/module/data/armor/materials.json");
    if (!mRes.ok) throw new Error("Armor materials file missing");
    const mData = await mRes.json();
    for (const m of mData.materials) materials[m.id] = m;

    const cRes = await fetch("systems/eqrmss/module/data/armor/conditions.json");
    if (!cRes.ok) throw new Error("Armor conditions file missing");
    const cData = await cRes.json();
    for (const c of cData.conditions) conditions[c.id] = c;

    loaded = true;
    console.log(`EQRMSS | Armor loaded: ${Object.keys(locations).length} locations, ${Object.keys(materials).length} materials, ${Object.keys(conditions).length} conditions`);
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

export function composeArmor(locationId, materialId, conditionId) {
    const loc = locations[locationId];
    if (!loc) throw new Error(`Unknown armor location: ${locationId}`);
    const m = materials[materialId];
    if (!m) throw new Error(`Unknown armor material: ${materialId}`);
    const c = conditions[conditionId];
    if (!c) throw new Error(`Unknown armor condition: ${conditionId}`);

    // Name: "[Condition] [Material] [noun]" (e.g. "Worn Steel Breastplate")
    const noun = loc.names?.[materialId] ?? loc.name;
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
        materials: Object.values(materials).map(m => ({ id: m.id, name: m.name })),
        conditions: Object.values(conditions).map(c => ({ id: c.id, name: c.name }))
    };
}
