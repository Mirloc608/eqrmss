// ============================================================
// EQRMSS System Bootstrap v4.2 LAZY + V13 COMPAT
// EverQuest - Rolemaster Standard System
// Foundry VTT V13 / V14 Compatible
// FIXES v4.2:
// - v13-compat-shim MUST load first (fixes html.find is not a function)
// - Geography LAZY: only index in init/ready, not 5599 files
// - Removed double loadAll() call (was in init AND ready)
// - Correct pipeline: init=register only, ready=data loaders -> geography index -> sheets
// ============================================================

// V13 Compat MUST be first - patches HTMLElement.find before any sheet loads
import "./module/initialization/v13-compat-shim.js";
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
import "./module/apps/eqrmss-character-creation-wizard.js";
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
    console.log("EQRMSS v4.2 | Initializing - register only, lazy geography");

    try {
        registerEQRMSSSettings();
        registerEQRMSSDocuments();

        await loadEQRMSSTemplates();

        registerEQRMSSDataLoaders();
        registerEQRMSSHooks();

        // v4.2 LAZY: Don't load geography in init - only index, and only if needed
        // Old code was: await EQRMSSGeography.loadAll() + registerAllScenes in init (heavy)
        // New: Just register, actual index load happens in ready pipeline
        console.log("EQRMSS v4.2 | Init complete - geography will load as index-only in ready");

        console.log("EQRMSS | Initialization complete");
    } catch (error) {
        console.error("EQRMSS | Initialization failed", error);
    }
});

// ============================================================
// READY - Correct order: data loaders -> geography index -> sheets
// ============================================================
Hooks.once("ready", async function () {
    console.log("EQRMSS v4.2 | Starting ready pipeline - LAZY geography");

    try {
        // 1. Data loaders first - wizard needs races/classes
        await initializeEQRMSSDataLoaders();
        console.log("EQRMSS v4.2 | Data loaders ready");

        await initializeEQRMSSSubsystems();
        console.log("EQRMSS v4.2 | Subsystems init queued");

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
            console.log("EQRMSS v4.2 | Loading geography INDEX only (lazy - 0 files)");
            await EQRMSSGeography.loadAll(); // v4.2 = index only
            console.log("EQRMSS | Geography index loaded - zones on-demand via EQRMSSGeography.loadZone()");
            
            // Scene registry now uses index, not full data
            await EQRMSSSceneRegistry.registerAllScenes();
            console.log("EQRMSS | Geography scenes registered (from index)");
        } catch (geoError) {
            console.error("EQRMSS | Geography failed to load", geoError);
        }

        // 4. Sheets last - after data and geography ready
        registerEQRMSSSheets();
        console.log("EQRMSS | Sheets registered");

        console.log("EQRMSS v4.2 | Ready - LAZY mode: geography index only, zones load on demand");
        console.log("EQRMSS v4.2 | Use game.eqrmss.geography.loadZone(world,region,zone) to load a zone");
        console.log("EQRMSS v4.2 | Use game.eqrmss.openWizard() to test wizard");
    } catch (error) {
        console.error("EQRMSS | Ready pipeline failed", error);
        ui.notifications?.error("EQRMSS failed during startup. Check console.");
    }
});
