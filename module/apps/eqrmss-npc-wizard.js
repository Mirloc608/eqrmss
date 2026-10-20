// ============================================================
// EQRMSS — NPC Wizard (2026-10-20 rework: 3 steps)
//
// Step 1 — Race: creature type + race (the level-1 template),
//   name, sex.
// Step 2 — Build: role (Striker/Defender/Caster/Healer) or PC
//   class, plus target level. The finalizer simulates the build
//   level-by-level with PC rules.
// Step 3 — Special attacks: one optional pick per 10-level band
//   the level reaches, from the PEQ-coordinated menu for the
//   race/type (module/data/creatures/special-attacks.json).
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

const ROLES = [
  { id: "striker", name: "Striker", desc: "High OB, high damage. Buys at Warrior costs." },
  { id: "defender", name: "Defender", desc: "High DB, meat shield. Buys at Warrior costs." },
  { id: "caster", name: "Caster", desc: "Magic-focused offense. Buys at Wizard costs." },
  { id: "healer", name: "Healer", desc: "Healing and support. Buys at Cleric costs." }
];

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class EQRMSSNPCWizard extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor(options = {}) {
    super(options);
    this.creatureType = "sentient";
    this.step = 1;
    this._allRaces = [];
    this._specialData = null; // lazily fetched special-attacks.json
  }

  static DEFAULT_OPTIONS = {
    id: "eqrmss-npc-wizard",
    classes: ["eqrmss", "eqrmss-npc-wizard"],
    tag: "form",
    window: {
      title: "Create NPC",
      icon: "fas fa-hat-wizard",
      resizable: true
    },
    position: { width: 460, height: "auto" }
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

  async #loadSpecialData() {
    if (this._specialData) return this._specialData;
    try {
      const resp = await fetch("systems/eqrmss/module/data/creatures/special-attacks.json");
      if (resp.ok) this._specialData = await resp.json();
    } catch { /* fail-soft */ }
    this._specialData ??= {};
    return this._specialData;
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
    context.roles = ROLES;
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const form = this.element?.querySelector("form.eqrmss-npc-wizard-form");
    if (form && !form.dataset.wired) {
      form.dataset.wired = "1";
      form.addEventListener("submit", this.#onSubmit.bind(this));
    }
    const wire = (sel, ev, fn) => {
      const el = this.element?.querySelector(sel);
      if (el && !el.dataset.wired) { el.dataset.wired = "1"; el.addEventListener(ev, fn); }
    };
    wire("[name=creatureType]", "change", (e) => {
      this.creatureType = e.target.value || "sentient";
      this.#syncTypeUI();
    });
    wire("#npc-next-1", "click", () => { if (this.#validateStep1()) this.#gotoStep(2); });
    wire("#npc-back-2", "click", () => this.#gotoStep(1));
    wire("#npc-next-2", "click", async () => { if (this.#validateStep2()) { await this.#buildSpecialStep(); this.#gotoStep(3); } });
    wire("#npc-back-3", "click", () => this.#gotoStep(2));
    this.element?.querySelectorAll("[name=buildMode]").forEach(el => {
      if (!el.dataset.wired) { el.dataset.wired = "1"; el.addEventListener("change", () => this.#syncBuildModeUI()); }
    });
    this.#syncTypeUI();
    this.#syncBuildModeUI();
    this.#gotoStep(this.step);
  }

  #gotoStep(n) {
    this.step = n;
    for (const s of [1, 2, 3]) {
      const sec = this.element?.querySelector(`[data-step="${s}"]`);
      if (sec) sec.style.display = s === n ? "" : "none";
    }
    const title = this.element?.querySelector(".eqrmss-npc-wizard-step-title");
    if (title) title.textContent = `Step ${n} of 3 — ${["Race", "Role & Level", "Special Attacks"][n - 1]}`;
  }

  /** Show/hide the class option and re-filter the race list in place
   *  (no full re-render, so name/level/sex entries are preserved). */
  #syncTypeUI() {
    const root = this.element;
    if (!root) return;
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
    this.#syncBuildModeUI();
  }

  /** Role vs class rows; class mode is sentient-only. */
  #syncBuildModeUI() {
    const root = this.element;
    if (!root) return;
    const sentient = this.creatureType === "sentient";
    const classRadio = root.querySelector("[name=buildMode][value=class]");
    if (classRadio) {
      classRadio.disabled = !sentient;
      if (!sentient && classRadio.checked) {
        const roleRadio = root.querySelector("[name=buildMode][value=role]");
        if (roleRadio) roleRadio.checked = true;
      }
    }
    const mode = root.querySelector("[name=buildMode]:checked")?.value ?? "role";
    const roleRow = root.querySelector("#npc-role-row");
    const classRow = root.querySelector("#npc-class-row");
    if (roleRow) roleRow.style.display = mode === "role" ? "" : "none";
    if (classRow) classRow.style.display = mode === "class" ? "" : "none";
  }

  #formValue(name) {
    return this.element?.querySelector(`[name="${name}"]`)?.value ?? "";
  }

  #validateStep1() {
    if (!this.#formValue("race")) {
      ui.notifications.warn("Pick a race first.");
      return false;
    }
    return true;
  }

  #validateStep2() {
    const mode = this.element?.querySelector("[name=buildMode]:checked")?.value ?? "role";
    if (mode === "class" && !this.#formValue("class")) {
      ui.notifications.warn("Pick a class, or switch to a role build.");
      return false;
    }
    const level = Number(this.#formValue("level")) || 0;
    if (level < 1 || level > 130) {
      ui.notifications.warn("Level must be 1–130.");
      return false;
    }
    return true;
  }

  /** Populate step 3: one select per 10-level band reached, with
   *  the PEQ menu for the chosen race (type menu as fallback). */
  async #buildSpecialStep() {
    const host = this.element?.querySelector("#npc-special-bands");
    if (!host) return;
    const data = await this.#loadSpecialData();
    const raceId = this.#formValue("race");
    const raceKey = String(raceId ?? "").toLowerCase().replace(/^eqrmss-/, "");
    const level = Math.min(130, Math.max(1, Number(this.#formValue("level")) || 1));
    const bandCount = Math.ceil(level / 10);

    const menuFor = (band) => {
      const b = String(band);
      return data?.byRace?.[raceKey]?.bands?.[b]
        ?? data?.byType?.[this.creatureType]?.bands?.[b]
        ?? data?.general?.bands?.[b]
        ?? [];
    };

    let html = "";
    let any = false;
    for (let band = 1; band <= bandCount; band++) {
      const menu = menuFor(band);
      if (!menu.length) continue;
      any = true;
      const lo = (band - 1) * 10 + 1, hi = Math.min(130, band * 10);
      html += `<div class="form-group"><label>Levels ${lo}–${hi}</label>` +
        `<select name="special_band_${band}"><option value="">— none —</option>` +
        menu.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join("") +
        `</select></div>`;
    }
    host.innerHTML = any
      ? html
      : `<p class="eqrmss-npc-wizard-hint">No special-attack menu data for this race yet — the NPC is created without band specials.</p>`;
  }

  async #onSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    const creatureType = String(data.get("creatureType") ?? "sentient").toLowerCase();
    const buildMode = String(data.get("buildMode") ?? "role").toLowerCase();
    const raceId = String(data.get("race") ?? "").trim();
    if (!raceId) {
      ui.notifications.warn("Pick a race first.");
      return;
    }

    const specialPicks = [];
    for (const [k, v] of data.entries()) {
      if (k.startsWith("special_band_") && v) specialPicks.push(String(v));
    }

    const finalizer = new EQRMSSNPCFinalizer({
      name: String(data.get("name") ?? ""),
      sex: String(data.get("sex") ?? ""),
      raceId,
      classId: buildMode === "class" ? String(data.get("class") ?? "").trim() : "",
      level: Number(data.get("level")) || 1,
      creatureType,
      buildMode,
      role: String(data.get("role") ?? "striker"),
      specialPicks
    });

    await this.close();
    await finalizer.finalize();
  }
}
