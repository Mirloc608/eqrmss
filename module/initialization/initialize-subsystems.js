/**
 * EQ-RMSS Initialize Subsystems v4.0 - LAZY GEOGRAPHY
 * FIX: Don't load 5599 geography files at startup - only index
 * Geography zones loaded on-demand when scene viewed or via API
 */
console.log("EQRMSS | Initialize Subsystems v4.0 LAZY | Starting");

async function safeImport(paths) {
    const list = Array.isArray(paths) ? paths : [paths];
    for (const p of list) { try { const m = await import(p); return m; } catch {} }
    return null;
}

export async function initializeEQRMSS() {
    console.log("EQRMSS | Subsystems v4.0 LAZY | Initializing - geography will be index-only");
    let geo = null;
    if (globalThis.game?.eqrmss?.geography) geo = { EQRMSSGeography: globalThis.game.eqrmss.geography };
    else geo = await safeImport(["../data/geography/geography-loader.js", "../data/geography/geography-loader.v2.js"]);

    let sceneReg = await safeImport(["../data/geography/scene-registry.js"]);

    Hooks.once("ready", async () => {
        // LAZY: Only load index, not all zone files
        if (geo?.EQRMSSGeography) {
            try {
                if (!game.eqrmss?.geography?._stats?.worlds) {
                    console.log("EQRMSS | Subsystems v4.0 | Loading geography INDEX only (lazy)");
                    await geo.EQRMSSGeography.loadAll(); // v4.0 loadAll now only loads index
                }
                // Optional: Load zones for currently viewed scene only
                const currentScene = game.scenes?.viewed || game.scenes?.active;
                if (currentScene) {
                    const sceneName = currentScene.name?.toLowerCase() || "";
                    // Try to infer world/region/zone from scene name and load just that zone
                    console.log(`EQRMSS | Subsystems v4.0 | Current scene: ${currentScene.name} - lazy mode, not loading all zones`);
                    // Example: If scene name contains "bloodfields", load kuua/bloodfields/bloodfields-camps
                    // This is handled by scene-registry which will call loadZone on demand
                }
            } catch (e) { console.warn("EQRMSS | Geography index load failed", e); }
        }
        if (sceneReg?.EQRMSSSceneRegistry) {
            try {
                // Scene registry now also lazy - it uses index, not full data
                if (game.settings.get("eqrmss", "autoRegisterScenes") !== false) {
                    await sceneReg.EQRMSSSceneRegistry.registerAllScenes();
                }
            } catch (e) { console.warn("Scene registry failed", e); }
        }
        console.log("EQRMSS | Subsystems v4.0 LAZY | Ready - geography index loaded, zones on-demand");
    });
}

export const initializeEQRMSSSubsystems = initializeEQRMSS;
export const initializeSubsystems = initializeEQRMSS;
export default { initializeEQRMSS, initializeEQRMSSSubsystems, initializeSubsystems };

if (typeof window !== 'undefined') {
    window.initializeEQRMSS = initializeEQRMSS;
    window.initializeEQRMSSSubsystems = initializeEQRMSSSubsystems;
    window.EQRMSS_loadZone = async (world, region, zone) => {
        const geo = game.eqrmss?.geography;
        if (geo?.loadZone) return await geo.loadZone(world, region, zone);
        console.error("Geography not ready");
    };
}
