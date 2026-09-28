import EQRMSSItemSheet from "./eqrmss_item_sheet.js";

export default class EQRMSSWeaponSheet extends EQRMSSItemSheet {

  static PARTS = {
    form: {
      template: "systems/eqrmss/templates/sheets/items/eqrmss-weapon-sheet.html"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const weapons = game.eqrmss?.weapons;
    context.weaponOptions = weapons ? weapons.options() : { templates: [], materials: [], conditions: [] };
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element?.querySelectorAll(".weapon-composer-select").forEach(el => {
      el.addEventListener("change", () => this._recomposeWeapon());
    });
  }

  async _recomposeWeapon() {
    const weapons = game.eqrmss?.weapons;
    if (!weapons) {
      ui.notifications.warn("Weapon data not loaded yet.");
      return;
    }
    const templateId = this.element.querySelector('[name="system.weaponTemplate"]')?.value;
    const materialId = this.element.querySelector('[name="system.material"]')?.value;
    const conditionId = this.element.querySelector('[name="system.condition"]')?.value;
    if (!templateId || !materialId || !conditionId) return;

    let composed;
    try {
      composed = weapons.compose(templateId, materialId, conditionId);
    } catch (e) {
      ui.notifications.error(`Weapon compose failed: ${e.message}`);
      return;
    }

    const breakageStr = composed.breakage.join("-")
      + (composed.breakageMod ? ` (${composed.breakageMod >= 0 ? "+" : ""}${composed.breakageMod})` : "");

    await this.document.update({
      name: composed.name,
      "system.weaponTemplate": composed.templateId,
      "system.material": composed.materialId,
      "system.condition": composed.conditionId,
      "system.type": composed.weaponType,
      "system.weight": composed.weight,
      "system.breakage_range": breakageStr,
      "system.strength": String(composed.strength),
      "system.fumble_range": composed.fumble,
      "system.attackTable": composed.attackTable,
      "system.length": composed.length,
      "system.criticalType": composed.criticalType,
      "system.obMod": composed.obMod,
      "system.damageMod": composed.damageMod
    });
  }

}
