// ============================================================
// EQRMSS Inventory Stacking
// ============================================================
//
// Auto-stacking for inventory items: when a new item is added to an
// actor (drop, purchase, crafting output), merge it into an existing
// matching stack instead of creating a separate entry. Also provides
// a manual "consolidate" to merge already-split stacks.
//
// Matching is conservative: when in doubt, items do NOT stack.
//
// ============================================================

// Item types eligible for auto-stacking. Weapons/armor are excluded
// by default — their material/quality/condition fields will usually
// prevent matches anyway, but the type gate is an extra safety.
const AUTO_STACK_TYPES = new Set([
    "tradeskill",
    "consumable",
    "item",
    "ammo",
]);

// Fields that distinguish items. If present on either item and
// different, the items do not stack.
const DISTINGUISHING_FIELDS = [
    "strandId",
    "material",
    "armorMaterial",
    "weaponMaterial",
    "armorCategory",
    "quality",
    "armorQuality",
    "condition",
    "armorCondition",
    "tradeskillId",
];

/**
 * Read an item's quantity. system.quantity is canonical (what the
 * inventory template and crafting use); system.item.quantity is a
 * legacy fallback.
 */
export function getItemQuantity(itemOrData) {
    const sys = itemOrData?.system ?? {};
    const q = sys.quantity ?? sys.item?.quantity ?? 1;
    const n = Number(q);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Check whether an item has any distinguishing effects or bonuses
 * that would make stacking unsafe.
 */
function hasEffects(itemOrData) {
    const sys = itemOrData?.system ?? {};
    const checkFields = [
        "effects", "itemEffects", "bonuses", "statBonuses",
        "wornEffects", "triggeredEffects",
    ];
    for (const f of checkFields) {
        const v = sys[f];
        if (Array.isArray(v) && v.length > 0) return true;
        if (v && typeof v === "object" && Object.keys(v).length > 0) return true;
    }
    // Numeric bonus fields (armor/weapon/jewelry sheets)
    const bonusFields = [
        "hp", "mana", "obBonus", "dbBonus", "db",
        "accuracyBonus", "avoidanceBonus",
    ];
    for (const f of bonusFields) {
        if (Number(sys[f]) !== 0 && sys[f] != null && sys[f] !== "") return true;
    }
    // Stat bonuses object with any nonzero value
    const stats = sys.stats;
    if (stats && typeof stats === "object") {
        for (const k of Object.keys(stats)) {
            if (Number(stats[k]) !== 0) return true;
        }
    }
    return false;
}

/**
 * Determine whether two items (documents or raw data) can stack.
 * Conservative: any meaningful difference blocks stacking.
 */
export function itemsCanStack(a, b) {
    if (!a || !b) return false;

    // Same document type
    if ((a.type ?? null) !== (b.type ?? null)) return false;

    // Same name (exact match)
    if (String(a.name ?? "") !== String(b.name ?? "")) return false;

    const sysA = a.system ?? {};
    const sysB = b.system ?? {};

    // Distinguishing fields must match (null-safe)
    for (const field of DISTINGUISHING_FIELDS) {
        const va = sysA[field] ?? null;
        const vb = sysB[field] ?? null;
        if (va !== vb) return false;
    }

    // Don't merge equipped with unequipped
    const locA = sysA.location ?? null;
    const locB = sysB.location ?? null;
    const equippedA = locA === "equipped" || sysA.equipped === true || sysA.worn === true;
    const equippedB = locB === "equipped" || sysB.equipped === true || sysB.worn === true;
    if (equippedA !== equippedB) return false;

    // Items with effects or bonuses never auto-stack
    if (hasEffects(a) || hasEffects(b)) return false;

    return true;
}

/**
 * Find an existing item on the actor that the new item data can
 * stack into. Returns the Item document, or null.
 */
export function findStackTarget(actor, itemData) {
    if (!actor?.items) return null;
    const type = itemData?.type ?? null;
    if (!AUTO_STACK_TYPES.has(type)) return null;

    for (const existing of actor.items) {
        // Skip the item itself (relevant during updates)
        if (itemData._id && existing.id === itemData._id) continue;
        if (itemsCanStack(existing, itemData)) return existing;
    }
    return null;
}

/**
 * Merge a new item's quantity into an existing stack.
 * Returns true if merged (caller should skip creating the new item).
 */
export async function tryStackInto(actor, itemData) {
    const target = findStackTarget(actor, itemData);
    if (!target) return false;

    const addQty = getItemQuantity(itemData);
    const curQty = getItemQuantity(target);
    try {
        await target.update({ "system.quantity": curQty + addQty });
        // Also sync the legacy field if the target uses it
        if (target.system?.item && "quantity" in target.system.item) {
            await target.update({ "system.item.quantity": curQty + addQty });
        }
        return true;
    } catch (e) {
        console.warn("EQRMSS | Stack merge failed", e);
        return false;
    }
}

/**
 * Consolidate all stacks in an actor's inventory. Groups items by
 * matching criteria and merges duplicates into the oldest entry.
 * Returns { merged: N, removed: M }.
 */
export async function consolidateInventory(actor) {
    if (!actor?.items) return { merged: 0, removed: 0 };

    const items = [...actor.items];
    const toDelete = [];
    let merged = 0;

    // Group by a stable key derived from matching criteria
    const groups = new Map();
    for (const item of items) {
        if (!AUTO_STACK_TYPES.has(item.type)) continue;
        if (hasEffects(item)) continue;

        const sys = item.system ?? {};
        const keyParts = [
            item.type,
            String(item.name ?? ""),
            String(sys.strandId ?? ""),
            String(sys.material ?? sys.armorMaterial ?? sys.weaponMaterial ?? ""),
            String(sys.quality ?? sys.armorQuality ?? ""),
            String(sys.condition ?? sys.armorCondition ?? ""),
            String(sys.tradeskillId ?? ""),
            (sys.location === "equipped" || sys.equipped || sys.worn) ? "worn" : "pack",
        ];
        const key = keyParts.join("|");

        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }

    for (const [, group] of groups) {
        if (group.length < 2) continue;
        // Keep the first (oldest), merge the rest into it
        const keeper = group[0];
        let total = getItemQuantity(keeper);
        for (let i = 1; i < group.length; i++) {
            total += getItemQuantity(group[i]);
            toDelete.push(group[i].id);
            merged++;
        }
        try {
            await keeper.update({ "system.quantity": total });
            if (keeper.system?.item && "quantity" in keeper.system.item) {
                await keeper.update({ "system.item.quantity": total });
            }
        } catch (e) {
            console.warn("EQRMSS | Consolidate update failed", e);
        }
    }

    if (toDelete.length > 0) {
        try {
            await actor.deleteEmbeddedDocuments("Item", toDelete);
        } catch (e) {
            console.warn("EQRMSS | Consolidate delete failed", e);
        }
    }

    return { merged, removed: toDelete.length };
}
