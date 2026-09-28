/**
 * EQRMSS Ability Loader v3.0 - NO this binding bug fix
 */
const ABILITIES = {};

async function fetchAndParse(path) {
    try {
        const resp = await fetch(path);
        if (!resp.ok) return null;
        const text = await resp.text();
        if (!text || text.trim() === '' || text.trim() === '[object Object]') return null;
        return JSON.parse(text);
    } catch { return null; }
}

function storeAbilities(classId, data, file) {
    if (Array.isArray(data)) {
        ABILITIES[classId] = ABILITIES[classId] || [];
        ABILITIES[classId].push(...data);
        return data.length;
    } else if (data.abilities && Array.isArray(data.abilities)) {
        ABILITIES[classId] = ABILITIES[classId] || [];
        ABILITIES[classId].push(...data.abilities);
        return data.abilities.length;
    } else if (data.abilities && typeof data.abilities === 'object') {
        ABILITIES[classId] = ABILITIES[classId] || [];
        ABILITIES[classId].push(data.abilities);
        return 1;
    } else if (data.id || data.name) {
        ABILITIES[classId] = ABILITIES[classId] || [];
        ABILITIES[classId].push(data);
        return 1;
    } else if (typeof data === 'object') {
        const keys = Object.keys(data);
        if (keys.length > 0) {
            ABILITIES[classId] = ABILITIES[classId] || [];
            if (keys.length > 3 && !data.id) {
                for (const k of keys) { if (typeof data[k] === 'object') ABILITIES[classId].push(data[k]); }
                return keys.length;
            } else {
                ABILITIES[classId].push(data);
                return 1;
            }
        }
    }
    return 0;
}

async function loadAbilities() {
    console.log("EQRMSS | Ability Loader v3.0 | Starting");
    const basePath = "systems/eqrmss/module/data/abilities";
    try {
        const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        if (!FilePickerImpl) return ABILITIES;
        let baseBrowse;
        try { baseBrowse = await FilePickerImpl.browse("data", basePath); }
        catch { console.log("EQRMSS | Ability Loader | No abilities folder - skipping"); console.log("EQRMSS | Loaded 0 abilities"); return ABILITIES; }
        
        let total = 0;
        for (const dir of baseBrowse.dirs) {
            const classId = dir.split('/').pop();
            if (classId.startsWith('.')) continue;
            try {
                const subBrowse = await FilePickerImpl.browse("data", dir);
                for (const file of subBrowse.files) {
                    if (!file.endsWith('.json')) continue;
                    const data = await fetchAndParse(file);
                    if (!data) continue;
                    total += storeAbilities(classId, data, file);
                }
                for (const subDir of subBrowse.dirs) {
                    try {
                        const subSubBrowse = await FilePickerImpl.browse("data", subDir);
                        for (const file of subSubBrowse.files) {
                            if (!file.endsWith('.json')) continue;
                            const data = await fetchAndParse(file);
                            if (!data) continue;
                            total += storeAbilities(classId, data, file);
                        }
                    } catch {}
                }
            } catch {}
        }
        for (const file of baseBrowse.files) {
            if (!file.endsWith('.json')) continue;
            const classId = file.split('/').pop().replace('.json','');
            if (ABILITIES[classId]) continue;
            const data = await fetchAndParse(file);
            if (!data) continue;
            total += storeAbilities(classId, data, file);
        }
        console.log(`EQRMSS | Ability Loader | Loaded ${total} abilities across ${Object.keys(ABILITIES).length} classes`, Object.keys(ABILITIES));
        game.eqrmss = game.eqrmss || {};
        game.eqrmss.abilities = ABILITIES;
        return ABILITIES;
    } catch (err) {
        console.log("EQRMSS | Ability Loader error:", err.message);
        return ABILITIES;
    }
}

export const EQRMSSAbilityLoader = {
    get abilities() { return ABILITIES; },
    load: loadAbilities,
    loadAbilities: loadAbilities
};

export async function load() { return await loadAbilities(); }
export async function loadAbilitiesFn() { return await loadAbilities(); }
export const AbilityLoader = EQRMSSAbilityLoader;
export const EQRMSS_ABILITY_LOADER = EQRMSSAbilityLoader;
export default EQRMSSAbilityLoader;
