// ============================================================
// EQRMSS Bandolier — quick weapon-set swaps.
//
// EQ feel, RMSS pricing. Design (user ruling 2026-10-12, Version B):
// - Base 4 slots: Ready (L/R) + Ondeck 1 (L/R).
// - Battle Ready AA (aa-battle-ready): R1 opens an extra left-hand
//   slot, R2 the matching right (first bonus set complete), R3/R4
//   the second bonus set. 8 slots / 4 sets max.
// - A swap exchanges the whole set (a lone unlocked side may be
//   swapped on its own while its pair is incomplete).
// - Swapping costs 50% activity (Arms Law "changing weapons":
//   draw 20% / sheath 30% / change 50%). This engine has no %
//   activity tracker, so the 50% is applied directly: attacks made
//   after a swap in the same round roll at half OB. One swap per
//   round; blocked while stunned; sets are configured out of
//   combat only.
// - All state lives in the actor flag "eqrmss".bandolier:
//     { current, sets: [{ name, left, right }], swappedThisRound }
//   No actor schema changes required.
// ============================================================

import { activeStun } from "./crit-conditions.js";
import { isWorn } from "../utils/equipment/equipment-utils.js";
import { combatCard } from "./chat-card.js";

const FLAG_SCOPE = "eqrmss";
const FLAG_KEY = "bandolier";
const BATTLE_READY_AA_ID = "aa-battle-ready";

const DEFAULT_SET_NAMES = ["Ready", "Ondeck 1", "Battle Ready 1", "Battle Ready 2"];
// Battle Ready rank required to unlock each side of the bonus sets.
const RANK_NEED = [null, null, { left: 1, right: 2 }, { left: 3, right: 4 }];

function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function blankSet(name) {
    return { name, left: null, right: null };
}

/**
 * Purchased Battle Ready rank (0-4). Mirrors
 * EQRMSSAAAdvancement.getPurchasedRank (module/aa/aa-advancement.js)
 * without importing the AA subsystem.
 */
export function battleReadyRank(actor) {
    try {
        const abilities = actor?.system?.aa?.abilities ?? [];
        const entry = abilities.find(a => a?.id === BATTLE_READY_AA_ID);
        return Math.max(0, Math.min(4, Number(entry?.rank) || 0));
    } catch (e) {
        return 0;
    }
}

/** Per-set/per-side unlock state from the Battle Ready rank. */
export function bandolierUnlocks(actor) {
    const rank = battleReadyRank(actor);
    return DEFAULT_SET_NAMES.map((_, i) => {
        const need = RANK_NEED[i];
        if (!need) return { left: true, right: true };
        return { left: rank >= need.left, right: rank >= need.right };
    });
}

/** Rank needed to unlock a locked side (for UI labels). */
export function bandolierRankNeed(setIndex, side) {
    return RANK_NEED[setIndex]?.[side] ?? null;
}

function ownedWeaponIds(actor) {
    return new Set(
        [...(actor?.items?.contents ?? [])]
            .filter(i => isWieldableWeapon(i))
            .map(i => i.id)
            .filter(Boolean)
    );
}

/**
 * Ammunition is never a wieldable weapon for the bandolier — the
 * quiver owns it. (Some ammo items are weapon-typed; without this
 * guard the swap's pack sweep would stow quivered arrows.)
 */
function isAmmunition(item) {
    return !!item?.system?.ammoType;
}

function isWieldableWeapon(item) {
    return item?.type === "weapon" && !isAmmunition(item);
}

/** Item ids of ammunition (any item with system.ammoType set). */
function ownedAmmoIds(actor) {
    return new Set(
        [...(actor?.items?.contents ?? [])]
            .filter(i => i?.system?.ammoType)
            .map(i => i.id)
            .filter(Boolean)
    );
}

/**
 * Normalized bandolier state. Pure: prunes references to deleted
 * items and clamps `current`, but never persists.
 */
export function getBandolier(actor) {
    const raw = actor?.getFlag?.(FLAG_SCOPE, FLAG_KEY) ?? null;
    const valid = ownedWeaponIds(actor);
    const sets = DEFAULT_SET_NAMES.map((name, i) => {
        const s = raw?.sets?.[i] ?? {};
        const pick = v => (typeof v === "string" && v.length && valid.has(v) ? v : null);
        const label = typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 24) : name;
        return { name: label, left: pick(s.left), right: pick(s.right) };
    });
    let current = Number(raw?.current);
    if (!Number.isInteger(current) || current < 0 || current >= sets.length) current = 0;
    // Quiver: the designated ready ammunition stack (pruned if deleted).
    const ammoIds = ownedAmmoIds(actor);
    const quiver = (typeof raw?.quiver === "string" && raw.quiver.length && ammoIds.has(raw.quiver))
        ? raw.quiver
        : null;
    return { current, sets, quiver, swappedThisRound: !!raw?.swappedThisRound };
}

/**
 * Ensure bandolier state exists. First call seeds the Ready set from
 * currently-worn weapons (the pre-bandolier "equipped" state).
 */
export async function ensureBandolier(actor) {
    const raw = actor?.getFlag?.(FLAG_SCOPE, FLAG_KEY);
    if (!(raw && Array.isArray(raw.sets) && raw.sets.length === DEFAULT_SET_NAMES.length)) {
        const worn = [...(actor?.items?.contents ?? [])].filter(i => isWieldableWeapon(i) && isWorn(i));
        const sets = DEFAULT_SET_NAMES.map(blankSet);
        if (worn[0]?.id) sets[0].left = worn[0].id;
        if (worn[1]?.id) sets[0].right = worn[1].id;
        // Seed the quiver from the first worn ammunition stack with shots left.
        const wornAmmo = [...(actor?.items?.contents ?? [])].find(i =>
            isAmmunition(i) && isWorn(i) && (Number(i.system?.quantity) || 0) > 0);
        const fresh = { current: 0, sets, quiver: wornAmmo?.id ?? null, swappedThisRound: false };
        try {
            await actor.setFlag(FLAG_SCOPE, FLAG_KEY, fresh);
        } catch (e) { /* best-effort */ }
    }
    // Self-heal: the quivered stack is the designated ready ammunition.
    // If something packed it (e.g. a pre-fix weapon swap), re-equip it
    // so "in the quiver" always means ready to fire.
    const healed = getBandolier(actor);
    if (healed.quiver) {
        const qitem = actor.items?.get(healed.quiver);
        if (qitem && !isWorn(qitem)) {
            try {
                await actor.updateEmbeddedDocuments("Item", [{ _id: qitem.id, "system.location": "equipped" }]);
            } catch (e) { /* best-effort */ }
        }
    }
    return getBandolier(actor);
}

/** Same in-combat test the sheet uses for config lockouts. */
export function isActorInCombat(actor) {
    try {
        return (game.combat?.combatants ?? []).some(c => c.actor?.id === actor?.id);
    } catch (e) {
        return false;
    }
}

function weaponName(actor, id) {
    return actor?.items?.get(id)?.name ?? "—";
}

/**
 * Swap to a bandolier set. Flips item locations (wielded weapons go
 * to pack; the new set's weapons equip — shields and other gear are
 * untouched) and marks the round when in combat.
 */
export async function swapBandolierSet(actor, setIndex) {
    if (!actor) return { ok: false, message: "No actor." };
    const b = await ensureBandolier(actor);
    const idx = Number(setIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= b.sets.length) {
        return { ok: false, message: "Unknown bandolier set." };
    }
    const target = b.sets[idx];
    if (idx === b.current) return { ok: false, message: `Already wielding ${target.name}.` };
    const unlocks = bandolierUnlocks(actor);
    if (!unlocks[idx].left && !unlocks[idx].right) {
        return { ok: false, message: `${target.name} is locked — purchase Battle Ready ranks to open it.` };
    }
    if (!target.left && !target.right) {
        return { ok: false, message: `No weapons assigned to ${target.name}.` };
    }
    const stun = activeStun(actor.system?.status?.stun);
    if (stun) return { ok: false, message: `${actor.name} is stunned and cannot swap weapons.` };
    const inCombat = isActorInCombat(actor);
    if (inCombat && b.swappedThisRound) {
        return { ok: false, message: `${actor.name} has already swapped weapons this round.` };
    }

    // Wielded = the bandolier's current set: every equipped WEAPON
    // goes to pack (ammunition is never packed here — the quiver owns
    // it), then the new set's weapons equip.
    const locUpdates = new Map();
    for (const item of actor.items?.contents ?? []) {
        if (isWieldableWeapon(item) && isWorn(item)) locUpdates.set(item.id, "pack");
    }
    const wield = [target.left, target.right].filter(Boolean);
    for (const id of wield) locUpdates.set(id, "equipped");
    try {
        const updates = [...locUpdates].map(([_id, loc]) => ({ _id, "system.location": loc }));
        if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    } catch (e) {
        return { ok: false, message: "Weapon swap failed to update items." };
    }
    const next = { ...b, current: idx, swappedThisRound: inCombat ? true : b.swappedThisRound };
    try {
        await actor.setFlag(FLAG_SCOPE, FLAG_KEY, next);
    } catch (e) { /* best-effort */ }

    try {
        const names = wield.map(id => esc(weaponName(actor, id))).join(" / ");
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Combat",
                `<h2>${esc(actor.name)} swaps weapons</h2>`
                + `<p>Wields <strong>${esc(target.name)}</strong> (${names}).</p>`
                + (inCombat
                    ? `<p><em>Changing weapons costs 50% activity (Arms Law) — attacks this round at half OB.</em></p>`
                    : ""))
        });
    } catch (e) { /* chat is best-effort */ }
    return { ok: true, setIndex: idx };
}

/**
 * Assign (or clear) a weapon in a bandolier slot. Out of combat only.
 * A weapon can only occupy one slot; assigning it elsewhere first
 * removes it from its old slot.
 */
export async function setBandolierSlot(actor, setIndex, side, itemId) {
    if (!actor) return { ok: false, message: "No actor." };
    if (isActorInCombat(actor)) {
        return { ok: false, message: "Cannot reconfigure the bandolier in combat." };
    }
    const b = await ensureBandolier(actor);
    const idx = Number(setIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= b.sets.length) {
        return { ok: false, message: "Unknown bandolier set." };
    }
    if (side !== "left" && side !== "right") return { ok: false, message: "Unknown hand." };
    if (!bandolierUnlocks(actor)[idx][side]) {
        return { ok: false, message: "That slot is locked — purchase Battle Ready ranks to open it." };
    }
    const id = (typeof itemId === "string" && itemId.length) ? itemId : null;
    if (id) {
        const item = actor.items?.get(id);
        if (!item || !isWieldableWeapon(item)) {
            return { ok: false, message: isAmmunition(item)
                ? "Ammunition goes in the quiver, not a weapon slot."
                : "That is not one of your weapons." };
        }
    }
    const sets = b.sets.map(s => ({ ...s }));
    if (id) {
        for (const s of sets) {
            if (s.left === id) s.left = null;
            if (s.right === id) s.right = null;
        }
    }
    const prev = sets[idx][side];
    sets[idx][side] = id;
    // Editing the wielded set keeps item locations in sync.
    const locUpdates = new Map();
    if (idx === b.current) {
        if (prev && prev !== id) locUpdates.set(prev, "pack");
        if (id) locUpdates.set(id, "equipped");
    }
    try {
        const updates = [...locUpdates].map(([_id, loc]) => ({ _id, "system.location": loc }));
        if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
        await actor.setFlag(FLAG_SCOPE, FLAG_KEY, { ...b, sets });
    } catch (e) {
        return { ok: false, message: "Bandolier update failed." };
    }
    return { ok: true };
}

/** Rename a bandolier set. Out of combat only. */
export async function renameBandolierSet(actor, setIndex, name) {
    if (!actor) return { ok: false, message: "No actor." };
    if (isActorInCombat(actor)) {
        return { ok: false, message: "Cannot reconfigure the bandolier in combat." };
    }
    const b = await ensureBandolier(actor);
    const idx = Number(setIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= b.sets.length) {
        return { ok: false, message: "Unknown bandolier set." };
    }
    const clean = String(name ?? "").trim().slice(0, 24) || DEFAULT_SET_NAMES[idx];
    const sets = b.sets.map((s, i) => (i === idx ? { ...s, name: clean } : { ...s }));
    try {
        await actor.setFlag(FLAG_SCOPE, FLAG_KEY, { ...b, sets });
    } catch (e) {
        return { ok: false, message: "Bandolier update failed." };
    }
    return { ok: true };
}

/**
 * Designate the quiver's ready ammunition stack. Assigning a stack
 * equips it (the missile attack flow only offers equipped ammunition);
 * replacing or clearing the quiver stows the previously quivered
 * stack. Out of combat only, like the weapon-set configuration.
 */
export async function setQuiver(actor, itemId) {
    if (!actor) return { ok: false, message: "No actor." };
    if (isActorInCombat(actor)) {
        return { ok: false, message: "Cannot reconfigure the quiver in combat." };
    }
    const b = await ensureBandolier(actor);
    const id = (typeof itemId === "string" && itemId.length) ? itemId : null;
    if (id === b.quiver) return { ok: true };
    if (id) {
        const item = actor.items?.get(id);
        if (!item || !item.system?.ammoType) return { ok: false, message: "That is not ammunition." };
        if ((Number(item.system?.quantity) || 0) <= 0) {
            return { ok: false, message: `${item.name} has no shots left.` };
        }
    }
    const locUpdates = new Map();
    if (b.quiver && b.quiver !== id) locUpdates.set(b.quiver, "pack");
    if (id) locUpdates.set(id, "equipped");
    try {
        const updates = [...locUpdates].map(([_id, loc]) => ({ _id, "system.location": loc }));
        if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
        await actor.setFlag(FLAG_SCOPE, FLAG_KEY, { ...b, quiver: id });
    } catch (e) {
        return { ok: false, message: "Quiver update failed." };
    }
    return { ok: true };
}

/**
 * Template context for the Bandolier panel. Pure builder — the caller
 * awaits ensureBandolier first (context prepare); this never writes.
 */
export function buildBandolierContext(actor) {
    const b = getBandolier(actor);
    const unlocks = bandolierUnlocks(actor);
    const weapons = [...(actor?.items?.contents ?? [])]
        .filter(i => isWieldableWeapon(i))
        .map(i => ({ id: i.id, name: i.name ?? "Unnamed weapon" }));
    const inCombat = isActorInCombat(actor);
    const canConfigure = !inCombat;
    // Quiver: the designated ready ammunition stack.
    const ammo = [...(actor?.items?.contents ?? [])]
        .filter(i => i?.system?.ammoType)
        .map(i => ({
            id: i.id,
            name: i.name ?? "Ammunition",
            ammoType: i.system.ammoType,
            quantity: Number(i.system?.quantity) || 0
        }));
    const qitem = b.quiver ? ammo.find(a => a.id === b.quiver) : null;
    const quiver = {
        itemId: b.quiver ?? "",
        itemName: qitem ? qitem.name : "— empty —",
        quantity: qitem ? qitem.quantity : 0,
        options: [
            { id: "", name: "— empty —", quantity: 0, selected: !b.quiver },
            ...ammo
                .filter(a => a.quantity > 0 || a.id === b.quiver)
                .map(a => ({ ...a, selected: a.id === b.quiver }))
        ]
    };
    const slot = (setIdx, side, itemId) => {
        const unlocked = unlocks[setIdx][side];
        const item = itemId ? weapons.find(w => w.id === itemId) : null;
        return {
            side,
            unlocked,
            itemId: itemId ?? "",
            itemName: item ? item.name : "— empty —",
            lockedNote: unlocked ? "" : `Battle Ready rank ${bandolierRankNeed(setIdx, side)}`,
            options: unlocked
                ? [{ id: "", name: "— empty —", selected: !itemId },
                   ...weapons.map(w => ({ id: w.id, name: w.name, selected: w.id === itemId }))]
                : []
        };
    };
    return {
        inCombat,
        canConfigure,
        swappedThisRound: b.swappedThisRound,
        battleReadyRank: battleReadyRank(actor),
        quiver,
        sets: b.sets.map((s, i) => ({
            index: i,
            name: s.name,
            isCurrent: i === b.current,
            canSwapTo: i !== b.current
                && (unlocks[i].left || unlocks[i].right)
                && !!(s.left || s.right)
                && !(inCombat && b.swappedThisRound),
            left: slot(i, "left", s.left),
            right: slot(i, "right", s.right)
        }))
    };
}
