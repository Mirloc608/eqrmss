/**
 * ============================================================
 * EQ-RMSS Expansion Loader
 * ============================================================
 * Loads expansion data from module/data/expansions/*.json and
 * exposes the query API consumed by EQRMSSExpansionRegistry.
 *
 * Foundry VTT V13/V14 Compatible
 * ============================================================
 */

const BASE_PATH = "systems/eqrmss/module/data/expansions";

async function fetchJson(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
    return r.json();
}

/** Build id -> order map from the index (progression preferred). */
function orderMap(index) {
    const map = {};
    const prog = index?.progression;
    if (Array.isArray(prog)) {
        for (const p of prog) {
            if (p && p.id != null) map[p.id] = p.order ?? 0;
        }
    }
    const ids = index?.expansions;
    if (Array.isArray(ids)) {
        ids.forEach((id, i) => { if (!(id in map)) map[id] = i; });
    }
    return map;
}

function orderOf(index, id) {
    const map = orderMap(index);
    const o = map[id];
    return (typeof o === "number") ? o : -1;
}

export const EQRMSSExpansionLoader = {
    expansions: {},
    loaded: false,

    /**
     * Primary load path used by EQRMSSExpansionRegistry.initialize().
     * @returns {{index: object, expansions: object}} expansions keyed by id
     */
    async load() {
        const index = await fetchJson(`${BASE_PATH}/index.json`);
        const ids = Array.isArray(index.expansions) ? index.expansions : [];
        const expansions = {};
        for (const id of ids) {
            try {
                expansions[id] = await fetchJson(`${BASE_PATH}/${id}.json`);
            } catch (err) {
                console.warn(`EQRMSS | ExpansionLoader | missing data for "${id}"`, err.message);
            }
        }
        this.expansions = expansions;
        this.loaded = true;
        console.log(`EQRMSS | ExpansionLoader | loaded ${Object.keys(expansions).length} expansions`);
        return { index, expansions };
    },

    // ---- Registry query API ----

    getExpansionIds(index) {
        return Array.isArray(index?.expansions) ? [...index.expansions] : [];
    },

    getProgression(index) {
        return Array.isArray(index?.progression) ? [...index.progression] : [];
    },

    getExpansion(expansionsOrId, id) {
        // Registry calls getExpansion(expansions, id); legacy callers use getExpansion(id)
        if (id === undefined) return this.expansions[expansionsOrId] || null;
        return (expansionsOrId && expansionsOrId[id]) || null;
    },

    hasExpansion(expansions, id) {
        return !!(expansions && Object.prototype.hasOwnProperty.call(expansions, id));
    },

    getExpansionByOrder(index, order) {
        const map = orderMap(index);
        for (const [id, o] of Object.entries(map)) {
            if (o === order) return id;
        }
        return null;
    },

    getExpansionOrder(index, id) {
        return orderOf(index, id);
    },

    getExpansionWorlds(expansions, id) {
        return expansions?.[id]?.content?.worlds || [];
    },

    getExpansionContinents(expansions, id) {
        return expansions?.[id]?.content?.continents || [];
    },

    getExpansionRealms(expansions, id) {
        return expansions?.[id]?.content?.realms || [];
    },

    getExpansionRegions(expansions, id) {
        return expansions?.[id]?.content?.regions || [];
    },

    getExpansionRaces(expansions, id) {
        return expansions?.[id]?.content?.races || [];
    },

    getExpansionClasses(expansions, id) {
        return expansions?.[id]?.content?.classes || [];
    },

    getCurrentExpansion(index) {
        return index?.currentExpansion || null;
    },

    getDefaultExpansion(index) {
        return index?.defaultExpansion || null;
    },

    getMinimumExpansion(index) {
        return index?.minimumSupportedExpansion || null;
    },

    getMaximumExpansion(index) {
        return index?.maximumSupportedExpansion || null;
    },

    getMilestones(index) {
        return index?.milestones || {};
    },

    getMilestone(index, name) {
        return index?.milestones?.[name] ?? null;
    },

    getFirstAaExpansion(index) {
        return index?.unlocks?.aas || null;
    },

    getFirstAdvancedAaExpansion(index) {
        return index?.unlocks?.advancedAas || null;
    },

    getFirstPlayableRaceExpansion(index) {
        return index?.milestones?.firstPlayableRaceExpansion || null;
    },

    getFirstExpansionClassUnlock(index) {
        return index?.milestones?.firstExpansionClassUnlock || null;
    },

    getSecondExpansionClassUnlock(index) {
        return index?.milestones?.secondExpansionClassUnlock || null;
    },

    getExpansionRange(index, startId, endId) {
        const start = orderOf(index, startId);
        const end = orderOf(index, endId);
        if (start < 0 || end < 0) return [];
        const [lo, hi] = start <= end ? [start, end] : [end, start];
        return this.getExpansionIds(index).filter(id => {
            const o = orderOf(index, id);
            return o >= lo && o <= hi;
        });
    },

    isExpansionAtOrAfter(index, sourceId, targetId) {
        const s = orderOf(index, sourceId);
        const t = orderOf(index, targetId);
        if (s < 0 || t < 0) return false;
        return s >= t;
    },

    isExpansionBefore(index, sourceId, targetId) {
        const s = orderOf(index, sourceId);
        const t = orderOf(index, targetId);
        if (s < 0 || t < 0) return false;
        return s < t;
    },

    isPlaceholderExpansion(expansions, id) {
        const exp = expansions?.[id];
        return !!exp && exp.enabled === false;
    },

    // ---- Legacy / convenience API (kept for backward compatibility) ----

    async loadAll() {
        console.log("EQRMSS | ExpansionLoader | loadAll() -> load()");
        const { expansions } = await this.load();
        game.eqrmss = game.eqrmss || {};
        game.eqrmss.expansions = this;
        return expansions;
    },

    getExpansionById(id) {
        return this.expansions[id] || null;
    },

    getAllExpansions() {
        return Object.keys(this.expansions);
    },

    isLoaded() {
        return this.loaded;
    }
};

// Auto-expose for compatibility
if (typeof window !== 'undefined') {
    window.EQRMSSExpansionLoader = EQRMSSExpansionLoader;
}

export default EQRMSSExpansionLoader;
