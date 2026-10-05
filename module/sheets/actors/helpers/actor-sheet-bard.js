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
import { visibleSongs } from "../../../utils/item-visibility.js";
import { toggleSong } from "../../../spells/songs.js";

export class EQRMSSActorBardHelper {
  constructor(sheet) {
    this.sheet = sheet;
  }

  prepare(context) {
    const actor = this.sheet.actor;
    context.songs = visibleSongs(actor.items);
    return context;
  }

  activate() {
    const html = this.sheet.element;
    if (!html) return;

    // Toggle active (Stage 5: activation applies the song's
    // effects to the currently-targeted actors; the round tick
    // pulses them while the song stays active).
    html.querySelectorAll("[data-action='bard-song-toggle']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const entry = btn.closest(".eq-song-entry");
        const id = entry.dataset.itemId;
        const song = this.sheet.actor.items.get(id);
        if (!song) return;

        const targets = [...(game.user?.targets ?? [])].map(t => t.actor).filter(Boolean);
        await toggleSong(this.sheet.actor, song, targets);
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
