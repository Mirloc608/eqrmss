// ============================================================
// EQRMSS Pet Summoning
// ============================================================

const MODULE_ID = "eqrmss";

export async function summonPetFromSpell(casterActor, spellItem) {
    const petTemplateId = spellItem.system?.petTemplateId;
    if (!petTemplateId) {
        return ui.notifications.error("Summon Pet spell is missing petTemplateId.");
    }

    const template = game.actors.get(petTemplateId);
    if (!template) {
        return ui.notifications.error("Pet template actor not found.");
    }

    const petData = template.toObject();
    delete petData._id;

    const pet = await Actor.create(petData, { temporary: false });
    await pet.setFlag(MODULE_ID, "ownerId", casterActor.id);
    await pet.update({ "system.active": true });

    ui.notifications.info(`${casterActor.name} has summoned ${pet.name}.`);

    return pet;
}

// Example: hook into spell usage
Hooks.on("useItem", async (item, config) => {
    if (item.type !== "spell") return;
    if (item.system?.petTemplateId) {
        const caster = item.actor;
        await summonPetFromSpell(caster, item);
    }
});
