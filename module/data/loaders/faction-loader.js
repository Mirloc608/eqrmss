// ============================================================
// Faction Loader (Sanctus Seru)
// ============================================================
//
// Loads Seru-specific factions.
// Returns an array of faction objects.
//
// ============================================================

export class FactionLoader {
    static async load() {
        const base = "systems/eqrmss/module/data/geography/luclin/political/sanctus-seru/";
        const file = `${base}factions.json`;

        try {
            const json = await fetch(file).then(r => r.json());
            console.log("EQRMSS | Factions loaded:", json.factions.length);
            return json.factions;
        } catch (err) {
            console.error("EQRMSS | Failed to load factions", err);
            return [];
        }
    }
}

export default FactionLoader;
