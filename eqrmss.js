// ============================================================
// EQRMSS System Bootstrap v4.15
// Restored init/ready pipeline (v4.12) + v4.14 data loader (NO TLA)
// Fixes: sheets never registered, hooks never registered,
//        initializeDataLoaders never called  <- "Troublshooting" regression
// ============================================================

// ---------- Part 1: bootstrap imports (shims, fixes, facade, engines) ----------
// ============================================================
// EQRMSS System Bootstrap v4.12 - FIXED 404 - uses master-fix-v46.js
// ============================================================


import {
    registerEQRMSSSettings,
    registerEQRMSSDocuments,
    registerEQRMSSDataLoaders,
    loadEQRMSSTemplates,
    registerEQRMSSHooks,
    initializeEQRMSSSubsystems
} from "./module/initialization/index.js";

import "./module/config.js";
import { registerEQRMSSSheets } from "./module/initialization/register-sheets.js";

import * as WizardModule from "./module/apps/eqrmss-character-creation-wizard.js";
import { EQRMSSCharacterCreationWizardFinalizer } from "./module/apps/eqrmss-character-creation-wizard-finalizer.js";
import { EQRMSSCharacterCreationData } from "./module/apps/eqrmss-character-creation-wizard-data.js";
console.log("EQRMSS v4.12 | Wizard module imported:", Object.keys(WizardModule));

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
        console.log(`EQRMSS v4.12 | Wizard exported: ${wizardClass.name}`);
        Hooks.once("init", () => { game.eqrmss = game.eqrmss || {}; game.eqrmss.CharacterCreationWizard = wizardClass; });
    }
})();

// Test hooks for the in-Foundry wizard test harness: expose the finalizer
// and the wizard data service so a GM macro can drive character creation
// end-to-end without the DOM. No runtime behavior change.
(function exportWizardTestHooks() {
    globalThis.EQRMSSCharacterCreationWizardFinalizer = EQRMSSCharacterCreationWizardFinalizer;
    globalThis.EQRMSSCharacterCreationData = EQRMSSCharacterCreationData;
    Hooks.once("init", () => {
        game.eqrmss = game.eqrmss || {};
        game.eqrmss.CharacterCreationWizardFinalizer = EQRMSSCharacterCreationWizardFinalizer;
        game.eqrmss.WizardDataService = EQRMSSCharacterCreationData;
    });
    console.log("EQRMSS v4.12 | Wizard test hooks exported (finalizer + data service)");
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

// ---------- Part 2: v4.14 data loader (unchanged) ----------
console.log("EQRMSS | Initialize Data Loaders v4.14 | Starting - Wizard+Sheet+LazyGeo fix - NO TLA");

let AbilityModule = null, ClassModule = null, SpellModule = null, RaceModule = null, SkillModule = null, SongModule = null;
let AbilityLoader = null, ClassLoader = null, SpellLoader = null, RaceLoader = null, SkillLoader = null, SongLoader = null;
let modulesLoaded = false;

async function tryImport(paths) {
    for (const p of paths) {
        try { 
            const m = await import(p); 
            if (m) {
                console.log(`EQRMSS | Loaded module: ${p}`);
                return m; 
            }
        } catch (e) {
            // console.log(`Failed ${p}: ${e.message}`);
        }
    }
    return null;
}

function resolveLoader(mod, ...names) {
    if (!mod) return null;
    for (const n of names) { if (mod[n]) return mod[n]; }
    if (mod.default && typeof mod.default.load === 'function') return mod.default;
    if (mod.default && typeof mod.default === 'object' && (mod.default.classes || mod.default.races || mod.default.spells)) return mod.default;
    for (const k of Object.keys(mod)) {
        const v = mod[k];
        if (v && typeof v.load === 'function') return v;
    }
    return null;
}

async function loadModules() {
    if (modulesLoaded) return;
    console.log("EQRMSS | Data Loaders | Loading loader modules...");
    AbilityModule = await tryImport(['./module/data/loaders/ability-loader.js']);
    ClassModule = await tryImport(['./module/data/loaders/class-loader.js']);
    SpellModule = await tryImport(['./module/data/loaders/spell-loader.js']);
    RaceModule = await tryImport(['./module/data/loaders/race-loader.js']);
    SkillModule = await tryImport(['./module/data/skills/skill-loader.js', './module/data/loaders/skill-loader.js']);
    SongModule = await tryImport(['./module/data/loaders/song-loader.js']);
    AbilityLoader = resolveLoader(AbilityModule, 'AbilityLoader','EQRMSSAbilityLoader','EQRMSS_ABILITY_LOADER');
    ClassLoader = resolveLoader(ClassModule, 'ClassLoader','EQRMSSClassLoader','EQRMSS_CLASS_LOADER');
    SpellLoader = resolveLoader(SpellModule, 'SpellLoader','EQRMSSSpellLoader','EQRMSS_SPELL_LOADER');
    RaceLoader = resolveLoader(RaceModule, 'RaceLoader','EQRMSSRaceLoader','EQRMSS_RACE_LOADER','RacesLoader');
    SkillLoader = resolveLoader(SkillModule, 'SkillLoader','EQRMSSSkillLoader','EQRMSS_SKILL_LOADER');
    SongLoader = resolveLoader(SongModule, 'SongLoader','EQRMSSSongLoader','EQRMSS_SONG_LOADER');
    modulesLoaded = true;
}

// Fallback manual race loader
async function manualLoadRaces() {
    console.log("EQRMSS | Manual race load fallback");
    const RACES = {};
    try {
        const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        if (!FilePickerImpl) return RACES;
        const tryPaths = ["systems/eqrmss/module/data/races","systems/eqrmss/templates/data/races"];
        for (const basePath of tryPaths) {
            try {
                const browse = await FilePickerImpl.browse("data", basePath);
                for (const f of browse.files.filter(f=>f.endsWith('.json'))) {
                    try {
                        const r = await fetch(f);
                        if (!r.ok) continue;
                        const txt = await r.text();
                        if (!txt || txt.trim()==='' || txt.includes('[object Object]')) continue;
                        const j = JSON.parse(txt);
                        const id = f.split('/').pop().replace('.json','').toLowerCase();
                        if (id==='race-schema' || id==='schema' || id==='index' || id.includes('schema')) continue;
                        if (Array.isArray(j)) { for (const item of j) { const key = (item.id||item.name||id).toLowerCase(); if (key.includes('schema')) continue; RACES[key]=item; } }
                        else if (j.races) { 
                            for (const [k,v] of Object.entries(j.races)) {
                                if (k.toLowerCase().includes('schema')) continue;
                                RACES[k]=v;
                            }
                        }
                        else { RACES[id]=j; }
                    } catch {}
                }
                if (Object.keys(RACES).length>0) break;
            } catch {}
        }
        console.log(`EQRMSS | Manual races: ${Object.keys(RACES).length} [${Object.keys(RACES).join(', ')}]`);
        return RACES;
    } catch { return {}; }
}

// Fallback manual skill loader
async function manualLoadSkills() {
    console.log("EQRMSS | Manual skill load fallback - scanning skills folder");
    const SKILLS = {};
    try {
        const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        if (!FilePickerImpl) return SKILLS;
        const tryPaths = ["systems/eqrmss/module/data/skills","systems/eqrmss/templates/data/skills"];
        for (const basePath of tryPaths) {
            try {
                const browse = await FilePickerImpl.browse("data", basePath);
                for (const f of browse.files.filter(f=>f.endsWith('.json'))) {
                    try {
                        const r = await fetch(f);
                        if (!r.ok) continue;
                        const txt = await r.text();
                        if (!txt || txt.trim()==='') continue;
                        const j = JSON.parse(txt);
                        const id = f.split('/').pop().replace('.json','').toLowerCase();
                        if (['index','manifest'].includes(id)) continue;
                        SKILLS[id]=j;
                    } catch {}
                }
                for (const dir of browse.dirs) {
                    try {
                        const sb = await FilePickerImpl.browse("data", dir);
                        const catId = dir.split('/').pop().toLowerCase();
                        for (const f of sb.files.filter(f=>f.endsWith('.json'))) {
                            try {
                                const r = await fetch(f);
                                if (!r.ok) continue;
                                const j = JSON.parse(await r.text());
                                const id = f.split('/').pop().replace('.json','').toLowerCase();
                                SKILLS[`${catId}.${id}`]=j;
                            } catch {}
                        }
                    } catch {}
                }
                if (Object.keys(SKILLS).length>0) break;
            } catch {}
        }
        console.log(`EQRMSS | Manual skills: ${Object.keys(SKILLS).length}`);
        return SKILLS;
    } catch { return {}; }
}

export async function initializeDataLoaders() {
    console.log("EQRMSS | initializeDataLoaders() v4.14 | Starting");
    await loadModules();
    game.eqrmss = game.eqrmss || {};
    game.eqrmss._loadStatus = { classes:false, abilities:false, spells:false, races:false, skills:false, songs:false, weapons:false, armor:false, shields:false, itemEffects:false, accessories:false, transports:false, herbs:false, poisons:false, combatTables:false };

    if (ClassLoader) {
        try {
            if (typeof ClassLoader.load === 'function') await ClassLoader.load();
            else if (ClassLoader.classes) { game.eqrmss.classes = ClassLoader.classes; }
            game.eqrmss._loadStatus.classes = true;
            console.log(`EQRMSS | Classes ready: ${Object.keys(game.eqrmss.classes||{}).length}`);
        } catch (e) { console.error("Class load failed", e); }
    }

    if (RaceLoader) {
        try {
            if (typeof RaceLoader.load === 'function') await RaceLoader.load();
            else if (RaceLoader.races) { game.eqrmss.races = RaceLoader.races; }
            else if (typeof RaceLoader === 'object' && !RaceLoader.load) { game.eqrmss.races = RaceLoader; }
            // Filter race-schema here too
            if (game.eqrmss.races) {
                for (const k of Object.keys(game.eqrmss.races)) {
                    if (k.toLowerCase().includes('schema')) delete game.eqrmss.races[k];
                }
            }
            game.eqrmss._loadStatus.races = true;
            console.log(`EQRMSS | Races ready: ${Object.keys(game.eqrmss.races||{}).length} [${Object.keys(game.eqrmss.races||{}).join(', ')}]`);
        } catch (e) { console.error("Race loader failed, trying manual", e); game.eqrmss.races = await manualLoadRaces(); }
    } else {
        game.eqrmss.races = await manualLoadRaces();
        game.eqrmss._loadStatus.races = true;
        console.log(`EQRMSS | Races ready (manual): ${Object.keys(game.eqrmss.races||{}).length}`);
    }

    if (AbilityLoader) {
        try {
            if (typeof AbilityLoader.load === 'function') await AbilityLoader.load();
            else if (AbilityLoader.abilities) { game.eqrmss.abilities = AbilityLoader.abilities; }
            game.eqrmss._loadStatus.abilities = true;
            console.log(`EQRMSS | Abilities ready: ${Object.keys(game.eqrmss.abilities||{}).length} classes`);
        } catch (e) { console.error("Ability load failed", e); }
    }

    if (SpellLoader) {
        try {
            if (typeof SpellLoader.load === 'function') await SpellLoader.load();
            game.eqrmss._loadStatus.spells = true;
            console.log(`EQRMSS | Spells ready: ${game.eqrmss.spells ? Object.keys(game.eqrmss.spells).length : 0} classes, total ${Object.values(game.eqrmss.spells||{}).reduce((a,b)=>a+(b?.length||0),0)} spells`);
        } catch (e) { console.error("Spell load failed", e); }
    }

    if (SkillLoader) {
        try {
            if (typeof SkillLoader.load === 'function') await SkillLoader.load();
            game.eqrmss._loadStatus.skills = true;
            console.log(`EQRMSS | Skills ready via loader`);
        } catch (e) { console.warn("Skill loader failed, manual fallback", e); game.eqrmss.skills = await manualLoadSkills(); game.eqrmss._loadStatus.skills = true; }
    } else {
        console.log("EQRMSS | SkillLoader module not found - using manual scan (fixes 404)");
        game.eqrmss.skills = await manualLoadSkills();
        game.eqrmss._loadStatus.skills = true;
        console.log(`EQRMSS | Skills ready (manual): ${Object.keys(game.eqrmss.skills||{}).length}`);
    }

    if (SongLoader) {
        try {
            if (typeof SongLoader.load === 'function') await SongLoader.load();
            game.eqrmss._loadStatus.songs = true;
            console.log(`EQRMSS | Songs ready: ${(CONFIG.EQRMSS?.songs?.length) || 0} songs`);
        } catch (e) { console.error("Song load failed", e); }
    }

    if (!game.eqrmss.races) game.eqrmss.races = {};
    if (!game.eqrmss.classes) game.eqrmss.classes = {};
    if (!game.eqrmss.spells) game.eqrmss.spells = {};
    if (!game.eqrmss.abilities) game.eqrmss.abilities = {};
    if (!game.eqrmss.skills) game.eqrmss.skills = {};

    // Weapons (template + material + condition composer)
    try {
        const weaponMod = await import('./module/data/weapons/weapon-composer.js');
        await weaponMod.loadWeaponData();
        game.eqrmss.weapons = {
            compose: weaponMod.composeWeapon,
            options: weaponMod.getWeaponOptions,
            typeLabels: weaponMod.WEAPON_TYPE_LABELS,
            typeLabel: weaponMod.weaponTypeLabel
        };
        game.eqrmss._loadStatus.weapons = true;
        const opts = weaponMod.getWeaponOptions();
        console.log(`EQRMSS | Weapons ready: ${opts.templates.length} templates, ${opts.materials.length} materials, ${opts.conditions.length} conditions`);
    } catch (e) {
        console.error("Weapon data load failed", e);
        game.eqrmss.weapons = null;
    }

    // Armor (location + category + material + condition composer)
    try {
        const armorMod = await import('./module/data/armor/armor-composer.js');
        await armorMod.loadArmorData();
        game.eqrmss.armor = {
            compose: armorMod.composeArmor,
            options: armorMod.getArmorOptions,
            materialsForCategory: armorMod.getMaterialsForCategory
        };
        game.eqrmss._loadStatus.armor = true;
        const armorOpts = armorMod.getArmorOptions();
        console.log(`EQRMSS | Armor ready: ${armorOpts.locations.length} locations, ${armorOpts.categories.length} categories, ${armorOpts.materials.length} materials, ${armorOpts.conditions.length} conditions`);
    } catch (e) {
        console.error("Armor data load failed", e);
        game.eqrmss.armor = null;
    }

    // Shields (template + material + condition composer; DB not AT)
    try {
        const shieldMod = await import('./module/data/shields/shield-composer.js');
        await shieldMod.loadShieldData();
        game.eqrmss.shields = {
            compose: shieldMod.composeShield,
            options: shieldMod.getShieldOptions
        };
        game.eqrmss._loadStatus.shields = true;
        const shieldOpts = shieldMod.getShieldOptions();
        console.log(`EQRMSS | Shields ready: ${shieldOpts.templates.length} templates, ${shieldOpts.materials.length} materials, ${shieldOpts.conditions.length} conditions`);
    } catch (e) {
        console.error("Shield data load failed", e);
        game.eqrmss.shields = null;
    }

    // Item effects (proc / worn / triggered catalog + engines).
    // Separate from spells: procs borrow no spell entry and reference no spell id.
    try {
        const fxMod = await import('./module/data/item-effects/item-effect-loader.js');
        await fxMod.loadItemEffectData();
        const procEngine = await import('./module/item-effects/proc-engine.js');
        const wornEngine = await import('./module/item-effects/worn-engine.js');
        const triggeredEngine = await import('./module/item-effects/triggered-engine.js');
        game.eqrmss.itemEffects = {
            get: fxMod.getItemEffect,
            byKind: fxMod.getItemEffectsByKind,
            options: fxMod.getItemEffectOptions,
            fireProc: procEngine.fireWeaponProc,
            applyWornRound: wornEngine.applyWornRoundEffects,
            fireTriggered: triggeredEngine.fireTriggeredEffect
        };
        game.eqrmss._loadStatus.itemEffects = true;
        console.log(`EQRMSS | Item effects ready: ${fxMod.getItemEffectOptions().length} effects`);
    } catch (e) {
        console.error("Item effect data load failed", e);
        game.eqrmss.itemEffects = null;
    }

    // Reference charts: accessories, transport, herbs, poisons (plain data, no composer)
    const refCharts = [
        ["accessories", "items/accessories.json"],
        ["transports", "transport/transports.json"],
        ["herbs", "herbs/herbs.json"],
        ["poisons", "herbs/poisons.json"]
    ];
    for (const [key, file] of refCharts) {
        try {
            const r = await fetch(`systems/eqrmss/module/data/${file}`);
            game.eqrmss[key] = await r.json();
            game.eqrmss._loadStatus[key] = true;
            console.log(`EQRMSS | ${key} ready: ${game.eqrmss[key].length} entries`);
        } catch (e) {
            console.error(`${key} load failed`, e);
            game.eqrmss[key] = null;
        }
    }

    // Combat tables: weapon attack tables + critical tables + weapon fumble table (plain data, no composer)
    try {
        const [wtR, ctR, fbR] = await Promise.all([
            fetch("systems/eqrmss/module/data/combat/weapon-tables.json"),
            fetch("systems/eqrmss/module/data/combat/crit-tables.json"),
            fetch("systems/eqrmss/module/data/combat/fumble-table.json")
        ]);
        game.eqrmss.combatTables = {
            weapons: (await wtR.json()).tables,
            crits: (await ctR.json()).tables,
            fumble: await fbR.json()
        };
        game.eqrmss._loadStatus.combatTables = true;
        console.log(`EQRMSS | Combat tables ready: ${game.eqrmss.combatTables.weapons.length} weapon tables, ${game.eqrmss.combatTables.crits.length} crit tables, fumble table: ${game.eqrmss.combatTables.fumble.name}`);
    } catch (e) {
        console.error("Combat tables load failed", e);
        game.eqrmss.combatTables = null;
    }

    // Combat rolls: Arms Law attack resolution (RMSS §6.2–6.4) and
    // initiative determination (RMSS §6.1).
    try {
        const combatRolls = await import("./module/combat/combat-rolls.js");
        const initiativeRolls = await import("./module/combat/initiative-rolls.js");
        const critConditions = await import("./module/combat/crit-conditions.js");
        game.eqrmss.combat = {
            rollWeaponAttack: combatRolls.rollWeaponAttack,
            rollInitiative: initiativeRolls.rollInitiative,
            // Critical conditions (2026-09-30): stun pool, bleed, death
            // timer, next-swing bonus, action penalty, must-parry capture.
            declareParry: critConditions.declareParry,
            tickConditions: critConditions.tickConditions,
            // Concussion-hit thresholds (2026-09-30): §6.4.1 unconsciousness,
            // §3.8 dying countdown.
            checkHitThresholds: critConditions.checkHitThresholds,
            // Healing magic: stabilizes death timers, stops bleeding
            // (wire to the healing spell subsystem when it lands).
            applyHealingSpell: critConditions.applyHealingSpell,
            // First aid: stubbed until non-combat actions per round land.
            declareFirstAid: critConditions.declareFirstAid
        };
        console.log("EQRMSS | Combat rolls ready");
    } catch (e) {
        console.error("Combat rolls load failed", e);
        game.eqrmss.combat = null;
    }

    // Final filter
    for (const k of Object.keys(game.eqrmss.races)) {
        if (k.toLowerCase().includes('schema')) delete game.eqrmss.races[k];
    }

    game.eqrmss.data = game.eqrmss.data || {};
    game.eqrmss.data.races = game.eqrmss.races;
    game.eqrmss.data.classes = game.eqrmss.classes;
    game.eqrmss.data.spells = game.eqrmss.spells;
    game.eqrmss.data.abilities = game.eqrmss.abilities;
    game.eqrmss.data.skills = game.eqrmss.skills;
    game.eqrmss.data.weapons = game.eqrmss.weapons;
    game.eqrmss.data.armor = game.eqrmss.armor;
    game.eqrmss.data.shields = game.eqrmss.shields;
    game.eqrmss.data.accessories = game.eqrmss.accessories;
    game.eqrmss.data.transports = game.eqrmss.transports;
    game.eqrmss.data.herbs = game.eqrmss.herbs;
    game.eqrmss.data.poisons = game.eqrmss.poisons;
    game.eqrmss.data.combatTables = game.eqrmss.combatTables;

    console.log("EQRMSS | initializeDataLoaders() v4.14 complete", game.eqrmss._loadStatus);
    Hooks.callAll("eqrmss:dataLoadersReady", game.eqrmss);
    setTimeout(() => Hooks.callAll("eqrmss:dataLoadersReady", game.eqrmss), 500);
}

export const initializeEQRMSSDataLoaders = initializeDataLoaders;
export const initializeDataLoader = initializeDataLoaders;
export const initDataLoaders = initializeDataLoaders;
export const EQRMSSDataLoader = { initialize: initializeDataLoaders, initializeDataLoaders };

// For backwards compat - getters that lazy-load
export function getAbilityLoader() { return AbilityLoader; }
export function getClassLoader() { return ClassLoader; }
export function getSpellLoader() { return SpellLoader; }
export function getRaceLoader() { return RaceLoader; }
export function getSkillLoader() { return SkillLoader; }

export { AbilityLoader, ClassLoader, SpellLoader, RaceLoader, SkillLoader };
export default { initializeDataLoaders, initializeEQRMSSDataLoaders: initializeDataLoaders, get AbilityLoader() { return AbilityLoader; }, get ClassLoader() { return ClassLoader; }, get SpellLoader() { return SpellLoader; }, get RaceLoader() { return RaceLoader; } };


// ---------- Part 3: init/ready pipeline ----------
Hooks.once("init", async function () {
    console.log("EQRMSS v4.15 | Initializing");
    try {
        registerEQRMSSSettings();
        registerEQRMSSDocuments();
        await loadEQRMSSTemplates();
        registerEQRMSSDataLoaders();
        registerEQRMSSHooks();
        console.log("EQRMSS v4.15 | Init complete");
    } catch (error) { console.error("EQRMSS | Initialization failed", error); }
});

Hooks.once("ready", async function () {
    console.log("EQRMSS v4.15 | Starting ready pipeline");
    try {
        await initializeDataLoaders();
        console.log("EQRMSS v4.15 | Data loaders ready");
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
        console.log("EQRMSS | Sheets registered v4.15");

        game.eqrmss.openWizard = async (actor = null) => {
           const wizardClass = game.eqrmss.CharacterCreationWizard || globalThis.EQRMSSCharacterCreationWizard;
            if (typeof wizardClass !== "function") {
                ui.notifications.error("EQRMSS | Character creation wizard is not available.");
                return null;
            }
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            await wizard.render(true);
            return wizard;
        };
        console.log("EQRMSS v4.15 | openWizard registered");

        console.log("EQRMSS v4.15 | Ready - Wizard:", !!globalThis.EQRMSSCharacterCreationWizard, "Races:", Object.keys(game.eqrmss?.races||{}).length);
    } catch (error) { console.error("EQRMSS | Ready failed", error); }
});
