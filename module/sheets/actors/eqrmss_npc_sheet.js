// ============================================================
// EQRMSS NPC Actor Sheet
// Foundry VTT V13 ApplicationV2
// Extends EQRMSSActorSheet
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

}