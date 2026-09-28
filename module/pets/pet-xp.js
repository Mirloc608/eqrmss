// ============================================================
// EQRMSS Pet XP / Leveling
// ============================================================

const MODULE_ID = "eqrmss";

export function grantPetXp(petActor, amount) {
    const system = petActor.system ?? {};
    const currentXp = system.xp ?? 0;
    const level = system.level ?? 1;
    const nextLevelXp = system.nextLevelXp ?? (level * 1000);

    const newXp = currentXp + amount;

    let newLevel = level;
    let newNextLevelXp = nextLevelXp;

    if (newXp >= nextLevelXp) {
        newLevel = level + 1;
        newNextLevelXp = newLevel * 1000;
        ui.notifications.info(`${petActor.name} has reached level ${newLevel}!`);
    }

    return petActor.update({
        "system.xp": newXp,
        "system.level": newLevel,
        "system.nextLevelXp": newNextLevelXp
    });
}

// Example hook: grant pet XP when owner gains XP
Hooks.on("updateActor", (actor, changes) => {
    if (actor.type !== "player") return;
    if (!changes.system?.xp) return;

    const pets = game.actors.filter(a =>
        a.type === "pet" &&
        a.getFlag(MODULE_ID, "ownerId") === actor.id
    );

    const delta = changes.system.xp - (actor.system?.xp ?? 0);
    if (delta <= 0) return;

    for (const pet of pets) {
        grantPetXp(pet, Math.floor(delta * 0.5)); // 50% of owner XP
    }
});
