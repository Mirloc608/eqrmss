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
 * Per-item stackable flag from the sheet (system.stackable).
 * Returns true / false / null (unset → legacy type-based behavior).
 */
export function getStackableFlag(itemOrData) {
    const v = itemOrData?.system?.stackable;
    if (v === true) return true;
    if (v === false) return false;
    return null;
}

/**
 * Max stack size across the given items. Unset / 0 / blank = unlimited.
 * When items disagree, the most restrictive cap wins.
 */
export function getMaxStack(...items) {
    let cap = Infinity;
    for (const it of items) {
        const v = Number(it?.system?.maxStack);
        if (Number.isFinite(v) && v > 0) cap = Math.min(cap, Math.floor(v));
    }
    return cap;
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

    // Explicit per-item opt-out always wins
    if (getStackableFlag(a) === false || getStackableFlag(b) === false) return false;

    return true;
}

/**
 * Find an existing item on the actor that the new item data can
 * stack into. Returns the Item document, or null.
 *
 * An explicit stackable=true on the incoming item bypasses the type
 * gate; stackable=false refuses outright. Full stacks (at maxStack)
 * are skipped.
 */
export function findStackTarget(actor, itemData) {
    if (!actor?.items) return null;
    if (getStackableFlag(itemData) === false) return null;
    const type = itemData?.type ?? null;
    const bypassGate = getStackableFlag(itemData) === true;
    if (!bypassGate && !AUTO_STACK_TYPES.has(type)) return null;

    for (const existing of actor.items) {
        // Skip the item itself (relevant during updates)
        if (itemData._id && existing.id === itemData._id) continue;
        if (!itemsCanStack(existing, itemData)) continue;
        // Skip stacks already at their cap
        const cap = getMaxStack(existing, itemData);
        if (getItemQuantity(existing) >= cap) continue;
        return existing;
    }
    return null;
}

/**
 * Merge a new item's quantity into existing stacks, honoring maxStack.
 * Fills each matching stack to its cap before moving to the next.
 * Any remainder stays on itemData (system.quantity) for normal creation.
 * Returns true only when the full quantity was merged (caller cancels
 * the creation); false otherwise.
 */
export async function tryStackInto(actor, itemData) {
    const sys = (itemData.system ??= {});
    let remaining = getItemQuantity(itemData);

    while (remaining > 0) {
        const target = findStackTarget(actor, itemData);
        if (!target) break;
        const cap = getMaxStack(target, itemData);
        const curQty = getItemQuantity(target);
        const space = cap - curQty;
        if (!(space > 0)) break;
        const add = Math.min(remaining, space);
        if (!(add > 0)) break;
        const newQty = curQty + add;
        try {
            await target.update({ "system.quantity": newQty });
            // Also sync the legacy field if the target uses it
            if (target.system?.item && "quantity" in target.system.item) {
                await target.update({ "system.item.quantity": newQty });
            }
        } catch (e) {
            console.warn("EQRMSS | Stack merge failed", e);
            break;
        }
        remaining -= add;
        // Reflect the remainder on the pending creation data
        sys.quantity = remaining;
        if (sys.item && "quantity" in sys.item) sys.item.quantity = remaining;
    }

    return remaining <= 0;
}

/**
 * Consolidate all stacks in an actor's inventory. Groups items by
 * matching criteria and merges duplicates into the oldest entry,
 * splitting into maxStack-sized chunks when capped.
 * Returns { merged: N, removed: M }.
 */
export async function consolidateInventory(actor) {
    if (!actor?.items) return { merged: 0, removed: 0 };

    const items = [...actor.items];
    let merged = 0;
    let removed = 0;

    // Group by a stable key derived from matching criteria
    const groups = new Map();
    for (const item of items) {
        if (getStackableFlag(item) === false) continue;
        if (!AUTO_STACK_TYPES.has(item.type) && getStackableFlag(item) !== true) continue;
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
        // Keep the first (oldest), merge the rest into it.
        // Honor maxStack: overflow becomes additional cap-sized stacks.
        const keeper = group[0];
        const cap = getMaxStack(...group);
        let total = 0;
        for (const it of group) total += getItemQuantity(it);

        // Split the merged total into cap-sized chunks
        const chunks = [];
        let rest = total;
        while (rest > 0) {
            const c = Math.min(rest, cap);
            if (!(c > 0)) break;
            chunks.push(c);
            rest -= c;
        }
        if (chunks.length === 0) continue;

        try {
            await keeper.update({ "system.quantity": chunks[0] });
            if (keeper.system?.item && "quantity" in keeper.system.item) {
                await keeper.update({ "system.item.quantity": chunks[0] });
            }
            merged++;
            const toDelete = [];
            for (let i = 1; i < group.length; i++) toDelete.push(group[i].id);
            // Overflow beyond the first chunk becomes new stacks
            if (chunks.length > 1) {
                const base = keeper.toObject();
                delete base._id;
                const creates = chunks.slice(1).map((q) => {
                    const d = foundry.utils.deepClone(base);
                    d.system.quantity = q;
                    if (d.system.item && "quantity" in d.system.item) d.system.item.quantity = q;
                    return d;
                });
                await actor.createEmbeddedDocuments("Item", creates);
            }
            if (toDelete.length > 0) {
                await actor.deleteEmbeddedDocuments("Item", toDelete);
                removed += toDelete.length;
            }
        } catch (e) {
            console.warn("EQRMSS | Consolidate update failed", e);
        }
    }

    return { merged, removed };
}
