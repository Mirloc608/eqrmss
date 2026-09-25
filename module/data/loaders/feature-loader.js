// ========================================================
// FEATURE LOADER CLASS
// ========================================================
export class FeatureLoader {
    // ========================================================
    // GET CLASSES
    // ========================================================
    static getClasses() {
        return Object.keys(CONFIG.EQRMSS?.classes ?? {});
    }

    // ========================================================
    // LOAD CLASS FEATURES
    // ========================================================
    static async loadClassFeatures(className) {
        const path = `systems/eqrmss/module/data/features/${className}.json`;
        const data = await this.loadJSON(path);

        if (!Array.isArray(data)) return [];

        return data.map(feature => ({
            id: feature.id ?? feature._id ?? `eqrmss-${className}-${foundry.utils.randomID()}`,
            _id: feature._id ?? feature.id ?? foundry.utils.randomID(),
            name: feature.name ?? "Unnamed Feature",
            type: "feature",
            system: {
                ...(feature.system ?? {}),
                class: className,
                source: feature.system?.source ?? "class_feature"
            }
        }));
    }

    // ========================================================
    // JSON (Suppresses 404 noise)
    // ========================================================
    static async loadJSON(path) {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                return null;
            }
            return await response.json();
        } catch (error) {
            console.error("EQRMSS | Feature JSON failed", path, error);
            return null;
        }
    }

    // ========================================================
    // ACCESSORS
    // ========================================================
    static getFeatures() {
        return CONFIG.EQRMSS?.features ?? [];
    }

    static getFeature(id) {
        return this.getFeatures().find(
            feature => feature.id === id || feature._id === id
        ) ?? null;
    }

    // (make sure you also have the static load() method here)
    static async load() {
        // ...implementation...
    }
}

// ========================================================
// PUBLIC API
// ========================================================
export async function loadFeatures() {
    return await FeatureLoader.load();
}

export default FeatureLoader;