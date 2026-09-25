// ============================================================
// EQRMSS Pet Manager Application
// ============================================================
//
// PURPOSE
// -------
// Provides the ApplicationV2 interface for managing pet actors
// associated with a specific owning actor.
//
// RESPONSIBILITIES
// ----------------
// - Extend Foundry's ApplicationV2 framework.
// - Track the actor whose pets are being managed.
// - Resolve pet actors through the EQRMSS ownerId flag.
// - Provide pet data to the application template.
// - Provide summon and dismiss operations for managed pets.
//
// NON-RESPONSIBILITIES
// --------------------
// - Does not create pet actors.
// - Does not determine pet ownership.
// - Does not implement pet AI or combat behavior.
// - Does not bypass Foundry document permissions.
// - Does not define pet actor data models.
//
// ARCHITECTURE
// ------------
// EQRMSS uses Foundry's global ApplicationV2 API exposed through
// foundry.applications.api. The system does not import the
// "foundry/applications/api" bare module specifier because that
// specifier is not resolvable in the current EQRMSS loading context.
//
// CONTEXT
// -------
// Foundry VTT V13 / V14.
// ApplicationV2 architecture.
// ============================================================

const { ApplicationV2 } = foundry.applications.api;

export class EQRMSSPetManager extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: "eqrmss-pet-manager",
        classes: ["eqrmss", "pet-manager"],
        title: "Pet Manager",
        position: {
            width: 500,
            height: "auto"
        }
    };

    constructor(actor) {
        super();
        this.actor = actor;
    }

    /**
     * Load pet actors linked to this player.
     *
     * @returns {Actor[]} Pet actors whose EQRMSS ownerId flag
     *                    matches the managed actor.
     */
    get pets() {
        return game.actors.filter(
            actor =>
                actor.type === "pet" &&
                actor.getFlag("eqrmss", "ownerId") === this.actor.id
        );
    }

    /**
     * Prepare template context.
     *
     * @returns {Promise<object>} Application rendering context.
     */
    async _prepareContext() {
        return {
            actor: this.actor,
            pets: this.pets
        };
    }

    /**
     * Application template parts.
     */
    static PARTS = {
        main: {
            template: "systems/eqrmss/templates/apps/pet-manager.html"
        }
    };

    /**
     * Summon / dismiss button handlers.
     *
     * NOTE:
     * This method is retained from the existing EQRMSS implementation.
     * If the pet manager is subsequently migrated fully to the
     * ApplicationV2 event-handling model, this should be converted
     * alongside the corresponding template rather than independently.
     *
     * @param {HTMLElement|jQuery} html Rendered application HTML.
     */
    activateListeners(html) {
        super.activateListeners(html);

        html.find(".pet-summon").click(ev => {
            const petId = ev.currentTarget.dataset.petId;
            this._summonPet(petId);
        });

        html.find(".pet-dismiss").click(ev => {
            const petId = ev.currentTarget.dataset.petId;
            this._dismissPet(petId);
        });
    }

    /**
     * Summon a pet.
     *
     * @param {string} petId Foundry Actor ID.
     */
    async _summonPet(petId) {
        const pet = game.actors.get(petId);
        if (!pet) return;

        await pet.update({
            "system.active": true
        });

        ui.notifications.info(`${pet.name} has been summoned.`);
    }

    /**
     * Dismiss a pet.
     *
     * @param {string} petId Foundry Actor ID.
     */
    async _dismissPet(petId) {
        const pet = game.actors.get(petId);
        if (!pet) return;

        await pet.update({
            "system.active": false
        });

        ui.notifications.info(`${pet.name} has been dismissed.`);
    }
}