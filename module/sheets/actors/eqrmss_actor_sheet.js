// ============================================================
// EQRMSS Actor Sheet
// Foundry VTT V13 / V14
//
// ApplicationV2 DocumentSheet
//
// Responsibilities:
// - Sheet lifecycle
// - Helper initialization
// - Context pipeline
// - Template rendering
//
// Gameplay logic delegated to helpers.
// ============================================================

import { EQRMSSActorContextHelper } from "./helpers/actor-sheet-context.js";
import { EQRMSSActorTabsHelper } from "./helpers/actor-sheet-tabs.js";
import { EQRMSSActorInventoryHelper } from "./helpers/actor-sheet-inventory.js";
import { EQRMSSActorSkillsHelper } from "./helpers/actor-sheet-skills.js";
import { EQRMSSActorSpellsHelper } from "./helpers/actor-sheet-spells.js";
import { EQRMSSActorBardHelper } from "./helpers/actor-sheet-bard.js";
import { EQRMSSActorProgressionHelper } from "./helpers/actor-sheet-progression.js";

// PETS
import { EQRMSSPetManager } from "../../pets/pet-manager.js";

// Ensure required Handlebars helpers exist (fallback)
if (typeof Handlebars !== "undefined") {
  if (!Handlebars.helpers?.add) Handlebars.registerHelper("add", (a,b)=>(Number(a)||0)+(Number(b)||0));
  if (!Handlebars.helpers?.keys) Handlebars.registerHelper("keys", (obj)=>Object.keys(obj||{}));
}

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ============================================================
// ACTOR SHEET
// ============================================================

export default class EQRMSSActorSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

    constructor(...args) {
        super(...args);

        // Helper modules
        this.contextHelper      = new EQRMSSActorContextHelper(this);
        this.tabsHelper         = new EQRMSSActorTabsHelper(this);
        this.inventoryHelper    = new EQRMSSActorInventoryHelper(this);
        this.skillsHelper       = new EQRMSSActorSkillsHelper(this);
        this.spellsHelper       = new EQRMSSActorSpellsHelper(this);
        this.bardHelper         = new EQRMSSActorBardHelper(this);
        this.progressionHelper  = new EQRMSSActorProgressionHelper(this);
    }

    // ============================================================
    // DOCUMENT
    // ============================================================

    get actor() {
        return this.document;
    }

    // ============================================================
    // APPLICATION OPTIONS
    // ============================================================

    static DEFAULT_OPTIONS = {
        classes: ["eqrmss", "sheet", "actor", "player-sheet"],

        position: {
            width: 1200,
            height: 950
        },

        form: {
            closeOnSubmit: false,
            submitOnChange: true
        },

        actions: {
            levelUp: EQRMSSActorSheet.#onLevelUp,
            syncProgression: EQRMSSActorSheet.#onSyncProgression
        }
    };

    // ============================================================
    // TEMPLATE PARTS
    // ============================================================

    static PARTS = {
        form: {
            template: "systems/eqrmss/templates/sheets/actors/eqrmss_player_sheet.html"
        }
    };

    // ============================================================
    // CONTEXT PIPELINE
    // ============================================================

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return await this.contextHelper.prepare(context);
    }

    // ============================================================
    // RENDER
    // ============================================================

    async _onRender(context, options) {
        await super._onRender(context, options);

        this.tabsHelper.activate();
        this.inventoryHelper.activate();
        this.skillsHelper.activate();
        this.spellsHelper.activate();
        this.bardHelper.activate();

        // ------------------------------------------------------------
        // PET MANAGER BUTTON (header)
        // ------------------------------------------------------------
        const html = this.element;

        html.find(".pet-manager-open").click(ev => {
            ev.preventDefault();
            const mgr = new EQRMSSPetManager(this.actor);
            mgr.render(true);
        });

        // ------------------------------------------------------------
        // PET SUMMON / DISMISS BUTTONS (main tab)
        // ------------------------------------------------------------
        html.find(".pet-summon-main").click(async () => {
            const pets = game.actors.filter(a =>
                a.type === "pet" &&
                a.getFlag("eqrmss", "ownerId") === this.actor.id
            );

            if (!pets.length) {
                return ui.notifications.warn("No pets linked to this character.");
            }

            const pet = pets[0];
            await pet.update({ "system.active": true });
            ui.notifications.info(`${pet.name} has been summoned.`);
        });

        html.find(".pet-dismiss-main").click(async () => {
            const pets = game.actors.filter(a =>
                a.type === "pet" &&
                a.getFlag("eqrmss", "ownerId") === this.actor.id
            );

            if (!pets.length) {
                return ui.notifications.warn("No pets linked to this character.");
            }

            const pet = pets[0];
            await pet.update({ "system.active": false });
            ui.notifications.info(`${pet.name} has been dismissed.`);
        });
    }

    // ============================================================
    // FORM UPDATE
    // ============================================================

    async _onSubmitForm(formConfig, event) {
        await super._onSubmitForm(formConfig, event);
    }

    // ============================================================
    // PROGRESSION ACTIONS (ApplicationV2 Static Handlers)
    // ============================================================

    static async #onLevelUp(event, target) {
        event.preventDefault();
        await this.progressionHelper.levelUp();
    }

    static async #onSyncProgression(event, target) {
        event.preventDefault();
        await this.progressionHelper.syncProgression();
    }

    // ============================================================
    // CLOSE
    // ============================================================

    async _onClose(options) {
        await super._onClose(options);
    }
}
