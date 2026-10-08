// ============================================================
// EQRMSS Pet Actor Sheet
// ============================================================

import EQRMSSActorSheet from "./eqrmss_actor_sheet.js";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

export default class EQRMSSPetSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

    static DEFAULT_OPTIONS = {
        classes: ["eqrmss", "sheet", "actor", "pet-sheet"],
        position: { width: 560, height: 560 },
        form: {
            closeOnSubmit: false,
            submitOnChange: true
        }
    };

    static PARTS = {
        form: {
            template: "systems/eqrmss/templates/sheets/actors/eqrmss_pet_sheet.html"
        }
    };

    get actor() {
        return this.document;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.actor.system ?? {};
        const pet = system.pet ?? {};
        const scaling = pet.scaling ?? {};

        // Owner name from flag (summonPet stores flags.eqrmss.ownerId)
        let ownerName = "—";
        try {
            const ownerId = pet.owner ?? this.actor.getFlag("eqrmss", "ownerId");
            const owner = ownerId ? game.actors.get(ownerId) : null;
            if (owner) ownerName = owner.name;
        } catch { /* ignore */ }

        const hitsMax = Number(system.hits?.max) || 0;
        const hitsTaken = Number(system.hits?.value) || 0;

        return {
            ...context,
            actor: this.actor,
            system,
            pet,
            ownerName,
            petLevel: Number(system.attributes?.level?.value) || 1,
            hitsTaken,
            hitsMax,
            petDefense: Number(scaling.defense) || 0,
            petOB: Number(scaling.ob) || 0,
            creatureType: system.details?.creatureType ?? pet.family ?? "—"
        };
    }

    async _onRender(context, options) {
        await super._onRender(context, options);

        const html = this.element;
        const actor = this.actor;

        // Command buttons: Attack / Guard / Follow
        html.querySelectorAll(".pet-command").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const command = el.dataset.command;
            if (!command) return;
            try {
                await actor.update({ "system.pet.command": command });
                ui.notifications.info(`${actor.name} commanded to ${command}.`);
            } catch (err) {
                console.warn("EQRMSS | pet command failed:", err);
                ui.notifications.warn(`Could not command ${actor.name}.`);
            }
        }));

        // Dismiss button: delete the pet actor
        html.querySelectorAll(".pet-dismiss").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Dismiss Pet" },
                content: `<p>Dismiss <strong>${actor.name}</strong>? This cannot be undone.</p>`
            });
            if (!confirmed) return;
            try {
                const ownerId = actor.system?.pet?.owner ?? actor.getFlag("eqrmss", "ownerId");
                await actor.delete();
                ui.notifications.info(`${actor.name} dismissed.`);
                void ownerId;
            } catch (err) {
                console.warn("EQRMSS | pet dismiss failed:", err);
                ui.notifications.warn(`Could not dismiss ${actor.name}.`);
            }
        }));
    }
}
