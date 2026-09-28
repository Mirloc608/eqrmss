// ============================================================
// Influence Loader (Sanctus Seru)
// ============================================================
//
// Loads influence tracks for factions.
// Returns an array of influence track objects.
//
// ============================================================

export class InfluenceLoader {
    static async load() {
        const base = "systems/eqrmss/module/data/geography/luclin/political/sanctus-seru/";
        const file = `${base}influence.json`;

        try {
            const json = await fetch(file).then(r => r.json());
            console.log("EQRMSS | Influence tracks loaded:", json.tracks.length);
            return json.tracks;
        } catch (err) {
            console.error("EQRMSS | Failed to load influence tracks", err);
            return [];
        }
    }
}

export default InfluenceLoader;
