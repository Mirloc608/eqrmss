import EQRMSSItemSheet from "./eqrmss_item_sheet.js";

export default class EQRMSSArmorSheet extends EQRMSSItemSheet {

  static PARTS = {
    form: {
      template: "systems/eqrmss/templates/sheets/items/eqrmss-armor-sheet.html"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const armor = game.eqrmss?.armor;
    context.armorOptions = armor ? armor.options() : { locations: [], materials: [], conditions: [] };
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element?.querySelectorAll(".armor-composer-select").forEach(el => {
      el.addEventListener("change", () => this._recomposeArmor());
    });
  }

  async _recomposeArmor() {
    const armor = game.eqrmss?.armor;
    if (!armor) {
      ui.notifications.warn("Armor data not loaded yet.");
      return;
    }
    const locationId = this.element.querySelector('[name="system.armorLocation"]')?.value;
    const materialId = this.element.querySelector('[name="system.armorMaterial"]')?.value;
    const conditionId = this.element.querySelector('[name="system.armorCondition"]')?.value;
    if (!locationId || !materialId || !conditionId) return;

    let composed;
    try {
      composed = armor.compose(locationId, materialId, conditionId);
    } catch (e) {
      ui.notifications.error(`Armor compose failed: ${e.message}`);
      return;
    }

    const updates = {
      name: composed.name,
      "system.armorLocation": composed.locationId,
      "system.armorMaterial": composed.materialId,
      "system.armorCondition": composed.conditionId,
      "system.at": composed.armorType ?? "",
      "system.weight": composed.weight,
      "system.maneuverPenalty": composed.maneuverPenalty,
      "system.cost": composed.cost,
      "system.prod_time": composed.prodTime
    };
    // Notes come from the chart when present; a GM's manual entry is otherwise preserved.
    if (composed.notes != null) updates["system.notes"] = composed.notes;

    await this.document.update(updates);
  }

}
