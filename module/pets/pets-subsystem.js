// ============================================================
// EQRMSS Pets Subsystem
// Foundry VTT V13+ Compatible
// ============================================================

const MODULE_ID = "eqrmss";
const PETS_SETTINGS_NAMESPACE = "pets";

import { EQRMSSPetManager } from "./pet-manager.js";

/**
 * Register all pet-related settings.
 * Uses game.settings.register (V10+ API).
 */
function registerPetSettings() {
    console.log("EQRMSS | Pets subsystem | Registering settings");

    // Enable/disable pet features
    game.settings.register(MODULE_ID, `${PETS_SETTINGS_NAMESPACE}.enabled`, {
        name: "Enable Pet Features",
        hint: "Toggle the EQRMSS pet subsystem on or off.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    // Show pet sheet button on player sheet
    game.settings.register(MODULE_ID, `${PETS_SETTINGS_NAMESPACE}.showPetButton`, {
        name: "Show Pet Button on Player Sheet",
        hint: "If enabled, a pet management button will appear on the player sheet.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });

    // Allow players to control their own pets
    game.settings.register(MODULE_ID, `${PETS_SETTINGS_NAMESPACE}.playerControl`, {
        name: "Allow Player Control of Pets",
        hint: "If enabled, players can control their own pets directly.",
        scope: "world",
        config: true,
        type: Boolean,
        default: true
    });
}

/**
 * Link a pet to an owner via flags.
 */
export function linkPetToOwner(petActor, ownerActor) {
    return petActor.setFlag(MODULE_ID, "ownerId", ownerActor.id);
}

/**
 * Wire hooks and UI integrations for pets.
 */
function wirePetHooks() {
    console.log("EQRMSS | Pets subsystem | Wiring hooks");

    // Auto-link newly created pet actors to the user's character (if any)
    Hooks.on("createActor", async (actor) => {
        if (actor?.type !== "pet") return;

        console.log(`EQRMSS | Pets subsystem | Pet actor created: ${actor.name}`);

        const existingOwner = actor.getFlag(MODULE_ID, "ownerId");
        if (!existingOwner && game.user?.character) {
            await actor.setFlag(MODULE_ID, "ownerId", game.user.character.id);
            console.log(`EQRMSS | Pets subsystem | Linked pet ${actor.name} to owner ${game.user.character.name}`);
        }
    });

    // Add a pet management button to the player sheet header
    Hooks.on("renderActorSheet", (sheet, html, data) => {
        try {
            const enabled = game.settings.get(MODULE_ID, `${PETS_SETTINGS_NAMESPACE}.enabled`);
            const showButton = game.settings.get(MODULE_ID, `${PETS_SETTINGS_NAMESPACE}.showPetButton`);

            if (!enabled || !showButton) return;
            if (sheet.actor?.type !== "player") return;

            const header = html.find(".window-header, .sheet-header").first();
            if (!header.length) return;

            if (header.find(".eqrmss-pet-button").length) return;

            const btn = $(
                `<a class="eqrmss-pet-button" title="Manage Pets">
                    <i class="fas fa-paw"></i>
                 </a>`
            );

            btn.on("click", ev => {
                ev.preventDefault();
                console.log(`EQRMSS | Pets subsystem | Pet button clicked for ${sheet.actor.name}`);
                const mgr = new EQRMSSPetManager(sheet.actor);
                mgr.render(true);
            });

            header.append(btn);
        } catch (err) {
            console.error("EQRMSS | Pets subsystem | Error wiring pet button", err);
        }
    });

    // Optional: summon/dismiss integration via flags
    Hooks.on("updateActor", (actor, changes) => {
        if (actor.type !== "pet") return;

        if (changes.system?.active !== undefined) {
            const active = changes.system.active;
            console.log(`EQRMSS | Pets subsystem | Pet ${actor.name} is now ${active ? "active" : "inactive"}`);
        }
    });
}

/**
 * Initialize the pets subsystem.
 * Called from the EQRMSS Ready pipeline.
 */
export function initializePetsSubsystem() {
    try {
        console.log("EQRMSS | Pets subsystem initializing");

        registerPetSettings();
        wirePetHooks();

        console.log("EQRMSS | Pets subsystem initialized");
    } catch (err) {
        console.error("EQRMSS | Pets subsystem failed to initialize", err);
        ui.notifications.error("EQRMSS | Pets subsystem failed to initialize. See console for details.");
    }
}
