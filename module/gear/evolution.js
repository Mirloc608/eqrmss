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
    const t = Math.max(1, tier);
    const table = cfg?.trivialByTier;
    if (table && table[String(t)] != null) return Number(table[String(t)]);
    return (Number(cfg?.trivialBase) || 25) + ((Number(cfg?.trivialStep) || 40) * (t - 1));
}

/** NPC fee in gold pieces for a combine in the given form (tier). */
export function npcFeeGp(cfg, tier) {
    const t = Math.max(1, tier); return (Number(cfg?.npcFeeBaseGp) || 50) * t * t;
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

// ------------------------------------------------------------
// Weapon ladders (2026-10-29 build)
//
// The stub `weaponLine` (material/condition rungs) is superseded
// by `weaponLadders`: nine format ladders keyed by EQ itemtype
// (1hs, 2hs, piercing, 1hb, 2hb, 2hp, archery, throwing, h2h).
// A weapon's format is chosen once (form-1 choice or the
// reclassification feed) and stamped on its evolution record;
// damage/delay are owned by the per-format curve, never by the
// fed weapon. Named same-format feeds transition (free identity);
// unnamed/feeder same-format feeds ripen.
// ------------------------------------------------------------

/** Round half to even (Python round()), unlike Math.round. */
export function pyRound(x) {
    const n = Number(x) || 0;
    const fl = Math.floor(n);
    const frac = n - fl;
    if (Math.abs(frac - 0.5) < 1e-9) return (fl % 2 === 0) ? fl : fl + 1;
    return Math.round(n);
}

/** The formats registry: { key: {name, skill, floor, anchor, forms, capstones} }. */
export function weaponFormats(lines) {
    return lines?.weaponLadders?.formats ?? {};
}

/** Format keys legal for a class slug, per the registry legality matrix. */
export function legalWeaponFormats(lines, classKey) {
    const legal = lines?.weaponLadders?.legality?.[classKey] ?? [];
    const formats = weaponFormats(lines);
    return (Array.isArray(legal) ? legal : []).filter(k => formats[k] || true);
}

/**
 * Damage/delay for a format at a form, interpolated floor (form 1)
 * -> anchor (form 33) on frac(f) = 0.18 + 0.82*((f-1)/32)^0.75,
 * round-half-even. Delay interpolates in whichever direction the
 * endpoints point. Returns null when the format is unknown.
 */
export function weaponCurve(lines, formatKey, form) {
    const fmt = weaponFormats(lines)[formatKey];
    if (!fmt?.floor || !fmt?.anchor) return null;
    const f = Math.min(33, Math.max(1, Math.floor(Number(form) || 1)));
    const frac = 0.18 + 0.82 * Math.pow((f - 1) / 32, 0.75);
    const at = (a, b) => pyRound(a + (b - a) * frac);
    return {
        damage: at(Number(fmt.floor.damage) || 0, Number(fmt.anchor.damage) || 0),
        delay: at(Number(fmt.floor.delay) || 0, Number(fmt.anchor.delay) || 0)
    };
}

/** The registry feeder-list format for an item name, or null. */
function feederFormatOf(lines, item) {
    const feeders = lines?.weaponLadders?.feeders;
    if (!feeders || !item?.name) return null;
    if (Array.isArray(feeders)) return feeders.includes(item.name) ? formatOfWeapon(lines, item) : null;
    for (const [key, names] of Object.entries(feeders)) {
        if (Array.isArray(names) && names.includes(item.name)) return key;
    }
    return null;
}

function isRegistryFeeder(lines, item) {
    const feeders = lines?.weaponLadders?.feeders;
    if (!feeders || !item?.name) return false;
    if (Array.isArray(feeders)) return feeders.includes(item.name);
    return Object.values(feeders).some(names => Array.isArray(names) && names.includes(item.name));
}

/**
 * A weapon's ladder format: the system.weaponFormat stamp wins,
 * then the evolution record's format, then a single-format
 * templateFormats mapping (dual-mode templates return null —
 * their mode is pinned by the player's form-1 choice).
 */
export function formatOfWeapon(lines, item) {
    const s = item?.system ?? {};
    if (s.weaponFormat) return s.weaponFormat;
    if (s.evolution?.format) return s.evolution.format;
    const mapped = lines?.weaponLadders?.templateFormats?.[s.weaponTemplate];
    if (typeof mapped === "string") return mapped;
    return feederFormatOf(lines, item);
}

/**
 * Classify a weapon for evolution feeds:
 *   "feeder"  — system.feeder stamp or the registry feeder lists
 *   "named"   — carries a system.weaponFormat stamp (catalog identity)
 *   "unnamed" — anything else (composed / generic weapons)
 * Returns null for non-weapons.
 */
export function classifyWeapon(lines, item) {
    if (!item || item.type !== "weapon") return null;
    if (item.system?.feeder || isRegistryFeeder(lines, item)) return "feeder";
    if (item.system?.weaponFormat) return "named";
    return "unnamed";
}

/**
 * How many evolutionary weapons an actor runs: started weapon
 * evolution records (stamped at format choice, i.e. carrying a
 * format), with pair members sharing a pairId counting once.
 */
export function countEvolvingWeapons(actorItems) {
    let items = [];
    if (Array.isArray(actorItems)) items = actorItems;
    else if (Array.isArray(actorItems?.contents)) items = actorItems.contents;
    else if (actorItems) { try { items = [...actorItems]; } catch { items = []; } }
    const pairs = new Set();
    let count = 0;
    for (const item of items) {
        if (item?.type !== "weapon") continue;
        const stamp = item.system?.evolution;
        if (!stamp?.format) continue;
        if (stamp.pairId) {
            if (pairs.has(stamp.pairId)) continue;
            pairs.add(stamp.pairId);
        }
        count++;
    }
    return count;
}

/**
 * Capstone overlay options for a class on a format, in choice
 * order epic / analog / ladder. Each: {kind, names, pair,
 * twoHanded?, pairNames?}. The ladder option is the format's
 * designated form-33 identity, when one is authored.
 */
export function capstoneOptions(lines, formatKey, classKey) {
    const fmt = weaponFormats(lines)[formatKey];
    if (!fmt) return [];
    const out = [];
    const cap = fmt.capstones?.[classKey] ?? null;
    const asNames = (v) => v == null ? [] : (Array.isArray(v) ? [...v] : [v]);
    if (cap?.epic != null) {
        const names = asNames(cap.epic);
        // epicPair === true means one catalog item manifested as
        // a pair; an epicPair ARRAY is the pair manifestation a
        // two-handed epic converts to (pairNames), not a pair here.
        const opt = { kind: "epic", names, pair: names.length > 1 || cap.epicPair === true };
        if (cap.epicTwoHanded) opt.twoHanded = cap.epicTwoHanded;
        if (Array.isArray(cap.epicPair)) opt.pairNames = [...cap.epicPair];
        out.push(opt);
    }
    if (cap?.analog != null) {
        const names = asNames(cap.analog);
        out.push({ kind: "analog", names, pair: names.length > 1 || !!cap.analogPair });
    }
    const ladderName = fmt.forms?.["33"] ?? fmt.forms?.[33] ?? null;
    if (ladderName) out.push({ kind: "ladder", names: [ladderName], pair: false });
    return out;
}

/** The proc a combine keeps: when only one side carries a proc
 *  that proc wins under either choice; when both carry one, the
 *  player's choice decides (defaulting to the vessel's). */
export function resolveProcChoice(vesselProc, fodderProc, choice) {
    if (!fodderProc) return vesselProc ?? null;
    if (!vesselProc) return fodderProc;
    if (choice === "fodder") return fodderProc;
    return vesselProc;
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
        const state = {
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
        if (kind === "weapon") {
            // Weapon stamp additions: the pinned format, the
            // current identity item name (null until the first
            // transition), a shared pair id for pair capstones,
            // the reclassification flag, and the material prefix
            // last applied by a ripening merge (stripped on the
            // next one).
            state.format = stamp.format ?? item?.system?.weaponFormat ?? null;
            state.identityName = stamp.identityName ?? null;
            state.pairId = stamp.pairId ?? null;
            state.reclassified = !!stamp.reclassified;
            state.prefixApplied = stamp.prefixApplied ?? null;
        }
        return state;
    }

    if (kind === "weapon") {
        // Any weapon can be a vessel: an unstamped weapon is a
        // form-1 state with no format chosen yet (the format is
        // picked in the dialog and stamped at Begin Evolution).
        return { kind, line: ctx.classKey ?? null, form: 1, set: null,
                 combines: 0, bakedDb: 0, bakedOb: 0, bakedHp: 0, bakedMana: 0, bakedStats: {}, bakedResists: {}, augments: [],
                 format: null, identityName: null, pairId: null, reclassified: false, prefixApplied: null };
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
 * Baked caps (user ruling 2026-10-29): a piece's baked totals may
 * never exceed ONE FULL SOCKET LOAD per key — what baking an entire
 * 2/2/2/2/1 load (minor/moderate/major/epic/artifact) of augments of
 * one key yields on the S2 ladders:
 *   db/ob:    2*5 + 2*10 + 2*15 + 2*20 + 25   = 125
 *   hp/mana:  2*15 + 2*30 + 2*50 + 2*75 + 100 = 440
 *   one stat or resist: 2*2 + 2*4 + 2*6 + 2*8 + 10 = 50
 * Enforced in bakeTiers — the single funnel for fusion and
 * transition bakes — as headroom: a bake adds at most (cap - current)
 * and never reduces a total, so pieces already above a cap (baked
 * before this ruling) are grandfathered and simply gain no more.
 * Socketed (unbaked) augments are NOT capped; only the permanent
 * baked layer is. If the augment ladders are ever retuned, recompute
 * these caps from the same formula.
 */
export const BAKED_CAPS = { db: 125, ob: 125, hp: 440, mana: 440, stat: 50, resist: 50 };

/** Add `value` to a baked total, bounded by the key's cap headroom. */
function bakedAdd(current, value, cap) {
    const cur = Number(current) || 0;
    const add = Math.max(0, Math.min(Number(value) || 0, cap - cur));
    return cur + add;
}

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
            next.bakedDb = bakedAdd(next.bakedDb, a.db, BAKED_CAPS.db);
            next.bakedOb = bakedAdd(next.bakedOb, a.ob, BAKED_CAPS.ob);
            next.bakedHp = bakedAdd(next.bakedHp, a.hp, BAKED_CAPS.hp);
            next.bakedMana = bakedAdd(next.bakedMana, a.mana, BAKED_CAPS.mana);
            for (const [k, v] of Object.entries(a.stats ?? {}))
                next.bakedStats[k] = bakedAdd(next.bakedStats[k], v, BAKED_CAPS.stat);
            for (const [k, v] of Object.entries(a.resistances ?? {}))
                next.bakedResists[k] = bakedAdd(next.bakedResists[k], v, BAKED_CAPS.resist);
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
        if (state.form >= 33) return null;
        const fmt = state.format ? weaponFormats(lines)[state.format] : null;
        if (fmt) {
            const name = fmt.forms?.[String(state.form + 1)] ?? fmt.forms?.[state.form + 1] ?? null;
            return { form: state.form + 1, name, format: state.format };
        }
        // Legacy fallback (pre-ladder registries): the stub line.
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

    // Weapons: the ladder feed rules live in validateWeaponFeed.
    return validateWeaponFeed(lines, vessel, fodder, actor);
}

/**
 * Validate feeding `fodder` to a weapon `vessel` under the ladder
 * model. vessel / fodder accept either the descriptor shape
 * validateCombine uses ({item, state, ...}) or a bare item;
 * actor accepts {classKey, raceKey} or an actor document.
 *
 * Kinds:
 *   "reclassify" — the FIRST feed: a feeder of the chosen format
 *     fed to a started record (format stamped, form 1, no
 *     combines, no identity yet). It pins the format for life and
 *     stamps reclassified on the record; it is not a combine.
 *   "ripening" — a feeder or unnamed weapon of the vessel's
 *     format: +1 in-form combine (merges for unnamed fodder).
 *   "transition" — a NAMED weapon of the vessel's format: form
 *     +1, the vessel takes the named weapon's identity. At form
 *     32 the verdict also carries the capstone overlay options.
 */
export function validateWeaponFeed(lines, vessel, fodder, actor) {
    const vesselItem = vessel?.item ?? vessel;
    const fodderItem = fodder?.item ?? fodder;
    const classKey = actor?.classKey ?? actor?.system?.fixed_info?.profession ?? null;
    const st = vessel?.state ?? (vesselItem ? evolutionState(lines, vesselItem, { classKey, raceKey: actor?.raceKey ?? null }) : null);
    const fail = (reasons) => ({ ok: false, kind: null, reasons, targetForm: null, targetSet: null });
    if (!st || st.kind !== "weapon") return fail(["The vessel is not an evolvable weapon."]);
    if (!fodderItem) return fail(["Choose a weapon to consume."]);
    if (vesselItem && fodderItem.id && fodderItem.id === vesselItem.id) {
        return fail(["A piece cannot eat itself."]);
    }
    if (fodderItem.type !== "weapon") return fail(["A weapon can only eat weapons."]);
    if (!st.format) return fail(["Choose this weapon's format first — Begin Evolution stamps it before any feed."]);

    const fodderClass = classifyWeapon(lines, fodderItem);
    const fodderFormat = formatOfWeapon(lines, fodderItem);
    const reasons = [];
    if (!fodderFormat) {
        reasons.push("That weapon's format cannot be determined (no format stamp and no single-format template).");
    } else if (fodderFormat !== st.format) {
        reasons.push(`Format mismatch — this vessel is ${weaponFormats(lines)[st.format]?.name ?? st.format}; the fodder is ${weaponFormats(lines)[fodderFormat]?.name ?? fodderFormat}.`);
    }
    if (reasons.length) return fail(reasons);

    // Reclassify-first: until the record is reclassified, the only
    // acceptable feed is a feeder of the vessel's chosen format.
    // Unnamed and named feeds are refused before reclassification.
    if (!st.reclassified && fodderClass !== "feeder") {
        return fail(["This weapon has not been reclassified — feed it a Rusty or Tarnished weapon of its format first."]);
    }

    // Reclassification: the first feed only, and it must be a feeder.
    const firstFeed = st.form === 1 && st.combines === 0 && !st.identityName && !st.reclassified;
    if (fodderClass === "feeder") {
        if (firstFeed) {
            const legal = legalWeaponFormats(lines, classKey);
            if (classKey && legal.length && !legal.includes(st.format)) {
                return fail([`A ${classKey} cannot wield ${weaponFormats(lines)[st.format]?.name ?? st.format} weapons — that format cannot be set by a feed.`]);
            }
            return { ok: true, kind: "reclassify", reasons: [], targetForm: st.form, targetSet: null };
        }
        if (st.form === 1 && !st.reclassified) {
            return fail(["Reclassification is the first feed only — this vessel has already fed, so its format can no longer be set by a feeder."]);
        }
    }

    // Named feeds transition (free identity). No per-item class
    // gate: designated identities carry PEQ class masks that can
    // exclude classes legal in the format, so legality is gated
    // once at format choice via legalWeaponFormats.
    if (fodderClass === "named") {
        if (st.form >= 33) return fail(["This weapon is at its final form (33) — it cannot transition further."]);
        const verdict = { ok: true, kind: "transition", reasons: [], targetForm: st.form + 1, targetSet: null };
        if (st.form + 1 === 33) {
            const options = capstoneOptions(lines, st.format, classKey);
            verdict.capstoneOptions = options;
            verdict.capstone = options[0] ?? null;
        }
        return verdict;
    }

    // Everything else of the format ripens.
    if (st.combines >= formCap(st.form)) {
        return fail([`Form ${st.form} is fully ripened (${st.combines}/${formCap(st.form)}) — transition to grow further.`]);
    }
    return { ok: true, kind: "ripening", reasons: [], targetForm: st.form, targetSet: null };
}

/** Tradeskill used for a DIY evolution combine on this vessel.
 *  Weapons use their format's registry skill when a format is
 *  known (an optional lines document may be passed; otherwise
 *  the cached registry is read); the legacy bow fallback covers
 *  format-less vessels. */
export function skillForVessel(item, state, lines = null) {
    if (state.kind === "weapon") {
        const registry = lines ?? evolutionLinesSync();
        const formatKey = state.format ?? (registry ? formatOfWeapon(registry, item) : null);
        const fmtSkill = formatKey ? weaponFormats(registry ?? {})[formatKey]?.skill : null;
        if (fmtSkill) return fmtSkill;
        const t = String(item?.system?.type ?? "");
        const tpl = String(item?.system?.weaponTemplate ?? "");
        if (t.includes("bow") || tpl.includes("bow") || tpl.includes("crossbow")) return "skill-fletching";
        return "skill-smithing";
    }
    const cat = item?.system?.armorCategory;
    if (cat === "plate" || cat === "chain") return "skill-smithing";
    return "skill-tailoring";
}
