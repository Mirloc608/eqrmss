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

// Coerce a races/classes source (array or key→entry dictionary) into a clean
// array. Drops loader metadata keys (schemas, indexes, manifests) that are not
// playable entries, and ensures every entry has id/key/name.
function coerceToArray(obj) {
    if (Array.isArray(obj)) {
        return obj.filter(i => {
            const id = String(i?.id ?? i?.key ?? "").toLowerCase();
            return id && !["race-schema", "schema", "index"].includes(id) && !id.includes("schema");
        });
    }
    if (!obj || typeof obj !== "object") return [];
    return Object.entries(obj)
        .filter(([k]) => {
            const kl = k.toLowerCase();
            return !["race-schema", "schema", "index", "manifest", "races", "classes"].includes(kl) && !kl.includes("schema");
        })
        .map(([key, val]) => {
            if (val && typeof val === "object") {
                const c = { ...val };
                if (!c.id) c.id = key;
                if (!c.key) c.key = key;
                if (!c.name) c.name = c.label || key;
                return c;
            }
            return { id: key, name: String(val), value: val };
        });
}

function filterByExpansionGate(items, gateName) {
    const list = coerceToArray(items);
    const manager = getExpansionManager();
    if (!manager || typeof manager[gateName] !== "function") return list;
    try {
        return list.filter(item => manager[gateName](item.id ?? item._id));
    } catch (err) {
        console.warn(
            "EQRMSS | Character Creation | expansion gate failed, showing all",
            err
        );
        return list;
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
    this.continents = [];
    this.regions = [];
    this.settlements = [];
    this.raceAvailability = {};

        this.raceDefinitions = {};
        this.classDefinitions = {};

    this.rmssPriorities = {};

    this.startingSpells = {};

    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return this;
    }

    console.log("EQRMSS | Character Creation Data Service initializing");

    // Ensure global configuration exists
    CONFIG.EQRMSS ??= {};

        // Races/classes: prefer CONFIG.EQRMSS, fall back to the data loaders'
    // game.eqrmss dictionaries (populated by initializeDataLoaders at ready).
    this.races = this.#normalizeRaces(
      this.#resolveList(CONFIG.EQRMSS.races, game?.eqrmss?.races)
    );

        this.classes = await this.#normalizeClasses(
      this.#resolveList(CONFIG.EQRMSS.classes, game?.eqrmss?.classes)
    );

    // Cities and Deities: prefer the origin data loader (game.eqrmss.origin),
    // fall back to direct JSON fetch if the loader hasn't run yet.
    const originData = game?.eqrmss?.origin;
    if (originData?.cities?.length) {
      this.cities = originData.cities;
      this.deities = originData.deities ?? [];
      this.continents = originData.continents ?? [];
      this.regions = originData.regions ?? [];
      this.settlements = originData.settlements ?? [];
      this.raceAvailability = originData.raceAvailability ?? {};
      // Expose helper functions
      this.getRegionsForContinent = originData.getRegionsForContinent?.bind(originData);
      this.getSettlementsForRegion = originData.getSettlementsForRegion?.bind(originData);
      this.getCitiesForRace = originData.getCitiesForRace?.bind(originData);
      this.getOriginPath = originData.getOriginPath?.bind(originData);
    } else {
      // Fallback: load directly from JSON
      this.cities = await this.#loadJson("systems/eqrmss/module/data/origin/cities.json");
      this.deities = await this.#loadJson("systems/eqrmss/module/data/origin/deities.json");
      this.continents = await this.#loadJson("systems/eqrmss/module/data/origin/origins/continents.json");
      this.regions = await this.#loadJson("systems/eqrmss/module/data/origin/origins/regions.json");
      this.settlements = await this.#loadJson("systems/eqrmss/module/data/origin/origins/settlements.json");
      const raceAvail = await this.#loadJson("systems/eqrmss/module/data/origin/race_city_availability.json");
      this.raceAvailability = Array.isArray(raceAvail) ? raceAvail[0] ?? {} : raceAvail ?? {};
    }

            // Definitions ARE the already-loaded documents; keep key→doc maps for
    // API compatibility instead of re-fetching the same JSON files.
    this.raceDefinitions = this.#buildDefinitionMap(this.races);
    this.classDefinitions = this.#buildDefinitionMap(this.classes);

        // Canonical priority matrix from module/data/stats/rmss-priorities.js —
    // do not maintain a second copy here. Stat keys are normalized to the
    // canonical uppercase spelling so they always match wizard stat keys.
    this.rmssPriorities = this.#normalizePriorities(RMSS_STAT_PRIORITIES);

    // Locked starting spells/songs granted by the wizard (fixed sets, no
    // picker). Object keyed by lowercase class id — fetched directly, not
    // via #loadJson, to preserve the key→names shape.
    try {
      const resp = await fetch("systems/eqrmss/module/data/spells/starting-spells.json");
      this.startingSpells = resp.ok ? (await resp.json()) ?? {} : {};
    } catch {
      this.startingSpells = {};
    }

    // Per-class development costs for the wizard Skills step (Table
    // 15.2.1 mapping, user-ruled 2026-09-29). Full document fetched
    // directly to preserve the classes key→entry shape.
    try {
      const resp = await fetch("systems/eqrmss/module/data/skills/class-development-costs.json");
      this.developmentCosts = resp.ok ? (await resp.json()) ?? {} : {};
    } catch {
      this.developmentCosts = {};
    }

    // Racial base-hits data (Table 15.5.1: hit die, max BHPT, rounds to
    // soul departure) for Body Development rolls in the Skills step.
    try {
      const resp = await fetch("systems/eqrmss/module/data/races/base-hits.json");
      this.baseHits = resp.ok ? (await resp.json())?.races ?? {} : {};
    } catch {
      this.baseHits = {};
    }

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
  // JSON DATA (cities, deities — canonical source, replaces compendia)
  // ------------------------------------------------------------

  async #loadJson(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        console.warn(`EQRMSS | Missing data file: ${path}`);
        return [];
      }
      const data = await response.json();
      // Normalize `id` so every selection has a usable value, matching
      // the same boundary the old compendium loader established.
      const list = Array.isArray(data) ? data : [data];
      return list.map(entry => ({
        ...entry,
        id: entry.id ?? entry._id ?? entry.name
      }));
    }
    catch (error) {
      console.error(`EQRMSS | Failed loading ${path}`, error);
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

  // Prefer the CONFIG list when it has entries; otherwise coerce the
  // game.eqrmss dictionary (or array) into a clean list.
  #resolveList(configVal, gameVal) {
    const fromConfig = coerceToArray(configVal);
    if (fromConfig.length > 0) return fromConfig;
    return coerceToArray(gameVal);
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
            // loader (module/data/progressions/<id>.json), keyed by class id.
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
      continents: this.continents,
      regions: this.regions,
      settlements: this.settlements,
      raceAvailability: this.raceAvailability,
      raceDefinitions: this.raceDefinitions,
      classDefinitions: this.classDefinitions,
      rmssPriorities: this.rmssPriorities,
      startingSpells: this.startingSpells,
      developmentCosts: this.developmentCosts,
      baseHits: this.baseHits
    };
  }

  // ------------------------------------------------------------
  // STARTING SPELLS / SONGS
  //
  // Resolve the locked starting sets for a class id into full
  // spell/song documents from the runtime loaders (display data for
  // the wizard step; the finalizer creates the items). Fail-soft:
  // unknown names are skipped with a warning so creation never blocks.
  // ------------------------------------------------------------

  resolveStartingSpells(classId) {
    const key = String(classId ?? "").toLowerCase();
    const names = this.startingSpells?.[key] ?? [];
    if (!names.length) return [];
    const spellPool = game?.eqrmss?.spells?.[key] ?? [];
    const songPool = CONFIG?.EQRMSS?.songs ?? [];
    const resolved = [];
    for (const name of names) {
      const doc =
        spellPool.find(s => s?.name === name) ??
        songPool.find(s => s?.name === name);
      if (doc) resolved.push(doc);
      else console.warn(`EQRMSS | Wizard | starting spell/song not found: "${name}" (${key})`);
    }
    return resolved;
  }

  // ------------------------------------------------------------
  // DEVELOPMENT COSTS (Skills step)
  //
  // Per-class Table 15.2.1 cost mapping for the two-pass DP system.
  // Returns the class entry (generalSkills, magicalSkills,
  // maneuveringInArmor, specialSkills, weaponCosts, weaponAssignment)
  // or null when unknown. Fail-soft: the Skills step renders an
  // explanatory empty state instead of breaking creation.
  // ------------------------------------------------------------

  resolveDevelopmentCosts(classId) {
    const key = String(classId ?? "").toLowerCase();
    return this.developmentCosts?.classes?.[key] ?? null;
  }
}

export async function loadCharacterCreationData() {
  return EQRMSSCharacterCreationData.load();
}

console.log("EQRMSS | Character Creation Data Service loaded");
