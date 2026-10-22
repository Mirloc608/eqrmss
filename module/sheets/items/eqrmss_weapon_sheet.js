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
    // Type dropdown: canonical slugs with display labels, plus a blank for untyped items
    const typeLabels = weapons?.typeLabels ?? {};
    context.weaponTypeOptions = [{ value: "", label: "" }].concat(
      Object.entries(typeLabels).map(([value, label]) => ({ value, label }))
    );
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element?.querySelectorAll(".weapon-composer-select").forEach(el => {
      el.addEventListener("change", () => this._recomposeWeapon());
    });
    this._evolutionBar();
  }

  // Gear evolution (Stage 2): a Reforge bar on weapons owned by an
  // actor — opens the evolution dialog for this piece as vessel.
  _evolutionBar() {
    const actor = this.document?.parent;
    if (actor?.documentName !== "Actor" || !this.element) return;
    if (this.element.querySelector(".eqrmss-evo-bar")) return;
    const form = this.element.querySelector("form") ?? this.element;
    const bar = document.createElement("div");
    bar.className = "eqrmss-evo-bar";
    bar.innerHTML = `<button type="button" class="eqrmss-evo-open"><i class="fas fa-fire"></i> Reforge…</button> <span class="eqrmss-evo-label"></span>`;
    form.prepend(bar);
    bar.querySelector(".eqrmss-evo-open").addEventListener("click", async () => {
      const { EvolutionDialog } = await import("../../apps/eqrmss-evolution-dialog.js");
      new EvolutionDialog(actor, this.document).render(true);
    });
    import("../../gear/evolution.js").then(async (evo) => {
      try {
        const lines = await evo.loadEvolutionLines();
        evo.cacheEvolutionLines(lines);
        const state = evo.evolutionState(lines, this.document, {
          classKey: actor.system?.fixed_info?.profession ?? null,
          raceKey: actor.system?.fixed_info?.race ?? null
        });
        const label = bar.querySelector(".eqrmss-evo-label");
        if (label) label.textContent = state
          ? `Evolution: Form ${state.form} · ${state.combines}/${evo.formCap(state.form)} combines · slots [${evo.socketLayout(state.combines).join(", ") || "none"}]`
          : "Not on an evolution line";
      } catch { /* label stays blank */ }
    }).catch(() => {});
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

    const breakageStr = composed.breakage
      ? composed.breakage.join("-")
        + (composed.breakageMod ? ` (${composed.breakageMod >= 0 ? "+" : ""}${composed.breakageMod})` : "")
      : "";

    const updates = {
      name: composed.name,
      "system.weaponTemplate": composed.templateId,
      "system.material": composed.materialId,
      "system.condition": composed.conditionId,
      "system.type": composed.weaponType,
      "system.weight": composed.weight,
      "system.cost": composed.cost,
      "system.prod_time": composed.prodTime,
      "system.breakage_range": breakageStr,
      "system.strength": composed.strength != null ? String(composed.strength) : "",
      "system.fumble_range": composed.fumble,
      "system.obMod": composed.obMod,
      "system.damageMod": composed.damageMod
    };
    // Only overwrite attack table / length / crit type when the template provides one;
    // a GM's manual entry is otherwise preserved across recomposes.
    if (composed.attackTable != null) updates["system.attackTable"] = composed.attackTable;
    if (composed.length != null) updates["system.length"] = composed.length;
    if (composed.criticalType != null) updates["system.criticalType"] = composed.criticalType;
    // Proc comes from the material; a GM's manual proc entry is otherwise
    // preserved across recomposes.
    if (composed.proc != null) updates["system.proc"] = composed.proc;
    // Notes come from the chart when present; a GM's manual entry is otherwise preserved.
    if (composed.notes != null) updates["system.notes"] = composed.notes;

    await this.document.update(updates);
  }

}
