console.log("EQRMSS | Initialize Data Loaders v4.14 | Starting - Wizard+Sheet+LazyGeo fix - NO TLA");

let AbilityModule = null, ClassModule = null, SpellModule = null, RaceModule = null, SkillModule = null;
let AbilityLoader = null, ClassLoader = null, SpellLoader = null, RaceLoader = null, SkillLoader = null;
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
    AbilityModule = await tryImport(['../data/loaders/ability-loader.js','../data/abilities/ability-loader.js']);
    ClassModule = await tryImport(['../data/loaders/class-loader.js','../data/classes/class-loader.js']);
    SpellModule = await tryImport(['../data/loaders/spell-loader.js','../data/spells/spell-loader.js']);
    RaceModule = await tryImport(['../data/loaders/race-loader.js','../data/races/race-loader.js','../data/loaders/races-loader.js']);
    SkillModule = await tryImport([
        '../data/loaders/skill-loader.js',
        '../data/skills/skill-loader.js',
        '../../module/data/loaders/skill-loader.js',
        '../data/loaders/skills-loader.js',
        './skill-loader.js'
    ]);
    AbilityLoader = resolveLoader(AbilityModule, 'AbilityLoader','EQRMSSAbilityLoader','EQRMSS_ABILITY_LOADER');
    ClassLoader = resolveLoader(ClassModule, 'ClassLoader','EQRMSSClassLoader','EQRMSS_CLASS_LOADER');
    SpellLoader = resolveLoader(SpellModule, 'SpellLoader','EQRMSSSpellLoader','EQRMSS_SPELL_LOADER');
    RaceLoader = resolveLoader(RaceModule, 'RaceLoader','EQRMSSRaceLoader','EQRMSS_RACE_LOADER','RacesLoader');
    SkillLoader = resolveLoader(SkillModule, 'SkillLoader','EQRMSSSkillLoader','EQRMSS_SKILL_LOADER');
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
    game.eqrmss._loadStatus = { classes:false, abilities:false, spells:false, races:false, skills:false };

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

    if (!game.eqrmss.races) game.eqrmss.races = {};
    if (!game.eqrmss.classes) game.eqrmss.classes = {};
    if (!game.eqrmss.spells) game.eqrmss.spells = {};
    if (!game.eqrmss.abilities) game.eqrmss.abilities = {};
    if (!game.eqrmss.skills) game.eqrmss.skills = {};

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
