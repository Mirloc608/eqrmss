// ============================================================
// EQRMSS Pet Initiative Inheritance (2026-10-08)
//
// Per user decision: "Pets will act on the same turn, after the owner."
// When a pet shares a combat with its owner, the pet's initiative is
// pinned to (owner's initiative - 0.01) so it sorts immediately after
// the owner in the tracker.
//
// This module covers what addPetToCombat() (summon-time) misses:
// - combat starts AFTER the pet was summoned
// - initiative is (re-)rolled while the pet is already a combatant
// - the pet's token is added to combat manually
//
// Hooks (registered in register-hooks.js, GM-only):
// - createCombatant: pet joins -> inherit if owner already has initiative
// - updateCombatant: initiative changed -> pet re-inherits; owner change
//   fixes all of that owner's pets in the same combat.
//
// Loop-safe: updates are skipped when the pet is already within EPSILON
// of the expected value, so our own corrections never re-trigger work.
// Non-fatal: any failure is logged and the combat proceeds.
// ============================================================

const MODULE_ID = "eqrmss";
const EPSILON = 0.001;

/**
 * Owner actor id for a pet actor (system data first, then flag fallback).
 * @param {object} petActor
 * @returns {string|null}
 */
export function getPetOwnerId(petActor) {
    return petActor?.system?.pet?.owner ?? petActor?.getFlag?.(MODULE_ID, "ownerId") ?? null;
}

/**
 * True if this combatant represents a pet actor.
 * @param {object} combatant
 * @returns {boolean}
 */
export function isPetCombatant(combatant) {
    const actor = combatant?.actor ?? globalThis.game?.actors?.get(combatant?.actorId);
    return actor?.type === "pet";
}

/**
 * Resolve a combatant's actor, preferring the embedded lookup with a
 * global fallback (unlinked or not-yet-ready tokens).
 * @param {object} combatant
 * @returns {object|null}
 */
function resolveActor(combatant) {
    return combatant?.actor ?? globalThis.game?.actors?.get(combatant?.actorId) ?? null;
}

/**
 * Numeric initiative, or null when unrolled/invalid.
 * Note: Number(null) === 0, so null/undefined are checked explicitly.
 * @param {object} combatant
 * @returns {number|null}
 */
function numericInitiative(combatant) {
    const raw = combatant?.initiative;
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

/**
 * Pin a pet combatant's initiative to its owner's (owner - 0.01).
 * No-op when the owner isn't in this combat, has no initiative yet,
 * or the pet is already correct.
 * @param {object} petCombatant
 * @returns {Promise<void>}
 */
export async function inheritPetInitiative(petCombatant) {
    try {
        const combat = petCombatant?.parent ?? null;
        if (!combat || !isPetCombatant(petCombatant)) return;
        const petActor = resolveActor(petCombatant);
        const ownerId = getPetOwnerId(petActor);
        if (!ownerId) return;
        const ownerCombatant = (combat.combatants ?? []).find((c) => c.actorId === ownerId) ?? null;
        const ownerInit = numericInitiative(ownerCombatant);
        if (ownerInit === null) return; // owner unrolled: their roll will fix us
        const expected = ownerInit - 0.01;
        const current = numericInitiative(petCombatant);
        if (current !== null && Math.abs(current - expected) < EPSILON) return; // already correct
        await petCombatant.update({ initiative: expected });
    } catch (err) {
        console.warn("EQRMSS | inheritPetInitiative failed:", err);
    }
}

/**
 * After a combatant's initiative changes, keep pets in sync:
 * - changed combatant is a pet -> re-inherit from its owner
 * - changed combatant is anyone else -> fix that actor's pets in combat
 * @param {object} combat
 * @param {object} changedCombatant
 * @returns {Promise<void>}
 */
export async function syncPetInitiatives(combat, changedCombatant) {
    try {
        if (!combat || !changedCombatant) return;
        if (isPetCombatant(changedCombatant)) {
            await inheritPetInitiative(changedCombatant);
            return;
        }
        const actorId = changedCombatant.actorId;
        if (!actorId) return;
        for (const c of combat.combatants ?? []) {
            if (!isPetCombatant(c)) continue;
            if (getPetOwnerId(resolveActor(c)) === actorId) {
                await inheritPetInitiative(c);
            }
        }
    } catch (err) {
        console.warn("EQRMSS | syncPetInitiatives failed:", err);
    }
}
