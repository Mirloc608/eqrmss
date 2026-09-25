// ============================================================
// EQRMSS — Character Creation Preview
//
// Part 3 — Preview
// ============================================================

import { extractRacialModifiers, canonicalStatKey } from "../utils/actor/rmss-stats.js";
import { rmssStatBonus } from "../data/stats/rmss-stat-bonus.js";
import { RMSSDerivedValueEngine } from "../data/stats/rmss-derived-values.js";
import { RMSSProgressionEngine } from "../data/stats/rmss-progression-engine.js";

export class EQRMSSCharacterCreationPreview {

  constructor(
    context = {},
    rules = null
  ) {

    this.context = context;
    this.rules = rules;
  }

  build(selection = {}) {

    const race =
      this.#find(
        this.context.races,
        selection.raceId
      );

    const cls =
      this.#find(
        this.context.classes,
        selection.classId
      );

    const city =
      this.#find(
        this.context.cities,
        selection.cityId
      );

    const deity =
      this.#find(
        this.context.deities,
        selection.deityId
      );

    const compatibility =
      race && cls
        ? checkCompatibility(
            race,
            cls,
            this.rules
          )
        : null;

        const finalStats =
      this.#calculateStats(
        selection,
        race
      );

    // RMSS stat bonus table, keyed by canonical stat key (ST, AG, ...)
    const statBonuses = {};
    for (const [key, value] of Object.entries(finalStats)) {
      const canon = canonicalStatKey(key);
      if (canon != null && Number.isFinite(Number(value))) {
        statBonuses[canon] = rmssStatBonus(Number(value));
      }
    }

    const derived =
      new RMSSDerivedValueEngine().compute(finalStats);

    const classKey = cls?.key ?? cls?.id ?? cls?.name?.toLowerCase?.();

    // Level-1 development points from the system's own progression engine
    const devPoints = classKey
      ? new RMSSProgressionEngine().dpPerLevel(
          finalStats,
          classKey,
          1
        )
      : 0;

    return {
      name:
        selection.name || "",

      gender:
        selection.gender || "",

      race,
      class: cls,
      city,
      deity,

      compatibility,

      stats:
        finalStats,

      statBonuses,

      devPoints,

      derived: {
        HP: derived.HP ?? 0,
        Mana: derived.Mana ?? 0,
        Initiative: derived.Initiative ?? 0,
        Attack: derived.Attack ?? 0,
        Defense: derived.Defense ?? 0
      },

      ready:
        !!(
          selection.name &&
          selection.gender &&
          race &&
          cls &&
          city &&
          compatibility !== false
        )
    };
  }

  #calculateStats(
    selection,
    race
  ) {

    const base =
      foundry.utils.duplicate(
        selection.stats || {}
      );

        // Case-insensitive lookup so "St"/"Ag" race JSONs apply to
    // "ST"/"AG" wizard stat keys (previously all mods resolved to 0).
    const modifiers =
      extractRacialModifiers(race ?? {});

    for (const key of Object.keys(base)) {

      if (
        modifiers[key] !== undefined &&
        base[key] !== undefined &&
        Number.isFinite(Number(base[key]))
      ) {

        base[key] =
          Number(base[key]) + Number(modifiers[key]);
      }
    }

    return base;
  }

  #find(
    collection = [],
    id
  ) {

    return collection.find(
      document =>
        document?._id === id ||
        document?.id === id
    );
  }
}

function checkCompatibility(
  race,
  cls,
  rules
) {

  if (
    rules &&
    typeof rules.validateSelection ===
      "function"
  ) {

    const errors =
      rules.validateSelection(
        {
          raceId:
            race?._id ?? race?.id,

          classId:
            cls?._id ?? cls?.id
        },
        {
          races: [race],
          classes: [cls],
          cities: [],
          deities: []
        },
        {
          partial: true
        }
      );

    return !errors.classId;
  }

  return true;
}

export function buildCharacterCreationPreview(
  selection,
  context
) {

  return new EQRMSSCharacterCreationPreview(
    context
  ).build(selection);
}

console.log(
  "EQRMSS | Character Creation Preview loaded"
);