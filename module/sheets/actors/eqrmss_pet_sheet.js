// ============================================================
// EQRMSS Pet Actor Sheet
// ============================================================

import EQRMSSActorSheet from "./eqrmss_actor_sheet.js";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

export default class EQRMSSPetSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

    static DEFAULT_OPTIONS = {
        classes: ["eqrmss", "sheet", "actor", "pet-sheet"],
        position: { width: 800, height: 700 },
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

        return {
            ...context,
            actor: this.actor,
            system,
            owner: game.actors.get(this.actor.getFlag("eqrmss", "ownerId") ?? null)
        };
    }

    async _onRender(context, options) {
        await super._onRender(context, options);

        const html = this.element;

        html.find(".pet-command-attack").click(ev => {
            ev.preventDefault();
            ui.notifications.info(`${this.actor.name} commanded to attack.`);
        });

        html.find(".pet-command-guard").click(ev => {
            ev.preventDefault();
            ui.notifications.info(`${this.actor.name} commanded to guard.`);
        });

        html.find(".pet-command-follow").click(ev => {
            ev.preventDefault();
            ui.notifications.info(`${this.actor.name} commanded to follow.`);
        });
    }
}
