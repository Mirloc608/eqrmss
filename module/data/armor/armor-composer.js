// ============================================================
// EQRMSS Armor Composer
// Template + Material + Condition -> finished armor piece
// ============================================================

let templates = {};
let materials = {};
let conditions = {};
let loaded = false;

const TEMPLATE_FILES = ["light.json", "medium.json", "heavy.json", "helms.json"];

export async function loadArmorData() {
    if (loaded) return;
    for (const f of TEMPLATE_FILES) {
        const res = await fetch(`systems/eqrmss/module/data/armor/templates/${f}`);
        if (!res.ok) throw new Error(`Armor template file missing: ${f}`);
        const data = await res.json();
        for (const t of data.templates) templates[t.id] = t;
    }
    const mRes = await fetch("systems/eqrmss/module/data/armor/materials.json");
    if (!mRes.ok) throw new Error("Armor materials file missing");
    const mData = await mRes.json();
    for (const m of mData.materials) materials[m.id] = m;

    const cRes = await fetch("systems/eqrmss/module/data/armor/conditions.json");
    if (!cRes.ok) throw new Error("Armor conditions file missing");
    const cData = await cRes.json();
    for (const c of cData.conditions) conditions[c.id] = c;

    loaded = true;
    console.log(`EQRMSS | Armor loaded: ${Object.keys(templates).length} templates, ${Object.keys(materials).length} materials, ${Object.keys(conditions).length} conditions`);
}

export function composeArmor(templateId, materialId, conditionId) {
    const t = templates[templateId];
    if (!t) throw new Error(`Unknown armor template: ${templateId}`);
    const m = materials[materialId];
    if (!m) throw new Error(`Unknown armor material: ${materialId}`);
    const c = conditions[conditionId];
    if (!c) throw new Error(`Unknown armor condition: ${conditionId}`);

    const parts = [];
    if (c.prefix) parts.push(c.prefix);
    if (m.prefix) parts.push(m.prefix);
    parts.push(t.name);
    const name = parts.join(" ");

    const weight = Math.round(t.weight * (m.weightMult ?? 1) * (c.weightMult ?? 1) * 10) / 10;
    const armorType = t.armorType == null ? null : Math.max(1, t.armorType + (m.atMod ?? 0) + (c.atMod ?? 0));
    const maneuverPenalty = (t.maneuverPenalty ?? 0) + (m.maneuverMod ?? 0) + (c.maneuverMod ?? 0);

    return {
        name,
        templateId,
        materialId,
        conditionId,
        armorType,
        weight,
        maneuverPenalty,
        slot: t.slot,
        cost: t.cost ?? "",
        prodTime: t.prodTime ?? "",
        notes: t.notes ?? null
    };
}

export function getArmorOptions() {
    return {
        templates: Object.values(templates).map(t => ({ id: t.id, name: t.name })),
        materials: Object.values(materials).map(m => ({ id: m.id, name: m.name })),
        conditions: Object.values(conditions).map(c => ({ id: c.id, name: c.name }))
    };
}
