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

    const unlockExpansion =
      this.getUnlocks()
        ?.aas;

    if (!unlockExpansion) {
      return false;
    }

    return this.isExpansionUnlocked(
      unlockExpansion
    );
  }

  static hasAdvancedAAs() {

    const unlockExpansion =
      this.getUnlocks()
        ?.advancedAas;

    if (!unlockExpansion) {
      return false;
    }

    return this.isExpansionUnlocked(
      unlockExpansion
    );
  }

  static isRaceUnlocked(
    raceId
  ) {

    const unlockExpansion =
      this.getUnlocks()
        ?.races?.[raceId];

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
      this.getUnlocks()
        ?.classes?.[classId];

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

    for (
      const expansionId of
      EQRMSSExpansionRegistry
        .getExpansionIds()
    ) {

      const values =
        EQRMSSExpansionRegistry
          expansionId;

      if (
        Array.isArray(values) &&
        values.includes(targetId)
      ) {

        return this.isExpansionUnlocked(
          expansionId
        );
      }
    }

    return false;
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