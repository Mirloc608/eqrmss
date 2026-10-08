// ============================================================
// EQRMSS Pet Lifecycle — Phase 5 (2026-10-08)
//
// Poof rules (user decisions 2026-10-08):
// - Caster death: pet ALWAYS poofs (persistence AA does not save it).
// - Owner logout: pet poofs UNLESS owner has the Persistent Minion AA.
//
// Persistence AA: "aa-persistent-minion"
// (module/data/aas/archetype/persistent-minion.json — real EQ AA,
//  archetype AA for beastlord/enchanter/magician/necromancer/
//  shadowknight/shaman, NOT invented.)
//
// Foundry VTT has no user-disconnect hook, so logout detection is
// a GM-side poll: we track user.active transitions and poof pets
// whose owners go from active -> inactive.
// ============================================================

import { dismissPet } from "./summon-pet.js";

const MODULE_ID = "eqrmss";
const PERSISTENCE_AA_ID = "aa-persistent-minion";

// User IDs seen active this session (for logout transition detection).
// Module-level: persists for the life of the GM client.
const seenActiveUsers = new Set();

/**
 * Find ALL pets owned by a caster (not just the first — the one-pet
 * limit is enforced at summon time, but be thorough on poof).
 *
 * @param {object} caster - Owner actor
 * @returns {Array} Pet actors
 */
export function findAllCasterPets(caster) {
    if (!caster) return [];
    const casterId = caster.id;
    try {
        return (globalThis.game?.actors ?? []).filter(a =>
            a?.type === "pet" &&
            (a?.system?.pet?.owner === casterId || a?.getFlag(MODULE_ID, "ownerId") === casterId)
        );
    } catch { return []; }
}

/**
 * Does the owner have the Persistent Minion AA at rank >= 1?
 * Reads purchased rank from system.aa.abilities (same pattern as
 * signature abilities / aa-advancement.js).
 *
 * @param {object} owner - Owner actor
 * @returns {boolean}
 */
export function ownerHasPersistenceAA(owner) {
    try {
        const abilities = owner?.system?.aa?.abilities ?? [];
        const entry = abilities.find(a => a?.id === PERSISTENCE_AA_ID);
        return (Number(entry?.rank) || 0) >= 1;
    } catch { return false; }
}

/**
 * Dismiss all of an owner's pets.
 *
 * @param {object} owner - Owner actor
 * @param {string} reason - Dismissal reason for chat (e.g. "dissipates as its master falls")
 * @returns {Promise<string>} HTML chat notes ("" if no pets)
 */
export async function poofPetsOfOwner(owner, reason) {
    if (!owner) return "";
    const pets = findAllCasterPets(owner);
    if (!pets.length) return "";
    let notes = "";
    for (const pet of pets) {
        try {
            notes += await dismissPet(pet, reason);
        } catch (err) {
            console.warn("EQRMSS | pet poof failed:", err);
        }
    }
    return notes;
}

/**
 * Get all users as an array (Foundry Collections are Map-like;
 * spreading one yields [key, value] entries, so use .filter()).
 */
function allUsers() {
    const users = globalThis.game?.users;
    if (!users) return [];
    if (typeof users.filter === "function") return users.filter(() => true);
    return [...(users.values?.() ?? [])];
}

/**
 * Find the non-GM users who own a given actor.
 * Prefers assigned character, falls back to ownership permission.
 *
 * @param {object} ownerActor - Actor to find users for
 * @returns {Array} User objects
 */
function findOwnerUsers(ownerActor) {
    const game = globalThis.game;
    if (!game || !ownerActor) return [];
    const users = allUsers().filter(u => !u.isGM);
    // Assigned character match first
    const assigned = users.filter(u => u.character?.id === ownerActor.id);
    if (assigned.length) return assigned;
    // Ownership permission fallback
    try {
        return users.filter(u => {
            try { return ownerActor.testUserPermission(u, "OWNER"); }
            catch { return false; }
        });
    } catch { return []; }
}

/**
 * Check for pets whose owners have logged out (GM-side).
 * Only poofs on active -> inactive transitions, and only if the
 * owner lacks the Persistent Minion AA.
 *
 * @returns {Promise<string>} HTML chat notes ("" if none)
 */
export async function checkOrphanedPets() {
    const game = globalThis.game;
    if (!game?.user?.isGM) return "";

    // Update the seen-active set with currently active users
    for (const u of allUsers()) {
        if (u.isGM) continue;
        if (u.active) seenActiveUsers.add(u.id);
    }

    let notes = "";
    const actors = game?.actors;
    const pets = (typeof actors?.filter === "function"
        ? actors.filter(a => a?.type === "pet")
        : [...(actors?.values?.() ?? [])].filter(a => a?.type === "pet"));

    for (const pet of pets) {
        try {
            const ownerId = pet?.system?.pet?.owner ?? pet?.getFlag(MODULE_ID, "ownerId");
            if (!ownerId) continue;
            const owner = actors?.get?.(ownerId);
            if (!owner) continue;

            // Persistence AA saves the pet on logout
            if (ownerHasPersistenceAA(owner)) continue;

            // Find owner's users
            const ownerUsers = findOwnerUsers(owner);
            if (!ownerUsers.length) continue; // NPC or unowned — no logout to detect

            // Poof only if ALL owner users are inactive AND at least one
            // was previously active (i.e., this is a logout, not a
            // never-connected user)
            const anyActive = ownerUsers.some(u => u.active);
            if (anyActive) continue;
            const wasActive = ownerUsers.some(u => seenActiveUsers.has(u.id));
            if (!wasActive) continue;

            console.info(`EQRMSS | Pet "${pet.name}" poofed: owner "${owner.name}" logged out (no Persistent Minion AA).`);
            notes += await dismissPet(pet, "dissipates as its master departs");
        } catch (err) {
            console.warn("EQRMSS | orphaned pet check failed:", err);
        }
    }

    return notes;
}

/**
 * Start the GM-side logout poll. Call once on ready (GM only).
 * Checks every intervalMs for newly-logged-out users.
 *
 * @param {number} intervalMs - Poll interval (default 60s)
 */
export function startLogoutPoll(intervalMs = 60000) {
    const game = globalThis.game;
    if (!game?.user?.isGM) return;

    // Seed the seen-active set with currently active users
    for (const u of allUsers()) {
        if (!u.isGM && u.active) seenActiveUsers.add(u.id);
    }

    setInterval(async () => {
        try {
            const notes = await checkOrphanedPets();
            if (notes) {
                await ChatMessage.create({
                    content: `<h2>Pets</h2>${notes}`,
                    speaker: { alias: "EQRMSS" }
                });
            }
        } catch (err) {
            console.error("EQRMSS | pet logout poll failed:", err);
        }
    }, intervalMs);

    console.info(`EQRMSS | Pet logout poll started (${intervalMs / 1000}s interval).`);
}
