// ============================================================
// EQRMSS Jewelry Item Sheet — bonuses/effects like armor,
// with jewelry-appropriate location slots
// Foundry VTT V13 / V14 ApplicationV2
// ============================================================

import EQRMSSItemSheet from "./eqrmss_item_sheet.js";

const JEWELRY_LOCATIONS = [
    { id: "ear", name: "Ear" },
    { id: "neck", name: "Neck" },
    { id: "finger", name: "Finger" },
    { id: "wrist", name: "Wrist" },
    { id: "charm", name: "Charm" }
];

export default class EQRMSSJewelrySheet extends EQRMSSItemSheet {

    static PARTS = {
        form: {
            template: "systems/eqrmss/templates/sheets/items/eqrmss-jewelry-sheet.html"
        }
    };

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        // Reuse the armor condition/quality lists so worn jewelry degrades
        // on the same scale; fall back to empty if armor data isn't loaded.
        const armorOpts = game.eqrmss?.armor?.options?.() ?? {};
        context.jewelryOptions = {
            locations: JEWELRY_LOCATIONS,
            conditions: armorOpts.conditions ?? [],
            qualities: armorOpts.qualities ?? []
        };
        return context;
    }
}
