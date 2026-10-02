// ============================================================
// EQRMSS NPC Actor Sheet
// Foundry VTT V13 ApplicationV2
// Extends EQRMSSActorSheet
// Compact sheet: hits, attack buttons, collapsed details.
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

}
