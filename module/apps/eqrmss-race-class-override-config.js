// ============================================================
// EQRMSS — GM Race / Class Override Dashboard
// ApplicationV2
// ============================================================

const {
  ApplicationV2,
  HandlebarsApplicationMixin
} = foundry.applications.api;

const BaseApplication =
  HandlebarsApplicationMixin(ApplicationV2);

export class EQRMSSRaceClassOverrideConfig
  extends BaseApplication {

  static DEFAULT_OPTIONS = {

    id:
      "eqrmss-race-class-override-dashboard",

    classes: [
      "eqrmss",
      "sheet",
      "race-class-override"
    ],

    window: {
      title:
        "EQRMSS — GM Override Dashboard",

      icon:
        "fas fa-sliders-h",

      resizable:
        true
    },

    position: {
      width: 1000,
      height: 720
    },

    actions: {

      "tab-matrix":
        this.#actionTab,

      "tab-lore":
        this.#actionTab,

      "tab-import":
        this.#actionTab,

      "tab-defaults":
        this.#actionTab,

      "tab-notes":
        this.#actionTab,

      "matrix-cycle":
        this.#actionMatrixCycle,

      "save-overrides":
        this.#actionSaveOverrides,

      "copy-json":
        this.#actionCopyJSON,

      "import-json":
        this.#actionImportJSON,

      "reset-defaults":
        this.#actionResetDefaults,

      "save-notes":
        this.#actionSaveNotes
    }
  };

  static PARTS = {

    main: {
      template:
        "systems/eqrmss/templates/apps/character-creation/eqrmss-race-class-override.html"
    }
  };

  #races = [];
  #classes = [];
  #overrides = {};
  #activeTab = "matrix";

  constructor(options = {}) {

    super(options);

    this.#loadData();
  }

  async _prepareContext(options) {

    this.#loadData();

    return {

      races:
        this.#races.map(
          race =>
            this.#buildRaceRow(
              race
            )
        ),

      classes:
        this.#classes.map(
          cls => ({
            id:
              cls.id ??
              cls._id,

            key:
              this.#key(cls),

            name:
              cls.name
          })
        ),

      overrides:
        foundry.utils.duplicate(
          this.#overrides
        ),

      activeTab:
        this.#activeTab
    };
  }

  async _renderHTML(
    context,
    options
  ) {

    return {

      main:
        await foundry.applications.handlebars
          .renderTemplate(
            this.constructor.PARTS.main.template,
            context
          )
    };
  }

  // ------------------------------------------------------------
  // DATA
  // ------------------------------------------------------------

  #loadData() {

    this.#races =
      CONFIG.EQRMSS?.data?.races ||
      Object.values(CONFIG.EQRMSS?.races || {});

    this.#classes =
      CONFIG.EQRMSS?.data?.classes ||
      Object.values(CONFIG.EQRMSS?.classes || {});

    try {

      this.#overrides =
        foundry.utils.duplicate(
          game.settings.get(
            "eqrmss",
            "customRaceClassOverrides"
          ) || {}
        );

    }
    catch {

      this.#overrides = {};
    }
  }

  #buildRaceRow(race) {

    const id =
      this.#key(race);

    const override =
      this.#overrides[id] || {};

    const canonicalAllowed =
      race.favoredProfessions ||
      race.system?.allowedClasses ||
      [];

    const canonicalRestricted =
      race.restrictedProfessions ||
      race.system?.classRestrictions ||
      [];

    return {

      id,

      name:
        race.name,

      allowedClasses:
        override.allowedClasses ||
        [],

      restrictedClasses:
        override.restrictedClasses ||
        [],

      canonicalAllowedClasses:
        canonicalAllowed,

      canonicalRestrictedClasses:
        canonicalRestricted
    };
  }

  // ------------------------------------------------------------
  // TAB ACTION
  // ------------------------------------------------------------

  static #actionTab(event) {

    const tab =
      event.currentTarget.dataset.tab;

    if (!tab) return;

    this.#activeTab =
      tab;

    return this.render();
  }

  // ------------------------------------------------------------
  // MATRIX
  // ------------------------------------------------------------

  static #actionMatrixCycle(event) {

    const cell =
      event.currentTarget;

    const raceId =
      cell.dataset.raceId;

    const classKey =
      cell.dataset.classKey;

    if (!raceId || !classKey) {
      return;
    }

    const override =
      this.#overrides[raceId] || {

        allowedClasses: [],
        restrictedClasses: []
      };

    const allowed =
      override.allowedClasses
        .includes(classKey);

    const restricted =
      override.restrictedClasses
        .includes(classKey);

    if (!allowed && !restricted) {

      override.allowedClasses.push(
        classKey
      );

    }
    else if (allowed) {

      override.allowedClasses =
        override.allowedClasses
          .filter(
            key => key !== classKey
          );

      override.restrictedClasses.push(
        classKey
      );

    }
    else {

      override.restrictedClasses =
        override.restrictedClasses
          .filter(
            key => key !== classKey
          );
    }

    this.#overrides[raceId] =
      override;

    return this.render();
  }

  // ------------------------------------------------------------
  // SAVE
  // ------------------------------------------------------------

  static async #actionSaveOverrides() {

    await game.settings.set(
      "eqrmss",
      "customRaceClassOverrides",
      this.#overrides
    );

    ui.notifications.info(
      "EQRMSS | Race/class overrides saved."
    );
  }

  // ------------------------------------------------------------
  // COPY
  // ------------------------------------------------------------

  static async #actionCopyJSON() {

    const json =
      JSON.stringify(
        this.#overrides,
        null,
        2
      );

    try {

      await navigator.clipboard.writeText(
        json
      );

      ui.notifications.info(
        "EQRMSS | Override JSON copied."
      );

    }
    catch {

      ui.notifications.error(
        "EQRMSS | Unable to access clipboard."
      );
    }
  }

  // ------------------------------------------------------------
  // IMPORT
  // ------------------------------------------------------------

  static async #actionImportJSON(event) {

    const textarea =
      this.element?.querySelector(
        "[data-field='json']"
      );

    if (!textarea) {
      return;
    }

    try {

      const parsed =
        JSON.parse(
          textarea.value
        );

      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {

        throw new Error(
          "Override data must be an object."
        );
      }

      this.#overrides =
        parsed;

      await game.settings.set(
        "eqrmss",
        "customRaceClassOverrides",
        parsed
      );

      ui.notifications.info(
        "EQRMSS | Override JSON imported."
      );

      await this.render();

    }
    catch (error) {

      console.error(
        "EQRMSS | Invalid override JSON",
        error
      );

      ui.notifications.error(
        "EQRMSS | Invalid override JSON."
      );
    }
  }

  // ------------------------------------------------------------
  // RESET
  // ------------------------------------------------------------

  static async #actionResetDefaults() {

    const canonical = {};

    for (
      const race of this.#races
    ) {

      const raceKey =
        this.#key(race);

      canonical[raceKey] = {

        allowedClasses:
          race.favoredProfessions ||
          race.system?.allowedClasses ||
          [],

        restrictedClasses:
          race.restrictedProfessions ||
          race.system?.classRestrictions ||
          []
      };
    }

    this.#overrides =
      canonical;

    await game.settings.set(
      "eqrmss",
      "customRaceClassOverrides",
      canonical
    );

    ui.notifications.info(
      "EQRMSS | Race/class overrides reset to defaults."
    );

    await this.render();
  }

  // ------------------------------------------------------------
  // NOTES
  // ------------------------------------------------------------

  static async #actionSaveNotes() {

    const textarea =
      this.element?.querySelector(
        "[data-field='notes']"
      );

    if (!textarea) {
      return;
    }

    await game.settings.set(
      "eqrmss",
      "gmOverrideNotes",
      textarea.value
    );

    ui.notifications.info(
      "EQRMSS | GM notes saved."
    );
  }

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------

  #key(document) {

    return String(
      document?.system?.key ??
      document?.id ??
      document?._id ??
      ""
    ).toLowerCase();
  }
}

console.log(
  "EQRMSS | GM Race/Class Override Dashboard loaded"
);
