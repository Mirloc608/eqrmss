/**
 * EQRMSS Bow Composer (2026-10-15)
 * Combines wood + string + bow type + class + quality into final bow stats.
 *
 * User rulings:
 * - Wood determines durability
 * - Cam adds range; enables Recurve and Laminate
 * - Composite and Compound add to arrow range
 * - String adds to accuracy (+OB)
 * - Rough: string only (no laminate, cam, composite, compound)
 * - Higher-end woods cannot accept low-quality strings
 * - Diminished = failed Rough attempt (not a craftable tier)
 */

const WOODS = {};
const STRINGS = {};
const TYPES = {};
const CLASSES = {};

/**
 * Load all bow data. Call once at init.
 */
export async function loadBowData() {
    const base = "systems/eqrmss/module/data/fletching";
    const [wRes, sRes, tRes, cRes] = await Promise.all([
        fetch(`${base}/woods.json`),
        fetch(`${base}/bowstrings.json`),
        fetch(`${base}/bow-types.json`),
        fetch(`${base}/bow-classes.json`)
    ]);
    for (const w of await wRes.json()) WOODS[w.id] = w;
    for (const s of await sRes.json()) STRINGS[s.id] = s;
    for (const t of await tRes.json()) TYPES[t.id] = t;
    for (const c of await cRes.json()) CLASSES[c.id] = c;
    console.log(`EQRMSS | Bows loaded: ${Object.keys(WOODS).length} woods, ${Object.keys(STRINGS).length} strings, ${Object.keys(TYPES).length} types, ${Object.keys(CLASSES).length} classes`);
}

/** Get wood by id. */
export function getWood(id) { return WOODS[id] ?? null; }
/** Get string by id. */
export function getBowstring(id) { return STRINGS[id] ?? null; }
/** Get bow type by id. */
export function getBowType(id) { return TYPES[id] ?? null; }
/** Get bow class by id. */
export function getBowClass(id) { return CLASSES[id] ?? null; }
/** List all woods (for dropdowns). */
export function listWoods() { return Object.values(WOODS); }
/** List all strings (for dropdowns). */
export function listStrings() { return Object.values(STRINGS); }
/** List all types (for dropdowns). */
export function listTypes() { return Object.values(TYPES); }
/** List all classes (for dropdowns). */
export function listClasses() { return Object.values(CLASSES); }

/**
 * Check if a wood can accept a string (user ruling: higher-end woods
 * cannot accept low-quality strings). Wood tier N requires string tier >= N-1.
 */
export function woodAcceptsString(woodId, stringId) {
    const wood = WOODS[woodId];
    const str = STRINGS[stringId];
    if (!wood || !str) return false;
    return str.tier >= wood.tier - 1;
}

/**
 * Check if a class can make a bow type (user rulings on unlocks).
 */
export function classCanMakeType(classId, typeId) {
    const cls = CLASSES[classId];
    if (!cls) return false;
    return cls.unlocks.includes(typeId);
}

/**
 * Validate a bow combination. Returns { valid, reason }.
 */
export function validateBow(woodId, stringId, typeId, classId) {
    const wood = WOODS[woodId];
    const str = STRINGS[stringId];
    const type = TYPES[typeId];
    const cls = CLASSES[classId];
    if (!wood) return { valid: false, reason: `Unknown wood: ${woodId}` };
    if (!str) return { valid: false, reason: `Unknown string: ${stringId}` };
    if (!type) return { valid: false, reason: `Unknown bow type: ${typeId}` };
    if (!cls) return { valid: false, reason: `Unknown class: ${classId}` };
    if (!woodAcceptsString(woodId, stringId)) {
        return { valid: false, reason: `${wood.name} is too fine for ${str.name} string (needs tier ${wood.tier - 1}+).` };
    }
    if (!classCanMakeType(classId, typeId)) {
        return { valid: false, reason: `${cls.name} class cannot make a ${type.name} (requires ${TYPES[typeId]?.minClass ?? "higher"}).` };
    }
    return { valid: true, reason: null };
}

/**
 * Compose a bow from wood + string + type + class + quality.
 * @param {string} woodId
 * @param {string} stringId
 * @param {string} typeId
 * @param {string} classId
 * @param {string} quality e.g. "normal" (pristine/normal/worn/tarnished/broken)
 * @returns {object} Final bow stats
 */
export function composeBow(woodId, stringId, typeId, classId, quality = "normal") {
    const check = validateBow(woodId, stringId, typeId, classId);
    if (!check.valid) throw new Error(check.reason);

    const wood = WOODS[woodId];
    const str = STRINGS[stringId];
    const type = TYPES[typeId];
    const cls = CLASSES[classId];

    // Name: "Carved Darkwood One-Cam Bow (Silk)" (EQ-style)
    const name = `${cls.name} ${wood.name} ${type.name} (${str.name})`;

    // Durability from wood (user ruling)
    const durability = wood.durability;

    // Range from type (user ruling: cam adds range, composite/compound add arrow range)
    // Max range = most featured type
    const range = type.range;

    // Accuracy from string (user ruling: +OB)
    const obMod = str.obBonus;

    // Quality affects condition prefix (reuse weapon condition pattern)
    const qualityPrefix = quality !== "normal" ? quality.charAt(0).toUpperCase() + quality.slice(1) + " " : "";
    const fullName = qualityPrefix + name;

    return {
        name: fullName,
        baseName: name,
        woodId: wood.id,
        woodName: wood.name,
        woodTier: wood.tier,
        stringId: str.id,
        stringName: str.name,
        stringTier: str.tier,
        typeId: type.id,
        typeName: type.name,
        classId: cls.id,
        className: cls.name,
        durability,
        range,
        obMod,
        cams: type.cams,
        features: [...type.features],
        quality,
        // Missile weapon basics
        weaponType: "missile",
        skill: "Archery",
        description: `Crafted bow (${quality}). Durability ${durability}, Range ${range}, +${obMod} OB from ${str.name} string.`
    };
}

/**
 * Difficulty for fashioning a bow: class base + wood tier modifier.
 */
export function bowDifficulty(classId, woodId) {
    const cls = CLASSES[classId];
    const wood = WOODS[woodId];
    if (!cls) return 20;
    const woodMod = wood ? (wood.tier - 1) * 10 : 0;
    return cls.baseDifficulty + woodMod;
}
