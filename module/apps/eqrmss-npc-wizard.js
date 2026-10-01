// ============================================================
// EQRMSS — NPC Quick-Build Wizard (Stage 1)
//
// Single-screen wizard: name, sex, race, class, level ->
// EQRMSSNPCFinalizer builds a generic NPC. Detailed NPCs are
// built by the GM as full characters.
// ============================================================

import { EQRMSSNPCFinalizer } from "./eqrmss-npc-finalizer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EQRMSSNPCWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "eqrmss-npc-wizard",
    classes: ["eqrmss", "eqrmss-npc-wizard"],
    tag: "form",
    window: {
      title: "Create NPC — Quick-Build",
      icon: "fas fa-hat-wizard",
      resizable: true
    },
    position: { width: 440, height: "auto" }
  };

  static PARTS = {
    form: {
      template: "systems/eqrmss/templates/apps/npc-wizard/eqrmss-npc-wizard.html"
    }
  };

  /** game.eqrmss.races / classes are keyed objects; the form wants arrays.
   *  The option value is the COLLECTION KEY ("human"), which is what the
   *  finalizer resolves — record ids ("eqrmss-human") differ. */
  static #asList(collection) {
    if (!collection) return [];
    const entries = Array.isArray(collection)
      ? collection.map(r => [String(r?._id ?? r?.id ?? ""), r])
      : Object.entries(collection);
    return entries
      .filter(([, r]) => r && (r.name || r.id))
      .map(([key, r]) => ({ id: key, name: String(r.name ?? r.id ?? key) }))
      .filter(r => r.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.races = EQRMSSNPCWizard.#asList(game?.eqrmss?.races);
    context.classes = EQRMSSNPCWizard.#asList(game?.eqrmss?.classes);
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const form = this.element?.querySelector("form.eqrmss-npc-wizard-form");
    if (form && !form.dataset.wired) {
      form.dataset.wired = "1";
      form.addEventListener("submit", this.#onSubmit.bind(this));
    }
  }

  async #onSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const raceId = String(data.get("race") ?? "").trim();
    const classId = String(data.get("class") ?? "").trim();
    if (!raceId || !classId) {
      ui.notifications.warn("Pick a race and a class first.");
      return;
    }

    const finalizer = new EQRMSSNPCFinalizer({
      name: String(data.get("name") ?? ""),
      sex: String(data.get("sex") ?? ""),
      raceId,
      classId,
      level: Number(data.get("level")) || 1
    });

    await this.close();
    await finalizer.finalize();
  }
}
