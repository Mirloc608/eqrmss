// ============================================================
// EQRMSS — Character Creation Wizard Data Service
//
// Part 2 — Data
//
// Consumes the shared RaceLoader/ClassLoader output already present in
// CONFIG.EQRMSS (populated during the ready pipeline). This service does
// NOT re-fetch race/class JSON over HTTP.
// ============================================================

import { RMSS_STAT_PRIORITIES } from "../data/stats/rmss-priorities.js";
import { canonicalStatKey } from "../utils/actor/rmss-stats.js";
import {
    initializeProgressions,
    getLoadedProgression
} from "../progression/progression-loader.js";

/**
 * Expansion gating for the wizard. Mirrors the AA loader's
 * getExpansionManager() helper: fail open (unfiltered) when the
 * expansion manager is unavailable.
 */

function getExpansionManager() {
    return game?.eqrmss?.expansions || null;
}

function filterByExpansionGate(items, gateName) {
    const manager = getExpansionManager();
    if (!manager || typeof manager[gateName] !== "function") return items;
    try {
        return items.filter(item => manager[gateName](item.id ?? item._id));
    } catch (err) {
        console.warn(
            "EQRMSS | Character Creation | expansion gate failed, showing all",
            err
        );
        return items;
    }
}

export class EQRMSSCharacterCreationData {

  static #instance = null;

  static async load() {
    if (!this.#instance) {
      this.#instance = new EQRMSSCharacterCreationData();
      await this.#instance.initialize();
    }
    return this.#instance;
  }

  constructor() {
    this.races = [];
    this.classes = [];
    this.cities = [];
    this.deities = [];

        this.raceDefinitions = {};
        this.classDefinitions = {};

    this.rmssPriorities = {};

    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return this;
    }

    console.log("EQRMSS | Character Creation Data Service initializing");

    // Ensure global configuration exists
    CONFIG.EQRMSS ??= {};

        // Pull races and classes directly from preloaded CONFIG dictionaries or arrays
    this.races = this.#normalizeRaces(
      Array.isArray(CONFIG.EQRMSS.races)
        ? CONFIG.EQRMSS.races
        : Object.values(CONFIG.EQRMSS.races || {})
    );

        this.classes = await this.#normalizeClasses(
      Array.isArray(CONFIG.EQRMSS.classes)
        ? CONFIG.EQRMSS.classes
        : Object.values(CONFIG.EQRMSS.classes || {})
    );

    // Cities and Deities load from compendium packs
    this.cities = await this.#loadPack("eqrmss.cities");
    this.deities = await this.#loadPack("eqrmss.deities");

            // Definitions ARE the already-loaded documents; keep key→doc maps for
    // API compatibility instead of re-fetching the same JSON files.
    this.raceDefinitions = this.#buildDefinitionMap(this.races);
    this.classDefinitions = this.#buildDefinitionMap(this.classes);

        // Canonical priority matrix from module/data/stats/rmss-priorities.js —
    // do not maintain a second copy here. Stat keys are normalized to the
    // canonical uppercase spelling so they always match wizard stat keys.
    this.rmssPriorities = this.#normalizePriorities(RMSS_STAT_PRIORITIES);

    this.initialized = true;

    console.log("EQRMSS | Character Creation Data Service ready", {
      version: '2.1.0',
      races: this.races.length,
      classes: this.classes.length,
      cities: this.cities.length,
      deities: this.deities.length
    });

    return this;
  }

  // ------------------------------------------------------------
  // COMPENDIA
  // ------------------------------------------------------------

  async #loadPack(packName) {
    const pack = game.packs.get(packName);

    if (!pack) {
      console.warn(`EQRMSS | Missing compendium: ${packName}`);
      return [];
    }

    try {
      await pack.getIndex();
      // Compendium index entries are stored with `_id`, while the wizard
      // template uses the same `id` field as race/class JSON definitions.
      // Normalize that boundary once so every selection has a usable value.
      return Array.from(pack.index.values()).map(entry => ({
        ...entry,
        id: entry.id ?? entry._id
      }));
    }
    catch (error) {
      console.error(`EQRMSS | Failed loading ${packName}`, error);
      return [];
    }
  }

    // ------------------------------------------------------------
  // DEFINITION MAPS
  // ------------------------------------------------------------

        #buildDefinitionMap(documents) {
      const map = {};

      for (const doc of documents ?? []) {
        // Match the normalized `id` boundary established in #loadPack,
        // falling back to `_id` / `name` for raw CONFIG entries.
        const key = doc.id ?? doc._id ?? doc.name;

        if (key == null) continue;

        map[key] = doc;
      }

      return map;
    }

    // ------------------------------------------------------------
    // PRIORITIES
    // ------------------------------------------------------------

    #normalizePriorities(priorities) {
      const out = {};

      for (const [classKey, tiers] of Object.entries(priorities ?? {})) {
        out[classKey] = {};
        for (const [tier, keys] of Object.entries(tiers ?? {})) {
          out[classKey][tier] = (keys ?? [])
            .map(k => canonicalStatKey(k))
            .filter(Boolean);
        }
      }

      return out;
    }

  // ------------------------------------------------------------
  // NORMALIZATION
  //
  // The wizard template renders flat string arrays. The raw race/class
  // JSON uses nested structures (role.primary, eqrmss.identity.strengths,
  // startingLanguages as {name, rank} objects, ...). Normalize once,
  // here, into pure view models — never mutating CONFIG.EQRMSS.
  // ------------------------------------------------------------

  #asList(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  }

  #stringifyEntry(entry) {
    // {name, rank} -> "Common (Rank 3)" | {name} -> "Common" | "x" -> "x"
    if (entry == null) return null;
    if (typeof entry === "string") return entry;
    if (typeof entry === "object") {
      const name = entry.name ?? entry.id ?? "";
      if (!name) return null;
      return entry.rank != null ? `${name} (Rank ${entry.rank})` : name;
    }
    return String(entry);
  }

  #normalizeRaces(raw) {
    return raw.map(r => ({
      ...r,
      stats: r.stats ?? {},
      movement: r.movement ?? {},
      lore: r.lore ?? {},
      startingLanguages: this.#asList(r.startingLanguages)
        .map(e => this.#stringifyEntry(e))
        .filter(Boolean),
      racialAbilities: this.#asList(
        r.racialAbilities ?? r.racialTalents
      )
    }));
  }

    async #normalizeClasses(raw) {
    // progression data is fetched once, then consulted synchronously per class
    await initializeProgressions();

    return raw.map(c => {
      const ex = c.eqrmss ?? {};
      const role = c.role ?? {};
      const armor = c.armor ?? {};
      const weapons = c.weapons ?? {};

      // description: object {summary,...} or string
      let description = c.description;
      if (description && typeof description === "object") {
        description = description.summary
          ?? Object.values(description).find(v => typeof v === "string")
          ?? "";
      }

            // abilities: {level1:[{id,name,description}],...} -> flat string list
            const abilities = Object.entries(c.abilities ?? {})
              .flatMap(([lvl, list]) => {
                const n = String(lvl).replace(/^level/i, "");
                return this.#asList(list).map(a =>
                  typeof a === "string"
                    ? `${a} (Level ${n})`
                    : a?.name
                      ? `${a.name} (Level ${n})`
                      : null
                );
              })
              .filter(Boolean);

      // equipment: [{name,type},...] -> strings
      const equipment = this.#asList(c.startingEquipment)
        .map(e => this.#stringifyEntry(e))
        .filter(Boolean);

            // progression: real level-by-level data lives in the progression
            // loader (packs/progression/classes/<id>.json), keyed by class id.
            const classKey = c.key ?? c.id ?? c.name?.toLowerCase?.();
            const levelsSource =
              getLoadedProgression(classKey)?.levels
              ?? c.levels
              ?? {};

            const progression = Object.entries(levelsSource)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([lvl, info]) => `Level ${lvl}: ${this.#summarizeProgression(info)}`)
              .filter(s => s.length > 9);

      // spellLists: {baseLists:{Arcane:[...]}, specialization:[...]} -> strings
      const baseLists = Object.entries(
        (c.spellLists && c.spellLists.baseLists) || {}
      ).map(([realm, lists]) =>
        `${realm}: ${[].concat(...Object.values(lists || {})).join(", ")}`
      );
      const spec = this.#asList(c.spellLists && c.spellLists.specialization);
      const spellLists = [...baseLists, ...(spec.length ? ["Specialization: " + spec.join(", ")] : [])];

            return {
        ...c,

        // template contract: flat string arrays / scalars
        description,
        archetype: c.archetype ?? role.primary ?? "",
        roles: [
          ...(role.primary ? [String(role.primary)] : []),
          ...this.#asList(role.secondary)
        ],
        stats: this.#asList(
          (c.stats && c.stats.primeRequisites) || []
        ),
        armor: this.#asList(armor.allowed),
        weapons: this.#asList(weapons.allowed),
        magic: this.#asList(c.magic),
        resources: this.#asList(c.resources),

        strengths: this.#asList(ex.identity?.strengths ?? c.classFeatures),
        weaknesses: this.#asList(ex.weaknesses),
        mechanics: this.#asList(ex.signatureMechanics),
        tags: this.#asList(ex.tags),
        pending: this.#asList(ex.pending),

                features: this.#asList(c.classFeatures),
        // combatActions: [{id,name},...] or [string,...] -> display strings
        extensions: this.#asList(c.combatActions ?? c.disciplines)
          .map(e => this.#stringifyEntry(e))
          .filter(Boolean),
        progression,
        abilities,
        skillCosts: this.#asList(
          (c.skills && c.skills.bonusCategories) || []
        ),
        spellLists,
        equipment
      };
    });
  }

    #summarizeProgression(info) {
    if (info == null) return "";
    if (typeof info === "string") return info;
    const parts = [];
    for (const [key, value] of Object.entries(info)) {
      if (key === "level" || value === false || value == null) continue;
      const label = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, s => s.toUpperCase());
      if (value === true) { parts.push(label); continue; }
      const list = Array.isArray(value) ? value : [value];
      const text = list
        .map(v => (typeof v === "object" ? v.name ?? v.id : String(v)))
        .filter(Boolean)
        .join(", ");
      if (text) parts.push(`${label}: ${text}`);
    }
    return parts.join(" · ");
  }

  // ------------------------------------------------------------
  // CONTEXT
  // ------------------------------------------------------------

  getContext() {
    return {
      races: filterByExpansionGate(this.races, "isRaceUnlocked"),
      classes: filterByExpansionGate(this.classes, "isClassUnlocked"),
      cities: this.cities,
      deities: this.deities,
      raceDefinitions: this.raceDefinitions,
      classDefinitions: this.classDefinitions,
      rmssPriorities: this.rmssPriorities
    };
  }
}

export async function loadCharacterCreationData() {
  return EQRMSSCharacterCreationData.load();
}

console.log("EQRMSS | Character Creation Data Service loaded");

