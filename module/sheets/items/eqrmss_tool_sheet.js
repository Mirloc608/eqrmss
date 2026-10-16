// ============================================================
// EQRMSS Tool Item Sheet — simplified card for reusable tools
// Foundry VTT V13 / V14 ApplicationV2
// ============================================================

import EQRMSSItemSheet from "./eqrmss_item_sheet.js";

const TRADESKILLS = [
    { id: "skill-alchemy", name: "Alchemy & Potions" },
    { id: "skill-baking", name: "Baking & Cooking" },
    { id: "skill-brewing", name: "Brewing" },
    { id: "skill-fishing", name: "Fishing" },
    { id: "skill-fletching", name: "Fletching" },
    { id: "skill-jewelcrafting", name: "Jewelcrafting" },
    { id: "skill-poison-making", name: "Poison Making" },
    { id: "skill-pottery", name: "Pottery" },
    { id: "skill-research", name: "Magical Research" },
    { id: "skill-smithing", name: "Smithing & Blacksmithing" },
    { id: "skill-tailoring", name: "Tailoring" },
    { id: "skill-tinkering", name: "Tinkering" }
];

export default class EQRMSSItemToolSheet extends EQRMSSItemSheet {

    static PARTS = {
        form: {
            template: "systems/eqrmss/templates/sheets/items/eqrmss-tool-sheet.html"
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        return { ...context, tradeskills: TRADESKILLS };
    }
}
