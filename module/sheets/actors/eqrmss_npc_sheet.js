// ============================================================
// EQRMSS NPC Actor Sheet
// Foundry VTT V13 ApplicationV2
// Extends EQRMSSActorSheet
// Minimal sheet: name, hits, attack buttons. Drop to equip.
// ============================================================

import EQRMSSActorSheet
    from "./eqrmss_actor_sheet.js";

export default class EQRMSSNPCSheet
    extends EQRMSSActorSheet
{

    static DEFAULT_OPTIONS = {

        classes:[
            "eqrmss",
            "sheet",
            "actor",
            "npc"
        ],

        window:{
            title:
                "EQRMSS NPC Sheet"
        },

        position:{
            width: 300,
            height: "auto"
        }

    };

    static PARTS = {

        form:{

            template:
            "systems/eqrmss/templates/sheets/actors/eqrmss_npc_sheet.html"

        }

    };

    async _onRender(context, options) {
        await super._onRender(context, options);
        const html = this.element;
        if (!html) return;

        html.querySelectorAll(".attack-roll").forEach(el => el.addEventListener("click", ev => {
            ev.preventDefault();
            this._onAttackRoll(ev.currentTarget.dataset.itemId);
        }));

        if (!this._npcDropBound) {
            html.addEventListener("dragover", ev => ev.preventDefault());
            html.addEventListener("drop", ev => this._onDrop(ev));
            this._npcDropBound = true;
        }
    }

    async _onAttackRoll(itemId) {
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== "weapon") {
            ui.notifications.error(`Unknown weapon: ${itemId}`);
            return;
        }
        try {
            const { rollWeaponAttack } = await import("../../combat/combat-rolls.js");
            await rollWeaponAttack(this.actor, item);
        } catch (e) {
            console.error("EQRMSS | NPC attack roll failed", e);
            ui.notifications.error(`Attack roll failed: ${e.message}`);
        }
    }

    async _onDrop(event) {
        event.preventDefault();
        const actor = this.document;
        if (!actor) return;
        try {
            const data = this._getDropData(event);
            if (!data || data.type !== "Item") return;
            const item = await fromUuid(data.uuid);
            if (!item || item.parent === actor) return;
            const itemData = item.toObject();
            if (itemData.type === "weapon" || itemData.type === "armor" || itemData.type === "shield") {
                itemData.system.equipped = true;
            }
            await actor.createEmbeddedDocuments("Item", [itemData]);
            ui.notifications.info(`${item.name} equipped.`);
        } catch (err) {
            console.error("EQRMSS | NPC drop failed", err);
        }
    }

    _getDropData(event) {
        try {
            const te = foundry?.applications?.ux?.TextEditor?.implementation;
            if (te?.getDragEventData) return te.getDragEventData(event);
        } catch (err) {}
        try {
            if (typeof TextEditor !== "undefined" && TextEditor?.getDragEventData) {
                return TextEditor.getDragEventData(event);
            }
        } catch (err) {}
        try {
            const raw = event?.dataTransfer?.getData("text/plain");
            if (raw) return JSON.parse(raw);
        } catch (err) {}
        return null;
    }

}
