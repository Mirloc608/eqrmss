// ============================================================
// EQRMSS Tradeskill Item Sheet — simplified card for components
// Foundry VTT V13 / V14 ApplicationV2
// ============================================================

import EQRMSSItemSheet from "./eqrmss_item_sheet.js";

export default class EQRMSSItemTradeskillSheet extends EQRMSSItemSheet {

    static PARTS = {
        form: {
            template: "systems/eqrmss/templates/sheets/items/eqrmss-tradeskill-sheet.html"
        }
    };
}
