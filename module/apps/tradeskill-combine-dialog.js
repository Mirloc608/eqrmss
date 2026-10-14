// ============================================================
// EQRMSS — Tradeskill Combine Dialog
// ApplicationV2 — lists recipes for a tradeskill, checks
// inventory, runs the combine engine.
// ============================================================

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const BaseApplication = HandlebarsApplicationMixin(ApplicationV2);

import { attemptCombine, getRecipesForSkill } from "../tradeskills/tradeskill-engine.js";

export class TradeskillCombineDialog extends BaseApplication {

    static DEFAULT_OPTIONS = {
        id: "eqrmss-tradeskill-combine",
        classes: ["eqrmss", "tradeskill-combine"],
        window: {
            title: "Tradeskill Combine",
            icon: "fas fa-hammer",
            resizable: true
        },
        position: { width: 600, height: 500 },
        actions: {
            "combine": this.#onCombine
        }
    };

    static PARTS = {
        main: {
            template: "systems/eqrmss/templates/apps/tradeskill-combine-dialog.html"
        }
    };

    constructor(actor, skillId, options = {}) {
        super(options);
        this.actor = actor;
        this.skillId = skillId;
    }

    async _prepareContext(options) {
        const recipes = getRecipesForSkill(this.skillId);
        const skillName = this._getSkillName();

        // Check inventory for each recipe's components
        const recipesWithStatus = recipes.map(r => ({
            ...r,
            canCombine: this._hasComponents(r.components),
            componentStatus: r.components.map(c => ({
                ...c,
                have: this._countItem(c),
                need: c.qty,
                met: this._countItem(c) >= c.qty
            }))
        }));

        return {
            actor: this.actor,
            skillId: this.skillId,
            skillName,
            recipes: recipesWithStatus
        };
    }

    _getSkillName() {
        const names = {
            "skill-baking": "Baking",
            "skill-brewing": "Brewing",
            "skill-fletching": "Fletching",
            "skill-jewelcraft": "Jewelcrafting",
            "skill-pottery": "Pottery",
            "skill-smithing": "Smithing",
            "skill-tailoring": "Tailoring",
            "skill-tinkering": "Tinkering",
            "skill-alchemy": "Alchemy",
            "skill-poison": "Poison Making",
            "skill-research": "Research"
        };
        return names[this.skillId] ?? this.skillId;
    }

    _countItem(component) {
        // Count matching items in actor inventory
        // For materials, match by material id; for items, by item id
        let count = 0;
        for (const item of this.actor.items) {
            const sys = item.system ?? {};
            if (component.type === "material") {
                if (sys.material === component.id || item.name.toLowerCase().includes(component.id.toLowerCase())) {
                    count += Number(sys.quantity ?? 1);
                }
            } else {
                if (item.id === component.id || sys.template === component.id) {
                    count += Number(sys.quantity ?? 1);
                }
            }
        }
        return count;
    }

    _hasComponents(components) {
        return components.every(c => this._countItem(c) >= c.qty);
    }

    async _consumeComponents(components) {
        for (const c of components) {
            let remaining = c.qty;
            for (const item of [...this.actor.items]) {
                if (remaining <= 0) break;
                const sys = item.system ?? {};
                let match = false;
                if (c.type === "material") {
                    match = sys.material === c.id || item.name.toLowerCase().includes(c.id.toLowerCase());
                } else {
                    match = item.id === c.id || sys.template === c.id;
                }
                if (match) {
                    const qty = Number(sys.quantity ?? 1);
                    if (qty <= remaining) {
                        await item.delete();
                        remaining -= qty;
                    } else {
                        await item.update({ "system.quantity": qty - remaining });
                        remaining = 0;
                    }
                }
            }
        }
    }

    async _createProduct(product) {
        // Create the product item on the actor
        // For now, create a generic item; full template composition is future work
        const itemData = {
            name: product.template ?? "Crafted Item",
            type: "item",
            system: {
                quantity: product.qty ?? 1,
                description: `Crafted via tradeskill.`
            }
        };
        await this.actor.createEmbeddedDocuments("Item", [itemData]);
    }

    static async #onCombine(event, target) {
        const recipeId = target.dataset.recipeId;
        const dialog = this;
        const recipe = getRecipesForSkill(dialog.skillId).find(r => r.id === recipeId);
        if (!recipe) return;

        const skillEngine = game.eqrmss?.getSkillCheckEngine?.();
        if (!skillEngine) {
            ui.notifications.error("Skill engine not available.");
            return;
        }

        const result = await attemptCombine(
            dialog.actor,
            recipe,
            (c) => dialog._hasComponents(c),
            (c) => dialog._consumeComponents(c),
            (p) => dialog._createProduct(p),
            skillEngine
        );

        // Post result to chat
        const icon = result.success ? "✅" : result.critFail ? "💥" : "❌";
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: dialog.actor }),
            content: `<h2>${icon} ${recipe.name}</h2><p>${result.message}</p>
                ${result.roll ? `<p>Roll: ${result.roll.total} + bonus = ${result.total} vs ${recipe.difficulty}</p>` : ""}`
        });

        // Refresh the dialog
        dialog.render();
    }
}
