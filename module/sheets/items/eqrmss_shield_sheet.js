import EQRMSSItemSheet from "./eqrmss_item_sheet.js";

export default class EQRMSSShieldSheet extends EQRMSSItemSheet {

  static PARTS = {
    form: {
      template: "systems/eqrmss/templates/sheets/items/eqrmss-shield-sheet.html"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const shields = game.eqrmss?.shields;
    context.shieldOptions = shields ? shields.options() : { templates: [], materials: [], conditions: [] };
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element?.querySelectorAll(".shield-composer-select").forEach(el => {
      el.addEventListener("change", () => this._recomposeShield());
    });
  }

  async _recomposeShield() {
    const shields = game.eqrmss?.shields;
    if (!shields) {
      ui.notifications.warn("Shield data not loaded yet.");
      return;
    }
    const templateId = this.element.querySelector('[name="system.shieldTemplate"]')?.value;
    const materialId = this.element.querySelector('[name="system.shieldMaterial"]')?.value;
    const conditionId = this.element.querySelector('[name="system.shieldCondition"]')?.value;
    if (!templateId || !materialId || !conditionId) return;

    let composed;
    try {
      composed = shields.compose(templateId, materialId, conditionId);
    } catch (e) {
      ui.notifications.error(`Shield compose failed: ${e.message}`);
      return;
    }

    await this.document.update({
      name: composed.name,
      "system.shieldTemplate": composed.templateId,
      "system.shieldMaterial": composed.materialId,
      "system.shieldCondition": composed.conditionId,
      "system.meleeDB": composed.meleeDB,
      "system.missileDB": composed.missileDB,
      "system.weight": composed.weight,
      "system.cost": composed.cost,
      "system.prod_time": composed.prodTime
    });
  }

}
