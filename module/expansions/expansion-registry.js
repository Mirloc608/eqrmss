/**
 * ============================================================
 * EQRMSS Expansion Registry
 * ============================================================
 *
 * Responsibilities:
 * - Hold loaded expansion data
 * - Expose registry APIs
 * - Serve expansion metadata
 *
 * Does NOT:
 * - Apply unlock rules
 * - Manage active expansion state
 * - Validate manifests
 *
 * ============================================================
 */

import { EQRMSSExpansionLoader }
  from "./expansion-loader.js";

const MODULE_ID = "eqrmss";

export class EQRMSSExpansionRegistry {

  static #index = null;

  static #expansions = {};

  static #loaded = false;

  /**
   * ==========================================================
   * Initialization
   * ==========================================================
   */

  static async initialize() {

    if (this.#loaded) {
      return;
    }

    const result =
      await EQRMSSExpansionLoader.load();

    this.#index =
      result.index;

    this.#expansions =
      result.expansions;

    this.#loaded = true;

    console.info(
      `${MODULE_ID} | Expansion Registry initialized`,
      {
        expansions:
          this.#index.expansions.length,
        current:
          this.#index.currentExpansion
      }
    );
  }

  static isInitialized() {
    return this.#loaded;
  }

  /**
   * ==========================================================
   * Registry Access
   * ==========================================================
   */

  static getIndex() {
    return this.#index;
  }

  static getExpansions() {
    return this.#expansions;
  }

  static getExpansionIds() {

    return EQRMSSExpansionLoader
      .getExpansionIds(
        this.#index
      );
  }

  static getProgression() {

    return EQRMSSExpansionLoader
      .getProgression(
        this.#index
      );
  }

  /**
   * ==========================================================
   * Expansion Access
   * ==========================================================
   */

  static getExpansion(id) {

    return EQRMSSExpansionLoader
      .getExpansion(
        this.#expansions,
        id
      );
  }

  static hasExpansion(id) {

    return EQRMSSExpansionLoader
      .hasExpansion(
        this.#expansions,
        id
      );
  }

  static getExpansionOrder(id) {

    return EQRMSSExpansionLoader
      .getExpansionOrder(
        this.#index,
        id
      );
  }

  static getExpansionByOrder(order) {

    return EQRMSSExpansionLoader
      .getExpansionByOrder(
        this.#index,
        order
      );
  }

  /**
   * ==========================================================
   * Current Expansion
   * ==========================================================
   */

  static getCurrentExpansion() {

    return EQRMSSExpansionLoader
      .getCurrentExpansion(
        this.#index
      );
  }

  static getDefaultExpansion() {

    return EQRMSSExpansionLoader
      .getDefaultExpansion(
        this.#index
      );
  }

  static getMinimumExpansion() {

    return EQRMSSExpansionLoader
      .getMinimumExpansion(
        this.#index
      );
  }

  static getMaximumExpansion() {

    return EQRMSSExpansionLoader
      .getMaximumExpansion(
        this.#index
      );
  }

  static getExpansionLevelCap(
    id
  ) {

    return EQRMSSExpansionLoader
      .getExpansionLevelCap(
        this.#index,
        id
      );
  }

  /**
   * ==========================================================
   * Milestones
   * ==========================================================
   */

  static getMilestones() {

    return EQRMSSExpansionLoader
      .getMilestones(
        this.#index
      );
  }

  static getMilestone(name) {

    return EQRMSSExpansionLoader
      .getMilestone(
        this.#index,
        name
      );
  }

  static getFirstAaExpansion() {

    return EQRMSSExpansionLoader
      .getFirstAaExpansion(
        this.#index
      );
  }

  static getFirstAdvancedAaExpansion() {

    return EQRMSSExpansionLoader
      .getFirstAdvancedAaExpansion(
        this.#index
      );
  }

  static getFirstPlayableRaceExpansion() {

    return EQRMSSExpansionLoader
      .getFirstPlayableRaceExpansion(
        this.#index
      );
  }

  static getFirstExpansionClassUnlock() {

    return EQRMSSExpansionLoader
      .getFirstExpansionClassUnlock(
        this.#index
      );
  }

  static getSecondExpansionClassUnlock() {

    return EQRMSSExpansionLoader
      .getSecondExpansionClassUnlock(
        this.#index
      );
  }

  /**
   * ==========================================================
   * Content Access
   * ==========================================================
   */

  static getExpansionRegions(id) {

    return EQRMSSExpansionLoader
      .getExpansionRegions(
        this.#expansions,
        id
      );
  }

  static getExpansionWorlds(id) {

    return EQRMSSExpansionLoader
      .getExpansionWorlds(
        this.#expansions,
        id
      );
  }

  static getExpansionContinents(id) {

    return EQRMSSExpansionLoader
      .getExpansionContinents(
        this.#expansions,
        id
      );
  }

  static getExpansionRealms(id) {

    return EQRMSSExpansionLoader
      .getExpansionRealms(
        this.#expansions,
        id
      );
  }

  static getExpansionRaces(id) {

    return EQRMSSExpansionLoader
      .getExpansionRaces(
        this.#expansions,
        id
      );
  }

  static getExpansionClasses(id) {

    return EQRMSSExpansionLoader
      .getExpansionClasses(
        this.#expansions,
        id
      );
  }

  static isPlaceholderExpansion(id) {

    return EQRMSSExpansionLoader
      .isPlaceholderExpansion(
        this.#expansions,
        id
      );
  }

  /**
   * ==========================================================
   * Progression Helpers
   * ==========================================================
   */

  static isExpansionAtOrAfter(
    sourceId,
    targetId
  ) {

    return EQRMSSExpansionLoader
      .isExpansionAtOrAfter(
        this.#index,
        sourceId,
        targetId
      );
  }

  static isExpansionBefore(
    sourceId,
    targetId
  ) {

    return EQRMSSExpansionLoader
      .isExpansionBefore(
        this.#index,
        sourceId,
        targetId
      );
  }

  static getExpansionRange(
    startId,
    endId
  ) {

    return EQRMSSExpansionLoader
      .getExpansionRange(
        this.#index,
        startId,
        endId
      );
  }
}