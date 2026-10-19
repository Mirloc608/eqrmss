import { EXPANSION_CHOICES } from "../expansions/expansion-settings.js";

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
    choices: EXPANSION_CHOICES,
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

  // ==========================================================
  // Spellcasting: Cast Time Enforcement
  // ==========================================================

  game.settings.register("eqrmss", "castTimeMode", {
    name: "Cast Time Enforcement",
    hint: "How EQ spell cast times are enforced. Rounds: spells take ceil(castTime/6) rounds, mana spent upfront, interruptible. Instant: spells fire immediately but fizzle if the caster took damage this round. Off: cast time has no mechanical effect (range still enforced).",
    scope: "world",
    config: true,
    type: String,
    default: "rounds",
    choices: {
      rounds: "Rounds (declare, wait, interruptible)",
      instant: "Instant (fizzles if damaged this round)",
      off: "Off (no cast-time enforcement)"
    }
  });

  // ==========================================================
  // Party HUD (native MMO-style overlay)
  // ==========================================================

  game.settings.register("eqrmss", "partyHudMode", {
    name: "Party HUD Mode",
    hint: "When should the party HUD be shown?",
    scope: "client",
    config: true,
    type: String,
    default: "always",
    choices: {
      always: "Always",
      combat: "Only in Combat",
      never: "Never"
    },
    onChange: () => { try { game.eqrmss?.partyHud?.render(); } catch (e) {} }
  });

  game.settings.register("eqrmss", "partyHudPartySource", {
    name: "Party HUD Party Source",
    hint: "Which characters appear in the party list?",
    scope: "world",
    config: true,
    type: String,
    default: "assigned",
    choices: {
      assigned: "Assigned characters (all users)",
      loggedin: "Assigned characters (logged-in users only)"
    },
    onChange: () => { try { game.eqrmss?.partyHud?.render(); } catch (e) {} }
  });

  game.settings.register("eqrmss", "aaPointsPerLevel", {
    name: "AA Points Per Level (61+)",
    hint: "How many Alternate Advancement points characters gain on each level-up from 61 to 125.",
    scope: "world",
    config: true,
    type: Number,
    default: 5,
    choices: {
      3: "3 — Tight (195 total, hard choices)",
      5: "5 — Standard (325 total)",
      10: "10 — Generous (650 total, completionist)"
    }
  });
}