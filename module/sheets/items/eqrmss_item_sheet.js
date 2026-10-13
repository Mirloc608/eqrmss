// ============================================================
// EQRMSS Item Sheet (Resizable + Scrollable)
// Foundry VTT V13 / V14 ApplicationV2
// ============================================================

const { DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

import { getItemEffectsByKind, getWornEffectPicker, getTriggeredEffectPicker } from "../../data/item-effects/item-effect-loader.js";

export default class EQRMSSItemSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["eqrmss","sheet","item"],
    tag: "form",
    resizable: true,
    position: { width: 530, height: 600 },
    scrollY: [".sheet-body", ".sheet-content"],
    form: { submitOnChange: false, closeOnSubmit: false },
    window: { title: "EQRMSS Item Sheet" },
    submitOnClose: true
  };
  static PARTS = { form: { template: "systems/eqrmss/templates/sheets/items/eqrmss-item-sheet.html" } };
  get id() { return `eqrmss-item-sheet-${this.document.id}`; }
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
          console.error(
              "eqrmss | item close save failed",
              err
          );
      }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.document;
    const enrichedDescription = await foundry.applications.ux.TextEditor.implementation.enrichHTML(item.system.description ?? "", { async: true });
    return { ...context, item, system: item.system, type: item.type, config: CONFIG.eqrmss ?? {}, owner: item.isOwner, editable: this.isEditable, isGM: game?.user?.isGM ?? false, enrichedDescription,
      wornEffects: getItemEffectsByKind("worn"),
      triggeredEffects: getItemEffectsByKind("triggered"),
      procEffects: getItemEffectsByKind("proc"),
      wornEffectPicker: getWornEffectPicker(item.system?.wornEffect ?? ""),
      triggeredEffectPicker: getTriggeredEffectPicker(item.system?.triggeredEffect ?? "") };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    // image picker (namespaced) and ensure draggable header exists
    try {
      const image = this.element?.querySelector("[data-edit='img']");
      if (image) {
        image.addEventListener('click', ev => {
          ev.preventDefault();
          if (!this.isEditable) return;
          new foundry.applications.apps.FilePicker.implementation({ type: 'image', current: this.document.img, callback: async path => { await this.document.update({ img: path }); } }).browse();
        });
      }
    } catch (e) { console.error('eqrmss | item image click setup failed', e); }

    // Add a small Save button into header if missing
    try {
      const header = this.element.querySelector('.window-header') || this.element.querySelector('.app-header') || this.element.querySelector('.window-titlebar');
      if (header && !header.querySelector('.eqrmss-save-btn') && this.isEditable) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'eqrmss-save-btn button'; btn.innerHTML = '<i class="fas fa-save"></i> Save';
        btn.addEventListener('click', async () => { const form = this.element.querySelector('form'); if (!form) return; const fd = new FormData(form); const obj = {}; for (const [k,v] of fd.entries()) obj[k]=v; await this._updateObject(undefined, obj); });
        header.appendChild(btn);
      }
    } catch (e) { console.error('eqrmss | item header setup failed', e); }

    // Clicky ("Use") button next to the Triggered Effect dropdown
    try {
      this.element?.querySelectorAll(".clicky-use-btn").forEach(btn => {
        btn.addEventListener("click", async ev => {
          ev.preventDefault();
          try {
            const eng = game?.eqrmss?.itemEffects;
            if (!eng?.activateClicky) {
              ui.notifications.warn("Item effects engine not loaded yet.");
              return;
            }
            await eng.activateClicky({ item: this.document });
          } catch (e) { console.error("EQRMSS | clicky use failed", e); }
        });
      });
    } catch (e) { console.error('eqrmss | clicky button setup failed', e); }

    // Effect pickers: the family/category select drives the effect select.
    // Only the effect select carries a name=, so the stored document value
    // (the effect id) is unchanged; the group select is UI-only.
    try {
      const wirePicker = (kind) => {
        const picker = this.element?.querySelector(`[data-effect-picker="${kind}"]`);
        if (!picker) return;
        const groupSel = picker.querySelector("[data-picker-group]");
        const effectSel = picker.querySelector("[data-picker-effect]");
        if (!groupSel || !effectSel) return;
        groupSel.addEventListener("change", () => {
          const data = kind === "worn" ? getWornEffectPicker(null) : getTriggeredEffectPicker(null);
          const groups = kind === "worn" ? data.families : data.categories;
          const group = groups.find(g => g.id === groupSel.value);
          const children = kind === "worn" ? (group?.ranks ?? []) : (group?.effects ?? []);
          effectSel.replaceChildren();
          if (!children.length) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "None";
            effectSel.appendChild(opt);
            return;
          }
          for (const c of children) {
            const opt = document.createElement("option");
            opt.value = c.id;
            opt.textContent = kind === "worn" ? c.label : c.name;
            effectSel.appendChild(opt);
          }
          effectSel.selectedIndex = 0;
        });
      };
      wirePicker("worn");
      wirePicker("triggered");
    } catch (e) { console.error('eqrmss | effect picker wiring failed', e); }
  }

  async close(options = {}) { try { if (this.isEditable) { const form = this.element?.querySelector('form'); if (form) { const fd = new FormData(form); const obj = {}; for (const [k,v] of fd.entries()) obj[k]=v; await this._updateObject(undefined, obj); } } } catch(e){console.error('eqrmss | item close save failed', e);} return super.close(options); }

  async activateListeners(html) {
    if (super.activateListeners) super.activateListeners(html);
    const img = this.element?.querySelector('img[data-edit="img"]');
    if (img) img.addEventListener('click', ev => { ev.preventDefault(); if (!this.isEditable) return; new foundry.applications.apps.FilePicker.implementation({ type: 'image', current: this.document.img, callback: async path => { await this.document.update({ img: path }); } }).render(true); });

    // Make header-image draggable
    try {
      const headerDrag = this.element?.querySelector('.header-image, .header-block.icon');
      if (headerDrag) {
        headerDrag.setAttribute('draggable', 'true');
        headerDrag.addEventListener('dragstart', ev => { const payload = { type: 'Item', id: this.document.id, uuid: this.document.uuid, itemType: this.document.type, name: this.document.name }; ev.dataTransfer.setData('text/plain', JSON.stringify(payload)); const imgEl = this.element.querySelector('img[data-edit="img"]') || this.element; try { ev.dataTransfer.setDragImage(imgEl, 32, 32); } catch(e){} });
      }
    } catch (e) { console.error('eqrmss | item drag setup failed', e); }
  }

}
