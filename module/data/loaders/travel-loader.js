// ============================================================
// Travel Loader (Sanctus Seru)
// ============================================================
//
// Loads region-level travel graph.
// Returns an array of travel edges.
//
// ============================================================

export class TravelLoader {
    static async load() {
        const base = "systems/eqrmss/module/data/geography/luclin/political/sanctus-seru/";
        const file = `${base}travel.json`;

        try {
            const json = await fetch(file).then(r => r.json());
            console.log("EQRMSS | Travel graph loaded:", json.travel.entries.length);
            return json.travel.entries;
        } catch (err) {
            console.error("EQRMSS | Failed to load travel graph", err);
            return [];
        }
    }
}

export default TravelLoader;
