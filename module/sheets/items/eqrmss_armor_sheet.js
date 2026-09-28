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
    context.armorOptions = armor ? armor.options() : { templates: [], materials: [], conditions: [] };
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
    const templateId = this.element.querySelector('[name="system.armorTemplate"]')?.value;
    const materialId = this.element.querySelector('[name="system.armorMaterial"]')?.value;
    const conditionId = this.element.querySelector('[name="system.armorCondition"]')?.value;
    if (!templateId || !materialId || !conditionId) return;

    let composed;
    try {
      composed = armor.compose(templateId, materialId, conditionId);
    } catch (e) {
      ui.notifications.error(`Armor compose failed: ${e.message}`);
      return;
    }

    const updates = {
      name: composed.name,
      "system.armorTemplate": composed.templateId,
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
