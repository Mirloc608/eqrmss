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
 * Source priority (2026-10-25): a world JournalEntry flagged as the
 * item catalog (GM-editable in-game, one page per equipment group)
 * wins when present and parseable; then the data service when
 * configured; then the bundled files above.
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
    if (j.type !== "item" && j.type !== "container" && j.type !== "tool" && j.type !== "tradeskill" && j.type !== "instrument" && j.type !== "armor" && j.type !== "weapon") return false;
    const s = j.system;
    if (!s || typeof s !== "object") return false;
    // Containers aren't worn in a slot; only plain items require one.
    if (j.type === "item" && (typeof s.slot !== "string" || !s.slot)) return false;
    // Armor entries declare their worn slot and material — the catalog
    // picker derives AT from the material and the DB bonus from the
    // EQ AC above that AT (user ruling 2026-10-21).
    if (j.type === "armor" && (typeof s.slot !== "string" || !s.slot || typeof s.material !== "string" || !s.material)) return false;
    // Weapon entries declare their attack table and weapon-type slug.
    if (j.type === "weapon" && (typeof s.attackTable !== "string" || !s.attackTable || typeof s.weaponType !== "string" || !s.weaponType)) return false;
    return true;
}

// ---------------------------------------------------------------------------
// Catalog journal (user ruling 2026-10-25): the item catalog can live
// in a world JournalEntry the GM edits in-game. One text page per
// equipment group; each page holds a name-keyed JSON object inside a
// <pre> block. Foundry's rich-text editor may re-wrap edited content,
// so extraction prefers the <pre>, strips any tags, and unescapes
// entities before parsing.
// ---------------------------------------------------------------------------
export const CATALOG_JOURNAL_NAME = "EQRMSS Item Catalog";

export function findCatalogJournal() {
    try {
        return globalThis.game?.journal?.find?.(j => j?.flags?.eqrmss?.catalog === "items") ?? null;
    } catch { return null; }
}

function escapeHtmlText(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function journalPageText(html) {
    let text = String(html ?? "");
    const pre = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
    if (pre) text = pre[1];
    text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
    return text
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .trim();
}

export function parseJournalPage(page) {
    const data = JSON.parse(journalPageText(page?.text?.content ?? ""));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`page "${page?.name ?? "?"}" did not contain a JSON object`);
    }
    return data;
}

/** Seed grouping: one journal page per equipment group. */
export function catalogGroupFor(item) {
    const t = String(item?.type ?? "item");
    const slot = String(item?.system?.slot ?? "");
    if (t === "armor") return "Armor";
    if (t === "weapon") return "Weapons";
    if (t === "shield") return "Shields";
    if (t === "container") return "Containers";
    if (slot === "ear") return "Earrings";
    if (slot === "finger") return "Rings";
    if (slot === "charm") return "Charms";
    if (slot === "neck") return "Necklaces";
    if (slot === "wrist") return "Bracelets";
    if (slot === "face") return "Face";
    if (t === "jewelry") return "Jewelry";
    if (t === "instrument") return "Instruments";
    if (t === "tool" || t === "tradeskill") return "Tools & Tradeskill";
    return "Miscellaneous";
}

// ---------------------------------------------------------------------------
// Player guide (user ruling 2026-10-26): a second journal renders the
// catalog as EQ-style item cards in markdown — the player-facing view.
// The JSON journal above is storage; this one is presentation only.
// ---------------------------------------------------------------------------
export const PLAYER_CATALOG_JOURNAL_NAME = "EQRMSS Item Catalog — Player Guide";

export function findPlayerCatalogJournal() {
    try {
        return globalThis.game?.journal?.find?.(j => j?.flags?.eqrmss?.catalogDisplay === "items") ?? null;
    } catch { return null; }
}

const CARD_STATS = [["st", "ST"], ["co", "CO"], ["ag", "AG"], ["qu", "QU"], ["em", "EM"], ["me", "ME"], ["pr", "PR"]];
const CARD_RESISTS = [["fire", "FIRE"], ["cold", "COLD"], ["magic", "MAGIC"], ["poison", "POISON"], ["disease", "DISEASE"], ["corruption", "CORRUPTION"]];

function signed(n) { return n > 0 ? `+${n}` : `${n}`; }

/** Fallback effect label when the effects catalog has no name for an id. */
export function prettifyEffectId(id) {
    return String(id ?? "")
        .replace(/^(clicky|focus|worn)-/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim();
}

/**
 * Render one catalog entry as an EQ item-window card (markdown):
 * a heading for search/TOC plus a fenced plain-text block that
 * copy/pastes exactly as shown. Only fields the entry carries are
 * rendered.
 */
export function renderItemCard(item, effectName = prettifyEffectId) {
    const s = item?.system ?? {};
    const lines = [`### ${item?.name ?? "Unnamed Item"}`, "```"];
    if (item?.type === "weapon") {
        const skill = String(s.weaponType ?? "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()).replace(/ (To|Of|And) /g, m => m.toLowerCase());
        if (skill) lines.push(`Skill: ${skill}`);
        if (s.damage != null && s.damage !== "") lines.push(`DMG: ${s.damage}`);
        if (s.magicWeapon) lines.push("MAGIC ITEM");
    } else if (s.slot) {
        lines.push(`Slot: ${String(s.slot).toUpperCase()}`);
    }
    const vitals = [];
    if (s.defense) vitals.push(`AC: ${s.defense}`);
    if (s.hp) vitals.push(`HP: ${signed(Number(s.hp))}`);
    if (s.mana) vitals.push(`MANA: ${signed(Number(s.mana))}`);
    if (s.stamina) vitals.push(`END: ${signed(Number(s.stamina))}`);
    if (vitals.length) lines.push(vitals.join("   "));
    if (s.attackBonus) lines.push(`Attack Bonus: ${signed(Number(s.attackBonus))}`);
    const stats = CARD_STATS.filter(([k]) => Number(s.stats?.[k])).map(([k, l]) => `${l}: ${signed(Number(s.stats[k]))}`);
    if (stats.length) lines.push(stats.join("  "));
    const res = CARD_RESISTS.filter(([k]) => Number(s.resistances?.[k])).map(([k, l]) => `SV ${l}: ${signed(Number(s.resistances[k]))}`);
    if (res.length) lines.push(res.join("  "));
    if (s.triggeredEffect) lines.push(`Effect: ${effectName(s.triggeredEffect)} (clicky)`);
    if (s.wornEffect) lines.push(`Effect: ${effectName(s.wornEffect)} (worn)`);
    if (s.focusEffect) lines.push(`Focus: ${effectName(s.focusEffect)}`);
    if (item?.type === "container") {
        const cap = [];
        if (s.capacitySlots) cap.push(`${s.capacitySlots} slots`);
        if (s.capacityWeight) cap.push(`${s.capacityWeight} lb`);
        if (cap.length) lines.push(`Capacity: ${cap.join(" / ")}`);
        if (s.weightReduction) lines.push(`Weight Reduction: ${s.weightReduction}%`);
    }
    if (s.classes) lines.push(`Class: ${String(s.classes).toUpperCase()}`);
    if (s.races && String(s.races).toUpperCase() !== "ALL") lines.push(`Race: ${String(s.races).toUpperCase()}`);
    const tail = [];
    if (s.weight != null && s.weight !== "") tail.push(`WT: ${s.weight}`);
    if (Number(s.level) > 1) tail.push(`Required level of ${s.level}`);
    if (tail.length) lines.push(tail.join("   "));
    if (s.notes) lines.push(String(s.notes));
    if (s.description) lines.push(String(s.description));
    lines.push("```");
    return lines.join("\n");
}

/**
 * Group the catalog into player-guide pages: one markdown page per
 * equipment group, items sorted by name. Returns JournalEntryPage
 * create data (format 2 = markdown).
 */
export function buildPlayerCatalogPages(items, effectName = prettifyEffectId) {
    const groups = new Map();
    for (const item of items ?? []) {
        const g = catalogGroupFor(item);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(item);
    }
    return [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, groupItems]) => {
            const sorted = [...groupItems].sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
            const body = sorted.map(i => renderItemCard(i, effectName)).join("\n\n");
            return {
                name: label,
                type: "text",
                text: { content: `# ${label}\n\n${body}\n`, format: 2 }
            };
        });
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

        // Ingest one catalog object (keyed by item name) from any source.
        const ingest = (data) => {
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
                if (typeof slot === "string" && slot) (bySlot[slot] = bySlot[slot] || []).push(item);

                const level = item.system.level || 1;
                (byLevel[level] = byLevel[level] || []).push(item);
            }
        };

        // World journal (user ruling 2026-10-25): when a journal
        // flagged as the item catalog exists, it is the catalog's
        // source of truth. Any page that fails to parse aborts the
        // journal source entirely (never a partial catalog); the
        // data service and bundled files remain the fallbacks.
        const catalogJournal = findCatalogJournal();
        if (catalogJournal) {
            try {
                const pages = [...(catalogJournal.pages ?? [])]
                    .filter(p => p?.type === "text")
                    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
                if (!pages.length) throw new Error("catalog journal has no text pages");
                for (const page of pages) {
                    ingest(parseJournalPage(page));
                    files++;
                }
                this._store(byId, bySlot, byLevel);
                console.log(`EQRMSS | Item Loader | files=${files} loaded=${loaded} invalid=${invalid} source=journal`);
                return this;
            } catch (err) {
                console.warn(`EQRMSS | Item Loader | catalog journal unusable (${err.message}); falling back to data service / bundled files`);
                for (const k of Object.keys(byId)) delete byId[k];
                for (const k of Object.keys(bySlot)) delete bySlot[k];
                for (const k of Object.keys(byLevel)) delete byLevel[k];
                loaded = 0; invalid = 0; files = 0;
            }
        }

        // Optional data service: when the "dataServiceUrl" world setting
        // is configured, the service is the catalog source of truth and
        // the bundled files below are only a fallback.
        let serviceUrl = "";
        try { serviceUrl = game?.settings?.get("eqrmss", "dataServiceUrl") || ""; } catch { serviceUrl = ""; }
        if (serviceUrl) {
            try {
                const base = String(serviceUrl).replace(/\/+$/, "");
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 5000);
                const r = await fetch(`${base}/api/v1/items`, { signal: ctrl.signal });
                clearTimeout(timer);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const data = await r.json();
                if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("unexpected catalog shape");
                ingest(data);
                files = 1;
                this._store(byId, bySlot, byLevel);
                console.log(`EQRMSS | Item Loader | files=${files} loaded=${loaded} invalid=${invalid} source=service`);
                return this;
            } catch (err) {
                console.warn(`EQRMSS | Item Loader | data service unavailable (${err.message}); falling back to bundled files`);
                for (const k of Object.keys(byId)) delete byId[k];
                for (const k of Object.keys(bySlot)) delete bySlot[k];
                for (const k of Object.keys(byLevel)) delete byLevel[k];
                loaded = 0; invalid = 0; files = 0;
            }
        }

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
                ingest(data);
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
    },

    /** The world journal flagged as the item catalog, or null. */
    catalogJournal() {
        return findCatalogJournal();
    },

    /**
     * Seed (or re-seed) the catalog journal from the currently
     * loaded catalog: one text page per equipment group, each a
     * name-keyed JSON object in a <pre> block. Re-seeding replaces
     * all pages — in-journal edits are overwritten. GM only.
     * Returns { journal, groups, items }.
     */
    async seedCatalogJournal() {
        if (!globalThis.game?.user?.isGM) throw new Error("GM only");
        const items = Object.values(this.byId ?? {});
        if (!items.length) throw new Error("no catalog is loaded to seed from");
        const groups = new Map();
        for (const item of items) {
            const g = catalogGroupFor(item);
            if (!groups.has(g)) groups.set(g, {});
            groups.get(g)[item.name] = item;
        }
        const pages = [...groups.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([label, obj]) => ({
                name: label,
                type: "text",
                text: { content: `<pre>${escapeHtmlText(JSON.stringify(obj, null, 2))}</pre>`, format: 1 }
            }));
        let journal = findCatalogJournal();
        if (journal) {
            const ids = journal.pages.map(p => p.id);
            if (ids.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", ids);
            await journal.createEmbeddedDocuments("JournalEntryPage", pages);
        } else {
            journal = await globalThis.JournalEntry.create({
                name: CATALOG_JOURNAL_NAME,
                ownership: { default: 0 },
                flags: { eqrmss: { catalog: "items" } },
                pages
            });
        }
        console.log(`EQRMSS | Item Loader | catalog journal seeded: ${items.length} items in ${pages.length} pages`);
        return { journal, groups: pages.length, items: items.length };
    },

    /** The player-guide journal (markdown item cards), or null. */
    playerCatalogJournal() {
        return findPlayerCatalogJournal();
    },

    /**
     * Generate (or regenerate) the player-guide journal from the
     * currently loaded catalog: EQ-style markdown item cards, one
     * page per equipment group, readable by all players (Observer).
     * Regeneration replaces all pages. GM only.
     * Returns { journal, groups, items }.
     */
    async generatePlayerCatalog() {
        if (!globalThis.game?.user?.isGM) throw new Error("GM only");
        const items = Object.values(this.byId ?? {});
        if (!items.length) throw new Error("no catalog is loaded to render");
        let effectName = prettifyEffectId;
        try {
            const mod = await import("../item-effects/item-effect-loader.js");
            if (typeof mod?.getItemEffect === "function") {
                effectName = (id) => mod.getItemEffect(id)?.name ?? prettifyEffectId(id);
            }
        } catch { /* effect ids render prettified */ }
        const pages = buildPlayerCatalogPages(items, effectName);
        let journal = findPlayerCatalogJournal();
        if (journal) {
            const ids = journal.pages.map(p => p.id);
            if (ids.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", ids);
            await journal.createEmbeddedDocuments("JournalEntryPage", pages);
        } else {
            journal = await globalThis.JournalEntry.create({
                name: PLAYER_CATALOG_JOURNAL_NAME,
                ownership: { default: 2 },
                flags: { eqrmss: { catalogDisplay: "items" } },
                pages
            });
        }
        console.log(`EQRMSS | Item Loader | player catalog generated: ${items.length} items in ${pages.length} pages`);
        return { journal, groups: pages.length, items: items.length };
    }
};
