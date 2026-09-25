/**
 * Handlebars Template Loader for EQRMSS
 * Single source of truth for Handlebars preloading.
 */

export async function loadEQRMSSTemplates() {
    console.info("EQRMSS | Loading Handlebars templates");

    const defaultPortrait = "systems/eqrmss/assets/Icons/class/default.png";
    const imageForSelection = (id, collection, fallback) => {
        if (!id) return fallback;
        const selected = (collection ?? []).find(entry =>
            (entry?.id ?? entry?._id) === id
        );
        return selected?.img ?? selected?.system?.img ?? fallback;
    };

    if (!Handlebars.helpers?.eqrmssRaceImage) {
        Handlebars.registerHelper("eqrmssRaceImage", (id, races) =>
            imageForSelection(id, races, defaultPortrait)
        );
    }

    if (!Handlebars.helpers?.eqrmssClassImage) {
        Handlebars.registerHelper("eqrmssClassImage", (id, classes) => {
            if (!id) return defaultPortrait;
            const selected = (classes ?? []).find(entry => (entry?.id ?? entry?._id) === id);
            if (!selected) return defaultPortrait;
            if (selected.img ?? selected.system?.img) return selected.img ?? selected.system.img;
            const key = String(selected.key ?? selected.id ?? selected._id).toLowerCase();
            return `systems/eqrmss/assets/Icons/class/${key}.png`;
        });
    }

    if (!Handlebars.helpers?.join) {
        Handlebars.registerHelper("join", (values, separator = ", ") => {
            if (Array.isArray(values)) return values.filter(value => value != null).join(separator);
            return values == null ? "" : String(values);
        });
    }

    const templatePaths = [
        // ==========================================================
        // Actor Parts (Consolidated)
        // ==========================================================
        "systems/eqrmss/templates/sheets/actors/parts/actor-header.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-stats.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-fixed-info.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-armor-info.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-resistance.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-race-stat-fixed-info.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-role-traits.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-background-info.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-skill-categories.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-skills.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-fav-skills.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-items.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-weapons.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-money.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-armor.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-herbs.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-spells.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-fav-spells.html",
        "systems/eqrmss/templates/sheets/actors/parts/actor-fav-items.html",
        "systems/eqrmss/templates/sheets/actors/apps/actor-settings.html",

        // ==========================================================
        // Actor Sheets
        // ==========================================================
        "systems/eqrmss/templates/sheets/actors/eqrmss_player_sheet.html",
        "systems/eqrmss/templates/sheets/actors/eqrmss_npc_sheet.html",
        "systems/eqrmss/templates/sheets/actors/eqrmss_pet_sheet.html",

        // ==========================================================
        // Item Sheets
        // ==========================================================
        "systems/eqrmss/templates/sheets/items/eqrmss-item-sheet.html",
        "systems/eqrmss/templates/sheets/items/eqrmss-weapon-sheet.html",
        "systems/eqrmss/templates/sheets/items/eqrmss-armor-sheet.html",
        "systems/eqrmss/templates/sheets/items/eqrmss-race-sheet.html",
        "systems/eqrmss/templates/sheets/items/eqrmss-class-sheet.html",
        "systems/eqrmss/templates/sheets/items/eqrmss-language-sheet.html",
        "systems/eqrmss/templates/sheets/items/eqrmss-transport-sheet.html",
        "systems/eqrmss/templates/sheets/items/eqrmss-herb-or-poison-sheet.html",

        // ==========================================================
        // Skill & Spell Sheets
        // ==========================================================
        "systems/eqrmss/templates/sheets/skills/eqrmss-skill-sheet.html",
        "systems/eqrmss/templates/sheets/skills/eqrmss-skill-category-sheet.html",
        "systems/eqrmss/templates/sheets/spells/eqrmss-spell-sheet.html",

        // ==========================================================
        // Character Creation Wizard & Steps
        // ==========================================================
        "systems/eqrmss/templates/apps/character-creation/eqrmss-character-creation-wizard.html",
        "systems/eqrmss/templates/apps/character-creation/partials/dp-table.html",
        "systems/eqrmss/templates/apps/character-creation/steps/step-0-preview.html",
        "systems/eqrmss/templates/apps/character-creation/steps/step-1-basic.html",
        "systems/eqrmss/templates/apps/character-creation/steps/step-2-race.html",
        "systems/eqrmss/templates/apps/character-creation/steps/step-3-profession.html",
        "systems/eqrmss/templates/apps/character-creation/steps/step-4-origin.html",
        "systems/eqrmss/templates/apps/character-creation/steps/step-5-stats.html",
        "systems/eqrmss/templates/apps/character-creation/steps/step-6-review.html"
    ];

    // Use the v13/v14 namespaced Handlebars loader safely with a global fallback
    const loader = foundry.applications?.handlebars?.loadTemplates ?? globalThis.loadTemplates;
    const result = await loader(templatePaths);

    console.info("EQRMSS | Templates loaded", { count: templatePaths.length });
    return result;
}