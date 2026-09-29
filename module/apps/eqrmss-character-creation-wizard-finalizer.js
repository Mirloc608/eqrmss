// ============================================================
// EQRMSS — Character Creation Wizard Finalizer
// Part 4 — Final Actor Creation
// ============================================================

import { extractRacialModifiers } from "../utils/actor/rmss-stats.js";

/**
 * Format one song effect record into a short human-readable summary line
 * for display on the song item sheet.
 */
function songEffectSummary(e) {
  const base = e?.value?.base ?? e?.value;
  const plus = (typeof base === "number" && base > 0) ? "+" : "";
  const dur = e?.duration ? ` (${e.duration} rounds)` : "";
  const ot = e?.over_time ? ` over ${e.over_time.duration} rounds` : "";
  switch (e?.type) {
    case "modifier": return `${String(e.stat ?? "").toUpperCase()} ${plus}${base ?? ""}${dur}`.trim();
    case "damage": return `Damage ${plus}${base ?? ""}${e.element ? " " + e.element : ""}${ot}${e.condition ? " if " + e.condition : ""}`.trim();
    case "heal": return `Heal ${plus}${base ?? ""}${dur}`.trim();
    case "regen": return `Regen ${e.stat ?? ""} ${plus}${base ?? ""}${dur}`.trim();
    case "utility": return `Utility: ${e.effect ?? ""}`.trim();
    case "control": return `Control: ${e.condition ?? ""}${dur}`.trim();
    case "invisibility": return `Invisibility${e.variant ? " (" + e.variant + ")" : ""}`.trim();
    case "debuff": return `Debuff: ${e.effect ?? ""} ${plus}${base ?? ""}${dur}`.trim();
    case "cure": return `Cure: ${e.effect ?? ""}`.trim();
    case "summon": return `Summon: ${e.pet ?? e.effect ?? ""}`.trim();
    default: return String(e?.type ?? "effect");
  }
}

export class EQRMSSCharacterCreationWizardFinalizer {

  constructor(wizardState = {}, context = {}) {
    this.state = wizardState;
    this.context = context;
  }

  async finalize() {
    const race = this.#resolve(this.context.races, this.state.raceId);
    const cls = this.#resolve(this.context.classes, this.state.classId);
    const deity = this.#resolve(this.context.deities, this.state.deityId);

    // Resolve origin: prefer hierarchical originId, fall back to legacy cityId
    // Origin can be a city (with full game data) or a settlement (smaller location)
    const originId = this.state.originId || this.state.cityId;
    let city = this.#resolve(this.context.cities, originId);
    let settlement = null;

    if (!city) {
      // Try settlements
      settlement = (this.context.settlements ?? []).find(s => s.id === originId);
    }

    if (!race || !cls) {
      ui.notifications.error("Race or profession data is missing — cannot finalize character.");
      return null;
    }

    if (!city && !settlement) {
      ui.notifications.error("Origin data is missing — cannot finalize character.");
      return null;
    }

    // For settlements, find the parent city for game mechanics (or use settlement data)
    // For now, use the settlement name as home_town and pass settlement data
    const originData = city ?? settlement;
    const actorData = this.#buildActorData(race, cls, originData, deity, settlement);

    try {
      const actor = await Actor.create(actorData, { renderSheet: true });

      if (!actor) {
        ui.notifications.error("Failed to create EQRMSS character.");
        return null;
      }

      ui.notifications.info(`Character "${actor.name}" created successfully.`);
      console.log("EQRMSS | Character finalized", actor);

      // Grant the locked starting spells/songs (fixed sets from
      // module/data/spells/starting-spells.json). Fail-soft: never blocks
      // creation.
      await this.#grantStartingSpells(actor, cls);

      // Grant the class starter kit (equipment + starting money) from
      // module/data/starter-kits.json. Fail-soft: never blocks creation.
      await this.#grantStarterKit(actor, cls, race);

      return actor;
    }
    catch (error) {
      console.error("EQRMSS | Character creation failed", error);
      ui.notifications.error(`Character creation failed: ${error.message}`);
      return null;
    }
  }

  #buildActorData(race, cls, city, deity, settlement = null) {
    const rawStats = this.state.stats || {};
    const rawPotentials = this.state.potentials || {};
    
        const finalStats = {};
    // Canonical, case-insensitive racial modifier lookup. Race JSONs use
    // "St"/"Ag"/… while the wizard uses "ST"/"AG"/…; raw bracket lookups
    // previously resolved every modifier to 0.
    const modifiers = extractRacialModifiers(race);

    for (const [key, tempVal] of Object.entries(rawStats)) {
      const potentialVal = rawPotentials[key] ?? tempVal;

      const racialMod = modifiers[key] ?? 0;

      const totalVal = Number(tempVal) + racialMod;

      finalStats[key] = {
        temp: Number(tempVal),
        potential: Number(potentialVal),
        basic_bonus: 0,
        racial_bonus: racialMod,
        special_bonus: 0,
        total: totalVal
      };
    }

    const charName = this.state.name?.trim() || "Unnamed Character";
    const raceName = race.name;
    const professionName = cls.name;
    const realm = cls.system?.realm || cls.realm || "Standard";

                return {
      name: charName,
      type: "character",

      // Ownership: the selected player owns the character (see #buildOwnership)
      ownership: this.#buildOwnership(),

            system: {
              name: charName,
              // Displayed in the sheet header "Player" field
              playerName: game.users.get(this.#resolveOwnerId())?.name ?? "",
              gender: this.state.gender || null,

        // Canonical stat schema consumed by eqrmss_actor._ensureSystemData()
        // and the sheet context helper. Previously this lived under
        // system.data.stats / system.attributes, which nothing read.
        stats: finalStats,

        // _ensureSystemData() backfills fixed_info (race/profession/city/
        // deity names) from this record automatically.
        origin: {
          raceId: String(race.id ?? race._id ?? ""),
          raceName,
          classId: String(cls.id ?? cls._id ?? ""),
          className: professionName,
          cityName: city.name,
          deityName: deity?.name ?? "",
          // Hierarchical origin data
          continentId: this.state.continentId ?? "",
          regionId: this.state.regionId ?? "",
          originId: this.state.originId ?? this.state.cityId ?? "",
          originType: settlement ? "settlement" : "city",
          settlementName: settlement?.name ?? null
        },

        character: {
          level: 1,
          experience: 0,
          developmentPoints: Number(this.state.devPoints) || 0
        },

        attributes: {
          hp: { value: 0, max: 0 },
          mana: { value: 0, max: 0 }
        },

                fixed_info: {
          realm: realm,
          training_packages: (this.state.trainingPackages ?? []).join(", "),
          nationality: this.state.nationality ?? ""
        },

                background: {
          home_town: city.name,
          deity: deity?.name ?? "",
          nationality: this.state.nationality ?? ""
        },

        physical: {
          height: Number(this.state.height) || null,
          weight: Number(this.state.weight) || null
        }
      },
      flags: {
        eqrmss: {
          createdByWizard: true,
          raceId: race._id ?? race.id,
          classId: cls._id ?? cls.id,
          cityId: city._id ?? city.id,
          deityId: deity?._id ?? deity?.id ?? null,
          ownerUserId: this.state.ownerUserId ?? game.userId
        }
      }
    };
  }

    #resolve(collection = [], id) {
    return collection.find(
      document => document?._id === id || document?.id === id
    );
  }

  // ============================================================
  // OWNERSHIP
  //
  // GMs may assign the new character to any user via the wizard's
  // Review-step dropdown (state.ownerUserId). Players always own
  // their own creation. Falls back safely when the chosen id is
  // stale, invalid, or belongs to a non-player account.
  // ============================================================

    #buildOwnership() {
    const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const requested = this.state?.ownerUserId;
    const isGM = game.user.isGM;

    let ownerId = game.userId;

    if (isGM && requested) {
      const target = game.users.get(requested);
      if (target && !target.isGM) ownerId = target.id;
    }

    return {
      // Respect the world's default player permission when the core
      // setting exists; otherwise fall back to OBSERVER silently.
      // (Some Foundry versions do not register defaultActorOwnership.)
      default: this.#worldDefaultPlayerLevel(),
      [ownerId]: LEVELS.OWNER
    };
  }

  #worldDefaultPlayerLevel() {
    const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    try {
      const value = game.settings.get("core", "defaultActorOwnership");
      return (
        foundry.utils.getProperty(value ?? {}, "player") ??
        LEVELS.OBSERVER
      );
        } catch {
      return LEVELS.OBSERVER;
    }
  }

  /** The user id that will own the new actor (mirrors #buildOwnership logic). */
  #resolveOwnerId() {
    if (game.user.isGM) {
      const requested = this.state?.ownerUserId;
      const target = requested ? game.users.get(requested) : null;
      if (target && !target.isGM) return target.id;
    }
    return game.userId;
  }

  /**
   * Grant the locked starting spells/songs as lightweight embedded Item
   * documents, following the codebase's reference-item convention
   * (progression rewards / song unlock engine): name + type, details
   * resolved by name from the loaders at render time. Fail-soft: a
   * missing spell/song is skipped with a warning; creation never blocks.
   */
  async #grantStartingSpells(actor, cls) {
    try {
      const key = String(cls?.id ?? cls?._id ?? "").toLowerCase();
      if (!key) return;

      let names = [];
      try {
        const resp = await fetch("systems/eqrmss/module/data/spells/starting-spells.json");
        if (resp.ok) names = (await resp.json())[key] ?? [];
      } catch { /* fall through */ }

      if (!names.length) return;

      const spellPool = game?.eqrmss?.spells?.[key] ?? [];
      const songPool = CONFIG?.EQRMSS?.songs ?? [];
      const items = [];

      for (const name of names) {
        const doc =
          spellPool.find(s => s?.name === name) ??
          songPool.find(s => s?.name === name);
        if (!doc) {
          console.warn(`EQRMSS | Finalizer | starting spell/song not found: "${name}" (${key})`);
          continue;
        }
        if (doc.type === "song") {
          const perf = doc.performance ?? {};
          const targ = doc.targeting ?? {};
          const stack = doc.stacking ?? {};
          items.push({
            name: doc.name,
            type: "song",
            img: doc.img ?? "systems/eqrmss/assets/Icons/game/musical-notes.svg",
            system: {
              level: doc.level_required ?? 1,
              active: false,
              favorite: false,
              description: doc.description ?? "",
              activation: perf.activation ?? "",
              maintained: !!perf.maintained,
              pulse: perf.pulse_interval ?? "",
              targetType: targ.type ?? "",
              range: targ.range ?? "",
              targets: targ.targets ?? "",
              stacking: stack.group ?? "",
              effectsSummary: (doc.effects ?? []).map(songEffectSummary)
            }
          });
        } else {
          items.push({
            name: doc.name,
            type: "spell",
            img: doc.img ?? "icons/svg/book.svg",
            system: {
              rank: 1,
              favorite: false,
              memorized: false,
              spell_list: (doc.system ?? {}).class ?? "",
              level: (doc.system ?? {}).level ?? 1,
              area_of_effect: (doc.system ?? {}).radius ?? "",
              duration: (doc.system ?? {}).duration ?? "",
              range: (doc.system ?? {}).range ?? "",
              type: (doc.system ?? {}).school ?? "",
              description: (doc.system ?? {}).description ?? "",
              castTime: (doc.system ?? {}).castTime ?? "",
              manaCost: (doc.system ?? {}).manaCost ?? "",
              target: (doc.system ?? {}).target ?? "",
              resist: (doc.system ?? {}).resist ?? ""
            }
          });
        }
      }

      if (items.length) {
        await actor.createEmbeddedDocuments("Item", items);
        console.log(`EQRMSS | Finalizer | granted ${items.length} starting spell(s)/song(s)`, items.map(i => i.name));
      }
    } catch (error) {
      console.warn("EQRMSS | Finalizer | starting spell grant failed (non-fatal)", error);
    }
  }

  /**
   * Grant the class starter kit (equipment + starting money) from
   * module/data/starter-kits.json. Mirrors #grantStartingSpells:
   * lightweight embedded Item documents, fail-soft, never blocks creation.
   *
   * Race overrides apply after the class kit (e.g. any ogre character's
   * chest piece becomes the Worn Hide Tunic). Money gp is fixed per kit;
   * the cp die (e.g. "1d100") is rolled here.
   */
  async #grantStarterKit(actor, cls, race) {
    try {
      const key = String(cls?.id ?? cls?._id ?? "").toLowerCase();
      if (!key) return;

      let data = {};
      try {
        const resp = await fetch("systems/eqrmss/module/data/starter-kits.json");
        if (resp.ok) data = await resp.json();
      } catch { /* fall through */ }

      const kit = data[key];
      if (!kit) {
        console.warn(`EQRMSS | Finalizer | no starter kit for class "${key}"`);
        return;
      }

      // Race key: race JSON ids look like "eqrmss-ogre"; fall back to the name.
      const raceKey =
        String(race?.id ?? race?._id ?? "").toLowerCase().replace(/^eqrmss-/, "") ||
        String(race?.name ?? "").toLowerCase();
      const overrides = (data.raceOverrides ?? {})[raceKey] ?? {};

      const items = [];
      for (const entry of kit.items ?? []) {
        const name = (entry.slot && overrides[entry.slot]) || entry.name;
        const item = { name, type: entry.type };
        const system = {};
        if (entry.slot) system.slot = entry.slot;
        if (entry.equipped) system.equipped = true;
        if (entry.type === "consumable") {
          system.item = {
            category: null,
            rarity: "common",
            quality: "normal",
            weight: 0,
            value: 0,
            stackable: (entry.quantity ?? 1) > 1,
            quantity: entry.quantity ?? 1
          };
          system.consumable = {
            category: entry.category ?? "food",
            charges: entry.charges ?? 1,
            maxCharges: entry.charges ?? 1,
            consumeOnUse: true
          };
        }
        if (Object.keys(system).length) item.system = system;
        items.push(item);
      }

      if (items.length) {
        await actor.createEmbeddedDocuments("Item", items);
        console.log(`EQRMSS | Finalizer | granted starter kit (${key})`, items.map(i => i.name));
      }

      // Starting money: { gp: N, cp: "1d100" | N }
      const money = kit.money ?? {};
      let cp = 0;
      if (typeof money.cp === "string" && money.cp.includes("d")) {
        try {
          cp = (await new Roll(money.cp).evaluate()).total ?? 0;
        } catch {
          cp = 0;
        }
      } else {
        cp = Number(money.cp) || 0;
      }
      await actor.update({
        "system.wealth": {
          pp: Number(money.pp) || 0,
          gp: Number(money.gp) || 0,
          sp: Number(money.sp) || 0,
          cp
        }
      });
      console.log(`EQRMSS | Finalizer | starting money: ${Number(money.gp) || 0} gp + ${cp} cp`);
    } catch (error) {
      console.warn("EQRMSS | Finalizer | starter kit grant failed (non-fatal)", error);
    }
  }
}

console.log("EQRMSS | Character Creation Finalizer loaded");