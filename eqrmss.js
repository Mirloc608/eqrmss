// ============================================================
// EQRMSS System Bootstrap v4.3 - FIXES SHEET + WIZARD + PET MANAGER
// EverQuest - Rolemaster Standard System
// Foundry VTT V13 / V14 Compatible
// FIXES v4.3:
// - v13-compat-shim MUST load first (fixes html.find is not a function)
// - pet-manager-fix MUST load second (fixes EQRMSSPetManager not renderable)
// - wizard export fix - ensures wizard class is in globalThis
// - Geography LAZY: only index in init/ready, not 5599 files
// ============================================================

// V13 Compat MUST be first - patches HTMLElement.find before any sheet loads
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

// Import wizard and EXPORT IT TO GLOBAL - this is the key fix for "Wizard class not found"
import * as WizardModule from "./module/apps/eqrmss-character-creation-wizard.js";
console.log("EQRMSS v4.3 | Wizard module imported:", Object.keys(WizardModule));

// Export wizard class to globalThis immediately
(function exportWizardGlobal() {
    let wizardClass = null;
    
    // Try all possible exports
    for (const key of Object.keys(WizardModule)) {
        const val = WizardModule[key];
        if (typeof val === 'function' && key.toLowerCase().includes('wizard')) {
            wizardClass = val;
            console.log(`EQRMSS v4.3 | Found wizard class in module: ${key} -> ${val.name}`);
            break;
        }
    }
    
    if (!wizardClass && WizardModule.default && typeof WizardModule.default === 'function') {
        wizardClass = WizardModule.default;
        console.log(`EQRMSS v4.3 | Found wizard as default export: ${wizardClass.name}`);
    }
    
    // Also check if module itself is the wizard class (if it's a single export)
    if (!wizardClass) {
        for (const key of Object.keys(WizardModule)) {
            const val = WizardModule[key];
            if (typeof val === 'function' && val.prototype?.render) {
                // Might be wizard even without wizard in name
                if (val.name.includes('Character') || val.name.includes('Creation')) {
                    wizardClass = val;
                    console.log(`EQRMSS v4.3 | Found wizard by heuristic: ${key} -> ${val.name}`);
                    break;
                }
            }
        }
    }
    
    if (wizardClass) {
        globalThis.EQRMSSCharacterCreationWizard = wizardClass;
        globalThis.CharacterCreationWizard = wizardClass;
        globalThis.EQRMSS = globalThis.EQRMSS || {};
        globalThis.EQRMSS.CharacterCreationWizard = wizardClass;
        console.log(`EQRMSS v4.3 | Wizard class exported to globalThis: ${wizardClass.name}`);
        
        // Also store in game.eqrmss early
        Hooks.once("init", () => {
            game.eqrmss = game.eqrmss || {};
            game.eqrmss.CharacterCreationWizard = wizardClass;
        });
    } else {
        console.error("EQRMSS v4.3 | FAILED to find wizard class in module! Keys:", Object.keys(WizardModule));
        console.error("EQRMSS v4.3 | Module values:", Object.values(WizardModule).map(v => typeof v === 'function' ? v.name : typeof v));
    }
})();

import { EQRMSSGeography } from "./module/data/geography/geography-loader.js";
import { EQRMSSSceneRegistry } from "./module/data/geography/scene-registry.js";

// RMSS Engines
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

// EQRMSS Skill Engine (new subsystem)
import { initializeSkillEngine } from "./module/utils/skills/index.js";

// ============================================================
// INIT - Register only, don't load heavy data
// ============================================================
Hooks.once("init", async function () {
    console.log("EQRMSS v4.3 | Initializing - register only, lazy geography");

    try {
        registerEQRMSSSettings();
        registerEQRMSSDocuments();

        await loadEQRMSSTemplates();

        registerEQRMSSDataLoaders();
        registerEQRMSSHooks();

        console.log("EQRMSS v4.3 | Init complete - geography will load as index-only in ready");
        console.log("EQRMSS | Initialization complete");
    } catch (error) {
        console.error("EQRMSS | Initialization failed", error);
    }
});

// ============================================================
// READY - Correct order: data loaders -> geography index -> sheets
// ============================================================
Hooks.once("ready", async function () {
    console.log("EQRMSS v4.3 | Starting ready pipeline - LAZY geography");

    try {
        // 1. Data loaders first - wizard needs races/classes
        await initializeEQRMSSDataLoaders();
        console.log("EQRMSS v4.3 | Data loaders ready");

        await initializeEQRMSSSubsystems();
        console.log("EQRMSS v4.3 | Subsystems init queued");

        // 2. Skill Engine
        try {
            const skillsPack = game.packs.get("eqrmss.skills");
            const categoriesPack = game.packs.get("eqrmss.skill-categories");
            const metadataPack = game.packs.get("eqrmss.skill-metadata");
            const professionCostsPack = game.packs.get("eqrmss.profession-skill-costs");

            const skills = skillsPack ? await skillsPack.getDocuments() : [];
            const categories = categoriesPack ? await categoriesPack.getDocuments() : [];
            const metadata = metadataPack ? await metadataPack.getDocuments() : [];
            const professionCosts = professionCostsPack ? await professionCostsPack.getDocuments() : [];

            const roller = {
                roll: (formula) => new Roll(formula).roll({ async: false })
            };

            initializeSkillEngine({
                skills,
                categories,
                metadata,
                professionCosts,
                roller
            });

            console.log("EQRMSS | Skill Engine initialized");
        } catch (skillError) {
            console.error("EQRMSS | Skill Engine failed to initialize", skillError);
        }

        // 3. Geography LAZY - only index, not 5599 files
        try {
            console.log("EQRMSS v4.3 | Loading geography INDEX only (lazy - 0 files)");
            await EQRMSSGeography.loadAll();
            console.log("EQRMSS | Geography index loaded - zones on-demand via EQRMSSGeography.loadZone()");
            
            await EQRMSSSceneRegistry.registerAllScenes();
            console.log("EQRMSS | Geography scenes registered (from index)");
        } catch (geoError) {
            console.error("EQRMSS | Geography failed to load", geoError);
        }

        // 4. Sheets last - after data and geography ready
        registerEQRMSSSheets();
        console.log("EQRMSS | Sheets registered");

        // 5. Final wizard global check
        if (!globalThis.EQRMSSCharacterCreationWizard) {
            console.warn("EQRMSS v4.3 | Wizard still not global after ready - trying emergency import");
            try {
                const mod = await import("./module/apps/eqrmss-character-creation-wizard.js");
                for (const key of Object.keys(mod)) {
                    if (typeof mod[key] === 'function' && key.toLowerCase().includes('wizard')) {
                        globalThis.EQRMSSCharacterCreationWizard = mod[key];
                        console.log(`EQRMSS v4.3 | Emergency wizard export: ${key}`);
                        break;
                    }
                }
            } catch (e) {
                console.error("EQRMSS v4.3 | Emergency wizard import failed:", e);
            }
        }

        console.log("EQRMSS v4.3 | Ready - LAZY mode: geography index only, zones load on demand");
        console.log("EQRMSS v4.3 | Wizard global:", !!globalThis.EQRMSSCharacterCreationWizard, globalThis.EQRMSSCharacterCreationWizard?.name);
        console.log("EQRMSS v4.3 | Use game.eqrmss.openWizard() to test wizard");
    } catch (error) {
        console.error("EQRMSS | Ready pipeline failed", error);
        ui.notifications?.error("EQRMSS failed during startup. Check console.");
    }
});
