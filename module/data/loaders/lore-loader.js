// ============================================================
// Lore Loader (Sanctus Seru)
// ============================================================
//
// Loads region-level lore.
// Returns a single lore object.
//
// ============================================================

export class LoreLoader {
    static async load() {
        const base = "systems/eqrmss/module/data/geography/luclin/political/sanctus-seru/";
        const file = `${base}lore.json`;

        try {
            const json = await fetch(file).then(r => r.json());
            console.log("EQRMSS | Lore loaded for region:", json.id);
            return json.lore;
        } catch (err) {
            console.error("EQRMSS | Failed to load lore", err);
            return {};
        }
    }
}

export default LoreLoader;
