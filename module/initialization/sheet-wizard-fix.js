/**
 * EQRMSS Sheet+Wizard Fix v4.1 - NO DOUBLE PATCH
 * v4.0 was patching ApplicationV2.render which broke things
 * v4.1 only logs, doesn't patch core Foundry
 */
console.log("EQRMSS | Sheet+Wizard Fix v4.1 | Loading - safe mode (no core patch)");

let wizardOpenAttempts = 0;

Hooks.once("ready", () => {
    console.log("EQRMSS | Fix v4.1 | ready - checking data");
    console.log(`EQRMSS | Fix | Data at ready: races=${Object.keys(game.eqrmss?.races||{}).length}, classes=${Object.keys(game.eqrmss?.classes||{}).length}`);
    
    if (Object.keys(game.eqrmss?.races||{}).length === 0) {
        console.warn("EQRMSS | Fix | No races at ready hook - will retry on dataLoadersReady");
    }
    
    game.eqrmss = game.eqrmss || {};
    game.eqrmss.debugWizard = () => {
        console.log("=== EQRMSS WIZARD DEBUG ===");
        console.log("game.eqrmss.races:", Object.keys(game.eqrmss.races||{}).length, game.eqrmss.races);
        console.log("game.eqrmss.classes:", Object.keys(game.eqrmss.classes||{}).length);
        console.log("Wizard class:", globalThis.EQRMSSCharacterCreationWizard);
        console.log("Open wizard manually: game.eqrmss.openWizard()");
    };
    
    game.eqrmss.debugSheets = () => {
        console.log("=== EQRMSS SHEET DEBUG ===");
        console.log("Sheet classes:", CONFIG.Actor.sheetClasses['character']);
        for (const actor of game.actors) {
            console.log(`Actor ${actor.name}: sheet=${actor.sheet?.constructor.name}, rendered=${actor.sheet?.rendered}`);
        }
    };
});

Hooks.on("eqrmss:dataLoadersReady", (data) => {
    console.log("EQRMSS | Fix v4.1 | dataLoadersReady", {
        races: Object.keys(data.races||{}).length,
        classes: Object.keys(data.classes||{}).length
    });
});

Hooks.on("renderApplication", (app) => {
    const name = app.constructor?.name || "";
    if (name.toLowerCase().includes('wizard')) {
        wizardOpenAttempts++;
        console.log(`EQRMSS | Wizard render #${wizardOpenAttempts}: ${name}`, {
            dataRaces: Object.keys(game.eqrmss?.races||{}).length,
            dataClasses: Object.keys(game.eqrmss?.classes||{}).length,
            element: app.element?.constructor?.name,
            template: app.template
        });
    }
});

export const EQRMSSFix = {
    checkWizard: () => game.eqrmss?.debugWizard(),
    checkSheets: () => game.eqrmss?.debugSheets()
};

window.EQRMSSFix = EQRMSSFix;
