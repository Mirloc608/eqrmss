/**
 * ============================================================
 * EQRMSS Item Loader
 * ============================================================
 * Loads item data from module/data/equipment/
 * Scans all .json files (earrings.json, rings.json, charms.json,
 * armor.json, weapons.json, etc.) and indexes by id / slot / level.
 *
 * To add new item types: drop a .json file in module/data/equipment/
 * No loader changes needed.
 *
 * Populates: game.eqrmss.items = { byId, bySlot, byLevel }
 *
 * Foundry VTT V13/V14 Compatible
 * ============================================================
 */

const ITEM_BASE_PATH = "systems/eqrmss/module/data/equipment";

async function fetchJson(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
    return r.json();
}

function isValidItem(j) {
    if (!j || typeof j !== "object") return false;
    if (typeof j.name !== "string" || !j.name) return false;
    if (j.type !== "item") return false;
    const s = j.system;
    if (!s || typeof s !== "object") return false;
    if (typeof s.slot !== "string" || !s.slot) return false;
    return true;
}

export const EQRMSSItemLoader = {
    byId: {},
    bySlot: {},
    byLevel: {},

    /**
     * Load all item data files, validate, and index by id / slot / level.
     * Scans module/data/equipment/ for .json files — new files are
     * picked up automatically, no loader changes needed.
     */
    async load() {
        console.log("EQRMSS | Item Loader | starting");
        const byId = {};
        const bySlot = {};
        const byLevel = {};
        let loaded = 0, invalid = 0, files = 0;

        try {
            const foundryPicker = (typeof foundry !== "undefined")
                ? foundry?.applications?.apps?.FilePicker?.implementation
                : undefined;
            const FilePickerImpl = foundryPicker ?? globalThis.FilePicker;
            if (!FilePickerImpl) {
                console.warn("EQRMSS | Item Loader | FilePicker unavailable, no items loaded");
                return this._store(byId, bySlot, byLevel);
            }

            const root = await FilePickerImpl.browse("data", ITEM_BASE_PATH).catch(() => ({ files: [] }));
            const jsonFiles = (root.files || []).filter(f => f.endsWith(".json"));

            for (const file of jsonFiles) {
                files++;
                let data;
                try {
                    data = await fetchJson(file);
                } catch {
                    console.warn(`EQRMSS | Item Loader | could not load ${file}`);
                    continue;
                }

                // Files are objects keyed by item name
                const items = Object.values(data);
                for (const item of items) {
                    if (!isValidItem(item)) {
                        invalid++;
                        continue;
                    }

                    // Generate ID from name if not present
                    const id = item.id || item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                    if (byId[id]) {
                        console.warn(`EQRMSS | Item Loader | duplicate id "${id}", keeping first`);
                        continue;
                    }

                    byId[id] = item;
                    loaded++;

                    const slot = item.system.slot;
                    (bySlot[slot] = bySlot[slot] || []).push(item);

                    const level = item.system.level || 1;
                    (byLevel[level] = byLevel[level] || []).push(item);
                }
            }
        } catch (err) {
            console.error("EQRMSS | Item Loader | failed:", err);
        }

        this._store(byId, bySlot, byLevel);
        console.log(`EQRMSS | Item Loader | files=${files} loaded=${loaded} invalid=${invalid}`);
        return this;
    },

    _store(byId, bySlot, byLevel) {
        this.byId = byId;
        this.bySlot = bySlot;
        this.byLevel = byLevel;

        if (typeof game !== "undefined") {
            game.eqrmss = game.eqrmss || {};
            game.eqrmss.items = this;
        }
        return this;
    },

    /**
     * Get an item by ID.
     */
    get(id) {
        return this.byId[id] || null;
    },

    /**
     * Get all items for a slot (ear, finger, charm, armor, weapon, etc.).
     */
    getBySlot(slot) {
        return this.bySlot[slot] || [];
    },

    /**
     * Get all items at or below a level.
     */
    getByLevel(maxLevel) {
        const result = [];
        for (const [level, items] of Object.entries(this.byLevel)) {
            if (Number(level) <= maxLevel) {
                result.push(...items);
            }
        }
        return result.sort((a, b) => (a.system.level || 1) - (b.system.level || 1));
    }
};
