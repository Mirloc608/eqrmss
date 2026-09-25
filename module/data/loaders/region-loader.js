// ============================================================
// Region Loader (Sanctus Seru)
// ============================================================
//
// Loads region-level metadata for Sanctus Seru.
// Returns a single region object.
//
// ============================================================

export class RegionLoader {
    static async load() {
        const base = "systems/eqrmss/module/data/geography/luclin/political/sanctus-seru/";
        const file = `${base}sanctus-seru-region.json`;

        try {
            const json = await fetch(file).then(r => r.json());
            console.log("EQRMSS | Region loaded:", json.id);
            return json;
        } catch (err) {
            console.error("EQRMSS | Failed to load region", err);
            return {};
        }
    }
}

export default RegionLoader;
