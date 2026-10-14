// ============================================================
// EQRMSS — Tradeskill Combine Dialog
// ApplicationV2 — lists recipes for a tradeskill, checks
// inventory, runs the combine engine.
// ============================================================

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const BaseApplication = HandlebarsApplicationMixin(ApplicationV2);

import { attemptCombine, getRecipesForSkill, canUseTradeskill } from "../tradeskills/tradeskill-engine.js";

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
        const access = canUseTradeskill(this.actor, this.skillId);

        // Check inventory for each recipe's components
        const recipesWithStatus = recipes.map(r => ({
            ...r,
            canCombine: access.allowed && this._hasComponents(r.components),
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
            recipes: recipesWithStatus,
            restricted: !access.allowed,
            restrictionReason: access.reason
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
            // Skip non-consumed components (e.g., reusable molds) - 2026-10-14
            if (c.consume === false) continue;
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

    async _createProduct(product, quality = "normal") {
        // Create the product item on the actor using composers (2026-10-14)
        // Quality from roll: pristine/normal/worn/tarnished/broken
        const productType = product.type ?? "item";
        
        if (productType === "weapon" && product.weaponTemplate) {
            // Weapon via composer: template + material + quality condition
            const weapons = game.eqrmss?.weapons;
            if (!weapons) {
                ui.notifications.error("Weapon data not loaded.");
                return;
            }
            try {
                const composed = weapons.compose(
                    product.weaponTemplate,
                    product.material ?? "steel",
                    quality
                );
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: composed.name,
                    type: "weapon",
                    system: {
                        weaponTemplate: composed.templateId,
                        material: composed.materialId,
                        condition: composed.conditionId,
                        type: composed.weaponType,
                        weight: composed.weight,
                        cost: composed.cost,
                        obMod: composed.obMod,
                        damageMod: composed.damageMod,
                        quantity: product.qty ?? 1,
                        description: `Crafted via tradeskill (${quality}).`
                    }
                }]);
                return;
            } catch (e) {
                ui.notifications.error(`Weapon compose failed: ${e.message}`);
                return;
            }
        }
        
        if (productType === "armor" && product.location) {
            // Armor via composer: location + category + material + quality condition
            const armor = game.eqrmss?.armor;
            if (!armor) {
                ui.notifications.error("Armor data not loaded.");
                return;
            }
            try {
                const composed = armor.compose(
                    product.location,
                    product.category ?? "cloth",
                    product.material ?? "cloth",
                    quality
                );
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: composed.name,
                    type: "armor",
                    system: {
                        location: composed.locationId,
                        category: composed.categoryId,
                        material: composed.materialId,
                        condition: composed.conditionId,
                        weight: composed.weight,
                        cost: composed.cost,
                        quantity: product.qty ?? 1,
                        description: `Crafted via tradeskill (${quality}).`
                    }
                }]);
                return;
            } catch (e) {
                ui.notifications.error(`Armor compose failed: ${e.message}`);
                return;
            }
        }
        
        // Generic item (default): consumables, etc.
        const itemData = {
            name: product.name ?? product.template ?? "Crafted Item",
            type: "item",
            system: {
                quantity: product.qty ?? 1,
                description: `Crafted via tradeskill (${quality}).`
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
            (p, q) => dialog._createProduct(p, q),
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
