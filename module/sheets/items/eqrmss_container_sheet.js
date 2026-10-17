// ============================================================
// EQRMSS Container Sheet (Resizable + Scrollable)
// Foundry VTT V13 / V14 (ApplicationV2)
// ============================================================

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

import {
    getContainerContents,
    getContentsWeight,
    getStorableItems,
    storeItemInContainer,
    removeItemFromContainer,
    getEffectiveContainerWeight,
} from "../../utils/inventory/container-storage.js";

export default class EQRMSSContainerSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["eqrmss","sheet","item","container"],
    tag: "form",
    resizable: true,
    position: { width: 560, height: 640 },
    scrollY: [".sheet-body", ".sheet-content"],
    form: { submitOnChange: false, closeOnSubmit: false },
    window: { title: "EQRMSS Container Sheet" },
    submitOnClose: true
  };
  static PARTS = { form: { template: "systems/eqrmss/templates/sheets/items/eqrmss-container-sheet.html" } };
  get id() { return `eqrmss-container-sheet-${this.document.id}`; }
  async _updateObject(event, formData)
  {
      if (!this.isEditable) return;
      try
      {
          if(this.document.pack)
          {
              ui.notifications.warn(
                  "This item is from a locked compendium. Duplicate it before editing."
              );
              return;
          }
          await this.document.update(
              formData
          );
      }
      catch(err)
      {
          console.error("EQRMSS | container _updateObject failed", err);
      }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const actor = item.parent;
    const sys = item.system ?? {};

    const enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.description ?? "", { async: true });

    // Containment context (only when owned by an actor)
    let contents = [];
    let storable = [];
    let contentsWeight = 0;
    let effectiveWeight = Number(sys.weight) || 0;
    if (actor) {
        contents = getContainerContents(actor, item.id);
        storable = getStorableItems(actor, item.id);
        contentsWeight = getContentsWeight(actor, item.id);
        effectiveWeight = getEffectiveContainerWeight(actor, item);
    }

    const capacityWeight = Number(sys.capacityWeight);
    const capacitySlots = Number(sys.capacitySlots);
    const liquidCap = Number(sys.liquidCapacityOz);
    const liquidAmt = Number(sys.liquid?.amountOz);

    return { ...context, item, system: sys, type: item.type,
      config: CONFIG.eqrmss ?? {}, owner: item.isOwner, editable: this.isEditable,
      isGM: game?.user?.isGM ?? false, enrichedDescription,
      hasActor: !!actor,
      contents: contents.map(i => ({ _id: i.id, name: i.name, img: i.img,
        quantity: i.system?.quantity ?? 1, weight: i.system?.weight ?? 0 })),
      storable: storable.map(i => ({ _id: i.id, name: i.name })),
      contentsWeight: Math.round(contentsWeight * 100) / 100,
      effectiveWeight: Math.round(effectiveWeight * 100) / 100,
      capacityWeightDisplay: Number.isFinite(capacityWeight) && capacityWeight > 0 ? `${capacityWeight} lb` : "—",
      capacitySlotsDisplay: Number.isFinite(capacitySlots) && capacitySlots > 0 ? capacitySlots : "—",
      isLiquidContainer: Number.isFinite(liquidCap) && liquidCap > 0,
      liquidCapacityDisplay: Number.isFinite(liquidCap) && liquidCap > 0 ? `${liquidCap} oz` : "—",
      liquidAmountDisplay: Number.isFinite(liquidAmt) && liquidAmt > 0 ? `${liquidAmt} oz` : "empty",
      isCoinPurse: sys.isCoinPurse === true,
      purseMoney: sys.isCoinPurse === true ? (actor?.system?.money ?? null) : null,
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    // image picker
    try {
      const image = this.element?.querySelector("[data-edit='img']");
      if (image) {
        image.addEventListener('click', ev => {
          ev.preventDefault();
          if (!this.isEditable) return;
          new foundry.applications.apps.FilePicker.implementation({ type: 'image', current: this.document.img, callback: async path => { await this.document.update({ img: path }); } }).browse();
        });
      }
    } catch (e) { console.error('eqrmss | container image click setup failed', e); }

    // Save button in header
    try {
      const header = this.element.querySelector('.window-header') || this.element.querySelector('.app-header') || this.element.querySelector('.window-titlebar');
      if (header && !header.querySelector('.eqrmss-save-btn') && this.isEditable) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'eqrmss-save-btn button'; btn.innerHTML = '<i class="fas fa-save"></i> Save';
        btn.addEventListener('click', async () => { const form = this.element.querySelector('form'); if (!form) return; const fd = new FormData(form); const obj = {}; for (const [k,v] of fd.entries()) obj[k]=v; await this._updateObject(undefined, obj); });
        header.appendChild(btn);
      }
    } catch (e) { console.error('eqrmss | container header setup failed', e); }

    // Store selected item
    try {
      this.element?.querySelectorAll("[data-action='container-store']").forEach(btn => {
        btn.addEventListener("click", async ev => {
          ev.preventDefault();
          if (!this.isEditable) return;
          const sel = this.element.querySelector("[data-container-store-select]");
          const itemId = sel?.value;
          if (!itemId) { ui.notifications.warn("Select an item to store."); return; }
          const actor = this.document.parent;
          const res = await storeItemInContainer(actor, itemId, this.document.id);
          if (!res.ok) ui.notifications.warn(`Cannot store: ${res.reason}`);
          this.render();
        });
      });
    } catch (e) { console.error('eqrmss | container store wiring failed', e); }

    // Remove item from container
    try {
      this.element?.querySelectorAll("[data-action='container-remove']").forEach(btn => {
        btn.addEventListener("click", async ev => {
          ev.preventDefault();
          if (!this.isEditable) return;
          const itemId = btn.dataset.itemId;
          const actor = this.document.parent;
          const res = await removeItemFromContainer(actor, itemId);
          if (!res.ok) ui.notifications.warn(`Cannot remove: ${res.reason}`);
          this.render();
        });
      });
    } catch (e) { console.error('eqrmss | container remove wiring failed', e); }

    // Empty liquid
    try {
      this.element?.querySelectorAll("[data-action='container-empty-liquid']").forEach(btn => {
        btn.addEventListener("click", async ev => {
          ev.preventDefault();
          if (!this.isEditable) return;
          await this.document.update({ "system.liquid.amountOz": 0, "system.liquid.type": "" });
          this.render();
        });
      });
    } catch (e) { console.error('eqrmss | container empty-liquid wiring failed', e); }
  }

  async close(options = {}) { try { if (this.isEditable) { const form = this.element?.querySelector('form'); if (form) { const fd = new FormData(form); const obj = {}; for (const [k,v] of fd.entries()) obj[k]=v; await this._updateObject(undefined, obj); } } } catch(e){console.error('eqrmss | container close save failed', e);} return super.close(options); }

  async activateListeners(html) {
    if (super.activateListeners) super.activateListeners(html);
    const img = this.element?.querySelector('img[data-edit="img"]');
    if (img) img.addEventListener('click', ev => { ev.preventDefault(); if (!this.isEditable) return; new foundry.applications.apps.FilePicker.implementation({ type: 'image', current: this.document.img, callback: async path => { await this.document.update({ img: path }); } }).render(true); });
  }

}
