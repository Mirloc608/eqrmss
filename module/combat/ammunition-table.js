// Ammunition effects table (2026-10-10)
// Fixed lookup: ammunition construction → OB modifier.
// Procs use the same item-effect catalog as weapon procs
// (system.proc ID); they fire on critical hits only,
// via the shared proc engine.
//
// Matching: ammo item names are matched case-insensitively
// against the `match` keywords. First match wins.

export const AMMUNITION_TABLE = [
    {
        id: "crude",
        label: "Crude/Flint",
        match: ["crude", "flint", "stone"],
        ob: -5,
        proc: null
    },
    {
        id: "standard",
        label: "Standard/Wooden",
        match: ["standard", "wooden", "plain"],
        ob: 0,
        proc: null
    },
    {
        id: "iron",
        label: "Iron-tipped",
        match: ["iron"],
        ob: 5,
        proc: null
    },
    {
        id: "steel",
        label: "Steel-tipped",
        match: ["steel"],
        ob: 10,
        proc: null
    },
    {
        id: "barbed",
        label: "Barbed",
        match: ["barbed"],
        ob: 5,
        proc: null
    },
    {
        id: "bodkin",
        label: "Bodkin",
        match: ["bodkin"],
        ob: 10,
        proc: null
    },
    {
        id: "mithril",
        label: "Mithril",
        match: ["mithril", "mythril"],
        ob: 15,
        proc: null
    },
    // Custom proc entries: add new ammo types here with a proc
    // ID from the item-effect catalog (same as weapon procs).
    // Example:
    // {
    //     id: "fear",
    //     label: "Arrows of Fear",
    //     match: ["fear"],
    //     ob: 0,
    //     proc: "arrow-fear-proc"
    // },
];

/**
 * Find the ammunition table entry for an ammo item name.
 * @param {string} ammoName - The ammunition item's name.
 * @returns {object|null} The table entry, or null if no match.
 */
export function ammoTableEntryFor(ammoName) {
    if (!ammoName) return null;
    const lower = String(ammoName).toLowerCase();
    for (const entry of AMMUNITION_TABLE) {
        if (entry.match.some(kw => lower.includes(kw.toLowerCase()))) {
            return entry;
        }
    }
    return null;
}

/**
 * Get the OB modifier for an ammunition item.
 * @param {string} ammoName - The ammunition item's name.
 * @returns {number} The OB modifier (0 if no match).
 */
export function ammoOBFor(ammoName) {
    const entry = ammoTableEntryFor(ammoName);
    return entry ? (Number(entry.ob) || 0) : 0;
}
