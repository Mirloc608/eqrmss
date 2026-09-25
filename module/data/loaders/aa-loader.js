/**
 * ============================================================
 * EQRMSS AA Loader
 * ============================================================
 * Loads Alternate Advancement data from module/data/aas/
 * (one JSON object per file, see module/data/aas/SCHEMA.md)
 * and applies expansion gating via EQRMSSExpansionManager.
 *
 * Populates: game.eqrmss.aas = { byId, byClass, byCategory }
 *
 * Foundry VTT V13/V14 Compatible
 * ============================================================
 */

const AA_BASE_PATH = "systems/eqrmss/module/data/aas";
const DEFAULT_AA_EXPANSION = "luclin";

// Manifest / non-data files never treated as AAs
const SKIP_FILES = new Set([
    "index.json",
    "aa-categories.json",
    "signature-dependencies.json",
    "schema.json",
    "manifest.json"
]);

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

function getExpansionManager() {
    return game?.eqrmss?.expansions || null;
}

/**
 * Expansion gate for a single AA. Returns true when the AA may be used
 * under the currently active expansion.
 */
function isAAUnlocked(aa) {
    const manager = getExpansionManager();
    if (!manager) {
        console.warn("EQRMSS | AA Loader | expansion manager unavailable, gating disabled");
        return true;
    }
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
            const foundryPicker = (typeof foundry !== "undefined")
                ? foundry?.applications?.apps?.FilePicker?.implementation
                : undefined;
            const FilePickerImpl = foundryPicker ?? globalThis.FilePicker;
            if (!FilePickerImpl) {
                console.warn("EQRMSS | AA Loader | FilePicker unavailable, no AAs loaded");
                return this._store(byId, byClass, byCategory);
            }

            const root = await FilePickerImpl.browse("data", AA_BASE_PATH).catch(() => ({ dirs: [], files: [] }));
            const dirs = [...(root.dirs || [])];

            const loadFile = async (file) => {
                const fname = file.split("/").pop();
                if (!fname.endsWith(".json") || SKIP_FILES.has(fname.toLowerCase())) return;
                scanned++;
                let j;
                try {
                    j = await fetchJson(file);
                } catch { invalid++; return; }
                if (!isValidAA(j)) { invalid++; return; }
                if (!isAAUnlocked(j)) { gated++; return; }
                const id = j.id;
                if (byId[id]) {
                    console.warn(`EQRMSS | AA Loader | duplicate id "${id}" in ${file}, keeping first`);
                    return;
                }
                byId[id] = j;
                loaded++;

                const cat = j.system.category;
                (byCategory[cat] = byCategory[cat] || []).push(j);

                const classes = j.system.classes || [];
                if (classes.length === 0) {
                    (byClass.all = byClass.all || []).push(j);
                } else {
                    for (const c of classes) {
                        (byClass[c] = byClass[c] || []).push(j);
                    }
                }
            };

            // Files directly under aas/ (none expected, but harmless)
            for (const f of (root.files || [])) await loadFile(f);

            // One directory per group: general, archetype, <class>, mercenary
            for (const dir of dirs) {
                try {
                    const sub = await FilePickerImpl.browse("data", dir);
                    for (const f of (sub.files || [])) await loadFile(f);
                } catch (err) {
                    console.warn(`EQRMSS | AA Loader | cannot browse ${dir}`, err.message);
                }
            }
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
