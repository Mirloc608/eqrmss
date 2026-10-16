// ============================================================
// EQRMSS Equipment Restrictions
// ============================================================
// Enforces:
//  1. One item per equipment slot (ears/fingers/wrists excepted)
//  2. Class weapon-type restrictions on bandolier assignment
//  3. Dual Wield requirement for two 1-handed weapons
//  4. Shield skill gate for active shield use (bash)
//
// Slot enforcement hooks into the worn toggle (actor-sheet-inventory.js).
// Weapon/dual-wield hooks into setBandolierSlot (module/combat/bandolier.js).
// Shield bash hooks into executeAbility (module/combat/ability-handlers.js).
// ============================================================

// ------------------------------------------------------------
// Slot definitions
// ------------------------------------------------------------
// Slot key -> max worn items. Most slots allow 1; ears, fingers
// and wrists allow multiples per the user's inventory ruling.

const MULTI_SLOTS = {
    "ear": 2,
    "ears": 2,
    "finger": 2,
    "fingers": 2,
    "wrist": 2,
    "wrists": 2,
};

const DEFAULT_SLOT_CAPACITY = 1;

/**
 * Determine the equipment slot key for an item.
 * Returns null for items that don't occupy a wear slot.
 */
export function getItemSlot(item) {
    if (!item) return null;
    const type = item.type;
    const sys = item.system ?? {};

    if (type === "armor") {
        const loc = String(sys.armorLocation ?? "").trim().toLowerCase();
        return loc ? `armor:${loc}` : "armor:unspecified";
    }
    if (type === "jewelry") {
        const loc = String(sys.jewelryLocation ?? sys.jewelrySlot ?? "").trim().toLowerCase();
        return loc ? `jewelry:${loc}` : "jewelry:unspecified";
    }
    if (type === "shield") {
        return "shield";
    }
    // Weapons are managed by the bandolier, not the worn toggle.
    // Tools, consumables, etc. don't occupy wear slots.
    return null;
}

/**
 * Max items allowed in a slot key.
 */
export function getSlotCapacity(slotKey) {
    if (!slotKey) return DEFAULT_SLOT_CAPACITY;
    const loc = slotKey.split(":").pop();
    return MULTI_SLOTS[loc] ?? DEFAULT_SLOT_CAPACITY;
}

/**
 * Count worn items of the actor occupying the same slot.
 */
function countWornInSlot(actor, slotKey, excludeId = null) {
    let n = 0;
    for (const i of actor?.items?.contents ?? []) {
        if (excludeId && i.id === excludeId) continue;
        if (!i.system?.worn) continue;
        if (getItemSlot(i) === slotKey) n++;
    }
    return n;
}

/**
 * Check whether an item may be worn (slot capacity).
 * Returns { ok: true } or { ok: false, message }.
 */
export function checkSlotAvailable(actor, item) {
    const slotKey = getItemSlot(item);
    if (!slotKey) return { ok: true };
    const cap = getSlotCapacity(slotKey);
    const worn = countWornInSlot(actor, slotKey, item.id);
    if (worn >= cap) {
        const loc = slotKey.split(":").pop();
        return {
            ok: false,
            message: `Slot full: only ${cap} item${cap === 1 ? "" : "s"} may be worn on ${loc} at a time.`,
        };
    }
    return { ok: true };
}

// ------------------------------------------------------------
// Skill / ability detection
// ------------------------------------------------------------

/** True if the actor has a developed skill with the given skillId. */
export function hasSkill(actor, skillId) {
    const id = String(skillId ?? "").toLowerCase();
    for (const i of actor?.items?.contents ?? []) {
        if (i.type !== "skill") continue;
        const sid = String(i.system?.skillId ?? i.name ?? "").toLowerCase();
        if (sid === id) return true;
    }
    return false;
}

/** True if the actor has an ability item with the given id. */
export function hasAbility(actor, abilityId) {
    const id = String(abilityId ?? "").toLowerCase();
    for (const i of actor?.items?.contents ?? []) {
        const t = i.type;
        if (t !== "ability" && t !== "combat_action") continue;
        const aid = String(i.system?.abilityId ?? i.system?.slug ?? i.name ?? "").toLowerCase();
        if (aid === id || String(i.name ?? "").toLowerCase() === String(abilityId).toLowerCase()) return true;
    }
    return false;
}

/** Dual Wield: skill-dual-wield developed OR dual-wield ability granted. */
export function hasDualWield(actor) {
    return hasSkill(actor, "skill-dual-wield") || hasAbility(actor, "dual-wield");
}

/**
 * Shield training: skill-shield-mastery developed OR shield-bash
 * ability granted (paladin/warrior get it from class).
 */
export function hasShieldTraining(actor) {
    return hasSkill(actor, "skill-shield-mastery") || hasAbility(actor, "shield-bash");
}

// ------------------------------------------------------------
// Class weapon restrictions
// ------------------------------------------------------------

// Map from class weapons-list terms (lowercase, singular-ish) to
// weapon type slugs used by the weapon composer / item system.type.
const WEAPON_TERM_TO_SLUGS = {
    "sword": ["one-handed-edged", "two-handed"],
    "short sword": ["one-handed-edged"],
    "shortsword": ["one-handed-edged"],
    "claymore": ["two-handed"],
    "dagger": ["one-handed-edged", "thrown"],
    "mace": ["one-handed-crushing"],
    "hammer": ["one-handed-crushing", "two-handed"],
    "axe": ["one-handed-edged", "two-handed"],
    "staff": ["two-handed"],
    "stave": ["two-handed"],
    "wand": ["one-handed-edged"],
    "bow": ["missile"],
    "crossbow": ["missile"],
    "thrown": ["thrown"],
    "fist": ["hand-to-hand"],
    "claw": ["hand-to-hand"],
    "pole arm": ["polearm"],
    "polearm": ["polearm"],
    "spear": ["polearm", "thrown"],
    "flail": ["one-handed-crushing"],
    "club": ["one-handed-crushing"],
    "blunt": ["one-handed-crushing", "two-handed"],
    "edged": ["one-handed-edged", "two-handed"],
    "2-h": ["two-handed"],
    "two-handed": ["two-handed"],
    "1-h edged": ["one-handed-edged"],
    "1-h crush": ["one-handed-crushing"],
    "missile": ["missile"],
    "natural": ["natural"],
    "hand to hand": ["hand-to-hand"],
    "martial": ["one-handed-edged", "one-handed-crushing", "two-handed", "polearm"],
    "heavy": ["two-handed", "polearm"],
    "spell foci": [],
    "focus": [],
};

/** Expand a class weapons-list entry to weapon type slugs. */
function expandWeaponTerm(term) {
    const t = String(term ?? "").trim().toLowerCase();
    if (WEAPON_TERM_TO_SLUGS[t]) return WEAPON_TERM_TO_SLUGS[t];
    // Fallback: singularize trailing "s" and retry.
    const singular = t.replace(/s$/, "");
    if (WEAPON_TERM_TO_SLUGS[singular]) return WEAPON_TERM_TO_SLUGS[singular];
    // Last resort: substring match against known terms.
    const out = new Set();
    for (const [key, slugs] of Object.entries(WEAPON_TERM_TO_SLUGS)) {
        if (t.includes(key) || key.includes(t)) for (const s of slugs) out.add(s);
    }
    return [...out];
}

/** Get the classId for an actor. */
export function getActorClassId(actor) {
    return String(
        actor?.system?.origin?.classId ??
        actor?.system?.classId ??
        actor?.system?.class?.toLowerCase?.() ??
        ""
    ).toLowerCase();
}

/** Load the weapons { allowed, restricted } block for a classId. */
function getClassWeaponBlock(classId) {
    try {
        const classes = game?.eqrmss?.classes ?? {};
        // ClassLoader stores by id; try direct and case variants.
        const cls = classes[classId] ?? classes[String(classId ?? "").toLowerCase()];
        const w = cls?.weapons ?? cls?.system?.weapons;
        if (w && (Array.isArray(w.allowed) || Array.isArray(w.restricted))) return w;
    } catch (e) { /* fall through */ }
    return null;
}

/**
 * Check whether a weapon item may be wielded by the actor's class.
 * Returns { ok: true } or { ok: false, message }.
 * If no class weapon data exists, the weapon is allowed (fail-open).
 */
export function checkWeaponAllowedForClass(actor, weaponItem) {
    const classId = getActorClassId(actor);
    if (!classId) return { ok: true };
    const block = getClassWeaponBlock(classId);
    if (!block) return { ok: true };

    const slug = String(weaponItem?.system?.type ?? "").trim().toLowerCase();
    if (!slug) return { ok: true };

    const restrictedSlugs = new Set();
    for (const term of block.restricted ?? []) {
        for (const s of expandWeaponTerm(term)) restrictedSlugs.add(s);
    }
    if (restrictedSlugs.has(slug)) {
        return {
            ok: false,
            message: `Your class cannot wield this weapon type (${weaponItem?.name ?? "weapon"}).`,
        };
    }

    const allowed = block.allowed ?? [];
    if (allowed.length) {
        const allowedSlugs = new Set();
        for (const term of allowed) {
            for (const s of expandWeaponTerm(term)) allowedSlugs.add(s);
        }
        if (allowedSlugs.size && !allowedSlugs.has(slug)) {
            return {
                ok: false,
                message: `Your class cannot wield this weapon type (${weaponItem?.name ?? "weapon"}).`,
            };
        }
    }
    return { ok: true };
}

/**
 * Dual-wield gate: after assigning itemId to (setIndex, side), would the
 * set hold two 1-handed weapons? If so the actor needs Dual Wield.
 * `sets` is the post-assignment array of { left, right } (item ids or null).
 * `getItem` resolves an id to an item (for hands lookup).
 * Returns { ok: true } or { ok: false, message }.
 */
export function checkDualWield(actor, sets, setIndex, getItem) {
    const set = sets?.[setIndex];
    if (!set) return { ok: true };
    const left = set.left ? getItem(set.left) : null;
    const right = set.right ? getItem(set.right) : null;
    if (!left || !right) return { ok: true };

    const hands = (it) => Number(it?.system?.weapon?.hands ?? it?.system?.hands ?? 1);
    // Two weapons wielded at once requires Dual Wield (a 2H weapon in one
    // hand already occupies both; that case is handled by hands > 1).
    if (hands(left) <= 1 && hands(right) <= 1) {
        if (!hasDualWield(actor)) {
            return {
                ok: false,
                message: "Dual Wield training is required to wield a weapon in each hand.",
            };
        }
    }
    return { ok: true };
}

// ------------------------------------------------------------
// UI warning
// ------------------------------------------------------------

/** Surface a blocking warning to the user (chat-adjacent, non-silent). */
export function warnBlocked(message) {
    const msg = String(message ?? "That cannot be equipped.");
    try {
        ui?.notifications?.warn?.(`EQRMSS | ${msg}`);
    } catch (e) { /* ignore */ }
    console.warn(`EQRMSS | Equipment restriction: ${msg}`);
}
