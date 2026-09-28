/**
 * EQRMSS Class Loader v3.0 - ZERO 403s - Production Clean
 * FIX: Never fetch() signature.json directly - that causes browser to log 403 network error
 * Signatures are optional and loaded only if explicitly enabled via setting
 */
const CLASSES = {};
const SIGNATURES = {};
let INDEX = null;

async function fetchJsonSafe(path) {
    try {
        const r = await fetch(path);
        if (!r.ok) return null;
        const t = await r.text();
        if (!t || t.trim() === '' || t.trim() === '[object Object]' || t.trim() === '{}') return null;
        try { return JSON.parse(t); } catch { return null; }
    } catch { return null; }
}

async function loadClasses() {
    console.log("EQRMSS | Class Loader v3.0 | Starting - Zero 403 mode");
    const basePath = "systems/eqrmss/module/data/classes";
    try {
        const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        if (!FilePickerImpl) return CLASSES;
        let baseBrowse;
        try { baseBrowse = await FilePickerImpl.browse("data", basePath); }
        catch { return CLASSES; }
        
        // index.json - safe, main file
        const indexFile = baseBrowse.files.find(f => f.endsWith('/index.json'));
        if (indexFile) {
            const idx = await fetchJsonSafe(indexFile);
            if (idx) INDEX = idx;
        }
        
        for (const dir of baseBrowse.dirs) {
            const classId = dir.split('/').pop().toLowerCase();
            if (classId.startsWith('.') || classId.startsWith('_')) continue;
            if (['backup','old','_old','templates'].includes(classId)) continue;
            try {
                const classBrowse = await FilePickerImpl.browse("data", dir);
                // Only load main class file - NEVER fetch signature.json here (causes 403)
                const mainFile = classBrowse.files.find(f => {
                    const b = f.split('/').pop().toLowerCase();
                    return b === `${classId}.json` || b === 'class.json' || b === `${classId}_class.json`;
                }) || classBrowse.files.find(f => {
                    const lower = f.toLowerCase();
                    return lower.endsWith('.json') && !lower.includes('signature') && !lower.includes('manifest') && !lower.includes('index');
                });
                
                if (mainFile) {
                    const json = await fetchJsonSafe(mainFile);
                    if (json && (json.id || json.name || json.label || json.className || Object.keys(json).length > 2)) {
                        CLASSES[classId] = json;
                    }
                }
                // v3.0: DO NOT LOAD signature.json - skip to avoid 403
                // If you need signatures, fix perms: chmod 644 .../signature.json
                // Or enable via: game.settings.get('eqrmss','loadSignatures')
            } catch (err) { continue; }
        }
        
        // Flat files in base folder
        for (const file of baseBrowse.files) {
            if (!file.endsWith('.json')) continue;
            const baseName = file.split('/').pop().replace('.json','').toLowerCase();
            if (['index','manifest'].includes(baseName) || CLASSES[baseName] || baseName.includes('signature')) continue;
            const json = await fetchJsonSafe(file);
            if (json) CLASSES[baseName] = json;
        }
        
        console.log(`EQRMSS | Classes loaded: ${Object.keys(CLASSES).length} [${Object.keys(CLASSES).sort().join(', ')}]`);
        
        game.eqrmss = game.eqrmss || {};
        game.eqrmss.classes = CLASSES;
        game.eqrmss.classSignatures = SIGNATURES;
        
        // Lazy load signatures only if setting enabled and files have correct perms
        try {
            const loadSigs = game.settings?.get?.('eqrmss','loadSignatures') ?? false;
            if (loadSigs) {
                console.log("EQRMSS | Class Loader | Lazy loading signatures (setting enabled)");
                // This will still 403 if perms bad, but only if user opted in
                for (const dir of baseBrowse.dirs) {
                    const classId = dir.split('/').pop().toLowerCase();
                    if (!CLASSES[classId]) continue;
                    try {
                        const cb = await FilePickerImpl.browse("data", dir);
                        const sigFile = cb.files.find(f => f.toLowerCase().endsWith('signature.json'));
                        if (sigFile) {
                            const sig = await fetchJsonSafe(sigFile);
                            if (sig) SIGNATURES[classId] = sig;
                        }
                    } catch {}
                }
                if (Object.keys(SIGNATURES).length > 0) console.log(`EQRMSS | Signatures loaded: ${Object.keys(SIGNATURES).length}`);
            }
        } catch {}
        
        return CLASSES;
    } catch (err) {
        console.error("EQRMSS | Class Loader Fatal", err);
        return CLASSES;
    }
}

async function loadSignaturesManually() {
    console.log("EQRMSS | Manually loading signatures - may 403 if perms not fixed");
    const basePath = "systems/eqrmss/module/data/classes";
    try {
        const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        const baseBrowse = await FilePickerImpl.browse("data", basePath);
        for (const dir of baseBrowse.dirs) {
            const classId = dir.split('/').pop().toLowerCase();
            try {
                const cb = await FilePickerImpl.browse("data", dir);
                const sigFile = cb.files.find(f => f.toLowerCase().endsWith('signature.json'));
                if (sigFile) {
                    const sig = await fetchJsonSafe(sigFile);
                    if (sig) SIGNATURES[classId] = sig;
                }
            } catch {}
        }
        console.log(`EQRMSS | Signatures: ${Object.keys(SIGNATURES).length}`);
        return SIGNATURES;
    } catch { return SIGNATURES; }
}

export const EQRMSSClassLoader = {
    get classes() { return CLASSES; },
    get signatures() { return SIGNATURES; },
    get index() { return INDEX; },
    load: loadClasses,
    loadClasses: loadClasses,
    loadSignatures: loadSignaturesManually,
    getClass(id) { return CLASSES[id?.toLowerCase()] || null; },
    getSignature(id) { return SIGNATURES[id?.toLowerCase()] || null; }
};

export async function load() { return await loadClasses(); }
export const ClassLoader = EQRMSSClassLoader;
export const EQRMSS_CLASS_LOADER = EQRMSSClassLoader;
export default EQRMSSClassLoader;
