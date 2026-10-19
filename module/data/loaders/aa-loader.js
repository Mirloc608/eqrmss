/**
 * ============================================================
 * EQRMSS AA Loader
 * ============================================================
 * Loads Alternate Advancement data from module/data/aas/consolidated/
 * (19 JSON files: 16 classes + general + archetype + mercenary)
 * and applies expansion gating via EQRMSSExpansionManager.
 *
 * Populates: game.eqrmss.aas = { byId, byClass, byCategory }
 *
 * Foundry VTT V13/V14 Compatible
 * ============================================================
 */


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

import { EQRMSSExpansionManager } from "../../expansions/expansion-manager.js";

const AA_BASE_PATH = "systems/eqrmss/module/data/aas/consolidated";
const DEFAULT_AA_EXPANSION = "luclin";

const AA_FILES = ["general", "archetype", "mercenary", "bard", "beastlord", "berserker", "cleric", "druid", "enchanter", "magician", "monk", "necromancer", "paladin", "ranger", "rogue", "shadowknight", "shaman", "warrior", "wizard"];

function isValidAA(j) {
    if (!j || typeof j !== "object") return false;
    if (j.type !== "aa") return false;
    if (typeof j.id !== "string" || !j.id) return false;
    if (typeof j.name !== "string" || !j.name) return false;
    const s = j.system;
    if (!s || typeof s !== "object") return false;
    if (typeof s.category !== "string" || !s.category) return false;
    if (typeof s.maxRanks !== "number" || s.maxRanks < 1) return false;
    if (!Array.isArray(s.costPerRank) || s.costPerRank.length !== s.maxRanks) return false;
    if (typeof s.levelRequired !== "number") return false;
    return true;
}

/**
 * The gate authority is the EQRMSSExpansionManager static class, imported
 * directly. (game.eqrmss.expansions is only the raw data loader object and
 * is never populated on the registry boot path, so it cannot be used here.)
 * Initialized lazily and exactly once; the promise is cached so reloads
 * reuse the already-initialized manager.
 */
let _expansionManagerPromise = null;
let _expansionUnavailableWarned = false;

async function getExpansionManager() {
    if (!_expansionManagerPromise) {
        _expansionManagerPromise = EQRMSSExpansionManager.initialize().catch(err => {
            console.warn("EQRMSS | AA Loader | expansion manager init failed, gating disabled", err);
            return null;
        });
    }
    return _expansionManagerPromise;
}

/**
 * Expansion gate for a single AA. Returns true when the AA may be used
 * under the currently active expansion. `manager` is resolved once per
 * load() call; a null manager fails open (the caller warns once).
 */
function isAAUnlocked(aa, manager) {
    if (!manager) return true;
    try {
        if (typeof manager.hasAAs === "function" && !manager.hasAAs()) return false;
        const required = aa?.system?.expansion || DEFAULT_AA_EXPANSION;
        if (typeof manager.isExpansionUnlocked === "function" &&
            !manager.isExpansionUnlocked(required)) return false;
        if (aa?.system?.advanced &&
            typeof manager.hasAdvancedAAs === "function" &&
            !manager.hasAdvancedAAs()) return false;
    } catch (err) {
        console.warn("EQRMSS | AA Loader | gating check failed, allowing AA", aa?.id, err);
        return true;
    }
    return true;
}

async function fetchJson(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
    return r.json();
}

export const EQRMSSAALoader = {
    byId: {},
    byClass: {},
    byCategory: {},

    /**
     * Load all AA data files, validate, apply expansion gating,
     * and index by id / class / category.
     */
    async load() {
        console.log("EQRMSS | AA Loader | starting");
        const byId = {};
        const byClass = {};
        const byCategory = {};
        let scanned = 0, loaded = 0, gated = 0, invalid = 0;

        try {
            // Resolve the expansion manager once for this load; warn at most once
            // when gating is unavailable instead of once per AA file.
            const manager = await getExpansionManager();
            if (!manager && !_expansionUnavailableWarned) {
                _expansionUnavailableWarned = true;
                console.warn("EQRMSS | AA Loader | expansion manager unavailable, gating disabled");
            }

            // Load 19 consolidated files directly (2026-10-19)
            const loadConsolidated = async (name) => {
                const file = `${AA_BASE_PATH}/${name}.json`;
                let arr;
                try { arr = await fetchJson(file); }
                catch (err) {
                    console.warn(`EQRMSS | AA Loader | cannot fetch ${file}`, err.message);
                    invalid++;
                    return;
                }
                if (!Array.isArray(arr)) { invalid++; return; }
                for (const j of arr) {
                    scanned++;
                    if (!isValidAA(j)) { invalid++; continue; }
                    if (!isAAUnlocked(j, manager)) { gated++; continue; }
                    const id = j.id;
                    if (byId[id]) {
                        console.warn(`EQRMSS | AA Loader | duplicate id "${id}" in ${file}, keeping first`);
                        continue;
                    }
                    byId[id] = j;
                    loaded++;
                    const cat = j.system.category;
                    (byCategory[cat] = byCategory[cat] || []).push(j);
                    const classes = j.system.classes || [];
                    if (classes.length === 0) { (byClass.all = byClass.all || []).push(j); }
                    else { for (const cl of classes) { (byClass[cl] = byClass[cl] || []).push(j); } }
                }
            };
            await mapLimit(AA_FILES, 5, loadConsolidated);
        } catch (err) {
            console.error("EQRMSS | AA Loader | failed", err);
        }

        console.log(
            `EQRMSS | AA Loader | scanned=${scanned} loaded=${loaded} gated=${gated} invalid=${invalid}`
        );
        return this._store(byId, byClass, byCategory);
    },

    _store(byId, byClass, byCategory) {
        this.byId = byId;
        this.byClass = byClass;
        this.byCategory = byCategory;
        game.eqrmss = game.eqrmss || {};
        game.eqrmss.aas = { byId, byClass, byCategory };
        return game.eqrmss.aas;
    },

    /** Re-run load (e.g. after the active expansion changes). */
    async reload() {
        const aas = await this.load();
        Hooks.callAll("eqrmss:aasChanged", aas);
        return aas;
    },

    /** All AAs available to a class: "all" bucket + class-specific. */
    getForClass(classId) {
        const all = this.byClass.all || [];
        const specific = this.byClass[classId] || [];
        const seen = new Set();
        return [...all, ...specific].filter(aa => {
            if (seen.has(aa.id)) return false;
            seen.add(aa.id);
            return true;
        });
    },

    getById(id) {
        return this.byId[id] || null;
    },

    getByCategory(category) {
        return this.byCategory[category] || [];
    }
};

// Re-filter whenever the active expansion changes
Hooks.on("eqrmssExpansionChanged", () => {
    if (game?.eqrmss?.aas) EQRMSSAALoader.reload().catch(e => console.error("EQRMSS | AA reload failed", e));
});

export const AALoader = EQRMSSAALoader;
export async function load() { return EQRMSSAALoader.load(); }
export default EQRMSSAALoader;
