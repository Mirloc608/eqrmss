// ============================================================
// EQRMSS Gear Evolution — engine (Stage 2, T1->T2)
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
//   { line, form, set, combines, bakedDb, bakedOb,
//     augments: [{tier, appliesTo, db, ob, name}] }
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
    return (Number(cfg?.trivialBase) || 100) + ((Number(cfg?.trivialStep) || 60) * (Math.max(1, tier) - 1));
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

/** Name -> set key index for a lines document. */
export function setIndex(lines) {
    const idx = {};
    for (const [key, set] of Object.entries(lines?.sets ?? {})) {
        for (const name of set.pieces ?? []) idx[name] = key;
    }
    return idx;
}

/** The set key an item belongs to (stamp wins, then name match). */
export function setOf(lines, item) {
    const stamped = item?.system?.evolution?.set;
    if (stamped && lines?.sets?.[stamped]) return stamped;
    return setIndex(lines)[item?.name] ?? null;
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
            augments: Array.isArray(stamp.augments) ? stamp.augments : []
        };
    }

    if (kind === "weapon") {
        const form = weaponFormOf(lines, item);
        if (!form) return null;
        return { kind, line: ctx.classKey ?? null, form, set: null,
                 combines: 0, bakedDb: 0, bakedOb: 0, augments: [] };
    }

    // Armor derivation from the class line.
    const setKey = setOf(lines, item);
    if (!setKey || !ctx.classKey) return null;
    const line = lines?.armorLines?.[ctx.classKey];
    if (!line) return null;
    for (const f of line.forms ?? []) {
        const candidates = [f.set, ...Object.values(f.variants ?? {})];
        if (candidates.includes(setKey)) {
            return { kind, line: ctx.classKey, form: f.form, set: setKey,
                     combines: 0, bakedDb: 0, bakedOb: 0, augments: [] };
        }
    }
    // A starter piece for this class (kit-stamped pieces return above;
    // an unstamped catalog starter-set piece still counts as form 1
    // when its set is the line's form-1 basis).
    if (setKey === "starter" || setKey === "calcified-bone") {
        return { kind, line: ctx.classKey, form: 1, set: setKey,
                 combines: 0, bakedDb: 0, bakedOb: 0, augments: [] };
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

// ------------------------------------------------------------
// Combine outcomes (pure state transforms)
// ------------------------------------------------------------

/**
 * Bake socketed augments of the given tiers into the state's baked
 * totals. Returns a new state.
 */
export function bakeTiers(state, tiers) {
    const next = { ...state, augments: [...(state.augments ?? [])] };
    const keep = [];
    for (const a of next.augments) {
        if (tiers.includes(a.tier)) {
            next.bakedDb = (Number(next.bakedDb) || 0) + (Number(a.db) || 0);
            next.bakedOb = (Number(next.bakedOb) || 0) + (Number(a.ob) || 0);
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
    const variantSet = ctx.raceKey && f.variants ? f.variants[ctx.raceKey] : null;
    return { ...f, set: variantSet ?? f.set, name: variantSet ? (lines.sets[variantSet]?.name ?? f.name) : f.name };
}

/** The set a transition must eat: the catalyst set when authored. */
export function transitionEatSet(lines, state, ctx = {}) {
    const nf = nextForm(lines, state, ctx);
    if (!nf) return null;
    if (state.kind === "weapon") return null; // weapons eat by spec, not set
    return nf.eatSet ?? nf.set;
}

/**
 * Validate eating `fodder` with `vessel`.
 *
 * vesselCtx / fodderCtx carry precomputed descriptors so this stays
 * pure and testable:
 *   vessel: { item, state, location, category, templateId, era }
 *   fodder: { item, setKey, era, crafted, catalyst, location,
 *             category, templateId, weaponForm, classes[] }
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
        // Transition first: the authored catalyst set (e.g. Decayed
        // Armor) is made of plain items, not armor documents, and a
        // direct target-set piece must win over the ripening rules.
        const eatSet = transitionEatSet(lines, st, actor);
        const nf = nextForm(lines, st, actor);
        if (nf && eatSet && fodder.setKey === eatSet && fodder.location === vessel.location) {
            return { ok: true, kind: "transition", reasons: [], targetSet: nf.set, targetForm: nf.form };
        }
        if (fodder.item.type !== "armor") reasons.push("Armor can only eat armor.");
        if (fodder.location !== vessel.location) reasons.push("Different slot — a piece only eats its own slot.");
        // Ripening rules.
        if (!fodder.setKey) reasons.push("Unknown provenance — only recognized sets can feed a reforge.");
        if (fodder.catalyst) reasons.push("That piece is a transition catalyst, not fodder.");
        if (fodder.crafted) reasons.push("Crafted gear cannot be fodder — fodder is dropped loot only.");
        if (fodder.category && vessel.category && fodder.category !== vessel.category) {
            reasons.push("Different material class — plate feeds plate, chain feeds chain.");
        }
        if (fodder.setKey) {
            const vEra = vessel.era ?? 0;
            if (!(fodder.era === vEra || fodder.era === vEra + 1)) {
                reasons.push("Wrong era — fodder must be from the vessel's era or the next.");
            }
        }
        const abbrev = CLASS_ABBREV[actor.classKey];
        if (fodder.classes && abbrev && !fodder.classes.includes(abbrev)) {
            reasons.push("Class-locked — that piece is not usable by the vessel's class.");
        }
        if (st.combines >= formCap(st.form)) {
            reasons.push(`Form ${st.form} is fully ripened (${st.combines}/${formCap(st.form)}) — transition to grow further.`);
        }
        return { ok: reasons.length === 0, kind: reasons.length === 0 ? "ripening" : null, reasons };
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
