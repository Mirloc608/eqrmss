// ============================================================
// EQRMSS System Bootstrap v4.9 - DIRECT MODULE PATCH
// ============================================================

import "./module/initialization/v13-compat-shim.js";
import "./module/initialization/master-fix-v49.js";
import "./module/initialization/pet-manager-fix.js";
import "./module/initialization/sheet-v13-final-fix.js";
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

import * as WizardModule from "./module/apps/eqrmss-character-creation-wizard.js";
console.log("EQRMSS v4.9 | Wizard module imported:", Object.keys(WizardModule));

(function exportWizardGlobal() {
    let wizardClass = null;
    for (const key of Object.keys(WizardModule)) {
        const val = WizardModule[key];
        if (typeof val === 'function' && key.toLowerCase().includes('wizard')) wizardClass = val;
    }
    if (!wizardClass && WizardModule.default && typeof WizardModule.default === 'function') wizardClass = WizardModule.default;
    if (wizardClass) {
        globalThis.EQRMSSCharacterCreationWizard = wizardClass;
        globalThis.CharacterCreationWizard = wizardClass;
        globalThis.EQRMSS = globalThis.EQRMSS || {};
        globalThis.EQRMSS.CharacterCreationWizard = wizardClass;
        console.log(`EQRMSS v4.9 | Wizard exported: ${wizardClass.name}`);
        Hooks.once("init", () => { game.eqrmss = game.eqrmss || {}; game.eqrmss.CharacterCreationWizard = wizardClass; });
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
    console.log("EQRMSS v4.9 | Initializing");
    try {
        registerEQRMSSSettings();
        registerEQRMSSDocuments();
        await loadEQRMSSTemplates();
        registerEQRMSSDataLoaders();
        registerEQRMSSHooks();
        console.log("EQRMSS v4.9 | Init complete");
    } catch (error) { console.error("EQRMSS | Initialization failed", error); }
});

Hooks.once("ready", async function () {
    console.log("EQRMSS v4.9 | Starting ready pipeline");
    try {
        await initializeEQRMSSDataLoaders();
        console.log("EQRMSS v4.9 | Data loaders ready");
        await initializeEQRMSSSubsystems();
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
        } catch {}
        try { await EQRMSSGeography.loadAll(); await EQRMSSSceneRegistry.registerAllScenes(); } catch {}
        registerEQRMSSSheets();
        console.log("EQRMSS | Sheets registered v4.9");
        console.log("EQRMSS v4.9 | Ready - Wizard:", !!globalThis.EQRMSSCharacterCreationWizard, "Races:", Object.keys(game.eqrmss?.races||{}).length);
    } catch (error) { console.error("EQRMSS | Ready failed", error); }
});
