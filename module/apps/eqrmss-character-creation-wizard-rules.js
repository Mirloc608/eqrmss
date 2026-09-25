// ============================================================
// EQRMSS — Character Creation Wizard Rules
//
// Part 3 — Rules / Validation
// ============================================================

export class EQRMSSCharacterCreationRules {

  constructor() {
    this.errors = {};
  }

  // ------------------------------------------------------------
  // COMPLETE VALIDATION
  // ------------------------------------------------------------

  validateSelection(
    selection = {},
    context = {},
    options = {}
  ) {

    this.errors = {};

    const partial =
      options.partial === true;

    this.validateName(selection);

    this.validateGender(selection);

    this.validateRace(
      selection,
      context
    );

    this.validateClass(
      selection,
      context
    );

    this.validateCity(
      selection,
      context
    );

    this.validateDeity(
      selection,
      context
    );

    this.validateStats(selection);

    return {
      ...this.errors
    };
  }

  // ------------------------------------------------------------
  // STEP VALIDATION
  // ------------------------------------------------------------

  validateStep(
    step,
    selection = {},
    context = {}
  ) {

    this.errors = {};

    switch (Number(step)) {

      case 1:
        this.validateName(selection);
        this.validateGender(selection);
        break;

      case 2:
        this.validateRace(
          selection,
          context
        );
        break;

      case 3:
        this.validateClass(
          selection,
          context
        );
        break;

      case 4:
        this.validateCity(
          selection,
          context
        );
        break;

      case 5:
        this.validateStats(selection);
        break;

      case 6:
        return this.validateSelection(
          selection,
          context
        );
    }

    return {
      ...this.errors
    };
  }

  // ------------------------------------------------------------
  // NAME
  // ------------------------------------------------------------

  validateName(selection) {

    if (!selection.name?.trim()) {

      this.errors.name =
        "Name is required.";
    }
  }

  // ------------------------------------------------------------
  // GENDER
  // ------------------------------------------------------------

  validateGender(selection) {

    if (!selection.gender) {

      this.errors.gender =
        "Gender is required.";
    }
  }

  // ------------------------------------------------------------
  // RACE
  // ------------------------------------------------------------

  validateRace(
    selection,
    context
  ) {

    if (!selection.raceId) {

      this.errors.raceId =
        "Race is required.";

      return;
    }

    const race =
      this.#find(
        context.races,
        selection.raceId
      );

    if (!race) {

      this.errors.raceId =
        "Invalid race selection.";
    }
  }

  // ------------------------------------------------------------
  // CLASS
  // ------------------------------------------------------------

  validateClass(
    selection,
    context
  ) {

    if (!selection.classId) {

      this.errors.classId =
        "Profession is required.";

      return;
    }

    const cls =
      this.#find(
        context.classes,
        selection.classId
      );

    if (!cls) {

      this.errors.classId =
        "Invalid profession selection.";

      return;
    }

    const race =
      this.#find(
        context.races,
        selection.raceId
      );

    if (!race) {
      return;
    }

    if (
      !checkRaceClassCompatibility(
        race,
        cls
      )
    ) {

      this.errors.classId =
        `${race.name} cannot be a ${cls.name}.`;
    }
  }

  // ------------------------------------------------------------
  // CITY
  // ------------------------------------------------------------

  validateCity(
    selection,
    context
  ) {

    if (!selection.cityId) {

      this.errors.cityId =
        "Starting city is required.";

      return;
    }

    const city =
      this.#find(
        context.cities,
        selection.cityId
      );

    if (!city) {

      this.errors.cityId =
        "Invalid starting city.";
    }
  }

  // ------------------------------------------------------------
  // DEITY
  // ------------------------------------------------------------

  validateDeity(
    selection,
    context
  ) {

    // Deity remains optional.
    if (!selection.deityId) {
      return;
    }

    const deity =
      this.#find(
        context.deities,
        selection.deityId
      );

    if (!deity) {

      this.errors.deityId =
        "Invalid deity selection.";
    }
  }

  // ------------------------------------------------------------
  // STATS
  // ------------------------------------------------------------

  validateStats(selection) {

    const stats =
      selection.stats || {};

    for (
      const [key, value]
      of Object.entries(stats)
    ) {

      const numeric =
        Number(value);

      if (
        !Number.isFinite(numeric) ||
        numeric < 1 ||
        numeric > 100
      ) {

        this.errors[
          `stats.${key}`
        ] =
          `${key} must be between 1 and 100.`;
      }
    }
  }

  // ------------------------------------------------------------
  // DOCUMENT LOOKUP
  // ------------------------------------------------------------

  #find(collection = [], id) {

    return collection.find(
      document =>
        document?._id === id ||
        document?.id === id
    );
  }
}

// ============================================================
// RACE / CLASS COMPATIBILITY
// ============================================================

export function checkRaceClassCompatibility(
  race,
  cls
) {

  if (!race || !cls) {
    return false;
  }

  const raceIds = [race.key, race.system?.key, race.id, race._id]
    .filter(Boolean)
    .map(value => String(value).toLowerCase());

  const classId =
    String(
      cls.system?.key ??
      cls.id ??
      cls._id ??
      ""
    ).toLowerCase();

  // ----------------------------------------------------------
  // GLOBAL GM OVERRIDE
  // ----------------------------------------------------------

  if (
    getSetting(
      "allowAllRaceClassCombinations",
      false
    )
  ) {

    return true;
  }

  // ----------------------------------------------------------
  // GM CUSTOM OVERRIDE
  // ----------------------------------------------------------

  const overrides =
    getSetting(
      "customRaceClassOverrides",
      {}
    );

  const override = raceIds
    .map(id => overrides?.[id])
    .find(Boolean);

  if (override) {

    if (
      Array.isArray(
        override.allowedClasses
      ) &&
      override.allowedClasses
        .map(String)
        .map(v => v.toLowerCase())
        .includes(classId)
    ) {

      return true;
    }

    if (
      Array.isArray(
        override.restrictedClasses
      ) &&
      override.restrictedClasses
        .map(String)
        .map(v => v.toLowerCase())
        .includes(classId)
    ) {

      return false;
    }
  }

  // ----------------------------------------------------------
  // CANONICAL RACE DATA
  // ----------------------------------------------------------

  const restricted = normalizeList(
    race.restrictedProfessions ?? race.system?.classRestrictions
  );

  if (
    restricted.includes(classId)
  ) {

    return false;
  }

  return true;
}

// ============================================================
// HELPERS
// ============================================================

function normalizeList(value) {

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(String)
    .map(v => v.toLowerCase());
}

function getSetting(
  key,
  fallback
) {

  try {

    return game.settings.get(
      "eqrmss",
      key
    );

  }
  catch {

    return fallback;
  }
}
