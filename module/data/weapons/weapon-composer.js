import { parsePriceToTp } from "../../utils/price.js";

/**
 * EQRMSS Weapon Composer
 * Combines a base weapon template + material + condition into final item stats.
 * Example: Longsword (template) + Iron (material) + Rusty (condition)
 *        = "Rusty Iron Longsword"
 */

const TEMPLATES = {};
const MATERIALS = {};
const CONDITIONS = {};

/**
 * Load all weapon data. Call once at init.
 */
export async function loadWeaponData() {
    const base = "systems/eqrmss/module/data/weapons";

    // Templates (one file per weapon category)
    const categories = [
        "one-handed-edged",
        "one-handed-crushing",
        "missile",
        "two-handed",
        "polearm",
        "thrown",
        "natural",
        "hand-to-hand"
    ];
    for (const cat of categories) {
        const res = await fetch(`${base}/templates/${cat}.json`);
        const list = await res.json();
        for (const t of list) TEMPLATES[t.id] = t;
    }

    // Materials
    const mRes = await fetch(`${base}/materials.json`);
    const mData = await mRes.json();
    for (const m of mData.materials) MATERIALS[m.id] = m;

    // Conditions
    const cRes = await fetch(`${base}/conditions.json`);
    const cData = await cRes.json();
    for (const c of cData.conditions) CONDITIONS[c.id] = c;

    console.log(`EQRMSS | Weapons loaded: ${Object.keys(TEMPLATES).length} templates, ${Object.keys(MATERIALS).length} materials, ${Object.keys(CONDITIONS).length} conditions`);
}

/**
 * Damage types an Infused weapon can carry (user ruling 2026-10-23:
 * "Infused" grants the weapon a natural damage type — nothing else).
 * The vocabulary is the system's element set (spell data elements and
 * BOLT_BY_ELEMENT in module/spells/spell-mapping.js): fire, cold,
 * electric, water, magic, arcane, poison, disease. An un-infused
 * weapon deals physical damage and carries damageType null.
 */
export const INFUSED_DAMAGE_TYPES = [
    "fire", "cold", "electric", "water", "magic", "arcane", "poison", "disease"
];

function normalizeDamageType(value) {
    const v = String(value ?? "").trim().toLowerCase();
    return INFUSED_DAMAGE_TYPES.includes(v) ? v : null;
}

/**
 * Compose a weapon from template + material + condition.
 * @param {string} templateId  e.g. "longsword"
 * @param {string} materialId  e.g. "iron" (default "steel")
 * @param {string} conditionId e.g. "rusty" (default "normal")
 * @param {string|null} infusedDamageType  Infused damage type (one of
 *        INFUSED_DAMAGE_TYPES) or null for an un-infused weapon. A
 *        template may also declare its own damageType; the compose-time
 *        value wins. Infusion changes ONLY the weapon's damage type:
 *        no OB bonus and no cost change (2026-10-23 ruling, superseding
 *        the 2026-10-14 +5 OB / 1.5x cost tier mechanics).
 * @returns {object} Final weapon stats
 */
export function composeWeapon(templateId, materialId = "steel", conditionId = "normal", infusedDamageType = null) {
    const template = TEMPLATES[templateId];
    const material = MATERIALS[materialId] ?? MATERIALS["steel"];
    const condition = CONDITIONS[conditionId] ?? CONDITIONS["normal"];

    if (!template) throw new Error(`Unknown weapon template: ${templateId}`);

    // Damage type: compose-time Infused type wins, else the template's
    // own declared damageType, else null (physical).
    const damageType = normalizeDamageType(infusedDamageType) ?? normalizeDamageType(template.damageType);

    // Name: "Rusty Iron Longsword" (skip baseline material/condition in name)
    // Infused weapons carry the "Infused" prefix (the property's name).
    const nameParts = [];
    if (damageType) nameParts.push("Infused");
    if (condition.id !== "normal") nameParts.push(condition.name);
    if (material.id !== "steel") nameParts.push(material.name);
    nameParts.push(template.name);

    // Weight: template × material multiplier (rounded to 0.1)
    const weight = Math.round(template.weight * material.weightMult * 10) / 10;

    // OB modifier: material + condition. (Infusion adds nothing —
    // see the 2026-10-23 ruling in the composeWeapon docstring.)
    const obMod = material.obMod + condition.obMod;

    // Damage modifier: material + condition
    const damageMod = material.damageMod + condition.damageMod;

    // Breakage: combine (higher = breaks more easily)
    // Template breakage is an array of doubles or "auto"
    let breakage = template.breakage;
    let breakageMod = material.breakageMod + condition.breakageMod;

    return {
        name: nameParts.join(" "),
        templateId,
        materialId: material.id,
        conditionId: condition.id,
        infused: damageType != null,
        damageType,
        attackTable: template.attackTable,
        weaponType: template.weaponType,
        typeCode: template.typeCode,
        cost: parsePriceToTp(template.cost),
        prodTime: template.prodTime,
        notes: template.notes ?? null,
        length: template.length,
        weight,
        fumble: template.fumble,
        breakage,
        breakageMod,
        strength: template.strength,
        criticalType: template.criticalType,
        obMod,
        damageMod,
        // H2H (2026-10-14, user ruling): magic weapon flag bypasses
        // "protected from non-magical attacks"; classes restricts to
        // Monk/Beastlord for hand-to-hand weapons.
        magicWeapon: template.magicWeapon ?? false,
        classes: template.classes ?? null,
        // Item-effect hook: materials may grant a proc (weapons only).
        // Stored as an id; resolved through the item-effect catalog at fire
        // time so catalog tuning updates existing items without recompose.
        proc: material.proc ?? null
    };
}

/**
 * Get all available templates, materials, conditions for UI dropdowns.
 */
/**
 * Display labels for the canonical weapon type slugs.
 * Stored values stay slugs; sheets show these labels.
 */
export const WEAPON_TYPE_LABELS = {
    "one-handed-edged": "1-H Edged",
    "one-handed-crushing": "1-H Crush",
    "two-handed": "2-H",
    "polearm": "Pole Arm",
    "missile": "Missile",
    "thrown": "Thrown",
    "natural": "Natural"
};

export function weaponTypeLabel(slug) {
    return WEAPON_TYPE_LABELS[slug] ?? slug ?? "";
}

export function getWeaponOptions() {
    return {
        templates: Object.values(TEMPLATES),
        materials: Object.values(MATERIALS),
        conditions: Object.values(CONDITIONS)
    };
}
