// ============================================================
// EQRMSS Pet Bonding System
// ============================================================

const MODULE_ID = "eqrmss";

export function applyPetBonding(owner, pet) {
    const ownerStats = owner.system.stats ?? {};
    const petSystem = pet.system ?? {};

    // Shared Senses
    petSystem.sharedSenses = {
        perceptionBonus: Math.floor((ownerStats.IN?.total ?? 0) / 10),
        empathyLink: Math.floor((ownerStats.EM?.total ?? 0) / 20)
    };

    // Shared Stats (Bond Strength)
    const bondStrength = Math.floor((ownerStats.PR?.total ?? 0) / 25);

    petSystem.bond = {
        loyalty: bondStrength,
        sharedDB: bondStrength * 2,
        sharedAttackBonus: bondStrength,
        sharedResistBonus: bondStrength
    };

    return pet.update({ "system": petSystem });
}

// Auto‑apply bonding whenever pet is summoned
Hooks.on("updateActor", (actor, changes) => {
    if (actor.type !== "pet") return;
    if (!changes.system?.active) return;

    const ownerId = actor.getFlag(MODULE_ID, "ownerId");
    const owner = game.actors.get(ownerId);
    if (!owner) return;

    applyPetBonding(owner, actor);
});
