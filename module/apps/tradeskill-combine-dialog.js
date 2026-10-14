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

    _onRender(context, options) {
        super._onRender?.(context, options);
        // Material dropdown change handler (2026-10-14)
        this.element.querySelectorAll(".material-select").forEach(select => {
            select.addEventListener("change", (ev) => {
                const recipeId = ev.target.dataset.recipeId;
                const materialId = ev.target.value;
                if (recipeId) {
                    this.selectedMaterials[recipeId] = materialId;
                    // Re-render to update have/need counts
                    this.render();
                }
            });
        });
        // Weapon dropdown change handler (2026-10-14)
        this.element.querySelectorAll(".weapon-select").forEach(select => {
            select.addEventListener("change", (ev) => {
                const recipeId = ev.target.dataset.recipeId;
                const weaponId = ev.target.value;
                if (recipeId) {
                    this.selectedWeapons[recipeId] = weaponId;
                    this.render();
                }
            });
        });
    }

    constructor(actor, skillId, options = {}) {
        super(options);
        this.actor = actor;
        this.skillId = skillId;
        this.selectedMaterials = {}; // recipeId -> materialId
        this.selectedWeapons = {}; // recipeId -> itemId (for weaponChoice)
    }

    // Get inventory weapons matching a condition (e.g., "rusty") - 2026-10-14
    _getWeaponsByCondition(condition) {
        const matches = [];
        for (const item of this.actor.items) {
            const sys = item.system ?? {};
            // Check if it's a weapon with matching condition
            if (sys.condition === condition || String(item.name ?? "").toLowerCase().startsWith(condition.toLowerCase())) {
                matches.push({ id: item.id, name: item.name });
            }
        }
        return matches;
    }

    _getSelectedWeapon(recipeId) {
        return this.selectedWeapons[recipeId] ?? null;
    }

    // Get available ore materials for dropdown (2026-10-14)
    _getOreMaterials() {
        try {
            const weapons = game.eqrmss?.weapons;
            if (!weapons || typeof weapons.options !== "function") return [];
            const opts = weapons.options();
            const materials = opts?.materials ?? [];
            // Filter to metal/ore materials (exclude cloth, leather, etc.)
            return materials
                .filter(m => {
                    const id = String(m.id ?? "").toLowerCase();
                    // Include ores and metals, exclude cloth/leather/silk
                    return id.includes("ore") || ["iron", "steel", "mithril", "velium", "acrylia", "titanium"].some(x => id.includes(x));
                })
                .map(m => ({ id: m.id, name: m.name }))
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) { return []; }
    }

    // Get selected material for a recipe (default to first available or recipe default)
    _getSelectedMaterial(recipeId, recipe) {
        if (this.selectedMaterials[recipeId]) return this.selectedMaterials[recipeId];
        // Default to recipe's defaultMaterial or first ore
        const prod = recipe.product ?? {};
        return prod.defaultMaterial ?? "iron";
    }

    async _prepareContext(options) {
        const recipes = getRecipesForSkill(this.skillId);
        const skillName = this._getSkillName();
        const access = canUseTradeskill(this.actor, this.skillId);

        // Check inventory for each recipe's components
        const oreMaterials = this._getOreMaterials();
        const recipesWithStatus = recipes.map(r => {
            const selectedMat = this._getSelectedMaterial(r.id, r);
            return {
                ...r,
                canCombine: access.allowed && this._hasComponents(r.components, r.id),
                componentStatus: r.components.map(c => {
                    const base = {
                        ...c,
                        have: this._countItem(c, r.id),
                        need: c.qty,
                        met: this._countItem(c, r.id) >= c.qty
                    };
                    // For materialChoice, add dropdown options
                    if (c.materialChoice) {
                        base.materialOptions = oreMaterials.map(m => ({
                            ...m,
                            selected: m.id === selectedMat,
                            have: this._countOreMaterial(m.id),
                            need: c.qty
                        }));
                    }
                    // For weaponChoice, add weapon dropdown options (2026-10-14)
                    if (c.weaponChoice) {
                        const condition = c.weaponChoice.condition ?? "rusty";
                        const weapons = this._getWeaponsByCondition(condition);
                        const selectedWeaponId = this._getSelectedWeapon(r.id);
                        base.weaponOptions = weapons.map(w => ({
                            ...w,
                            selected: w.id === selectedWeaponId || (!selectedWeaponId && w === weapons[0])
                        }));
                        // Auto-select first if none selected
                        if (weapons.length > 0 && !selectedWeaponId) {
                            this.selectedWeapons[r.id] = weapons[0].id;
                        }
                    }
                    return base;
                })
            };
        });

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

    // Count ore items matching a material ID (e.g., "iron" matches "Iron Ore")
    _countOreMaterial(materialId) {
        let count = 0;
        const matLower = String(materialId ?? "").toLowerCase().replace(/_ore$/, "");
        for (const item of this.actor.items) {
            const nameLower = String(item.name ?? "").toLowerCase();
            // Match if item name contains the material name (e.g., "iron ore" contains "iron")
            if (nameLower.includes(matLower)) {
                count += Number(item.system?.quantity ?? 1);
            }
        }
        return count;
    }

    _countItem(component, recipeId = null) {
        // For weaponChoice, count matching weapons (1 if any available)
        if (component.weaponChoice) {
            const condition = component.weaponChoice.condition ?? "rusty";
            return this._getWeaponsByCondition(condition).length > 0 ? 1 : 0;
        }
        // For materialChoice, count the selected material's ore
        if (component.materialChoice && recipeId) {
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
            const selectedMat = this._getSelectedMaterial(recipeId, recipe ?? {});
            return this._countOreMaterial(selectedMat);
        }
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
                const itemNameNorm = String(item.name ?? "").toLowerCase().trim();
                const compNameNorm = String(component.name ?? "").toLowerCase().trim();
                const compIdNorm = String(component.id ?? "").toLowerCase().replace(/-/g, " ").trim();
                if (item.id === component.id || sys.template === component.id ||
                    itemNameNorm === compNameNorm ||
                    itemNameNorm === compIdNorm ||
                    itemNameNorm.includes(compIdNorm) ||
                    itemNameNorm.includes(compNameNorm)) {
                    count += Number(sys.quantity ?? 1);
                }
            }
        }
        return count;
    }

    _hasComponents(components, recipeId = null) {
        return components.every(c => this._countItem(c, recipeId) >= c.qty);
    }

    // Consume ore items matching a material ID
    async _consumeOreMaterial(materialId, qty) {
        let remaining = qty;
        const matLower = String(materialId ?? "").toLowerCase().replace(/_ore$/, "");
        for (const item of [...this.actor.items]) {
            if (remaining <= 0) break;
            const nameLower = String(item.name ?? "").toLowerCase();
            if (nameLower.includes(matLower)) {
                const itemQty = Number(item.system?.quantity ?? 1);
                if (itemQty <= remaining) {
                    await item.delete();
                    remaining -= itemQty;
                } else {
                    await item.update({ "system.quantity": itemQty - remaining });
                    remaining = 0;
                }
            }
        }
    }

    async _consumeComponents(components, recipeId = null) {
        for (const c of components) {
            // Skip non-consumed components (e.g., reusable molds) - 2026-10-14
            if (c.consume === false) continue;
            // Skip weaponChoice (transformed, not consumed) - 2026-10-14
            if (c.weaponChoice) continue;
            // For materialChoice, consume the selected material's ore
            if (c.materialChoice && recipeId) {
                const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
                const selectedMat = this._getSelectedMaterial(recipeId, recipe ?? {});
                await this._consumeOreMaterial(selectedMat, c.qty);
                continue;
            }
            let remaining = c.qty;
            for (const item of [...this.actor.items]) {
                if (remaining <= 0) break;
                const sys = item.system ?? {};
                let match = false;
                if (c.type === "material") {
                    match = sys.material === c.id || item.name.toLowerCase().includes(c.id.toLowerCase());
                } else {
                    const itemNameNorm = String(item.name ?? "").toLowerCase().trim();
                    const compNameNorm = String(c.name ?? "").toLowerCase().trim();
                    const compIdNorm = String(c.id ?? "").toLowerCase().replace(/-/g, " ").trim();
                    match = item.id === c.id || sys.template === c.id ||
                        itemNameNorm === compNameNorm ||
                        itemNameNorm === compIdNorm ||
                        itemNameNorm.includes(compIdNorm) ||
                        itemNameNorm.includes(compNameNorm);
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

    async _createProduct(product, quality = "normal", recipeId = null) {
        // Handle polish product type (2026-10-14): transform weapon condition
        if (product.type === "polish" && recipeId) {
            const weaponId = this._getSelectedWeapon(recipeId);
            if (!weaponId) {
                ui.notifications.error("No weapon selected.");
                return;
            }
            const weapon = this.actor.items.get(weaponId);
            if (!weapon) {
                ui.notifications.error("Weapon not found.");
                return;
            }
            const fromCond = product.fromCondition ?? "rusty";
            const toCond = product.toCondition ?? "normal";
            // Update condition and name
            const newName = String(weapon.name ?? "").replace(new RegExp(`^${fromCond}\s+`, "i"), "");
            await weapon.update({
                name: newName,
                "system.condition": toCond
            });
            ui.notifications.info(`Polished ${weapon.name} to ${newName}.`);
            return;
        }
        // Use selected material from dropdown if available (2026-10-14)
        let materialId = product.material ?? product.defaultMaterial ?? "steel";
        if (recipeId) {
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
            if (recipe) {
                const selected = this._getSelectedMaterial(recipeId, recipe);
                // Only override if recipe has materialChoice
                if (recipe.components?.some(c => c.materialChoice)) {
                    materialId = selected;
                }
            }
        }
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
                    materialId,
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
                    materialId,
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
            (c) => dialog._hasComponents(c, recipeId),
            (c) => dialog._consumeComponents(c, recipeId),
            (p, q) => dialog._createProduct(p, q, recipeId),
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
