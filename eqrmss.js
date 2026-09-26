// ============================================================
// EQRMSS System Bootstrap v4.4 - FINAL FIXES
// Fixes:
// - PetManager not renderable
// - Wizard races=0 classes=0 (data service not using game.eqrmss)
// - Wizard global export
// - Sheet html.find
// ============================================================

import "./module/initialization/v13-compat-shim.js";
import "./module/initialization/pet-manager-fix.js";
import "./module/initialization/sheet-wizard-fix.js";
import "./module/initialization/wizard-fix.js";

import {
    registerEQRMSSSettings,
    registerEQRMSSDocuments,
    registerEQRMSSDataLoaders,
    loadEQRMSSTemplates,
    registerEQRMSSHooks,
    initializeEQRMSSSubsystems,
    initializeEQRMSSDataLoaders
} from "./module/initialization/index.js";

import "./module/config.js";
import { registerEQRMSSSheets } from "./module/initialization/register-sheets.js";

// Import wizard and export to global
import * as WizardModule from "./module/apps/eqrmss-character-creation-wizard.js";
console.log("EQRMSS v4.4 | Wizard module imported:", Object.keys(WizardModule));

(function exportWizardGlobal() {
    let wizardClass = null;
    for (const key of Object.keys(WizardModule)) {
        const val = WizardModule[key];
        if (typeof val === 'function' && key.toLowerCase().includes('wizard')) {
            wizardClass = val;
            console.log(`EQRMSS v4.4 | Found wizard: ${key} -> ${val.name}`);
            break;
        }
    }
    if (!wizardClass && WizardModule.default && typeof WizardModule.default === 'function') {
        wizardClass = WizardModule.default;
    }
    if (wizardClass) {
        globalThis.EQRMSSCharacterCreationWizard = wizardClass;
        globalThis.CharacterCreationWizard = wizardClass;
        globalThis.EQRMSS = globalThis.EQRMSS || {};
        globalThis.EQRMSS.CharacterCreationWizard = wizardClass;
        console.log(`EQRMSS v4.4 | Wizard exported: ${wizardClass.name}`);
        Hooks.once("init", () => {
            game.eqrmss = game.eqrmss || {};
            game.eqrmss.CharacterCreationWizard = wizardClass;
        });
    } else {
        console.error("EQRMSS v4.4 | FAILED to find wizard class!");
    }
})();

import { EQRMSSGeography } from "./module/data/geography/geography-loader.js";
import { EQRMSSSceneRegistry } from "./module/data/geography/scene-registry.js";

import "./module/data/stats/rmss-stat-rolling.js";
import "./module/data/stats/rmss-point-buy.js";
import "./module/data/stats/rmss-derived-values.js";
import "./module/data/stats/rmss-skill-categories.js";
import "./module/data/stats/rmss-skill-costs.js";
import "./module/data/stats/rmss-stat-bonus.js";
import "./module/data/stats/rmss-combat-round-engine.js";
import "./module/data/stats/rmss-spell-resolution-engine.js";
import "./module/data/stats/rmss-skill-check-engine.js";
import "./module/data/stats/rmss-weapon-damage-engine.js";
import "./module/data/stats/rmss-progression-engine.js";

import { initializeSkillEngine } from "./module/utils/skills/index.js";

Hooks.once("init", async function () {
    console.log("EQRMSS v4.4 | Initializing");
    try {
        registerEQRMSSSettings();
        registerEQRMSSDocuments();
        await loadEQRMSSTemplates();
        registerEQRMSSDataLoaders();
        registerEQRMSSHooks();
        console.log("EQRMSS v4.4 | Init complete");
    } catch (error) {
        console.error("EQRMSS | Initialization failed", error);
    }
});

Hooks.once("ready", async function () {
    console.log("EQRMSS v4.4 | Starting ready pipeline");
    try {
        await initializeEQRMSSDataLoaders();
        console.log("EQRMSS v4.4 | Data loaders ready");

        await initializeEQRMSSSubsystems();
        console.log("EQRMSS v4.4 | Subsystems queued");

        try {
            const skillsPack = game.packs.get("eqrmss.skills");
            const categoriesPack = game.packs.get("eqrmss.skill-categories");
            const metadataPack = game.packs.get("eqrmss.skill-metadata");
            const professionCostsPack = game.packs.get("eqrmss.profession-skill-costs");

            const skills = skillsPack ? await skillsPack.getDocuments() : [];
            const categories = categoriesPack ? await categoriesPack.getDocuments() : [];
            const metadata = metadataPack ? await metadataPack.getDocuments() : [];
            const professionCosts = professionCostsPack ? await professionCostsPack.getDocuments() : [];

            const roller = { roll: (formula) => new Roll(formula).roll({ async: false }) };
            initializeSkillEngine({ skills, categories, metadata, professionCosts, roller });
            console.log("EQRMSS | Skill Engine initialized");
        } catch (skillError) {
            console.error("EQRMSS | Skill Engine failed", skillError);
        }

        try {
            console.log("EQRMSS v4.4 | Loading geography INDEX only");
            await EQRMSSGeography.loadAll();
            await EQRMSSSceneRegistry.registerAllScenes();
            console.log("EQRMSS | Geography scenes registered");
        } catch (geoError) {
            console.error("EQRMSS | Geography failed", geoError);
        }

        registerEQRMSSSheets();
        console.log("EQRMSS | Sheets registered");

        if (!globalThis.EQRMSSCharacterCreationWizard) {
            console.warn("EQRMSS v4.4 | Wizard still not global - emergency import");
            try {
                const mod = await import("./module/apps/eqrmss-character-creation-wizard.js");
                for (const key of Object.keys(mod)) {
                    if (typeof mod[key] === 'function' && key.toLowerCase().includes('wizard')) {
                        globalThis.EQRMSSCharacterCreationWizard = mod[key];
                        console.log(`EQRMSS v4.4 | Emergency wizard export: ${key}`);
                        break;
                    }
                }
            } catch (e) {
                console.error("EQRMSS v4.4 | Emergency wizard import failed:", e);
            }
        }

        console.log("EQRMSS v4.4 | Ready");
        console.log("EQRMSS v4.4 | Wizard global:", !!globalThis.EQRMSSCharacterCreationWizard, globalThis.EQRMSSCharacterCreationWizard?.name);
        console.log("EQRMSS v4.4 | Races:", Object.keys(game.eqrmss?.races||{}).length, "Classes:", Object.keys(game.eqrmss?.classes||{}).length);
    } catch (error) {
        console.error("EQRMSS | Ready pipeline failed", error);
        ui.notifications?.error("EQRMSS failed during startup. Check console.");
    }
});
