export function registerEQRMSSSettings() {
  console.info("EQRMSS | Registering system settings");

  game.settings.register("eqrmss", "debugMode", {
    name: "EQRMSS Debug Mode",
    hint: "Enable additional logging and developer diagnostics.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register("eqrmss", "enableCharacterWizard", {
    name: "Enable Character Creation Wizard",
    hint: "Use the EQRMSS multi-step character creation wizard.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // GM: Allow all race/class combinations
  game.settings.register("eqrmss", "allowAllRaceClassCombinations", {
    name: "Allow All Race/Class Combinations",
    hint: "If enabled, all races may select any class regardless of restrictions.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // GM: Custom overrides
  game.settings.register("eqrmss", "customRaceClassOverrides", {
    name: "Custom Race/Class Overrides",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // GM: Notes
  game.settings.register("eqrmss", "gmOverrideNotes", {
    name: "GM Override Notes",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // ==========================================================
  // Expansion System
  // ==========================================================

  game.settings.register("eqrmss", "activeExpansion", {
    name: "Active Expansion",
    hint: "Controls what expansion era content is available.",
    scope: "world",
    config: true,
    type: String,
    default: "classic",
    choices: {
      classic: "EverQuest",
      kunark: "Ruins of Kunark",
      velious: "Scars of Velious",
      luclin: "Shadows of Luclin",
      pop: "Planes of Power",
      ldon: "Lost Dungeons of Norrath",
      gates: "Gates of Discord",
      oow: "Omens of War",
      don: "Dragons of Norrath",
      dodh: "Depths of Darkhollow",
      por: "Prophecy of Ro",
      tss: "The Serpent's Spine",
      tsof: "The Secrets of Faydwer",
      sod: "Seeds of Destruction",
      underfoot: "Underfoot",
      hot: "House of Thule",
      voa: "Veil of Alaris",
      rof: "Rain of Fear",
      cotf: "Call of the Forsaken",
      tbm: "The Broken Mirror",
      eok: "Empires of Kunark",
      ros: "Ring of Scale",
      tov: "Torment of Velious",
      cov: "Claws of Veeshan",
      tol: "Terror of Luclin",
      nos: "Night of Shadows",
      ls: "Laurion's Song"
    },
    requiresReload: true
  });

  game.settings.register("eqrmss", "strictExpansionMode", {
    name: "Strict Expansion Mode",
    hint: "Hide all content introduced after the selected expansion.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register("eqrmss", "enableExpansionThemes", {
    name: "Enable Expansion Themes",
    hint: "Automatically apply expansion-themed visuals where supported.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}