// ============================================================
// EQRMSS Gear Evolution — engine (Stage 2, T1->T2)
//
// Crescent Reach redesign (2026-10-27): ARMOR combines burn
// stackable catalyst materials (see validateCatalystCombine);
// weapons still eat weapons (see validateCombine). The original
// model, below, survives for weapons:
//
// A worn piece is never replaced: it is REFORGED by eating other
// pieces. The vessel keeps its identity, history, baked effects and
// socketed augments; the consumed piece templates any transition.
// Within a form, each combine adds one minor augment slot; slots
// follow the ternary digits of the in-form combine count (three of
// a tier fuse into one of the next, cascading). Socketed augments
// whose slots fuse away — and all socketed augments at a form
// transition — BAKE IN as permanent bonuses. Forms are capped:
// form N can be combined N times. Sockets reset at transitions.
//
// Line data: module/data/gear/evolution-lines.json (authored).
// State lives on the item document at system.evolution:
//   { line, form, set, combines, bakedDb, bakedOb, bakedHp,
//     bakedMana, bakedStats, bakedResists,
//     augments: [{tier, appliesTo, db, ob, hp, mana, stats,
//                 resistances, name}] }
// Augment payloads beyond db/ob arrived with the S2 augment wave
// (user ruling 2026-10-28): hp/mana/stat/resist augments socket and
// bake exactly like db/ob, and EquipmentStateEngine adds a worn
// piece's evolution bonuses to its profile.
// ============================================================

export const TIER_NAMES = ["minor", "moderate", "major", "epic", "artifact"];
export const TIER_VALUES = { minor: 1, moderate: 3, major: 9, epic: 27, artifact: 81 };

// Class slug (starter-kits / wizard) -> EQ class abbreviation used in
// catalog `classes` strings.
export const CLASS_ABBREV = {
    warrior: "WAR", cleric: "CLR", paladin: "PAL", ranger: "RNG",
    shadowknight: "SHD", druid: "DRU", monk: "MNK", bard: "BRD",
    rogue: "ROG", shaman: "SHM", necromancer: "NEC", wizard: "WIZ",
    magician: "MAG", enchanter: "ENC", beastlord: "BST", berserker: "BER"
};

let _linesPromise = null;

/** Load (once) and return the evolution line data. */
export async function loadEvolutionLines() {
    if (!_linesPromise) {
        _linesPromise = (async () => {
            const r = await fetch("systems/eqrmss/module/data/gear/evolution-lines.json");
            if (!r.ok) throw new Error(`evolution-lines.json: HTTP ${r.status}`);
            return r.json();
        })();
    }
    return _linesPromise;
}

/** Synchronous access after loadEvolutionLines() has resolved. */
let _linesCache = null;
export function cacheEvolutionLines(lines) { _linesCache = lines; }
export function evolutionLinesSync() { return _linesCache; }

// ------------------------------------------------------------
// Socket arithmetic (pure)
// ------------------------------------------------------------

/**
 * Socket layout for an in-form combine count: the count written in
 * base 3, each digit position contributing that many slots of its
 * tier (units = minor, 3s = moderate, 9s = major, ...). Ascending.
 */
export function socketLayout(count) {
    const out = [];
    let n = Math.max(0, Math.floor(Number(count) || 0));
    let tier = 0;
    while (n > 0 && tier < TIER_NAMES.length) {
        const digit = n % 3;
        for (let i = 0; i < digit; i++) out.push(TIER_NAMES[tier]);
        n = Math.floor(n / 3);
        tier++;
    }
    return out;
}

/** Form N can be combined N times. */
export function formCap(form) { return Math.max(0, Math.floor(Number(form) || 0)); }

/** DIY trivial for a combine performed in the given form (tier). */
export function trivialForTier(cfg, tier) {
    return (Number(cfg?.trivialBase) || 25) + ((Number(cfg?.trivialStep) || 40) * (Math.max(1, tier) - 1));
}

/** NPC fee in gold pieces for a combine in the given form (tier). */
export function npcFeeGp(cfg, tier) {
    return (Number(cfg?.npcFeeBaseGp) || 50) * Math.pow(2, Math.max(1, tier) - 1);
}

// ------------------------------------------------------------
// Item descriptors (pure readers over item-like objects)
// ------------------------------------------------------------

export function armorLocationOf(item) {
    const s = item?.system ?? {};
    return s.armorLocation || s.slot || null;
}

export function armorCategoryOf(item, materialsById = null) {
    const s = item?.system ?? {};
    if (s.armorCategory) return s.armorCategory;
    if (materialsById && s.armorMaterial) {
        const m = materialsById[s.armorMaterial];
        if (m?.categories?.length) return m.categories[0];
    }
    if (materialsById && s.material) {
        const m = materialsById[s.material];
        if (m?.categories?.length) return m.categories[0];
    }
    return null;
}

/** Catalog `classes` string -> array of abbreviations (or null). */
export function classesOf(item) {
    const c = item?.system?.classes;
    if (!c) return null;
    return String(c).split(/[,\s]+/).filter(Boolean);
}

// ------------------------------------------------------------
// Ruined twins (Stage 2, Tier 1 engine)
//
// Every dropped armor piece has a ruined twin in the world: same
// stats and effects, 0 AC, usable by NO class. The twin's name
// prefix encodes its material class (user ruling, 2026-10-27):
//   Torn = leather, Ripped = cloth, Mangled = chain, Broken = plate
// Twins feed evolution like their base piece (same set, era and
// material class for the fodder rules) except the class lock does
// not apply — a twin is classless by design.
// ------------------------------------------------------------

export const RUINED_PREFIX_BY_CATEGORY = {
    plate: "Broken", chain: "Mangled", leather: "Torn", cloth: "Ripped"
};
export const RUINED_CATEGORY_BY_PREFIX = {
    Broken: "plate", Mangled: "chain", Torn: "leather", Ripped: "cloth"
};

/**
 * Resolve an item as a ruined twin: returns
 * { baseName, setKey, prefix, category } or null. The
 * system.ruinedOf stamp wins; otherwise the name prefix must
 * match and the base name must be a registered set piece.
 */
export function ruinedTwinBase(lines, item) {
    if (!item?.name) return null;
    let baseName = item?.system?.ruinedOf ?? null;
    let prefix = null;
    if (!baseName) {
        const m = /^(Broken|Mangled|Torn|Ripped)\s+(.+)$/.exec(item.name);
        if (!m) return null;
        prefix = m[1];
        baseName = m[2];
    }
    const setKey = setIndex(lines)[baseName] ?? null;
    if (!setKey) return null;
    return {
        baseName,
        setKey,
        prefix,
        category: prefix ? RUINED_CATEGORY_BY_PREFIX[prefix] : null
    };
}

/**
 * Derive the ruined twin of a dropped armor piece (catalog-shaped
 * data in, catalog-shaped data out): stats and effects copied,
 * defense zeroed, classes removed, stamped with its base name.
 * Returns null when the piece's material class has no prefix.
 */
export function deriveRuinedTwin(item, category) {
    const prefix = RUINED_PREFIX_BY_CATEGORY[category];
    if (!prefix || !item?.name) return null;
    const system = { ...(item.system ?? {}) };
    delete system.classes;
    if ("defense" in system) system.defense = 0;
    if ("at" in system) system.at = 0;
    if ("dbBonus" in system) system.dbBonus = 0;
    system.ruinedOf = item.name;
    return { name: `${prefix} ${item.name}`, img: item.img, type: item.type ?? "armor", system };
}

/** Name -> set key index for a lines document. */
export function setIndex(lines) {
    const idx = {};
    for (const [key, set] of Object.entries(lines?.sets ?? {})) {
        for (const name of set.pieces ?? []) idx[name] = key;
    }
    return idx;
}

/** The set key an item belongs to (stamp wins, then name, then a
 *  material that belongs to exactly one set — renamed kit pieces
 *  like "Dreadscale Helm" keep their material when the name goes). */
export function setOf(lines, item) {
    const stamped = item?.system?.evolution?.set;
    if (stamped && lines?.sets?.[stamped]) return stamped;
    const byName = setIndex(lines)[item?.name] ?? null;
    if (byName) return byName;
    const mat = item?.system?.armorMaterial ?? item?.system?.material ?? null;
    if (mat) {
        const hits = Object.entries(lines?.sets ?? {})
            .filter(([, s]) => s.material && s.material === mat)
            .map(([k]) => k);
        if (hits.length === 1) return hits[0];
    }
    return null;
}

/** Weapon form from the composer spec (material + condition). */
export function weaponFormOf(lines, item) {
    const s = item?.system ?? {};
    const stamped = item?.system?.evolution?.form;
    if (stamped) return Number(stamped);
    for (const f of lines?.weaponLine?.forms ?? []) {
        if (s.material === f.material && s.condition === f.condition) return f.form;
    }
    return null;
}

// ------------------------------------------------------------
// Evolution state
// ------------------------------------------------------------

/**
 * Normalized evolution state for a vessel candidate. Uses the stamp
 * when present; otherwise derives form from the actor's class line
 * (armor: the item's set and its position in the line, honoring
 * race variants; weapons: the composer-spec ladder). Returns null
 * when the item is not on the actor's line at all.
 *
 * ctx: { classKey, raceKey }
 */
export function evolutionState(lines, item, ctx = {}) {
    const stamp = item?.system?.evolution;
    const kind = item?.type === "weapon" ? "weapon" : item?.type === "armor" ? "armor" : null;
    if (!kind) return null;

    if (stamp && (stamp.form || stamp.line)) {
        return {
            kind,
            line: stamp.line ?? ctx.classKey ?? null,
            form: Number(stamp.form) || 1,
            set: stamp.set ?? null,
            combines: Number(stamp.combines) || 0,
            bakedDb: Number(stamp.bakedDb) || 0,
            bakedOb: Number(stamp.bakedOb) || 0,
            bakedHp: Number(stamp.bakedHp) || 0,
            bakedMana: Number(stamp.bakedMana) || 0,
            bakedStats: (stamp.bakedStats && typeof stamp.bakedStats === "object") ? stamp.bakedStats : {},
            bakedResists: (stamp.bakedResists && typeof stamp.bakedResists === "object") ? stamp.bakedResists : {},
            augments: Array.isArray(stamp.augments) ? stamp.augments : []
        };
    }

    if (kind === "weapon") {
        const form = weaponFormOf(lines, item);
        if (!form) return null;
        return { kind, line: ctx.classKey ?? null, form, set: null,
                 combines: 0, bakedDb: 0, bakedOb: 0, bakedHp: 0, bakedMana: 0, bakedStats: {}, bakedResists: {}, augments: [] };
    }

    // Armor derivation from the class line.
    const setKey = setOf(lines, item);
    if (!ctx.classKey) return null;
    const line = lines?.armorLines?.[ctx.classKey];
    if (!line) return null;
    for (const f of line.forms ?? []) {
        const candidates = [f.set, ...Object.values(f.variants ?? {})];
        if (candidates.includes(setKey)) {
            return { kind, line: ctx.classKey, form: f.form, set: setKey,
                     combines: 0, bakedDb: 0, bakedOb: 0, bakedHp: 0, bakedMana: 0, bakedStats: {}, bakedResists: {}, augments: [] };
        }
    }
    // A starter piece for this class (kit-stamped pieces return above;
    // an unstamped catalog starter-set piece still counts as form 1
    // when its set is the line's form-1 basis).
    if (setKey === "starter" || setKey === "calcified-bone") {
        return { kind, line: ctx.classKey, form: 1, set: setKey,
                 combines: 0, bakedDb: 0, bakedOb: 0, bakedHp: 0, bakedMana: 0, bakedStats: {}, bakedResists: {}, augments: [] };
    }
    // Unstamped kit pieces whose names were race-renamed at grant
    // ("Dreadscale Helm") match the line's form-1 name list; the
    // material fallback is gated on the kit's worn condition so a
    // player-composed piece of the same material doesn't qualify.
    const f1 = (line.forms ?? []).find(f => f.form === 1);
    if (f1 && (line.form1Names ?? []).includes(item?.name)) {
        return { kind, line: ctx.classKey, form: 1, set: f1.set ?? "starter",
                 combines: 0, bakedDb: 0, bakedOb: 0, bakedHp: 0, bakedMana: 0, bakedStats: {}, bakedResists: {}, augments: [] };
    }
    const matId = item?.system?.armorMaterial ?? item?.system?.material ?? null;
    if (f1 && matId && (line.form1Materials ?? []).includes(matId)
        && item?.system?.armorCondition === "worn") {
        return { kind, line: ctx.classKey, form: 1, set: f1.set ?? "starter",
                 combines: 0, bakedDb: 0, bakedOb: 0, bakedHp: 0, bakedMana: 0, bakedStats: {}, bakedResists: {}, augments: [] };
    }
    return null;
}

/** Socketed augments grouped by tier: {minor: [aug, ...], ...}. */
export function augmentsByTier(state) {
    const out = {};
    for (const t of TIER_NAMES) out[t] = [];
    for (const a of state?.augments ?? []) {
        if (out[a.tier]) out[a.tier].push(a);
    }
    return out;
}

/** Free slots per tier for a state: layout minus socketed. */
export function freeSlots(state) {
    const layout = socketLayout(state?.combines ?? 0);
    const byTier = augmentsByTier(state);
    const free = {};
    for (const t of TIER_NAMES) {
        const total = layout.filter(x => x === t).length;
        free[t] = total - (byTier[t]?.length ?? 0);
    }
    return free;
}

/** Total DB a piece's evolution contributes (baked + socketed). */
export function evolutionDb(item) {
    const st = item?.system?.evolution;
    if (!st) return 0;
    let sum = Number(st.bakedDb) || 0;
    for (const a of st.augments ?? []) sum += Number(a?.db) || 0;
    return sum;
}

/** Total OB a weapon's evolution contributes (baked + socketed). */
export function evolutionOb(item) {
    const st = item?.system?.evolution;
    if (!st) return 0;
    let sum = Number(st.bakedOb) || 0;
    for (const a of st.augments ?? []) sum += Number(a?.ob) || 0;
    return sum;
}

/**
 * The non-DB/OB bonuses a piece's evolution contributes (baked +
 * socketed): {hp, mana, stats, resistances}. EquipmentStateEngine
 * adds these to the host piece's own profile, so hp/mana follow the
 * best-piece rule through the host and stats/resists stack.
 */
export function evolutionBonuses(item) {
    const out = { hp: 0, mana: 0, stats: {}, resistances: {} };
    const st = item?.system?.evolution;
    if (!st) return out;
    out.hp = Number(st.bakedHp) || 0;
    out.mana = Number(st.bakedMana) || 0;
    for (const [k, v] of Object.entries(st.bakedStats ?? {})) out.stats[k] = Number(v) || 0;
    for (const [k, v] of Object.entries(st.bakedResists ?? {})) out.resistances[k] = Number(v) || 0;
    for (const a of st.augments ?? []) {
        out.hp += Number(a?.hp) || 0;
        out.mana += Number(a?.mana) || 0;
        for (const [k, v] of Object.entries(a?.stats ?? {})) out.stats[k] = (out.stats[k] || 0) + (Number(v) || 0);
        for (const [k, v] of Object.entries(a?.resistances ?? {})) out.resistances[k] = (out.resistances[k] || 0) + (Number(v) || 0);
    }
    return out;
}

// ------------------------------------------------------------
// Combine outcomes (pure state transforms)
// ------------------------------------------------------------

/**
 * Bake socketed augments of the given tiers into the state's baked
 * totals. Returns a new state.
 */
export function bakeTiers(state, tiers) {
    const next = { ...state, augments: [...(state.augments ?? [])],
                   bakedStats: { ...(state.bakedStats ?? {}) },
                   bakedResists: { ...(state.bakedResists ?? {}) } };
    const keep = [];
    for (const a of next.augments) {
        if (tiers.includes(a.tier)) {
            next.bakedDb = (Number(next.bakedDb) || 0) + (Number(a.db) || 0);
            next.bakedOb = (Number(next.bakedOb) || 0) + (Number(a.ob) || 0);
            next.bakedHp = (Number(next.bakedHp) || 0) + (Number(a.hp) || 0);
            next.bakedMana = (Number(next.bakedMana) || 0) + (Number(a.mana) || 0);
            for (const [k, v] of Object.entries(a.stats ?? {}))
                next.bakedStats[k] = (Number(next.bakedStats[k]) || 0) + (Number(v) || 0);
            for (const [k, v] of Object.entries(a.resistances ?? {}))
                next.bakedResists[k] = (Number(next.bakedResists[k]) || 0) + (Number(v) || 0);
        } else {
            keep.push(a);
        }
    }
    next.augments = keep;
    return next;
}

/**
 * A ripening combine: count + 1. When the increment carries in base
 * 3, the augments of every tier whose digit DROPS bake in (fusion
 * graduates effects). Returns {state, bakedTiers}.
 */
export function ripen(state) {
    const before = socketLayout(state.combines);
    const after = socketLayout(state.combines + 1);
    const countOf = (layout, t) => layout.filter(x => x === t).length;
    const bakedTiers = TIER_NAMES.filter(t => countOf(after, t) < countOf(before, t));
    let next = { ...state, combines: state.combines + 1 };
    if (bakedTiers.length) next = bakeTiers(next, bakedTiers);
    return { state: next, bakedTiers };
}

/**
 * A transition: all socketed augments bake in, the count resets,
 * the form advances. Returns the new state (identity fields are
 * applied by the caller from the target piece).
 */
export function transition(state, targetSet) {
    let next = bakeTiers({ ...state }, TIER_NAMES);
    next = { ...next, form: state.form + 1, set: targetSet ?? next.set, combines: 0 };
    return next;
}

/** Socket an augment record into a state (caller validates first). */
export function socketAugment(state, augment) {
    return { ...state, augments: [...(state.augments ?? []), augment] };
}

// ------------------------------------------------------------
// Validation
// ------------------------------------------------------------

/** The next form definition for a vessel state (race-aware). */
export function nextForm(lines, state, ctx = {}) {
    if (state.kind === "weapon") {
        return (lines?.weaponLine?.forms ?? []).find(f => f.form === state.form + 1) ?? null;
    }
    const line = lines?.armorLines?.[state.line ?? ctx.classKey];
    if (!line) return null;
    const f = (line.forms ?? []).find(x => x.form === state.form + 1);
    if (!f) return null;
    // Variants resolve by faction first (the Velious mold fork: the
    // burned mold's faction decides the form-4 set), then by race
    // (the iksar form-2 sets). A form entry never mixes both.
    const variantSet = (ctx.faction && f.variants?.[ctx.faction])
        ?? (ctx.raceKey && f.variants ? f.variants[ctx.raceKey] : null);
    return { ...f, set: variantSet ?? f.set, name: variantSet ? (lines.sets[variantSet]?.name ?? f.name) : f.name };
}

/** The set a transition must eat: the catalyst set when authored.
 *  (Pre-redesign armor path; armor transitions are catalyst-driven
 *  since the Crescent Reach redesign, 2026-10-27. Kept for API
 *  compatibility.) */
export function transitionEatSet(lines, state, ctx = {}) {
    const nf = nextForm(lines, state, ctx);
    if (!nf) return null;
    if (state.kind === "weapon") return null; // weapons eat by spec, not set
    return nf.eatSet ?? nf.set;
}

// ------------------------------------------------------------
// Catalyst combines (Crescent Reach redesign, 2026-10-27)
//
// Armor no longer eats armor. Every armor combine — ripening or
// transition — burns a slot-scaled count of a stackable catalyst
// material: the family is keyed by the vessel's CURRENT form
// (form 1 = Decaying, form 2 = Rubicite, form 3 = Sebilite) and the
// material within the family follows the vessel's material class
// (a line may override with catalystCategory — beastlord is
// leather only). Velious exceptions (V1–V3, 2026-10-28): the
// form-3 transition burns a chosen faction MOLD, which selects
// the form-4 set; form-4 pieces ripen on their own faction's
// molds. The augment combine is mandatory: a form must be ripened
// at least once before it can transition. Weapons are unchanged
// and still combine through validateCombine below.
// ------------------------------------------------------------

/**
 * The catalyst requirement for an armor vessel state:
 * { itemName, category, family, tier, faction } or null when no
 * family is authored for the vessel's form or its material class
 * is unknown.
 *
 * Velious (V1–V3 rulings, 2026-10-28): the form-3 TRANSITION burns
 * a faction mold instead of Sebilite — pass opts { forTransition:
 * true, faction } and the requirement reads that faction's mold
 * materials from families["4"].factions. Form-4 pieces ripen on
 * their own set's faction molds (the set entry carries `faction`).
 */
export function catalystRequirement(lines, state, vesselCategory, opts = {}) {
    if (!state || state.kind !== "armor") return null;
    const cfg = lines?.catalysts;
    if (!cfg) return null;
    const lineCat = state.line ? lines?.armorLines?.[state.line]?.catalystCategory : null;
    const category = lineCat ?? vesselCategory ?? null;
    if (!category) return null;
    let family = null, familyName = null, faction = null;
    // Mold forks (Velious form 4, PoP form 6): a form whose family
    // block carries `factions` ripens on its own variant's molds, and
    // a transition INTO such a form burns the chosen variant's mold.
    const famOf = (form) => cfg.families?.[String(form)] ?? null;
    if (opts.forTransition && famOf(state.form + 1)?.factions) {
        faction = opts.faction ?? null;
        family = faction ? famOf(state.form + 1).factions[faction] : null;
        if (!family) return null;
        familyName = `${family.name} molds`;
    } else if (famOf(state.form)?.factions) {
        faction = lines?.sets?.[state.set]?.faction ?? null;
        family = faction ? famOf(state.form).factions[faction] : null;
        if (!family) return null;
        familyName = `${family.name} molds`;
    } else {
        family = cfg.families?.[String(state.form)];
        if (!family) return null;
        familyName = family.name ?? null;
    }
    const itemName = family.materials?.[category] ?? null;
    if (!itemName) return null;
    return { itemName, category, family: familyName, tier: state.form, faction };
}

/** Catalyst units one combine burns for a vessel in this slot. */
export function catalystCost(lines, location) {
    return Number(lines?.catalysts?.slotCosts?.[location]) || 0;
}

/**
 * Validate a catalyst combine.
 *   vessel: { item, state, location, category }
 *   action: { kind: "ripening" | "transition", held }
 *   actor:  { classKey, raceKey }
 * On success the result carries the requirement and cost so the
 * caller consumes exactly what was validated.
 */
export function validateCatalystCombine(lines, vessel, action, actor) {
    const st = vessel?.state;
    if (!st) return { ok: false, kind: null, reasons: ["The vessel is not on an evolution line."] };
    if (st.kind !== "armor") return { ok: false, kind: null, reasons: ["Only armor combines burn catalyst materials."] };
    // The form-3 transition burns a chosen faction mold (V1); every
    // other combine reads the vessel form's own family.
    const moldTransition = action?.kind === "transition"
        && !!lines?.catalysts?.families?.[String(st.form + 1)]?.factions;
    const req = catalystRequirement(lines, st, vessel.category,
        { forTransition: moldTransition, faction: action?.faction });
    if (!req) return { ok: false, kind: null, reasons: [moldTransition && !action?.faction
        ? "Choose a mold to burn — the mold decides the next form's set."
        : `No catalyst family is authored for form ${st.form}.`] };
    const cost = catalystCost(lines, vessel.location);
    const reasons = [];
    if (!cost) reasons.push("No catalyst cost is authored for this slot.");
    const held = Number(action?.held) || 0;
    if (cost && held < cost) reasons.push(`Needs ${cost} × ${req.itemName} — you hold ${held}.`);
    if (action?.kind === "transition") {
        const nf = nextForm(lines, st, { ...actor, faction: action?.faction });
        if (!nf) reasons.push("This piece is at its line's final form.");
        if (st.combines < 1) reasons.push("Ripen this form at least once before transitioning — the augment combine is mandatory.");
        if (reasons.length === 0) {
            return { ok: true, kind: "transition", reasons: [], targetSet: nf.set, targetForm: nf.form, requirement: req, cost };
        }
        return { ok: false, kind: null, reasons, requirement: req, cost };
    }
    if (st.combines >= formCap(st.form)) {
        reasons.push(`Form ${st.form} is fully ripened (${st.combines}/${formCap(st.form)}) — transition to grow further.`);
    }
    if (reasons.length === 0) return { ok: true, kind: "ripening", reasons: [], requirement: req, cost };
    return { ok: false, kind: null, reasons, requirement: req, cost };
}

/**
 * Validate eating `fodder` with `vessel` (WEAPONS only since the
 * Crescent Reach redesign — armor uses validateCatalystCombine).
 *
 * vesselCtx / fodderCtx carry precomputed descriptors so this stays
 * pure and testable:
 *   vessel: { item, state, location, category, templateId, era }
 *   fodder: { item, setKey, era, crafted, catalyst, location,
 *             category, templateId, weaponForm, classes[],
 *             material, ruined }
 *   actor:  { classKey, raceKey }
 */
export function validateCombine(lines, vessel, fodder, actor) {
    const reasons = [];
    const st = vessel.state;
    if (!st) return { ok: false, kind: null, reasons: ["The vessel is not on an evolution line."] };
    if (!fodder.item || fodder.item.id === vessel.item.id) {
        return { ok: false, kind: null, reasons: ["A piece cannot eat itself."] };
    }

    if (st.kind === "armor") {
        return { ok: false, kind: null, reasons: ["Armor no longer eats armor — reforging burns catalyst materials."] };
    }

    // Weapons.
    if (fodder.item.type !== "weapon") reasons.push("A weapon can only eat weapons.");
    if (fodder.templateId !== vessel.templateId) reasons.push("Different weapon type — a weapon only eats its own kind.");
    const vf = weaponFormOf(lines, fodder.item);
    if (vf == null) reasons.push("That weapon is not on the weapon ladder (unknown material/condition).");
    if (vf != null) {
        if (vf === st.form + 1 && fodder.templateId === vessel.templateId) {
            return { ok: true, kind: "transition", reasons: [], targetSet: null, targetForm: st.form + 1 };
        }
        if (vf !== st.form && vf !== st.form + 1) {
            reasons.push("Wrong rung — fodder must be the weapon's current rung or the next.");
        }
    }
    if (st.combines >= formCap(st.form)) {
        reasons.push(`Form ${st.form} is fully ripened (${st.combines}/${formCap(st.form)}) — transition to grow further.`);
    }
    return { ok: reasons.length === 0, kind: reasons.length === 0 ? "ripening" : null, reasons };
}

/** Tradeskill used for a DIY evolution combine on this vessel. */
export function skillForVessel(item, state) {
    if (state.kind === "weapon") {
        const t = String(item?.system?.type ?? "");
        const tpl = String(item?.system?.weaponTemplate ?? "");
        if (t.includes("bow") || tpl.includes("bow") || tpl.includes("crossbow")) return "skill-fletching";
        return "skill-smithing";
    }
    const cat = item?.system?.armorCategory;
    if (cat === "plate" || cat === "chain") return "skill-smithing";
    return "skill-tailoring";
}
