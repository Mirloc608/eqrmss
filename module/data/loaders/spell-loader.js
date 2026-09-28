/**
 * EQRMSS Spell Loader v3.0 - CLEAN PRODUCTION
 * - Handles spells_01-05.json 5-level chunks
 * - Silently skips empty placeholder files (beastlord etc are non-casters or WIP)
 * - Only logs loaded classes, not empty spam
 */
const SPELLS = {};
const SPELLS_BY_LEVEL = {};
const STATS = {classes:0,total:0,chunks:0};

async function parseSpellFile(className, file, levelKey) {
    try {
        const resp = await fetch(file);
        if (!resp.ok) return 0;
        const text = await resp.text();
        if (!text || text.trim() === '' || text.trim() === '[object Object]') return 0;
        let json;
        try { json = JSON.parse(text); } catch { return 0; }
        
        SPELLS[className] = SPELLS[className] || [];
        SPELLS_BY_LEVEL[className] = SPELLS_BY_LEVEL[className] || {};
        SPELLS_BY_LEVEL[className][levelKey] = SPELLS_BY_LEVEL[className][levelKey] || [];
        
        let added = 0;
        if (Array.isArray(json)) {
            SPELLS[className].push(...json);
            SPELLS_BY_LEVEL[className][levelKey].push(...json);
            added = json.length;
        } else if (json.spells && Array.isArray(json.spells)) {
            SPELLS[className].push(...json.spells);
            SPELLS_BY_LEVEL[className][levelKey].push(...json.spells);
            added = json.spells.length;
        } else if (json.data && Array.isArray(json.data)) {
            SPELLS[className].push(...json.data);
            SPELLS_BY_LEVEL[className][levelKey].push(...json.data);
            added = json.data.length;
        } else if (json.id || json.name || json.spellName || json.spell_name) {
            SPELLS[className].push(json);
            SPELLS_BY_LEVEL[className][levelKey].push(json);
            added = 1;
        } else if (typeof json === 'object') {
            for (const k of Object.keys(json)) {
                const v = json[k];
                if (Array.isArray(v)) { SPELLS[className].push(...v); SPELLS_BY_LEVEL[className][levelKey].push(...v); added += v.length; }
                else if (v && typeof v === 'object' && (v.id || v.name || v.spellName || v.spell_name || v.level)) {
                    if (!v.id) v.id = k;
                    SPELLS[className].push(v); SPELLS_BY_LEVEL[className][levelKey].push(v); added++;
                }
            }
            if (added === 0 && (json.spellName || json.spell_name || json.level || json.mana)) {
                SPELLS[className].push(json); SPELLS_BY_LEVEL[className][levelKey].push(json); added = 1;
            }
        }
        return added;
    } catch { return 0; }
}

async function loadClassSpells(className, classPath) {
    try {
        const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        const browse = await FilePickerImpl.browse("data", classPath).catch(() => ({files:[],dirs:[]}));
        let total = 0;
        SPELLS[className] = SPELLS[className] || [];
        SPELLS_BY_LEVEL[className] = SPELLS_BY_LEVEL[className] || {};
        const sorted = browse.files.filter(f => f.endsWith('.json')).sort((a,b) => a.localeCompare(b));
        for (const file of sorted) {
            const fn = file.split('/').pop();
            if (['index.json','manifest.json'].includes(fn) || fn.startsWith('.')) continue;
            const m = fn.match(/spells[_-]?(\d+)[-_](\d+)/i) || fn.match(/(\d+)[-_](\d+)/i);
            const key = m ? `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : fn.replace('.json','');
            const add = await parseSpellFile(className, file, key);
            if (add > 0) { total += add; STATS.chunks++; }
        }
        for (const subDir of browse.dirs) {
            if (subDir.split('/').pop().startsWith('.')) continue;
            try {
                const sb = await FilePickerImpl.browse("data", subDir);
                for (const file of sb.files.filter(f => f.endsWith('.json')).sort((a,b) => a.localeCompare(b))) {
                    const fn = file.split('/').pop();
                    if (['index.json','manifest.json'].includes(fn)) continue;
                    const m = fn.match(/spells[_-]?(\d+)[-_](\d+)/i) || fn.match(/(\d+)[-_](\d+)/i);
                    const key = m ? `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : fn.replace('.json','');
                    const add = await parseSpellFile(className, file, key);
                    if (add > 0) { total += add; STATS.chunks++; }
                }
            } catch {}
        }
        return total;
    } catch { return 0; }
}

async function loadSingleFile(className, file) {
    const fn = file.split('/').pop();
    const m = fn.match(/spells[_-]?(\d+)[-_](\d+)/i);
    const key = m ? `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : 'all';
    const add = await parseSpellFile(className, file, key);
    if (add > 0) STATS.chunks++;
    return add;
}

async function loadSpells() {
    console.log("EQRMSS | Spell Loader v3.0 | ZERO 403 - 5-level chunks");
    for (const k of Object.keys(SPELLS)) delete SPELLS[k];
    for (const k of Object.keys(SPELLS_BY_LEVEL)) delete SPELLS_BY_LEVEL[k];
    STATS.classes = 0; STATS.total = 0; STATS.chunks = 0;
    
    try {
        const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        if (!FilePickerImpl) return SPELLS;
        const basePath = "systems/eqrmss/module/data/spells";
        let baseBrowse;
        try { baseBrowse = await FilePickerImpl.browse("data", basePath); }
        catch { console.log("EQRMSS | Spell Loader | No spells folder"); return SPELLS; }
        
        if (baseBrowse.dirs.length > 0) {
            for (const classDir of baseBrowse.dirs) {
                const className = classDir.split('/').pop().toLowerCase();
                if (className.startsWith('.') || ['backup','old'].includes(className)) continue;
                const c = await loadClassSpells(className, classDir);
                SPELLS[className] = SPELLS[className] || [];
                if (c > 0) { STATS.classes++; STATS.total += c; }
            }
        }
        for (const file of baseBrowse.files) {
            if (!file.endsWith('.json')) continue;
            const bn = file.split('/').pop().replace('.json','').toLowerCase();
            if (['index','manifest'].includes(bn)) continue;
            const c = await loadSingleFile(bn, file);
            if (c > 0) { STATS.classes++; STATS.total += c; }
        }
        console.log(`EQRMSS | Spells loaded: ${STATS.total} spells across ${STATS.classes} caster classes in ${STATS.chunks} chunks`);
        game.eqrmss = game.eqrmss || {};
        game.eqrmss.spells = SPELLS;
        game.eqrmss.spellsByLevel = SPELLS_BY_LEVEL;
        for (const cls of Object.keys(SPELLS).sort()) {
            if (SPELLS[cls].length > 0) {
                const lk = Object.keys(SPELLS_BY_LEVEL[cls] || {});
                console.log(`  ${cls}: ${SPELLS[cls].length} spells [${lk.join(', ')}]`);
            }
        }
        const allClasses = ['bard','beastlord','berserker','cleric','druid','enchanter','magician','monk','necromancer','paladin','ranger','rogue','shadowknight','shaman','warrior','wizard'];
        for (const c of allClasses) { if (!SPELLS[c]) { SPELLS[c] = []; SPELLS_BY_LEVEL[c] = {}; } }
        return SPELLS;
    } catch (err) {
        console.error("EQRMSS | Spell Loader error", err);
        return SPELLS;
    }
}

export const EQRMSSSpellLoader = {
    get spells() { return SPELLS; },
    get spellsByLevel() { return SPELLS_BY_LEVEL; },
    get stats() { return STATS; },
    load: loadSpells,
    loadSpells: loadSpells,
    getSpellsForLevel(className, level) {
        const all = SPELLS[className] || [];
        if (!level) return all;
        return all.filter(s => { const l = s.level || s.spellLevel || s.minLevel || s.spell_level || 0; return l <= level; });
    },
    getSpellsForRange(className, rangeKey) { return SPELLS_BY_LEVEL[className]?.[rangeKey] || []; }
};

export async function load() { return await loadSpells(); }
export const SpellLoader = EQRMSSSpellLoader;
export const EQRMSS_SPELL_LOADER = EQRMSSSpellLoader;
export default EQRMSSSpellLoader;
