// ============================================================
// EQRMSS Shield Composer
// Template + Material + Condition -> finished shield
// Shields grant DB (melee/missile), not AT.
// ============================================================

let templates = {};
let materials = {};
let conditions = {};
let loaded = false;

export async function loadShieldData() {
    if (loaded) return;
    const tRes = await fetch("systems/eqrmss/module/data/shields/templates.json");
    if (!tRes.ok) throw new Error("Shield templates file missing");
    const tData = await tRes.json();
    for (const t of tData.templates) templates[t.id] = t;

    const mRes = await fetch("systems/eqrmss/module/data/shields/materials.json");
    if (!mRes.ok) throw new Error("Shield materials file missing");
    const mData = await mRes.json();
    for (const m of mData.materials) materials[m.id] = m;

    const cRes = await fetch("systems/eqrmss/module/data/shields/conditions.json");
    if (!cRes.ok) throw new Error("Shield conditions file missing");
    const cData = await cRes.json();
    for (const c of cData.conditions) conditions[c.id] = c;

    loaded = true;
    console.log(`EQRMSS | Shields loaded: ${Object.keys(templates).length} templates, ${Object.keys(materials).length} materials, ${Object.keys(conditions).length} conditions`);
}

export function composeShield(templateId, materialId, conditionId) {
    const t = templates[templateId];
    if (!t) throw new Error(`Unknown shield template: ${templateId}`);
    const m = materials[materialId];
    if (!m) throw new Error(`Unknown shield material: ${materialId}`);
    const c = conditions[conditionId];
    if (!c) throw new Error(`Unknown shield condition: ${conditionId}`);

    const parts = [];
    if (c.prefix) parts.push(c.prefix);
    if (m.prefix) parts.push(m.prefix);
    parts.push(t.name);
    const name = parts.join(" ");

    const weight = Math.round(t.weight * (m.weightMult ?? 1) * (c.weightMult ?? 1) * 10) / 10;
    const meleeDB = Math.max(0, t.meleeDB + (c.dbMod ?? 0));
    const missileDB = Math.max(0, t.missileDB + (c.dbMod ?? 0));

    return {
        name,
        templateId,
        materialId,
        conditionId,
        meleeDB,
        missileDB,
        weight,
        cost: t.cost ?? "",
        prodTime: t.prodTime ?? "",
        notes: t.notes ?? null,
        // Item-effect hooks: materials may grant worn/triggered effects
        // (shields never proc). Stored as ids; resolved at fire time.
        wornEffect: m.wornEffect ?? null,
        triggeredEffect: m.triggeredEffect ?? null
    };
}

export function getShieldOptions() {
    return {
        templates: Object.values(templates).map(t => ({ id: t.id, name: t.name })),
        materials: Object.values(materials).map(m => ({ id: m.id, name: m.name })),
        conditions: Object.values(conditions).map(c => ({ id: c.id, name: c.name }))
    };
}
