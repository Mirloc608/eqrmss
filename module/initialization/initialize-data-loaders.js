/**
 * EQRMSS Initialize Data Loaders v4.0 - FIX WIZARD+SHEET + LAZY GEO
 * Fixes:
 * 1. skill-loader.js 404 - try multiple paths, fallback to manual skill scan
 * 2. Wizard no error - ensure data available before wizard opens, add retry
 * 3. Sheet no render - ensure defaults exist
 */
console.log("EQRMSS | Initialize Data Loaders v4.0 | Starting - Wizard+Sheet+LazyGeo fix");

let AbilityModule, ClassModule, SpellModule, RaceModule, SkillModule;

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

AbilityModule = await tryImport(['../data/loaders/ability-loader.js','../data/abilities/ability-loader.js']);
ClassModule = await tryImport(['../data/loaders/class-loader.js','../data/classes/class-loader.js']);
SpellModule = await tryImport(['../data/loaders/spell-loader.js','../data/spells/spell-loader.js']);
RaceModule = await tryImport(['../data/loaders/race-loader.js','../data/races/race-loader.js','../data/loaders/races-loader.js']);
// Skill loader has many possible locations - try all
SkillModule = await tryImport([
    '../data/loaders/skill-loader.js',
    '../data/skills/skill-loader.js',
    '../../module/data/loaders/skill-loader.js',
    '../data/loaders/skills-loader.js',
    './skill-loader.js'
]);

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

const AbilityLoader = resolveLoader(AbilityModule, 'AbilityLoader','EQRMSSAbilityLoader','EQRMSS_ABILITY_LOADER');
const ClassLoader = resolveLoader(ClassModule, 'ClassLoader','EQRMSSClassLoader','EQRMSS_CLASS_LOADER');
const SpellLoader = resolveLoader(SpellModule, 'SpellLoader','EQRMSSSpellLoader','EQRMSS_SPELL_LOADER');
const RaceLoader = resolveLoader(RaceModule, 'RaceLoader','EQRMSSRaceLoader','EQRMSS_RACE_LOADER','RacesLoader');
let SkillLoader = resolveLoader(SkillModule, 'SkillLoader','EQRMSSSkillLoader','EQRMSS_SKILL_LOADER');

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
                        if (id==='race-schema' || id==='schema' || id==='index') continue;
                        if (Array.isArray(j)) { for (const item of j) { const key = (item.id||item.name||id).toLowerCase(); RACES[key]=item; } }
                        else if (j.races) { Object.assign(RACES, j.races); }
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

// Fallback manual skill loader - since skill-loader.js 404s
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
    console.log("EQRMSS | initializeDataLoaders() v4.0 | Starting");
    game.eqrmss = game.eqrmss || {};
    game.eqrmss._loadStatus = { classes:false, abilities:false, spells:false, races:false, skills:false, aas:false };

    // Expansion manager first - AA gating (and future race/class gating) depends on it
    try {
        const { EQRMSSExpansionManager } = await import('../expansions/expansion-manager.js');
        await EQRMSSExpansionManager.initialize();
        game.eqrmss.expansions = EQRMSSExpansionManager;
        console.log(`EQRMSS | Expansion manager ready: active=${EQRMSSExpansionManager.getActiveExpansion()}`);
    } catch (e) {
        console.warn("EQRMSS | Expansion manager failed, expansion-gated content loads ungated", e);
    }

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

    // Alternate Advancements - expansion-gated
    try {
        const { EQRMSSAALoader } = await import('../data/loaders/aa-loader.js');
        await EQRMSSAALoader.load();
        game.eqrmss._loadStatus.aas = true;
        const count = Object.keys(game.eqrmss.aas?.byId || {}).length;
        console.log(`EQRMSS | AAs ready: ${count} unlocked under active expansion`);
    } catch (e) {
        console.error("EQRMSS | AA loader failed", e);
        game.eqrmss.aas = { byId:{}, byClass:{}, byCategory:{} };
    }

    if (!game.eqrmss.aas) game.eqrmss.aas = { byId:{}, byClass:{}, byCategory:{} };

    game.eqrmss.data = game.eqrmss.data || {};
    game.eqrmss.data.races = game.eqrmss.races;
    game.eqrmss.data.classes = game.eqrmss.classes;
    game.eqrmss.data.spells = game.eqrmss.spells;
    game.eqrmss.data.abilities = game.eqrmss.abilities;
    game.eqrmss.data.skills = game.eqrmss.skills;
    game.eqrmss.data.aas = game.eqrmss.aas;

    console.log("EQRMSS | initializeDataLoaders() v4.0 complete", game.eqrmss._loadStatus);
    Hooks.callAll("eqrmss:dataLoadersReady", game.eqrmss);
    
    // Also call a second time after a short delay for wizard that missed first hook
    setTimeout(() => Hooks.callAll("eqrmss:dataLoadersReady", game.eqrmss), 500);
}

export const initializeEQRMSSDataLoaders = initializeDataLoaders;
export const initializeDataLoader = initializeDataLoaders;
export const initDataLoaders = initializeDataLoaders;
export const EQRMSSDataLoader = { initialize: initializeDataLoaders, initializeDataLoaders };

export { AbilityLoader, ClassLoader, SpellLoader, RaceLoader, SkillLoader };
export default { initializeDataLoaders, initializeEQRMSSDataLoaders, AbilityLoader, ClassLoader, SpellLoader, RaceLoader };
