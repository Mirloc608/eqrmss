// ============================================================
// EQRMSS — Character Creation Wizard Finalizer
// Part 4 — Final Actor Creation
// ============================================================

import { extractRacialModifiers } from "../utils/actor/rmss-stats.js";

export class EQRMSSCharacterCreationWizardFinalizer {

  constructor(wizardState = {}, context = {}) {
    this.state = wizardState;
    this.context = context;
  }

  async finalize() {
    const race = this.#resolve(this.context.races, this.state.raceId);
    const cls = this.#resolve(this.context.classes, this.state.classId);
    const city = this.#resolve(this.context.cities, this.state.cityId);
    const deity = this.#resolve(this.context.deities, this.state.deityId);

    if (!race || !cls) {
      ui.notifications.error("Race or profession data is missing — cannot finalize character.");
      return null;
    }

    if (!city) {
      ui.notifications.error("Starting city data is missing — cannot finalize character.");
      return null;
    }

    const actorData = this.#buildActorData(race, cls, city, deity);

    try {
      const actor = await Actor.create(actorData, { renderSheet: true });

      if (!actor) {
        ui.notifications.error("Failed to create EQRMSS character.");
        return null;
      }

      ui.notifications.info(`Character "${actor.name}" created successfully.`);
      console.log("EQRMSS | Character finalized", actor);
      return actor;
    }
    catch (error) {
      console.error("EQRMSS | Character creation failed", error);
      ui.notifications.error(`Character creation failed: ${error.message}`);
      return null;
    }
  }

  #buildActorData(race, cls, city, deity) {
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
          deityName: deity?.name ?? ""
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
}

console.log("EQRMSS | Character Creation Finalizer loaded");