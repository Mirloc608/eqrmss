// ============================================================
// EQRMSS Pet Combat (2026-10-08)
//
// Phase 3: Pet control — pets act on the same turn, AFTER the owner.
//
// - "attack": pet attacks the owner's current target (or nearest hostile)
// - "guard": pet attacks anything that harmed the owner or the pet
// - "follow": pet does nothing in combat
//
// Hooked at the end of rollWeaponAttack (combat-rolls.js): after the
// owner's attack resolves, petActAfterOwner() runs the pet's action.
// ============================================================

import { getPetWeapon } from "./pet-equipment.js";

/**
 * Attack table per pet family (natural attacks).
 * Names must match module/data/combat/weapon-tables.json.
 */
export const PET_ATTACK_TABLES = {
    elemental: "Armored Fist",
    undead: "Claw/Talon",
    animal: "Bite",
    construct: "Armored Fist",
    dragon: "Claw/Talon",
    insect: "Bite",
    plant: "Grapple/Swallow",
};

/**
 * Upgraded attack tables for warder-buffed pets (Tier 5).
 * Maps base table -> improved table.
 */
export const PET_ATTACK_UPGRADES = {
    "Bite": "Claw/Talon",
    "Claw/Talon": "Claw/Talon", // Already top tier
    "Armored Fist": "Claw/Talon",
    "Grapple/Swallow": "Claw/Talon",
};

/**
 * Find the owner's active pet (one-pet limit).
 * @param {object} owner - Owner actor
 * @returns {object|null} Pet actor or null
 */
export function findOwnerPet(owner) {
    if (!owner) return null;
    const ownerId = owner.id;
    try {
        const pets = (globalThis.game?.actors ?? []).filter(a =>
            a?.type === "pet" &&
            (a?.system?.pet?.owner === ownerId || a?.getFlag("eqrmss", "ownerId") === ownerId)
        );
        return pets[0] ?? null;
    } catch { return null; }
}

/**
 * Check if a pet can act (not dead, stunned, feared, feigning).
 * @param {object} pet - Pet actor
 * @returns {boolean}
 */
function petCanAct(pet) {
    if (!pet) return false;
    const st = pet.system?.status ?? {};
    if (st.dead) return false;
    if (st.unconscious) return false;
    if (Number(st.fear?.rounds ?? 0) > 0) return false;
    if (st.feigned) return false;
    // Stun check (reuse the same helper pattern as combat-rolls)
    try {
        const pool = st.stun ?? {};
        const total = Object.values(pool).reduce((s, v) => s + (Number(v) || 0), 0);
        if (total > 0) return false;
    } catch { /* ignore */ }
    return true;
}

/**
 * Get the nearest hostile token's actor to the pet.
 * @param {object} pet - Pet actor
 * @returns {object|null} Target actor or null
 */
function nearestHostile(pet) {
    try {
        const petToken = pet.getActiveTokens?.()?.[0] ?? null;
        if (!petToken) return null;
        const px = petToken.x ?? 0;
        const py = petToken.y ?? 0;
        const petDisp = petToken.document?.disposition ?? 1;
        let best = null;
        let bestDist = Infinity;
        for (const tok of globalThis.canvas?.tokens?.placeables ?? []) {
            if (!tok?.actor || tok.actor.id === pet.id) continue;
            if (tok.actor.system?.status?.dead) continue;
            const disp = tok.document?.disposition ?? 0;
            // Hostile = opposite disposition
            const isHostile = (petDisp === 1 && disp === -1) || (petDisp === -1 && disp === 1);
            if (!isHostile) continue;
            const dx = (tok.x ?? 0) - px;
            const dy = (tok.y ?? 0) - py;
            const dist = Math.hypot(dx, dy);
            if (dist < bestDist) {
                bestDist = dist;
                best = tok.actor;
            }
        }
        return best;
    } catch { return null; }
}

/**
 * Resolve the pet's target based on its command.
 * @param {object} pet - Pet actor
 * @param {object} owner - Owner actor
 * @param {object|null} ownerTarget - Owner's current target actor (may be null)
 * @returns {object|null} Target actor or null
 */
export function resolvePetTarget(pet, owner, ownerTarget) {
    const command = pet?.system?.pet?.command ?? "follow";
    if (command === "follow") return null;

    if (command === "attack") {
        // Owner's target first, else nearest hostile
        if (ownerTarget && !ownerTarget.system?.status?.dead) return ownerTarget;
        return nearestHostile(pet);
    }

    if (command === "guard") {
        // Attack whoever harmed the owner or the pet (highest damage first)
        const candidates = [];
        const ownerAggro = owner?.system?.status?.aggro ?? {};
        const petAggro = pet?.system?.status?.aggro ?? {};
        const seen = new Set();
        for (const [attackerId, record] of Object.entries({ ...ownerAggro, ...petAggro })) {
            if (seen.has(attackerId)) continue;
            seen.add(attackerId);
            const attacker = globalThis.game?.actors?.get(attackerId) ?? null;
            if (!attacker || attacker.system?.status?.dead) continue;
            candidates.push({ attacker, damage: Number(record?.damage) || 0 });
        }
        candidates.sort((a, b) => b.damage - a.damage);
        if (candidates.length) return candidates[0].attacker;
        // No one has attacked — fall back to owner's target
        if (ownerTarget && !ownerTarget.system?.status?.dead) return ownerTarget;
        return null;
    }

    return null;
}

/**
 * Build a synthetic natural-attack weapon for the pet.
 * Follows the syntheticBoltWeapon pattern from cast-spell.js.
 *
 * Warder buffs (system.pet.buffs) modify the weapon:
 * Build a synthetic natural-attack weapon for the pet.
 * Follows the syntheticBoltWeapon pattern from cast-spell.js.
 *
 * If the pet has an equipped weapon (pet inventory, 2026-10-08), use it:
 * the weapon's attack table (or the family natural table as fallback) with
 * the pet's OB plus the weapon's attack bonus. Weapon type restrictions are
 * ignored for pets (user ruling — e.g. animals use summoned weapons).
 *
 * All pets are magical attackers (system.pet.isMagical = true).
 * HOOK: If creatures gain a "requires magic weapon" immunity, check
 * pet.system.pet.isMagical in the attack resolution pipeline to bypass it.
 *
 * @param {object} pet - Pet actor
 * @param {string|null} [attackKind] - "natural" forces the natural attack
 *   (skips the equipped-weapon branch); anything else prefers the
 *   equipped weapon when one exists.
 * @returns {object} Synthetic weapon item
 */
function syntheticPetWeapon(pet, attackKind = null) {
    const scaling = pet?.system?.pet?.scaling ?? {};
    const buffs = pet?.system?.pet?.buffs ?? {};
    const family = pet?.system?.pet?.family ?? pet?.system?.details?.creatureType ?? "animal";
    let tableName = PET_ATTACK_TABLES[family] ?? "Armored Fist";
    // Tier 5 warder buff: upgrade the attack table
    if (buffs.attackUpgrade) {
        tableName = PET_ATTACK_UPGRADES[tableName] ?? tableName;
    }
    const ob = Number(scaling.ob) || 0;
    const petName = pet?.name ?? "Pet";
    const critSteps = Number(buffs.critSteps) || 0;

    // Equipped weapon (pet-equipment.js): prefer it over natural attacks,
    // unless the caller explicitly asked for the natural form (e.g. the
    // pet sheet's per-form Attack buttons).
    if (attackKind !== "natural") {
    try {
        const equipped = getPetWeapon(pet);
        if (equipped) {
            const sys = equipped.system ?? {};
            const bonuses = sys.bonuses ?? {};
            return {
                _id: equipped.id,
                id: equipped.id,
                name: equipped.name,
                type: "weapon",
                system: {
                    type: sys.weaponType ?? "melee",
                    attackTable: sys.attackTable ?? tableName,
                    obMod: ob + (Number(bonuses.attackBonus) || 0),
                    damageMod: Number(bonuses.damageBonus) || 0,
                    criticalType: sys.criticalType ?? "",
                    // Magical attacker: bypasses "requires magic weapon" immunities
                    isMagical: pet?.system?.pet?.isMagical ?? true,
                    // Crit range expansion from warder buffs
                    critRangeMod: critSteps,
                    location: "equipped",
                    equipped: true,
                },
            };
        }
    } catch { /* fall through to natural attack */ }
    }

    return {
        _id: `pet-attack-${pet?.id ?? "x"}`,
        id: `pet-attack-${pet?.id ?? "x"}`,
        name: `${petName}'s Attack`,
        type: "weapon",
        system: {
            type: "natural",
            attackTable: tableName,
            obMod: ob,
            damageMod: 0,
            criticalType: "",
            // Magical attacker: bypasses "requires magic weapon" immunities
            // (hook point for future creature immunity mechanics)
            isMagical: pet?.system?.pet?.isMagical ?? true,
            // Crit range expansion: each step widens the crit threshold
            // (handled by the combat engine if it reads critRangeMod)
            critRangeMod: critSteps,
            location: "equipped",
            equipped: true,
        },
    };
}

/**
 * Have the pet attack a target.
 * Warder buffs may grant bonus attacks (system.pet.buffs.bonusAttacks).
 * @param {object} pet - Pet actor
 * @param {object} targetActor - Target actor
 * @param {string|null} [attackKind] - "natural" forces the natural attack
 *   form; otherwise the equipped weapon is preferred when present.
 * @returns {Promise<object>} Result from rollWeaponAttack (last attack)
 */
export async function petAttack(pet, targetActor, attackKind = null) {
    if (!pet || !targetActor) return { error: "no-target" };
    if (!petCanAct(pet)) return { error: "cannot-act" };

    // Permission check: pet owner or GM
    const canControl = pet.isOwner || globalThis.game?.user?.isGM;
    if (!canControl) return { error: "no-permission" };

    // Find the target's token for the attack
    let targetToken = null;
    try {
        const tokens = targetActor.getActiveTokens?.() ?? [];
        targetToken = tokens[0] ?? null;
    } catch { /* ignore */ }

    const synthetic = syntheticPetWeapon(pet, attackKind);
    const bonusAttacks = Number(pet?.system?.pet?.buffs?.bonusAttacks) || 0;
    const totalAttacks = 1 + bonusAttacks;

    let lastResult = null;
    try {
        const { rollWeaponAttack } = await import("../../combat/combat-rolls.js");
        for (let i = 0; i < totalAttacks; i++) {
            lastResult = await rollWeaponAttack(pet, synthetic, {
                targetToken,
                skipPetFollowup: true, // Prevent recursion
            });
            // Stop if the target died mid-sequence
            if (targetActor.system?.status?.dead) break;
        }
        return lastResult ?? { error: "no-attacks" };
    } catch (err) {
        console.warn("EQRMSS | petAttack failed:", err);
        return { error: "attack-failed", message: err?.message };
    }
}

/**
 * Main entry: called after the owner's attack resolves.
 * The pet acts on the same turn, after the owner.
 *
 * @param {object} owner - Owner actor (just acted)
 * @param {object|null} ownerTarget - Owner's target actor (may be null)
 */
export async function petActAfterOwner(owner, ownerTarget) {
    if (!owner || owner.type === "pet") return;
    // Familiars don't get a combat turn (user decision 2026-10-08)
    const pet = findOwnerPet(owner);
    if (!pet) return;
    if (pet.system?.pet?.petType === "familiar") return;
    if (!petCanAct(pet)) return;

    const command = pet.system?.pet?.command ?? "follow";
    if (command === "follow") return;

    const target = resolvePetTarget(pet, owner, ownerTarget);
    if (!target) return;

    await petAttack(pet, target);
}

const esc = (s) => globalThis.foundry?.utils?.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
