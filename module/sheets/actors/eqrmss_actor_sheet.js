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
import { EQRMSSActorSignatureHelper } from "./helpers/actor-sheet-signature.js";
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
        this.signatureHelper    = new EQRMSSActorSignatureHelper(this);
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
        this.signatureHelper?.activateListeners(html);

        // ------------------------------------------------------------
        // PET MANAGER BUTTON (header)
        // ------------------------------------------------------------
        const html = this.element;

        html.querySelectorAll(".pet-manager-open").forEach(el => el.addEventListener("click", ev => {
            ev.preventDefault();
            const mgr = new EQRMSSPetManager(this.actor);
            mgr.render(true);
        }));

        // ------------------------------------------------------------
        // PET SUMMON / DISMISS BUTTONS (main tab)
        // ------------------------------------------------------------
        html.querySelectorAll(".pet-summon-main").forEach(el => el.addEventListener("click", async () => {
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
        }));

        html.querySelectorAll(".pet-dismiss-main").forEach(el => el.addEventListener("click", async () => {
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
        }));

        // ------------------------------------------------------------
        // BUFFS & DEBUFFS (Status tab)
        // ------------------------------------------------------------
        // Name links back to the originating spell; buffs can be
        // dismissed by the player, debuffs only via curative spells.
        html.querySelectorAll(".buff-debuff-open").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const origin = el.dataset.origin;
            if (origin) {
                try {
                    const doc = await fromUuid(origin);
                    if (doc?.sheet) { doc.sheet.render(true); return; }
                } catch (err) { /* fall through to effect sheet */ }
            }
            const effect = this.actor?.effects?.get(el.dataset.effectId);
            effect?.sheet?.render(true);
        }));

        html.querySelectorAll(".buff-remove").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            const effect = this.actor?.effects?.get(el.dataset.effectId);
            if (effect) { await effect.delete(); return; }
            const timedId = el.dataset.timedId;
            const timedSource = el.dataset.timedSource;
            const groupId = el.dataset.groupId;
            if (timedId || timedSource || groupId) {
                const list = [...(this.actor?.system?.status?.spellEffects ?? [])];
                const kept = list.filter(e => {
                    // Group dismiss (2026-10-07): remove all effects from the
                    // same spell/song, not just the clicked entry.
                    if (groupId) {
                        const eGroup = e?.spellId ?? e?.songId ?? null;
                        if (eGroup && eGroup === groupId) return false;
                    }
                    const id = e?.id ?? e?.name ?? e?.label;
                    if (timedId && id === timedId) return false;
                    // Only use timedSource as fallback when no groupId
                    // (prevents removing all spells when dismissing one).
                    if (!groupId && timedSource && e?.source === timedSource) return false;
                    return true;
                });
                const removed = list.filter(e => !kept.includes(e));
                if (removed.some(e => e?.category === "debuff" && e?.snareValue != null)) {
                    await this.actor.update({ "system.movement.snarePenalty": 0 });
                }
                await this.actor.update({ "system.status.spellEffects": kept });
            }
        }));
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
