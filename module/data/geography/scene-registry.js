/* ============================================================
 * EQRMSS Scene Registry
 * Auto‑creates scenes from geography data
 * ============================================================
 */

export const EQRMSSSceneRegistry = {

    async registerAllScenes() {
        console.log("EQRMSS | SceneRegistry | Starting scene registration");

        if (!game?.scenes) {
            console.warn("EQRMSS | SceneRegistry | game.scenes unavailable yet");
            return;
        }

        const geo = game.eqrmss?.geography?.data;
        if (!geo) {
            console.warn("EQRMSS | SceneRegistry | No geography loaded");
            return;
        }

        for (const continent of Object.keys(geo)) {
            for (const region of Object.keys(geo[continent])) {
                const regionData = geo[continent][region];
                if (!regionData || typeof regionData !== "object") continue;

                const regionScene = this._extractSceneFromContainer(regionData, region);
                if (regionScene) {
                    await this._registerSceneFromData(regionScene, `${continent} - ${region} (Region)`);
                }

                for (const zone of Object.keys(regionData)) {
                    const zoneData = regionData[zone];
                    if (typeof zoneData !== "object" || zoneData === null) continue;

                    // Skip manifest-like objects (world/region manifests) which contain regions/zones lists
                    if ((Array.isArray(zoneData.regions) && zoneData.regions.length > 0) ||
                        (Array.isArray(zoneData.zones) && zoneData.zones.length > 0) ||
                        (typeof zoneData.type === 'string' && ['world','region','zone','manifest'].includes(zoneData.type))) {
                        continue;
                    }

                    // Heuristic: if the object looks like a zone-package (contains many file keys whose
                    // values are objects) prefer extracting a nested scene; otherwise try to extract
                    // only when explicit scene key or scene-like props exist.
                    const isZonePackage = Object.values(zoneData).some(v => typeof v === 'object' && v !== null && !Array.isArray(v));

                    const sceneJson = this._extractSceneFromContainer(zoneData, zone);
                    if (sceneJson) {
                        await this._registerSceneFromData(sceneJson, `${continent} - ${region} - ${zone}`);
                    }
                }
            }
        }

        console.log("EQRMSS | SceneRegistry | Scene registration complete");
    },

    _extractSceneFromContainer(container, fallbackName) {
        if (!container || typeof container !== "object") return null;

        // Reject world/region manifests or other non-scene documents
        if (Array.isArray(container.regions) || Array.isArray(container.zones) ||
            (typeof container.type === 'string' && ['world','region','zone','manifest'].includes(container.type))) {
            return null;
        }

        // If explicit loader flag indicates this is a scene package, accept it
        const loaderFlag = container.eqrmss?.loader ?? container.flags?.eqrmss?.loader ?? null;
        const autoRegister = container.eqrmss?.autoRegister ?? container.flags?.eqrmss?.autoRegister ?? false;
        if (loaderFlag && ['scene','scene-v2'].includes(loaderFlag)) {
            return this._normalizeScenePayload(container, fallbackName);
        }

        // If the container already looks like a scene (has width/height/img/background/name), normalize it
        if (container.width || container.height || container.img || container.background || container.name) {
            return this._normalizeScenePayload(container, fallbackName);
        }

        // Otherwise, look for explicit nested scene entries (scene or *.scene)
        for (const [key, value] of Object.entries(container)) {
            if ((key === "scene" || key.endsWith(".scene")) && value && typeof value === "object") {
                return this._normalizeScenePayload(value, fallbackName, container);
            }
        }

        // No scene found
        return null;
    },


    _normalizeScenePayload(sceneJson, fallbackName, meta = {}) {
        if (!sceneJson || typeof sceneJson !== "object") return null;

        const nestedScene = sceneJson.scene && typeof sceneJson.scene === "object" ? sceneJson.scene : {};
        const sceneSource = Object.keys(nestedScene).length ? nestedScene : sceneJson;
        const metadata = meta && typeof meta === "object" ? meta : {};

        const normalized = {
            ...sceneSource,
            name: sceneJson.name ?? sceneSource.name ?? fallbackName ?? "EQRMSS Scene",
            type: sceneJson.type ?? sceneSource.type ?? "scene",
            active: sceneJson.active ?? sceneSource.active ?? false,
            navigation: sceneJson.navigation ?? sceneSource.navigation ?? true,
            width: sceneJson.width ?? sceneSource.width ?? sceneJson.scene?.width ?? 4000,
            height: sceneJson.height ?? sceneSource.height ?? sceneJson.scene?.height ?? 3000,
            grid: sceneJson.grid ?? sceneSource.grid ?? sceneJson.scene?.grid ?? 100,
            img: sceneJson.img ?? sceneSource.img ?? sceneJson.background ?? sceneSource.background ?? "",
            background: sceneJson.background ?? sceneSource.background ?? sceneJson.img ?? sceneSource.img ?? "",
            initialView: sceneJson.initialView ?? sceneSource.initialView ?? sceneJson.scene?.initialView ?? { x: 0, y: 0, scale: 1 }
        };

        const legacyEqrmss = sceneJson.eqrmss ?? metadata.eqrmss ?? {};
        const flagEqrmss = sceneJson.flags?.eqrmss ?? metadata.flags?.eqrmss ?? {};
        const eqrmssFlags = { ...legacyEqrmss, ...flagEqrmss };

        normalized.flags = {
            ...sceneJson.flags,
            ...(metadata.flags ?? {}),
            eqrmss: {
                ...legacyEqrmss,
                ...flagEqrmss,
                ...(metadata.region ? { region: metadata.region } : {}),
                ...(metadata.zone ? { zone: metadata.zone } : {}),
                ...(sceneJson.region ? { region: sceneJson.region } : {}),
                ...(sceneJson.zone ? { zone: sceneJson.zone } : {})
            }
        };

        if (sceneJson.flags && sceneJson.flags.eqrmss) {
            normalized.flags.eqrmss = { ...sceneJson.flags.eqrmss, ...normalized.flags.eqrmss };
        }

        if (!normalized.flags.eqrmss.zone && (sceneJson.region || metadata.region)) {
            normalized.flags.eqrmss.zone = sceneJson.region ?? metadata.region ?? fallbackName;
        }

        if (!normalized.flags.eqrmss.region && (sceneJson.region || metadata.region)) {
            normalized.flags.eqrmss.region = sceneJson.region ?? metadata.region ?? fallbackName;
        }

        if (sceneJson.id) normalized.id = sceneJson.id;
        if (sceneJson.region) normalized.region = sceneJson.region;
        if (sceneJson.zone) normalized.zone = sceneJson.zone;
        if (!normalized.img && normalized.background) normalized.img = normalized.background;
        if (!normalized.background && normalized.img) normalized.background = normalized.img;
        if (!normalized.flags.eqrmss || Object.keys(normalized.flags.eqrmss).length === 0) {
            delete normalized.flags.eqrmss;
        }

        // Ensure no embedded 'regions' or 'zones' arrays are passed to Scene.create() which would
        // fail Foundry's Scene schema validation (these belong in geography manifests, not scenes).
        if (normalized.regions) delete normalized.regions;
        if (normalized.zones) delete normalized.zones;

        return normalized;
    },


    async _registerSceneFromData(sceneJson, label) {
        if (!sceneJson) return;

        const normalized = this._normalizeScenePayload(sceneJson, label);
        if (!normalized) return;

        const zoneKey = normalized.flags?.eqrmss?.zone ?? normalized.eqrmss?.zone ?? normalized.region ?? label;
        const existing = game.scenes.find(s =>
            s.flags?.eqrmss?.zone === zoneKey ||
            s.id === normalized.id ||
            s.name === normalized.name
        );

        if (existing) {
            console.log(`EQRMSS | SceneRegistry | Scene already exists: ${label}`);
            return;
        }

        try {
            const created = await Scene.create(normalized);
            console.log(`EQRMSS | SceneRegistry | Created scene: ${label}`, created);
        } catch (err) {
            console.error(`EQRMSS | SceneRegistry | Failed to create scene: ${label}`, err);
        }
    }
};
