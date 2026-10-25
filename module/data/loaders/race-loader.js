/**
 * EQRMSS Race Loader v3.1 - NEW - Wizard dependency
 * Wizard fails because race data missing
 * Structure: races/barbarian/barbarian.json or races/barbarian.json
 */
const RACES = {};
let INDEX = null;

/* Parallel fetch helper (2026-10-14): concurrency-limited Promise.all
   to avoid hammering the server. Batches at 10 concurrent fetches. */
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            try { results[i] = await fn(items[i], i); }
            catch { results[i] = null; }
        }
    }
    const workers = Array(Math.min(limit, items.length)).fill().map(() => worker());
    await Promise.all(workers);
    return results;
}

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
        
        const raceDirs = baseBrowse.dirs.filter(dir => {
            const raceId = dir.split('/').pop().toLowerCase();
            return !raceId.startsWith('.') && !['backup','old'].includes(raceId);
        });
        await mapLimit(raceDirs, 5, async (dir) => {
            const raceId = dir.split('/').pop().toLowerCase();
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
        });
        
        const raceFiles = baseBrowse.files.filter(file => {
            if (!file.endsWith('.json')) return false;
            const baseName = file.split('/').pop().replace('.json','').toLowerCase();
            return !['index','manifest','race-schema','schema','races','base-hits'].includes(baseName) && !baseName.includes('schema') && !RACES[baseName];
        });
        await mapLimit(raceFiles, 10, async (file) => {
            const baseName = file.split('/').pop().replace('.json','').toLowerCase();
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
        });
        
        console.log(`EQRMSS | Races loaded: ${Object.keys(RACES).length} [${Object.keys(RACES).sort().join(', ')}]`);

        // Optional data service: pre-fill bestiary entries from the
        // service. The file scan below never overwrites existing keys,
        // so service entries win and unlisted files still load.
        try {
            const svcBase = game?.settings?.get("eqrmss", "dataServiceUrl") || "";
            if (svcBase) {
                const base = String(svcBase).replace(/\/+$/, "");
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 8000);
                const r = await fetch(`${base}/api/v1/bestiary`, { signal: ctrl.signal });
                clearTimeout(timer);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const data = await r.json();
                if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("unexpected bestiary shape");
                let added = 0;
                for (const [key, json] of Object.entries(data)) {
                    if (json && !RACES[key]) { RACES[key] = json; added++; }
                }
                console.log(`EQRMSS | Race Loader | Bestiary from data service: ${added} creatures`);
            }
        } catch (err) {
            console.warn(`EQRMSS | Race Loader | bestiary service unavailable (${err.message}); using bundled creature files`);
        }

        // Creatures & Treasures bestiary: module/data/creatures/<type>/<name>.json
        // races/ stays PC-sentient-only; creatures/ holds every NPC entry
        // (including NPC versions of PC races). types.json,
        // attack-packages.json and special-attacks.json are data files,
        // not creature entries — skip them.
        try {
            const cBrowse = await FilePickerImpl.browse("data", "systems/eqrmss/module/data/creatures");
            const skipCreatureFiles = new Set(["types", "attack-packages", "special-attacks"]);
            await mapLimit(cBrowse.dirs || [], 5, async (dir) => {
                try {
                    const sub = await FilePickerImpl.browse("data", dir);
                    const files = (sub.files || []).filter(file => {
                        if (!file.endsWith(".json")) return false;
                        const key = file.split("/").pop().replace(".json", "").toLowerCase();
                        return !skipCreatureFiles.has(key) && !RACES[key];
                    });
                    await mapLimit(files, 10, async (file) => {
                        const key = file.split("/").pop().replace(".json", "").toLowerCase();
                        const json = await fetchJsonSafe(file);
                        if (json) RACES[key] = json;
                    });
                } catch {}
            });
            const cFiles = (cBrowse.files || []).filter(file => {
                if (!file.endsWith(".json")) return false;
                const key = file.split("/").pop().replace(".json", "").toLowerCase();
                return !skipCreatureFiles.has(key) && !RACES[key];
            });
            await mapLimit(cFiles, 10, async (file) => {
                const key = file.split("/").pop().replace(".json", "").toLowerCase();
                const json = await fetchJsonSafe(file);
                if (json) RACES[key] = json;
            });
            console.log(`EQRMSS | Creatures loaded into race registry: ${Object.keys(RACES).length} total`);
        } catch {}
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
