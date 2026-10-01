// ============================================================
// EQRMSS — NPC Quick-Build Wizard (Stage 1 + creature types)
//
// Single-screen wizard: creature type, name, sex, race, class
// (sentients only), level -> EQRMSSNPCFinalizer builds a generic
// NPC. Detailed NPCs are built by the GM as full characters.
// ============================================================

import { EQRMSSNPCFinalizer } from "./eqrmss-npc-finalizer.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Fallback if module/data/creatures/types.json is not installed yet.
const CREATURE_TYPE_FALLBACK = [
  { id: "sentient", name: "Sentient", sentient: true },
  { id: "animal", name: "Animal", sentient: false },
  { id: "undead", name: "Undead", sentient: false },
  { id: "insect", name: "Insect", sentient: false },
  { id: "plant", name: "Plant", sentient: false },
  { id: "construct", name: "Construct", sentient: false },
  { id: "dragon", name: "Dragon", sentient: false },
  { id: "elemental", name: "Elemental", sentient: false }
];

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class EQRMSSNPCWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(options = {}) {
    super(options);
    this.creatureType = "sentient";
    this._allRaces = [];
  }

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
   *  finalizer resolves — record ids ("eqrmss-human") differ.
   *  Races also carry creatureType (defaults to "sentient"). */
  static #asList(collection) {
    if (!collection) return [];
    const entries = Array.isArray(collection)
      ? collection.map(r => [String(r?._id ?? r?.id ?? ""), r])
      : Object.entries(collection);
    return entries
      .filter(([, r]) => r && (r.name || r.id))
      .map(([key, r]) => ({
        id: key,
        name: String(r.name ?? r.id ?? key),
        creatureType: String(r.creatureType ?? "sentient").toLowerCase()
      }))
      .filter(r => r.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async #loadCreatureTypes() {
    try {
      const resp = await fetch("systems/eqrmss/module/data/creatures/types.json");
      if (resp.ok) {
        const types = (await resp.json())?.types ?? {};
        const list = Object.entries(types).map(([id, t]) => ({
          id,
          name: String(t?.name ?? id),
          sentient: !!t?.sentient
        }));
        if (list.length) return list;
      }
    } catch { /* fall through to fallback */ }
    return CREATURE_TYPE_FALLBACK;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this._allRaces = EQRMSSNPCWizard.#asList(game?.eqrmss?.races);
    context.creatureTypes = await this.#loadCreatureTypes();
    if (!context.creatureTypes.some(t => t.id === this.creatureType)) {
      this.creatureType = "sentient";
    }
    context.creatureType = this.creatureType;
    context.isSentient = this.creatureType === "sentient";
    context.races = this._allRaces.filter(r => r.creatureType === this.creatureType);
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
    const typeSel = this.element?.querySelector("[name=creatureType]");
    if (typeSel && !typeSel.dataset.wired) {
      typeSel.dataset.wired = "1";
      typeSel.addEventListener("change", () => {
        this.creatureType = typeSel.value || "sentient";
        this.#syncTypeUI();
      });
    }
    this.#syncTypeUI();
  }

  /** Show/hide the class row and re-filter the race list in place
   *  (no full re-render, so name/level/sex entries are preserved). */
  #syncTypeUI() {
    const root = this.element;
    if (!root) return;
    const sentient = this.creatureType === "sentient";
    const classRow = root.querySelector("#npc-class-row");
    const note = root.querySelector("#npc-no-class-note");
    if (classRow) classRow.style.display = sentient ? "" : "none";
    if (note) note.hidden = sentient;

    const raceSel = root.querySelector("[name=race]");
    if (raceSel) {
      const prev = raceSel.value;
      const matches = this._allRaces.filter(r => r.creatureType === this.creatureType);
      let html = `<option value="">— select —</option>`;
      if (!matches.length) {
        html += `<option value="" disabled>No ${escapeHtml(this.creatureType)} races installed yet</option>`;
      } else {
        html += matches.map(r =>
          `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join("");
      }
      raceSel.innerHTML = html;
      if (matches.some(r => r.id === prev)) raceSel.value = prev;
    }
  }

  async #onSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const creatureType = String(data.get("creatureType") ?? "sentient").toLowerCase();
    const sentient = creatureType === "sentient";
    const raceId = String(data.get("race") ?? "").trim();
    const classId = String(data.get("class") ?? "").trim();
    if (!raceId || (sentient && !classId)) {
      ui.notifications.warn(sentient ? "Pick a race and a class first." : "Pick a race first.");
      return;
    }

    const finalizer = new EQRMSSNPCFinalizer({
      name: String(data.get("name") ?? ""),
      sex: String(data.get("sex") ?? ""),
      raceId,
      classId: sentient ? classId : "",
      level: Number(data.get("level")) || 1,
      creatureType
    });

    await this.close();
    await finalizer.finalize();
  }
}
