// EQRMSS Actor Sheet Spells Helper
// - Spell tab behavior
// - Spell list interactions
// - Spell gem bar drag-and-drop + casting

import { EQRMSSSpellcastingEngine } from "../../../utils/spells/spellcasting-engine.js";

export class EQRMSSActorSpellsHelper {
  constructor(sheet) {
    this.sheet = sheet;
  }

  prepare(context) {
    const actor = this.sheet.actor;

    context.spells = actor.items.filter(i => i.type === "spell");
    context.memorized = actor.system.memorized ?? [
      {}, {}, {}, {}, {}, {}, {}, {}
    ];

    return context;
  }

  activate() {
    const html = this.sheet.element;
    if (!html) return;

    // Drag from spell list
    html.querySelectorAll(".eq-spell-entry").forEach(el => {
      el.addEventListener("dragstart", ev => {
        const itemId = el.dataset.itemId;
        ev.dataTransfer.setData("text/plain", itemId);
      });
    });

    // Drop onto spell gem
    html.querySelectorAll(".eq-spell-gem").forEach(el => {
      el.addEventListener("dragover", ev => ev.preventDefault());

      el.addEventListener("drop", async ev => {
        ev.preventDefault();
        const itemId = ev.dataTransfer.getData("text/plain");
        const item = this.sheet.actor.items.get(itemId);
        if (!item) return;

        const index = Number(el.dataset.index);
        const memorized = foundry.utils.deepClone(this.sheet.actor.system.memorized ?? [
          {}, {}, {}, {}, {}, {}, {}, {}
        ]);

        memorized[index] = {
          id: item.id,
          name: item.name,
          icon: item.img
        };

        await this.sheet.actor.update({ "system.memorized": memorized });
        this.sheet.render();
      });

      // Click to cast
      el.addEventListener("click", async () => {
        const index = Number(el.dataset.index);
        const memorized = this.sheet.actor.system.memorized ?? [];
        const entry = memorized[index];
        if (!entry) return;

        const item = this.sheet.actor.items.get(entry.id);
        if (!item) return;

        await EQRMSSSpellcastingEngine.cast(this.sheet.actor, item);
      });
    });
  }
}
