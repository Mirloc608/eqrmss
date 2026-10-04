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
            height: 260
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

        // Force the small card size on the window element. Foundry restores a
        // saved window position for document sheets, overriding the class
        // default — set the inline height directly so it actually sticks.
        html.style.setProperty("width", "300px", "important");
        html.style.setProperty("height", "300px", "important");
        html.style.setProperty("max-height", "300px", "important");
        requestAnimationFrame(() => {
            try { this.setPosition({ width: 300, height: 300 }); } catch (e) {}
            html.style.setProperty("height", "300px", "important");
        });

        html.querySelectorAll(".attack-roll").forEach(el => el.addEventListener("click", ev => {
            ev.preventDefault();
            this._onAttackRoll(ev.currentTarget.dataset.itemId);
        }));

        html.querySelectorAll(".parry-declare").forEach(el => el.addEventListener("click", ev => {
            ev.preventDefault();
            this._onParryDeclare(ev.currentTarget.dataset.itemId);
        }));

        html.querySelectorAll(".missile-parry-declare").forEach(el => el.addEventListener("click", ev => {
            ev.preventDefault();
            this._onMissileParryDeclare(ev.currentTarget.dataset.itemId);
        }));

        html.querySelectorAll(".cqc-toggle").forEach(el => el.addEventListener("click", ev => {
            ev.preventDefault();
            this._onCQCToggle();
        }));

        html.querySelectorAll(".stance-select").forEach(el => el.addEventListener("change", ev => {
            this.actor.update({ "system.status.stance": ev.currentTarget.value || "" });
        }));

        html.querySelectorAll(".attack-speed-select").forEach(el => el.addEventListener("change", ev => {
            this.actor.update({ "system.status.attackSpeed": ev.currentTarget.value || "" });
        }));

        html.querySelectorAll(".rac-select").forEach(el => el.addEventListener("change", ev => {
            const key = ev.currentTarget.dataset.key;
            if (!["height", "width", "weaponSpace"].includes(key)) return;
            this.actor.update({ [`system.status.restrictedArea.${key}`]: ev.currentTarget.value || "" });
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

    async _onParryDeclare(itemId) {
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== "weapon") {
            ui.notifications.error(`Unknown weapon: ${itemId}`);
            return;
        }
        try {
            const { declareParry } = await import("../../combat/crit-conditions.js");
            await declareParry(this.actor, item);
        } catch (e) {
            console.error("EQRMSS | NPC parry declaration failed", e);
            ui.notifications.error(`Parry declaration failed: ${e.message}`);
        }
    }

    async _onMissileParryDeclare(itemId) {
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== "weapon") {
            ui.notifications.error(`Unknown weapon: ${itemId}`);
            return;
        }
        try {
            const { declareMissileParry } = await import("../../combat/crit-conditions.js");
            await declareMissileParry(this.actor, item);
        } catch (e) {
            console.error("EQRMSS | NPC missile parry declaration failed", e);
            ui.notifications.error(`Missile parry declaration failed: ${e.message}`);
        }
    }

    async _onCQCToggle() {
        try {
            const { declareCloseQuarters } = await import("../../combat/crit-conditions.js");
            await declareCloseQuarters(this.actor);
        } catch (e) {
            console.error("EQRMSS | NPC close-quarters toggle failed", e);
            ui.notifications.error(`Close-quarters toggle failed: ${e.message}`);
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
