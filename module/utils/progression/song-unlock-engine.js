/**
 * EQRMSS Song Unlock Engine
 *
 * Tick = level‑up for unlocks, rounds for twisting.
 */

export class EQRMSSSongUnlockEngine {

  static getUnlocksForLevel(actor, level) {
    if (!actor || !Number.isFinite(level)) return [];

    const classId = actor.system?.class?.id ?? actor.system?.classId;
    if (classId !== "bard") return [];

    const songsByClass = game.eqrmss?.data?.songs?.songsByClass ?? {};
    const bardSongs = songsByClass.bard ?? [];

    return bardSongs.filter(song => song.level === level);
  }

  static async applyUnlocks(actor, level) {
    const unlocks = this.getUnlocksForLevel(actor, level);
    if (!unlocks.length) return [];

    const items = unlocks.map(song => ({
      name: song.name,
      type: "song",
      img: song.icon ?? "icons/svg/music.svg",
      system: {
        level: song.level,
        durationRounds: song.durationRounds ?? 1,
        effect: song.effect,
        description: song.description,
        tier: song.tier ?? 1,
        active: false
      }
    }));

    const created = await actor.createEmbeddedDocuments("Item", items);
    return created;
  }

  static async twist(actor, songIds = []) {
    if (!actor) return;

    const songs = actor.items.filter(i => i.type === "song");

    for (const song of songs) {
      await song.update({ "system.active": false });
    }

    for (const id of songIds) {
      const song = actor.items.get(id);
      if (!song) continue;

      await song.update({ "system.active": true });
    }

    return true;
  }

  static async startTwistRotation(actor, songIds = [], intervalMs = 3000) {
    if (!actor || !songIds.length) return;

    let index = 0;

    const twistLoop = async () => {
      const songId = songIds[index];
      await this.twist(actor, [songId]);

      index = (index + 1) % songIds.length;

      actor.system._twistTimeout = setTimeout(twistLoop, intervalMs);
    };

    twistLoop();
  }

  static stopTwistRotation(actor) {
    const timeout = actor.system?._twistTimeout;
    if (timeout) {
      clearTimeout(timeout);
      actor.system._twistTimeout = null;
    }

    const songs = actor.items.filter(i => i.type === "song");
    for (const song of songs) {
      song.update({ "system.active": false });
    }
  }
}
