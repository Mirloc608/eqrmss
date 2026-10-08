// ============================================================
// EQRMSS Pet Equipment (2026-10-08)
//
// VERY simple inventory for pets. Two categories:
//
// Humanoid pets (undead, construct — skeleton, shade, golem):
//   - Armor (normal armor items)
//   - Shield
//   - Weapon
//   - Necklace (jewelry)
//
// Animal pets (animal, elemental, insect, plant, dragon):
//   - Barding (armor items, incl. magician summoned armors)
//   - Collar (jewelry)
//   - Weapon (magician summoned weapons; weapon type ignored)
//
// Items are embedded Item documents on the pet actor. Equipping sets
// system.equipped = true + system.petSlot = slot id. Bonuses are read
// from item.system.bonuses (same fields as the PC equipment engine).
// ============================================================

const MODULE_ID = "eqrmss";

/** Families treated as humanoid for equipment purposes. */
const HUMANOID_FAMILIES = new Set(["undead", "construct"]);

/**
 * Get the pet's equipment category.
 * @param {object} pet - Pet actor
 * @returns {"humanoid"|"animal"}
 */
export function getPetCategory(pet) {
    const family = String(pet?.system?.pet?.family ?? "").toLowerCase();
    return HUMANOID_FAMILIES.has(family) ? "humanoid" : "animal";
}

/**
 * Get the equipment slots for a pet.
 * @param {object} pet - Pet actor
 * @returns {Array<{id,label,itemTypes}>}
 */
export function getPetSlots(pet) {
    if (getPetCategory(pet) === "humanoid") {
        return [
            { id: "armor", label: "Armor", itemTypes: ["armor"] },
            { id: "shield", label: "Shield", itemTypes: ["shield"] },
            { id: "weapon", label: "Weapon", itemTypes: ["weapon"] },
            { id: "necklace", label: "Necklace", itemTypes: ["jewelry"] },
        ];
    }
    return [
        { id: "barding", label: "Barding", itemTypes: ["armor"] },
        { id: "collar", label: "Collar", itemTypes: ["jewelry"] },
        { id: "weapon", label: "Weapon", itemTypes: ["weapon"] },
    ];
}

/**
 * Find which slot an item belongs in (first matching slot for its type).
 * @param {object} pet - Pet actor
 * @param {object} item - Item document
 * @returns {object|null} Slot def or null
 */
export function getSlotForItem(pet, item) {
    const slots = getPetSlots(pet);
    return slots.find((s) => s.itemTypes.includes(item?.type)) ?? null;
}

/**
 * Equip an item into a slot (unequips any existing item in that slot).
 * @param {object} pet - Pet actor
 * @param {string} itemId - Item ID
 * @param {string} [slotId] - Slot ID (auto-detected from item type if omitted)
 * @returns {Promise<boolean>}
 */
export async function equipPetItem(pet, itemId, slotId) {
    if (!pet || !itemId) return false;
    const item = pet.items?.get(itemId) ?? null;
    if (!item) return false;

    const slot = slotId
        ? getPetSlots(pet).find((s) => s.id === slotId)
        : getSlotForItem(pet, item);
    if (!slot) {
        ui.notifications?.warn(`${item.name} cannot be equipped by ${pet.name}.`);
        return false;
    }
    if (!slot.itemTypes.includes(item.type)) {
        ui.notifications?.warn(`${item.name} cannot go in the ${slot.label} slot.`);
        return false;
    }

    try {
        // Unequip anything already in this slot
        for (const other of pet.items ?? []) {
            if (other.id !== itemId && other.system?.petSlot === slot.id && other.system?.equipped) {
                await other.update({ "system.equipped": false, "system.petSlot": "" });
            }
        }
        await item.update({ "system.equipped": true, "system.petSlot": slot.id });
        await syncPetCombatStats(pet);
        ui.notifications?.info(`${item.name} equipped (${slot.label}).`);
        return true;
    } catch (err) {
        console.warn("EQRMSS | equipPetItem failed:", err);
        return false;
    }
}

/**
 * Unequip an item.
 * @param {object} pet - Pet actor
 * @param {string} itemId - Item ID
 * @returns {Promise<boolean>}
 */
export async function unequipPetItem(pet, itemId) {
    if (!pet || !itemId) return false;
    const item = pet.items?.get(itemId) ?? null;
    if (!item) return false;
    try {
        await item.update({ "system.equipped": false, "system.petSlot": "" });
        await syncPetCombatStats(pet);
        ui.notifications?.info(`${item.name} unequipped.`);
        return true;
    } catch (err) {
        console.warn("EQRMSS | unequipPetItem failed:", err);
        return false;
    }
}

/**
 * Sum combat bonuses from equipped items.
 * Reads item.system.bonuses (same fields as the PC equipment engine).
 * @param {object} pet - Pet actor
 * @returns {{defense:number,attackBonus:number,damageBonus:number,shieldBonus:number}}
 */
export function getPetEquipmentBonuses(pet) {
    const bonuses = { defense: 0, attackBonus: 0, damageBonus: 0, shieldBonus: 0 };
    for (const item of pet?.items ?? []) {
        if (item?.system?.equipped !== true) continue;
        const b = item.system?.bonuses ?? {};
        bonuses.defense += Number(b.defense ?? b.armor ?? 0);
        bonuses.attackBonus += Number(b.attackBonus ?? 0);
        bonuses.damageBonus += Number(b.damageBonus ?? 0);
        if (item.type === "shield") {
            bonuses.shieldBonus += Number(b.shieldBonus ?? b.armor ?? b.defense ?? 0);
        }
    }
    return bonuses;
}

/**
 * Get the pet's equipped weapon, if any.
 * @param {object} pet - Pet actor
 * @returns {object|null} Weapon item or null
 */
export function getPetWeapon(pet) {
    for (const item of pet?.items ?? []) {
        if (item?.type === "weapon" && item?.system?.equipped === true) return item;
    }
    return null;
}

/**
 * Sync the pet's combat stats from scaling + equipment.
 * Sets system.combat.totalDB so the combat engine uses the pet's real
 * defense (pets previously defended at DB 0 — scaling.defense was
 * display-only).
 * @param {object} pet - Pet actor
 * @returns {Promise<void>}
 */
export async function syncPetCombatStats(pet) {
    if (!pet) return;
    const scaling = pet.system?.pet?.scaling ?? {};
    const baseDefense = Number(scaling.defense) || 0;
    const bonuses = getPetEquipmentBonuses(pet);
    try {
        await pet.update({
            "system.combat.totalDB": baseDefense + bonuses.defense,
            "system.combat.shieldBonus": bonuses.shieldBonus,
        });
    } catch (err) {
        console.warn("EQRMSS | syncPetCombatStats failed:", err);
    }
}

/**
 * Get the pet's effective defense (scaling + equipment) for display.
 * @param {object} pet - Pet actor
 * @returns {number}
 */
export function getPetDefense(pet) {
    const scaling = pet?.system?.pet?.scaling ?? {};
    const baseDefense = Number(scaling.defense) || 0;
    return baseDefense + getPetEquipmentBonuses(pet).defense;
}

/**
 * Get the pet's effective OB (scaling + weapon bonus) for display.
 * @param {object} pet - Pet actor
 * @returns {number}
 */
export function getPetOB(pet) {
    const scaling = pet?.system?.pet?.scaling ?? {};
    const baseOB = Number(scaling.ob) || 0;
    return baseOB + getPetEquipmentBonuses(pet).attackBonus;
}
