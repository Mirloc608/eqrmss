// ============================================================
// EQRMSS Container Storage
// ============================================================
// Items can be stored inside container-type items via
// system.containerId. This module owns the containment rules:
// capacity checks, nesting guards, and effective weight.
//
// Container fields (system):
//   capacityWeight   max lbs of contents (0/unset = unlimited)
//   capacitySlots    max distinct contained items (0/unset = unlimited)
//   weightReduction  % of contents weight ignored (0-100, default 0)
//   liquidCapacityOz fluid-oz capacity (0 = not a liquid container)
//   liquid           { type: "", amountOz: 0 }
//   isCoinPurse      true → displays the actor's money
// ============================================================

/**
 * Normalize an actor's items to an array — works with document
 * Collections and raw data arrays alike.
 */
function itemListOf(actor) {
    const items = actor?.items;
    if (!items) return [];
    if (Array.isArray(items)) return items;
    if (Array.isArray(items.contents)) return items.contents;
    try {
        const arr = [...items];
        if (Array.isArray(arr)) return arr;
    } catch { /* not iterable — fall through */ }
    return [];
}

function itemIdOf(it) {
    return it?.id ?? it?._id ?? null;
}

function itemById(actor, id) {
    if (!id) return null;
    return itemListOf(actor).find(i => itemIdOf(i) === id) ?? null;
}

/**
 * All items directly inside a container.
 */
export function getContainerContents(actor, containerId) {
    if (!containerId) return [];
    return itemListOf(actor).filter(i => i?.system?.containerId === containerId);
}

/**
 * Weight of a container's direct contents (weight × quantity each).
 */
export function getContentsWeight(actor, containerId) {
    let w = 0;
    for (const it of getContainerContents(actor, containerId)) {
        const iw = Number(it?.system?.weight);
        if (!Number.isFinite(iw) || iw <= 0) continue;
        const qty = Number(it?.system?.quantity ?? 1);
        w += iw * (Number.isFinite(qty) && qty > 0 ? qty : 1);
    }
    return w;
}

/**
 * Effective carried weight of a container: its own weight plus its
 * contents weight reduced by weightReduction %. Handles nesting via
 * the actor's item list; guards against containment cycles.
 */
export function getEffectiveContainerWeight(actor, container, seen = new Set()) {
    if (!container) return 0;
    const cid = itemIdOf(container);
    if (!cid || seen.has(cid)) return 0;
    seen.add(cid);

    const sys = container.system ?? {};
    let w = Number(sys.weight);
    w = Number.isFinite(w) && w > 0 ? w : 0;

    let contents = 0;
    for (const it of getContainerContents(actor, cid)) {
        if (it.type === "container") {
            contents += getEffectiveContainerWeight(actor, it, seen);
        } else {
            const iw = Number(it?.system?.weight);
            if (!Number.isFinite(iw) || iw <= 0) continue;
            const qty = Number(it?.system?.quantity ?? 1);
            contents += iw * (Number.isFinite(qty) && qty > 0 ? qty : 1);
        }
    }

    const reduction = Number(sys.weightReduction);
    const pct = Number.isFinite(reduction) ? Math.min(100, Math.max(0, reduction)) : 0;
    return w + contents * (1 - pct / 100);
}

/**
 * True if `ancestorId` is contained (directly or transitively) inside
 * `descendantId` — used to block containment cycles.
 */
function isAncestorOf(actor, ancestorId, descendantId, seen = new Set()) {
    if (!ancestorId || !descendantId) return false;
    if (ancestorId === descendantId) return true;
    if (seen.has(descendantId)) return false;
    seen.add(descendantId);
    const item = itemById(actor, descendantId);
    const parentId = item?.system?.containerId;
    if (!parentId) return false;
    return isAncestorOf(actor, ancestorId, parentId, seen);
}

/**
 * Check whether an item can be stored in a container.
 * Returns { ok: true } or { ok: false, reason }.
 */
export function canStoreInContainer(actor, itemId, containerId) {
    if (!actor) return { ok: false, reason: "No actor" };
    const item = itemById(actor, itemId);
    const container = itemById(actor, containerId);
    if (!item) return { ok: false, reason: "Item not found" };
    if (!container) return { ok: false, reason: "Container not found" };
    if (container.type !== "container") return { ok: false, reason: "Not a container" };
    if (itemId === containerId) return { ok: false, reason: "Cannot store a container in itself" };
    if (item.system?.containerId === containerId) return { ok: false, reason: "Already stored there" };
    // Block cycles: container must not be inside the item being stored
    if (isAncestorOf(actor, itemId, containerId)) {
        return { ok: false, reason: "Cannot create a containment loop" };
    }

    const sys = container.system ?? {};
    const contents = getContainerContents(actor, containerId);

    // Slot capacity: distinct contained items
    const slots = Number(sys.capacitySlots);
    if (Number.isFinite(slots) && slots > 0 && contents.length >= slots) {
        return { ok: false, reason: `Container is full (${slots} items max)` };
    }

    // Weight capacity
    const capW = Number(sys.capacityWeight);
    if (Number.isFinite(capW) && capW > 0) {
        const iw = Number(item.system?.weight);
        const qty = Number(item.system?.quantity ?? 1);
        const addW = (Number.isFinite(iw) && iw > 0 ? iw : 0) * (Number.isFinite(qty) && qty > 0 ? qty : 1);
        if (getContentsWeight(actor, containerId) + addW > capW) {
            return { ok: false, reason: `Too heavy (holds ${capW} lb max)` };
        }
    }

    return { ok: true };
}

/**
 * Store an item in a container (sets system.containerId).
 * Returns { ok } — caller surfaces reason via notification.
 */
export async function storeItemInContainer(actor, itemId, containerId) {
    const check = canStoreInContainer(actor, itemId, containerId);
    if (!check.ok) return check;
    try {
        await itemById(actor, itemId).update({ "system.containerId": containerId });
        return { ok: true };
    } catch (e) {
        console.warn("EQRMSS | Store in container failed", e);
        return { ok: false, reason: "Update failed" };
    }
}

/**
 * Remove an item from its container (clears system.containerId).
 */
export async function removeItemFromContainer(actor, itemId) {
    const item = actor?.items?.get?.(itemId);
    if (!item) return { ok: false, reason: "Item not found" };
    try {
        await item.update({ "system.containerId": "" });
        return { ok: true };
    } catch (e) {
        console.warn("EQRMSS | Remove from container failed", e);
        return { ok: false, reason: "Update failed" };
    }
}

/**
 * Items on the actor eligible for storing in a container:
 * not already contained, not the container itself, not an ancestor
 * of the container (cycle guard).
 */
export function getStorableItems(actor, containerId) {
    if (!containerId) return [];
    return itemListOf(actor).filter((it) => {
        const iid = itemIdOf(it);
        if (iid === containerId) return false;
        if (it.system?.containerId) return false;
        if (isAncestorOf(actor, iid, containerId)) return false;
        return true;
    });
}
