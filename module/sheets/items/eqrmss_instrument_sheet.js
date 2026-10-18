// ============================================================
// EQRMSS Instrument Sheet
// Foundry VTT V13 / V14 ApplicationV2
// ============================================================

import EQRMSSItemSheet from "./eqrmss_item_sheet.js";

export default class EQRMSSInstrumentSheet extends EQRMSSItemSheet {

  static DEFAULT_OPTIONS = {
    ...EQRMSSItemSheet.DEFAULT_OPTIONS,
    window: { title: "EQRMSS Instrument Sheet" },
  };
  static PARTS = { form: { template: "systems/eqrmss/templates/sheets/items/eqrmss-instrument-sheet.html" } };
  get id() { return `eqrmss-instrument-sheet-${this.document.id}`; }

}
