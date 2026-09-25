/**
 * ============================================================
 * EQRMSS Expansion Manager
 * ============================================================
 *
 * Active expansion state.
 * Unlock resolution.
 *
 * No hardcoded expansion mappings.
 *
 * ============================================================
 */

import { EQRMSSExpansionRegistry }
  from "./expansion-registry.js";

const MODULE_ID = "eqrmss";

/**
 * Fallback level cap when expansion metadata is unavailable.
 * Classic era.
 */
const CLASSIC_LEVEL_CAP = 50;

export class EQRMSSExpansionManager {

  static #activeExpansion = null;

  static async initialize() {

    await EQRMSSExpansionRegistry.initialize();

    let configured = null;

    try {

      configured =
        game.settings.get(
          MODULE_ID,
          "activeExpansion"
        );

    } catch (err) {

      console.warn(
        `${MODULE_ID} | activeExpansion setting not registered`
      );
    }

    this.#activeExpansion =
      configured ??
      EQRMSSExpansionRegistry
        .getDefaultExpansion();

    return this;
  }

  static getActiveExpansion() {
    return this.#activeExpansion;
  }

  /**
   * Level cap for an expansion (defaults to the active one).
   * Falls back to the classic-era cap when metadata is missing.
   */

  static getLevelCap(
    expansionId = this.#activeExpansion
  ) {

    const cap =
      EQRMSSExpansionRegistry
        .getExpansionLevelCap(
          expansionId
        );

    return cap ?? CLASSIC_LEVEL_CAP;
  }

  static getActiveExpansionName() {

    return (
      EQRMSSExpansionRegistry
        .getExpansion(
          this.#activeExpansion
        )
        ?.name ??
      this.#activeExpansion
    );
  }

  static async setActiveExpansion(
    expansionId
  ) {

    if (
      !EQRMSSExpansionRegistry
        .hasExpansion(expansionId)
    ) {

      throw new Error(
        `Unknown expansion: ${expansionId}`
      );
    }

    this.#activeExpansion =
      expansionId;

    try {

      await game.settings.set(
        MODULE_ID,
        "activeExpansion",
        expansionId
      );

    } catch (err) {

      console.warn(
        `${MODULE_ID} | failed to persist expansion`,
        err
      );
    }

    Hooks.callAll(
      "eqrmssExpansionChanged",
      expansionId
    );

    this.#warnOverCapActors(
      expansionId
    );
  }

  /**
   * Warn (never silently clamp) when switching to an expansion
   * whose level cap sits below an existing character's level.
   * GM-only; players just see the level-up block.
   */

  static #warnOverCapActors(
    expansionId
  ) {

    try {

      if (
        !game?.user?.isGM ||
        !game?.actors
      ) {

        return;
      }

      const cap =
        this.getLevelCap(
          expansionId
        );

      const over = [];

      for (
        const actor of
        game.actors
      ) {

        if (
          actor.type !==
          "character"
        ) {

          continue;
        }

        const level =
          Number(
            actor.system
              ?.attributes
              ?.level
              ?.value ??
            actor.system
              ?.level ??
            actor.system
              ?.character
              ?.level ??
            1
          );

        if (
          level > cap
        ) {

          over.push(
            `${actor.name} (${level})`
          );
        }
      }

      if (
        over.length
      ) {

        const name =
          this.getActiveExpansionName();

        ui.notifications.warn(
          `EQRMSS | ${over.length} character(s) exceed the ${name} level cap of ${cap}: ${over.join(", ")}`
        );
      }

    } catch (err) {

      console.warn(
        `${MODULE_ID} | over-cap actor scan failed`,
        err
      );
    }
  }

  static getUnlocks() {

    return (
      EQRMSSExpansionRegistry
        .getIndex()
        ?.unlocks ||
      {}
    );
  }

  static isExpansionUnlocked(
    expansionId
  ) {

    return EQRMSSExpansionRegistry
      .isExpansionAtOrAfter(
        this.#activeExpansion,
        expansionId
      );
  }

  static hasAAs() {

    return this.#isContentFlagUnlocked(
      "aas"
    );
  }

  static hasAdvancedAAs() {

    return this.#isContentFlagUnlocked(
      "advancedAas"
    );
  }

  /**
   * Walk expansions in release order and unlock when the first
   * expansion whose content sets the given flag is unlocked.
   */

  static #isContentFlagUnlocked(
    flag
  ) {

    for (
      const expansionId of
      EQRMSSExpansionRegistry
        .getExpansionIds()
    ) {

      const expansion =
        EQRMSSExpansionRegistry
          .getExpansion(
            expansionId
          );

      if (
        expansion
          ?.content
          ?.[flag] === true
      ) {

        return this.isExpansionUnlocked(
          expansionId
        );
      }
    }

    return false;
  }

  static isRaceUnlocked(
    raceId
  ) {

    const unlockExpansion =
      this.#findContentExpansion(
        "getExpansionRaces",
        raceId
      );

    if (!unlockExpansion) {
      return true;
    }

    return this.isExpansionUnlocked(
      unlockExpansion
    );
  }

  static isClassUnlocked(
    classId
  ) {

    const unlockExpansion =
      this.#findContentExpansion(
        "getExpansionClasses",
        classId
      );

    if (!unlockExpansion) {
      return true;
    }

    return this.isExpansionUnlocked(
      unlockExpansion
    );
  }

  static isWorldUnlocked(
    worldId
  ) {

    return this.#isContentUnlocked(
      "getExpansionWorlds",
      worldId
    );
  }

  static isContinentUnlocked(
    continentId
  ) {

    return this.#isContentUnlocked(
      "getExpansionContinents",
      continentId
    );
  }

  static isRealmUnlocked(
    realmId
  ) {

    return this.#isContentUnlocked(
      "getExpansionRealms",
      realmId
    );
  }

  static isRegionUnlocked(
    regionId
  ) {

    return this.#isContentUnlocked(
      "getExpansionRegions",
      regionId
    );
  }

  static #isContentUnlocked(
    accessor,
    targetId
  ) {

    const expansionId =
      this.#findContentExpansion(
        accessor,
        targetId
      );

    if (!expansionId) {
      return false;
    }

    return this.isExpansionUnlocked(
      expansionId
    );
  }

  /**
   * Return the id of the first expansion (in release order)
   * whose content list contains targetId, or null when no
   * expansion lists it.
   */

  static #findContentExpansion(
    accessor,
    targetId
  ) {

    for (
      const expansionId of
      EQRMSSExpansionRegistry
        .getExpansionIds()
    ) {

      const values =
        EQRMSSExpansionRegistry
          [accessor](
            expansionId
          );

      if (
        Array.isArray(values) &&
        values.includes(targetId)
      ) {

        return expansionId;
      }
    }

    return null;
  }

  static getUnlockedRegions() {

    const results = [];

    for (
      const expansionId of
      EQRMSSExpansionRegistry
        .getExpansionIds()
    ) {

      if (
        !this.isExpansionUnlocked(
          expansionId
        )
      ) {
        continue;
      }

      const regions =
        EQRMSSExpansionRegistry
          .getExpansionRegions(
            expansionId
          );

      if (
        Array.isArray(regions)
      ) {

        results.push(
          ...regions
        );
      }
    }

    return results;
  }
}