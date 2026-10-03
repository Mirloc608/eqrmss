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
let enhancements = {};
let qualities = {};
let thicknesses = {};
let helmets = {};
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

    // Arms Companion 5.1/6.23: enhanced armor and workmanship quality.
    const eRes = await fetch("systems/eqrmss/module/data/armor/enhancements.json");
    if (!eRes.ok) throw new Error("Armor enhancements file missing");
    const eData = await eRes.json();
    for (const e of eData.enhancements) enhancements[e.id] = e;
    for (const q of eData.qualities) qualities[q.id] = q;
    for (const t of (eData.thicknesses ?? [])) thicknesses[t.id] = t;

    // Named helmet presets (Character Law 118-124 + Arms Companion 5.4).
    const hRes = await fetch("systems/eqrmss/module/data/armor/helmets.json");
    if (!hRes.ok) throw new Error("Armor helmets file missing");
    const hData = await hRes.json();
    for (const h of hData.helmets) helmets[h.id] = h;

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

export function composeArmor(locationId, categoryId, materialId, conditionId, options = {}) {
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

    // Arms Companion 6.23 workmanship quality and 5.1 enhancement.
    // Enhancing armor affects DB only; the AT worn does not change.
    const qualityId = options.qualityId || "average";
    const q = qualities[qualityId];
    if (!q) throw new Error(`Unknown armor quality: ${qualityId}`);
    let enh = null;
    if (options.enhancementId) {
        enh = enhancements[options.enhancementId];
        if (!enh) throw new Error(`Unknown armor enhancement: ${options.enhancementId}`);
        if (!(enh.categories ?? []).includes(categoryId))
            throw new Error(`${enh.name} cannot be applied to ${cat.name} armor`);
        const baseAT = m.baseAT ?? 1;
        if (enh.minBaseAT != null && baseAT < enh.minBaseAT)
            throw new Error(`${enh.name} requires AT ${enh.minBaseAT}+ armor`);
        if (enh.maxBaseAT != null && baseAT > enh.maxBaseAT)
            throw new Error(`${enh.name} is already built into AT ${baseAT} armor`);
    }
    // Arms Companion 5.7: armor thickness — a DB modifier that
    // applies to all attacks; the AT worn does not change.
    const thicknessId = options.thicknessId || "standard";
    const thk = thicknesses[thicknessId];
    if (!thk) throw new Error(`Unknown armor thickness: ${thicknessId}`);
    const dbBonus = (q.dbBonus ?? 0) + (enh?.dbBonus ?? 0) + (thk?.dbBonus ?? 0);
    const enhWeightMult = enh
        ? (enh.weightMultByCategory?.[categoryId] ?? enh.weightMult ?? 1)
        : 1;

    // Name: "[Condition] [Quality] [Material] [noun]" (e.g. "Worn Steel
    // Breastplate"; quality is named only when not Average).
    // The noun is per-material when the location defines one, else the
    // category default for the location, else the location's plain name.
    const noun = loc.names?.[materialId] ?? categories[categoryId]?.nouns?.[locationId] ?? loc.name;
    const parts = [];
    if (c.prefix) parts.push(c.prefix);
    if (qualityId !== "average") parts.push(q.name);
    if (m.prefix) parts.push(m.prefix);
    if (enh) parts.push(enh.name);
    parts.push(noun);
    const thicknessSuffix = thk.short ? ` (${thk.short})` : "";
    const name = parts.join(" ") + thicknessSuffix;

    // AT comes from the material; weight scales the location's base weight;
    // maneuver and cost combine location base with material/condition mods.
    // Quality and enhancement scale cost (and enhancement scales weight).
    const weight = Math.round(loc.baseWeight * (m.weightMult ?? 1) * (c.weightMult ?? 1) * enhWeightMult * (thk?.weightMult ?? 1) * 10) / 10;
    const armorType = Math.max(1, (m.baseAT ?? 1) + (c.atMod ?? 0));
    const maneuverPenalty = (loc.baseManeuver ?? 0) + (m.maneuverMod ?? 0) + (c.maneuverMod ?? 0);
    const cost = formatBp(parseCostToBp(loc.baseCost) * (m.costMult ?? 1) * (enh?.costMult ?? 1) * (q.costMult ?? 1) * (thk?.costMult ?? 1));

    return {
        name,
        locationId,
        categoryId,
        materialId,
        conditionId,
        qualityId,
        enhancementId: enh?.id ?? null,
        thicknessId,
        thicknessSuffix,
        dbBonus,
        armorType,
        weight,
        maneuverPenalty,
        slot: loc.slot,
        cost,
        prodTime: loc.baseProdTime ?? "",
        notes: loc.notes ?? null,
        // Item-effect hooks: materials may grant worn/triggered effects
        // (armor never procs). Stored as ids; resolved at fire time.
        wornEffect: m.wornEffect ?? null,
        triggeredEffect: m.triggeredEffect ?? null
    };
}

export function getArmorOptions() {
    return {
        locations: Object.values(locations).map(l => ({ id: l.id, name: l.name })),
        categories: Object.values(categories).map(g => ({ id: g.id, name: g.name })),
        materials: Object.values(materials).map(m => ({ id: m.id, name: m.name, categories: m.categories ?? [] })),
        conditions: Object.values(conditions).map(c => ({ id: c.id, name: c.name })),
        qualities: Object.values(qualities).map(q => ({ id: q.id, name: q.name })),
        enhancements: Object.values(enhancements).map(e => ({ id: e.id, name: e.name, categories: e.categories ?? [] })),
        thicknesses: Object.values(thicknesses).map(t => ({ id: t.id, name: t.name })),
        helmets: Object.values(helmets).map(h => ({ id: h.id, name: h.name, source: h.source }))
    };
}

// Named helmet presets: a preset composes a head piece from its
// mapped category/material; book cost/weight/production time (when
// the source chart gives them) override the composer's computed
// values. The name is the preset's name, keeping condition prefix.
export function composeHelmet(presetId, conditionId = "normal", options = {}) {
    const preset = helmets[presetId];
    if (!preset) throw new Error(`Unknown helmet preset: ${presetId}`);
    const composed = composeArmor("head", preset.categoryId, preset.materialId, conditionId, options);
    const c = conditions[conditionId];
    composed.name = `${c?.prefix ? `${c.prefix} ` : ""}${preset.name}${composed.thicknessSuffix ?? ""}`;
    composed.presetId = preset.id;
    composed.source = preset.source;
    if (preset.cost != null) composed.cost = preset.cost;
    if (preset.weight != null) composed.weight = preset.weight;
    if (preset.prodTime != null) composed.prodTime = preset.prodTime;
    composed.notes = preset.notes ?? composed.notes;
    return composed;
}

/** Enhancements valid for a category (and, when given, a material's base AT). */
export function getEnhancementsFor(categoryId, materialId = null) {
    const baseAT = materialId ? (materials[materialId]?.baseAT ?? null) : null;
    return Object.values(enhancements)
        .filter(e => (e.categories ?? []).includes(categoryId))
        .filter(e => baseAT == null
            || ((e.minBaseAT == null || baseAT >= e.minBaseAT)
                && (e.maxBaseAT == null || baseAT <= e.maxBaseAT)))
        .map(e => ({ id: e.id, name: e.name, categories: e.categories ?? [] }));
}

export function getMaterialsForCategory(categoryId) {
    return Object.values(materials)
        .filter(m => (m.categories ?? []).includes(categoryId))
        .map(m => ({ id: m.id, name: m.name, categories: m.categories ?? [] }));
}
