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
 * @param {object} pet - Pet actor
 * @returns {object} Synthetic weapon item
 */
function syntheticPetWeapon(pet) {
    const scaling = pet?.system?.pet?.scaling ?? {};
    const family = pet?.system?.pet?.family ?? pet?.system?.details?.creatureType ?? "animal";
    const tableName = PET_ATTACK_TABLES[family] ?? "Armored Fist";
    const ob = Number(scaling.ob) || 0;
    const petName = pet?.name ?? "Pet";
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
            location: "equipped",
            equipped: true,
        },
    };
}

/**
 * Have the pet attack a target.
 * @param {object} pet - Pet actor
 * @param {object} targetActor - Target actor
 * @returns {Promise<object>} Result from rollWeaponAttack
 */
export async function petAttack(pet, targetActor) {
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

    const synthetic = syntheticPetWeapon(pet);
    try {
        const { rollWeaponAttack } = await import("../combat/combat-rolls.js");
        return await rollWeaponAttack(pet, synthetic, {
            targetToken,
            skipPetFollowup: true, // Prevent recursion
        });
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
