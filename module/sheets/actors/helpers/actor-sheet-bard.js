/**
 * EQRMSS Actor Sheet Bard Helper
 *
 * Responsibilities:
 * - Bard song tab interactions
 * - Song activation / deactivation
 * - Tier cycling
 * - Twist start / stop
 */

import { EQRMSSSongUnlockEngine } from "../../../utils/progression/song-unlock-engine.js";

export class EQRMSSActorBardHelper {
  constructor(sheet) {
    this.sheet = sheet;
  }

  prepare(context) {
    const actor = this.sheet.actor;
    context.songs = actor.items.filter(i => i.type === "song");
    return context;
  }

  activate() {
    const html = this.sheet.element;
    if (!html) return;

    // Toggle active
    html.querySelectorAll("[data-action='bard-song-toggle']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const entry = btn.closest(".eq-song-entry");
        const id = entry.dataset.itemId;
        const song = this.sheet.actor.items.get(id);
        if (!song) return;

        const active = !!song.system?.active;
        await song.update({ "system.active": !active });
        this.sheet.render();
      });
    });

    // Tier up/down
    html.querySelectorAll("[data-action='bard-song-tier-up']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const entry = btn.closest(".eq-song-entry");
        const id = entry.dataset.itemId;
        const song = this.sheet.actor.items.get(id);
        if (!song) return;

        const tier = song.system?.tier ?? 1;
        await song.update({ "system.tier": tier + 1 });
        this.sheet.render();
      });
    });

    html.querySelectorAll("[data-action='bard-song-tier-down']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const entry = btn.closest(".eq-song-entry");
        const id = entry.dataset.itemId;
        const song = this.sheet.actor.items.get(id);
        if (!song) return;

        const tier = song.system?.tier ?? 1;
        await song.update({ "system.tier": Math.max(1, tier - 1) });
        this.sheet.render();
      });
    });

    // Twist start/stop
    html.querySelectorAll("[data-action='bard-twist-start']").forEach(btn => {
      btn.addEventListener("click", () => {
        const activeSongs = this.sheet.actor.items
          .filter(i => i.type === "song" && i.system?.active)
          .map(i => i.id);

        EQRMSSSongUnlockEngine.startTwistRotation(this.sheet.actor, activeSongs, 3000);
      });
    });

    html.querySelectorAll("[data-action='bard-twist-stop']").forEach(btn => {
      btn.addEventListener("click", () => {
        EQRMSSSongUnlockEngine.stopTwistRotation(this.sheet.actor);
        this.sheet.render();
      });
    });
  }
}
