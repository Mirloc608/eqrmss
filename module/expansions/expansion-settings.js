/**
 * ============================================================
 * EQ-RMSS Expansion Settings
 * ============================================================
 */

const MODULE_ID = "eqrmss";

export const EXPANSION_CHOICES = {

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
};

export function registerExpansionSettings() {

    game.settings.register(
        MODULE_ID,
        "activeExpansion",
        {
            name: "Active Expansion",

            hint:
                "All content beyond the selected expansion is disabled.",

            scope: "world",

            config: true,

            type: String,

            default: "classic",

            choices: EXPANSION_CHOICES
        }
    );
}