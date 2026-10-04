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
    const opts = armor ? armor.options() : { locations: [], categories: [], materials: [], conditions: [] };
    // Gate the material list by the item's current category so an invalid
    // combination (e.g. adamantine cloth) can't be picked.
    const categoryId = this.document.system?.armorCategory ?? "";
    if (categoryId) {
      opts.materials = opts.materials.filter(m => (m.categories ?? []).includes(categoryId));
    }
    // Enhancements gate on category (and the material's base AT).
    const materialId = this.document.system?.armorMaterial ?? "";
    opts.enhancements = armor?.enhancementsFor
      ? armor.enhancementsFor(categoryId, materialId || null)
      : (opts.enhancements ?? []);
    context.armorOptions = opts;
    if (!this.document.system?.armorQuality) {
      context.system = { ...context.system, armorQuality: "average" };
    }
    if (!this.document.system?.armorThickness) {
      context.system = { ...context.system, armorThickness: "standard" };
    }
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element?.querySelectorAll(".armor-composer-select").forEach(el => {
      el.addEventListener("change", () => this._recomposeArmor());
    });
    this.element?.querySelectorAll(".armor-helmet-select").forEach(el => {
      el.addEventListener("change", () => this._applyHelmetPreset());
    });
  }

  async _applyHelmetPreset() {
    const armor = game.eqrmss?.armor;
    if (!armor?.composeHelmet) {
      ui.notifications.warn("Armor data not loaded yet.");
      return;
    }
    const presetId = this.element.querySelector(".armor-helmet-select")?.value;
    if (!presetId) return;
    const conditionId = this.element.querySelector('[name="system.armorCondition"]')?.value || "normal";
    const qualityId = this.element.querySelector('[name="system.armorQuality"]')?.value || "average";
    const enhancementId = this.element.querySelector('[name="system.armorEnhancement"]')?.value || null;
    const thicknessId = this.element.querySelector('[name="system.armorThickness"]')?.value || "standard";
    let composed;
    try {
      composed = armor.composeHelmet(presetId, conditionId, { qualityId, enhancementId, thicknessId });
    } catch (e) {
      ui.notifications.error(`Helmet compose failed: ${e.message}`);
      return;
    }
    const updates = {
      name: composed.name,
      "system.armorLocation": composed.locationId,
      "system.armorCategory": composed.categoryId,
      "system.armorMaterial": composed.materialId,
      "system.armorCondition": composed.conditionId,
      "system.armorQuality": composed.qualityId,
      "system.armorEnhancement": composed.enhancementId,
      "system.armorThickness": composed.thicknessId,
      "system.armorHelmetPreset": composed.presetId,
      "system.dfHead": composed.dfHead ?? 0,
      "system.dfBody": composed.dfBody ?? 0,
      "system.dfHalfSameType": composed.dfHalfSameType === true,
      "system.pf": composed.pf ?? 0,
      "system.dbBonus": composed.dbBonus,
      "system.at": composed.armorType ?? "",
      "system.weight": composed.weight,
      "system.maneuverPenalty": composed.maneuverPenalty,
      "system.cost": composed.cost,
      "system.prod_time": composed.prodTime
    };
    if (composed.notes != null) updates["system.notes"] = composed.notes;
    await this.document.update(updates);
  }

  async _recomposeArmor() {
    const armor = game.eqrmss?.armor;
    if (!armor) {
      ui.notifications.warn("Armor data not loaded yet.");
      return;
    }
    const locationId = this.element.querySelector('[name="system.armorLocation"]')?.value;
    const categoryId = this.element.querySelector('[name="system.armorCategory"]')?.value ?? "";
    let materialId = this.element.querySelector('[name="system.armorMaterial"]')?.value ?? "";
    const conditionId = this.element.querySelector('[name="system.armorCondition"]')?.value;
    const qualityId = this.element.querySelector('[name="system.armorQuality"]')?.value || "average";
    const enhancementId = this.element.querySelector('[name="system.armorEnhancement"]')?.value || null;
    const thicknessId = this.element.querySelector('[name="system.armorThickness"]')?.value || "standard";

    // Persist a changed category right away so the material dropdown
    // re-renders filtered to that category; drop a material it invalidates.
    // (The sheet doesn't submit on change, so without this the filter in
    // _prepareContext would never engage on a fresh item.)
    if (categoryId !== (this.document.system?.armorCategory ?? "")) {
      const catUpdate = { "system.armorCategory": categoryId };
      if (categoryId && materialId && !armor.materialsForCategory(categoryId).some(m => m.id === materialId)) {
        catUpdate["system.armorMaterial"] = "";
        materialId = "";
      }
      await this.document.update(catUpdate);
    }

    if (!locationId || !categoryId || !materialId || !conditionId) return;

    let composed;
    try {
      composed = armor.compose(locationId, categoryId, materialId, conditionId, { qualityId, enhancementId, thicknessId });
    } catch (e) {
      ui.notifications.error(`Armor compose failed: ${e.message}`);
      return;
    }

    const updates = {
      name: composed.name,
      "system.armorLocation": composed.locationId,
      "system.armorCategory": composed.categoryId,
      "system.armorMaterial": composed.materialId,
      "system.armorCondition": composed.conditionId,
      "system.armorQuality": composed.qualityId,
      "system.armorEnhancement": composed.enhancementId,
      "system.armorThickness": composed.thicknessId,
      "system.dfHead": composed.dfHead ?? 0,
      "system.dfBody": composed.dfBody ?? 0,
      "system.dfHalfSameType": composed.dfHalfSameType === true,
      "system.pf": composed.pf ?? 0,
      "system.dbBonus": composed.dbBonus,
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
