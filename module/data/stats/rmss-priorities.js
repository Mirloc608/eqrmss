/**
 * ============================================================
 * RMSS Stat Priority Matrix (EverQuest → RMSS)
 * ============================================================
 */

export const RMSS_STAT_PRIORITIES = {

  warrior: {
    primary:   ["St", "Co", "Qu"],
    secondary: ["Ag", "SD"],
    tertiary:  ["Me", "Re", "Em", "In", "Pr"]
  },

  paladin: {
    primary:   ["St", "SD", "Em"],
    secondary: ["Co", "Pr"],
    tertiary:  ["Ag", "Me", "Re", "In", "Qu"]
  },

  shadowknight: {
    primary:   ["St", "SD", "Em"],
    secondary: ["Co", "In"],
    tertiary:  ["Ag", "Me", "Re", "Pr", "Qu"]
  },

  monk: {
    primary:   ["Ag", "Qu", "SD"],
    secondary: ["St", "Co"],
    tertiary:  ["Me", "Re", "Em", "In", "Pr"]
  },

  rogue: {
    primary:   ["Ag", "Qu", "In"],
    secondary: ["St", "Pr"],
    tertiary:  ["Co", "Me", "Re", "SD", "Em"]
  },

  ranger: {
    primary:   ["Ag", "Qu", "St"],
    secondary: ["Co", "In"],
    tertiary:  ["Me", "Re", "SD", "Em", "Pr"]
  },

  beastlord: {
    primary:   ["St", "Ag", "Em"],
    secondary: ["Co", "SD"],
    tertiary:  ["Me", "Re", "In", "Pr", "Qu"]
  },

  cleric: {
    primary:   ["Em", "SD"],
    secondary: ["Re", "Me"],
    tertiary:  ["St", "Co", "Ag", "In", "Pr", "Qu"]
  },

  druid: {
    primary:   ["Em", "In"],
    secondary: ["Re", "Me"],
    tertiary:  ["Ag", "Co", "St", "SD", "Pr", "Qu"]
  },

  shaman: {
    primary:   ["Em", "SD"],
    secondary: ["Co", "Re"],
    tertiary:  ["Ag", "St", "Me", "In", "Pr", "Qu"]
  },

  wizard: {
    primary:   ["Re", "Me", "Em"],
    secondary: ["In", "SD"],
    tertiary:  ["Ag", "Co", "St", "Pr", "Qu"]
  },

  magician: {
    primary:   ["Re", "Me", "Em"],
    secondary: ["In", "SD"],
    tertiary:  ["Ag", "Co", "St", "Pr", "Qu"]
  },

  enchanter: {
    primary:   ["Re", "Me", "Pr"],
    secondary: ["Em", "In"],
    tertiary:  ["Ag", "Co", "St", "SD", "Qu"]
  },

  necromancer: {
    primary:   ["Re", "Me", "SD"],
    secondary: ["Em", "In"],
    tertiary:  ["Ag", "Co", "St", "Pr", "Qu"]
  },

  bard: {
    primary:   ["Pr", "Em", "In"],
    secondary: ["Ag", "SD"],
    tertiary:  ["St", "Co", "Me", "Re", "Qu"]
  }
};
