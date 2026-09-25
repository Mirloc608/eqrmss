/**
 * EQRMSS Race Loader v3.1 - NEW - Wizard dependency
 * Wizard fails because race data missing
 * Structure: races/barbarian/barbarian.json or races/barbarian.json
 */
const RACES = {};
let INDEX = null;

async function fetchJsonSafe(path) {
    try {
        const r = await fetch(path);
        if (!r.ok) return null;
        const t = await r.text();
        if (!t || t.trim() === '' || t.trim() === '[object Object]') return null;
        return JSON.parse(t);
    } catch { return null; }
}

async function loadRaces() {
    console.log("EQRMSS | Race Loader v3.1 | Starting");
    const tryBasePaths = [
        "systems/eqrmss/module/data/races",
        "systems/eqrmss/module/data/race",
        "systems/eqrmss/module/data/races/races"
    ];
    
    try {
        const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        if (!FilePickerImpl) return RACES;
        
        let basePath = null;
        let baseBrowse = null;
        for (const p of tryBasePaths) {
            try {
                const b = await FilePickerImpl.browse("data", p);
                if (b.dirs.length>0 || b.files.length>0) { basePath = p; baseBrowse = b; break; }
            } catch {}
        }
        if (!baseBrowse) { console.log("EQRMSS | Race Loader | No races folder found"); return RACES; }
        
        console.log(`EQRMSS | Race Loader | Using path: ${basePath} - ${baseBrowse.dirs.length} dirs, ${baseBrowse.files.length} files`);
        
        for (const dir of baseBrowse.dirs) {
            const raceId = dir.split('/').pop().toLowerCase();
            if (raceId.startsWith('.') || ['backup','old'].includes(raceId)) continue;
            try {
                const raceBrowse = await FilePickerImpl.browse("data", dir);
                const mainFile = raceBrowse.files.find(f=> {
                    const b = f.split('/').pop().toLowerCase();
                    return b === `${raceId}.json` || b === 'race.json' || b === 'index.json';
                }) || raceBrowse.files.find(f=>f.endsWith('.json') && !f.includes('manifest'));
                
                if (mainFile) {
                    const json = await fetchJsonSafe(mainFile);
                    if (json) RACES[raceId] = json;
                }
            } catch {}
        }
        
        for (const file of baseBrowse.files) {
            if (!file.endsWith('.json')) continue;
            const baseName = file.split('/').pop().replace('.json','').toLowerCase();
            if (['index','manifest'].includes(baseName) || RACES[baseName]) continue;
            const json = await fetchJsonSafe(file);
            if (json) {
                if (Array.isArray(json)) {
                    for (const item of json) {
                        const key = (item.id||item.name||baseName).toLowerCase();
                        RACES[key]=item;
                    }
                } else if (json.races && typeof json.races === 'object') {
                    Object.assign(RACES, json.races);
                } else {
                    RACES[baseName]=json;
                }
            }
        }
        
        console.log(`EQRMSS | Races loaded: ${Object.keys(RACES).length} [${Object.keys(RACES).sort().join(', ')}]`);
        game.eqrmss = game.eqrmss||{};
        game.eqrmss.races = RACES;
        game.eqrmss.data = game.eqrmss.data||{};
        game.eqrmss.data.races = RACES;
        return RACES;
    } catch (err) {
        console.error("EQRMSS | Race Loader Fatal", err);
        return RACES;
    }
}

export const EQRMSSRaceLoader = {
    get races() { return RACES; },
    get index() { return INDEX; },
    load: loadRaces,
    loadRaces: loadRaces,
    getRace(id) { return RACES[id?.toLowerCase()]||null; }
};

export async function load() { return await loadRaces(); }
export const RaceLoader = EQRMSSRaceLoader;
export const EQRMSS_RACE_LOADER = EQRMSSRaceLoader;
export default EQRMSSRaceLoader;
