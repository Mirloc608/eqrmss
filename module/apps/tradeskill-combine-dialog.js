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
                const componentId = ev.target.dataset.componentId;
                const materialId = ev.target.value;
                if (recipeId) {
                    const key = componentId ? `${recipeId}:${componentId}` : recipeId;
                    this.selectedMaterials[key] = materialId;
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
        // Bow item dropdown change handler (2026-10-15): bows, bowstaves, bowstrings, arrow shafts
        this.element.querySelectorAll(".bowitem-select").forEach(select => {
            select.addEventListener("change", (ev) => {
                const recipeId = ev.target.dataset.recipeId;
                const kind = ev.target.dataset.kind; // "bow", "bowstave", "bowstring", "shaft"
                const itemId = ev.target.value;
                if (recipeId && kind) {
                    this._setSelectedBowItem(recipeId, kind, itemId);
                    this.render();
                }
            });
        });
    }

    constructor(actor, skillId, options = {}) {
        super(options);
        this.actor = actor;
        this.skillId = skillId;
        this.selectedMaterials = {}; // recipeId:componentId -> materialId
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

    // Bow inventory picks (2026-10-15): bows, bowstaves, bowstrings from actor inventory
    _getBows() {
        const matches = [];
        for (const item of this.actor.items) {
            const sys = item.system ?? {};
            if (sys.bowWood || sys.bowType || String(item.name ?? "").toLowerCase().includes("bow")) {
                // Exclude bowstaves and bowstrings (they're components, not finished bows)
                const n = String(item.name ?? "").toLowerCase();
                if (n.includes("bowstave") || n.includes("bowstring")) continue;
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    _getBowstaves() {
        const matches = [];
        for (const item of this.actor.items) {
            const sys = item.system ?? {};
            if (sys.bowWood || String(item.name ?? "").toLowerCase().includes("bowstave")) {
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    _getBowstrings() {
        const matches = [];
        for (const item of this.actor.items) {
            const sys = item.system ?? {};
            if (sys.bowString || String(item.name ?? "").toLowerCase().includes("bowstring")) {
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    _getSelectedBowItem(recipeId, kind) {
        // kind: "bow", "bowstave", "bowstring"
        const key = `${recipeId}:${kind}`;
        if (!this.selectedBowItems) this.selectedBowItems = {};
        return this.selectedBowItems[key] ?? null;
    }

    // Arrow shafts from inventory (2026-10-15)
    _getArrowShafts() {
        const matches = [];
        for (const item of this.actor.items) {
            const sys = item.system ?? {};
            if (sys.arrowShaft || String(item.name ?? "").toLowerCase().includes("arrow shaft")) {
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    // Haft pieces from inventory (2026-10-15): filter by piece type if specified
    _getHafts(pieceType = null) {
        const matches = [];
        for (const item of this.actor.items) {
            const sys = item.system ?? {};
            if (sys.haftPiece) {
                if (!pieceType || sys.haftPiece === pieceType) {
                    matches.push({ id: item.id, name: item.name, item });
                }
            }
        }
        return matches;
    }

    // Wood shields from inventory (2026-10-15)
    _getWoodShields() {
        const matches = [];
        for (const item of this.actor.items) {
            const sys = item.system ?? {};
            if (sys.woodShield || (String(item.name ?? "").toLowerCase().includes("wood") && String(item.name ?? "").toLowerCase().includes("shield"))) {
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    // Crossbow components from inventory (2026-10-15)
    _getCrossbowStocks() {
        const matches = [];
        for (const item of this.actor.items) {
            if (item.system?.crossbowStock) matches.push({ id: item.id, name: item.name, item });
        }
        return matches;
    }

    _getBowCams() {
        const matches = [];
        for (const item of this.actor.items) {
            const n = String(item.name ?? "").toLowerCase();
            if (n.includes("bow cam") || n.includes("cam")) matches.push({ id: item.id, name: item.name, item });
        }
        return matches;
    }

    _getTriggers() {
        const matches = [];
        for (const item of this.actor.items) {
            if (item.system?.crossbowTrigger || String(item.name ?? "").toLowerCase().includes("trigger")) {
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    _getLimbs() {
        const matches = [];
        for (const item of this.actor.items) {
            if (item.system?.crossbowLimbs || String(item.name ?? "").toLowerCase().includes("limbs")) {
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    _getRisers() {
        const matches = [];
        for (const item of this.actor.items) {
            if (item.system?.crossbowRiser || String(item.name ?? "").toLowerCase().includes("riser")) {
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    _getGrooves() {
        const matches = [];
        for (const item of this.actor.items) {
            if (item.system?.crossbowGroove || String(item.name ?? "").toLowerCase().includes("groove")) {
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    // Fletchings from inventory (2026-10-15)
    _getFletchings() {
        const matches = [];
        for (const item of this.actor.items) {
            if (item.system?.fletchId || String(item.name ?? "").toLowerCase().includes("fletching") || String(item.name ?? "").toLowerCase().includes("vane")) {
                matches.push({ id: item.id, name: item.name, item });
            }
        }
        return matches;
    }

    _setSelectedBowItem(recipeId, kind, itemId) {
        if (!this.selectedBowItems) this.selectedBowItems = {};
        this.selectedBowItems[`${recipeId}:${kind}`] = itemId;
    }

    // Get available materials for dropdown (2026-10-14)
    // materialType: "ore" (default), "cloth", "leather"
    _getOreMaterials(materialType = "ore") {
        try {
            if (materialType === "metal") {
                // Jewelcraft metals (bars) - regular and enchanted
                // Full precious metals: Silver, Gold, Electrum, Platinum, Cazicite, Palladium, Velium
                return [
                    { id: "silver-bar", name: "Silver Bar" },
                    { id: "electrum-bar", name: "Electrum Bar" },
                    { id: "gold-bar", name: "Gold Bar" },
                    { id: "platinum-bar", name: "Platinum Bar" },
                    { id: "cazicite-bar", name: "Cazicite Bar" },
                    { id: "palladium-bar", name: "Palladium Bar" },
                    { id: "velium-bar", name: "Velium Bar" },
                    { id: "enchanted-silver-bar", name: "Enchanted Silver Bar" },
                    { id: "enchanted-electrum-bar", name: "Enchanted Electrum Bar" },
                    { id: "enchanted-gold-bar", name: "Enchanted Gold Bar" },
                    { id: "enchanted-platinum-bar", name: "Enchanted Platinum Bar" },
                    { id: "enchanted-cazicite-bar", name: "Enchanted Cazicite Bar" },
                    { id: "enchanted-palladium-bar", name: "Enchanted Palladium Bar" },
                    { id: "enchanted-velium-bar", name: "Enchanted Velium Bar" },
                ];
            }
            if (materialType === "gem") {
                // Jewelcraft gems - standard and imbued (deity-specific)
                return [
                    { id: "malachite", name: "Malachite" },
                    { id: "turquoise", name: "Turquoise" },
                    { id: "lapis-lazuli", name: "Lapis Lazuli" },
                    { id: "hematite", name: "Hematite" },
                    { id: "cat-s-eye-agate", name: "Cat Eye Agate" },
                    { id: "jasper", name: "Jasper" },
                    { id: "amber", name: "Amber" },
                    { id: "jade", name: "Jade" },
                    { id: "topaz", name: "Topaz" },
                    { id: "peridot", name: "Peridot" },
                    { id: "sapphire", name: "Sapphire" },
                    { id: "ruby", name: "Ruby" },
                    { id: "emerald", name: "Emerald" },
                    { id: "diamond", name: "Diamond" },
                    { id: "opal", name: "Opal" },
                    { id: "fire-opal", name: "Fire Opal" },
                    { id: "black-pearl", name: "Black Pearl" },
                    { id: "black-sapphire", name: "Black Sapphire" },
                    { id: "star-rose-quartz", name: "Star Rose Quartz" },
                    { id: "plains-pebble", name: "Plains Pebble" },
                    { id: "ivory", name: "Ivory" },
                    // Imbued gems (deity-specific, for imbued jewelry)
                    { id: "imbued-black-sapphire-bertoxxulous", name: "Imbued Black Sapphire (Bertoxxulous)" },
                    { id: "imbued-ruby-brell", name: "Imbued Ruby (Brell Serilis)" },
                    { id: "imbued-peridot-bristlebane", name: "Imbued Peridot (Bristlebane)" },
                    { id: "imbued-amber-cazic", name: "Imbued Amber (Cazic-Thule)" },
                    { id: "imbued-star-rose-quartz-erollisi", name: "Imbued Star Rose Quartz (Erollisi Marr)" },
                    { id: "imbued-sapphire-innorruk", name: "Imbued Sapphire (Innorruk)" },
                    { id: "imbued-plains-pebble-karana", name: "Imbued Plains Pebble (Karana)" },
                    { id: "imbued-diamond-mithaniel", name: "Imbued Diamond (Mithaniel Marr)" },
                    { id: "imbued-black-pearl-prexus", name: "Imbued Black Pearl (Prexus)" },
                    { id: "imbued-topaz-quellious", name: "Imbued Topaz (Quellious)" },
                    { id: "imbued-jade-rallos", name: "Imbued Jade (Rallos Zek)" },
                    { id: "imbued-opal-rodcet", name: "Imbued Opal (Rodcet Nife)" },
                    { id: "imbued-fire-opal-solusek", name: "Imbued Fire Opal (Solusek Ro)" },
                    { id: "imbued-ivory-tribunal", name: "Imbued Ivory (The Tribunal)" },
                    { id: "imbued-emerald-tunare", name: "Imbued Emerald (Tunare)" },
                ];
            }
            if (materialType === "wood") {
                // Bow woods (2026-10-15): from bow composer data
                const bows = game.eqrmss?.bows;
                if (!bows || typeof bows.listWoods !== "function") return [];
                return bows.listWoods()
                    .map(w => ({ id: w.id, name: `${w.name} (T${w.tier})` }))
                    .sort((a, b) => a.name.localeCompare(b.name));
            }
            if (materialType === "bowstring") {
                // Bowstring materials (2026-10-15): from bow composer data
                const bows = game.eqrmss?.bows;
                if (!bows || typeof bows.listStrings !== "function") return [];
                return bows.listStrings()
                    .map(s => ({ id: s.id, name: `${s.name} (T${s.tier}, +${s.obBonus} OB)` }))
                    .sort((a, b) => a.name.localeCompare(b.name));
            }
            if (materialType === "bowtype") {
                // Bow types (2026-10-15): filtered by class via component.bowClass
                const bows = game.eqrmss?.bows;
                if (!bows || typeof bows.listTypes !== "function") return [];
                // Note: class filtering happens in _prepareContext where component is available
                return bows.listTypes()
                    .map(t => ({ id: t.id, name: t.name }));
            }
            if (materialType === "arrowhead") {
                // Arrow heads (2026-10-15)
                const arrows = game.eqrmss?.arrows;
                if (!arrows || typeof arrows.listHeads !== "function") return [];
                return arrows.listHeads()
                    .map(h => ({ id: h.id, name: `${h.name} (+${h.damageBonus} dmg)` }));
            }
            if (materialType === "arrowfletch") {
                // Arrow fletchings (2026-10-15)
                const arrows = game.eqrmss?.arrows;
                if (!arrows || typeof arrows.listFletches !== "function") return [];
                return arrows.listFletches()
                    .map(f => ({ id: f.id, name: `Class ${f.class}: ${f.name}` }));
            }
            if (materialType === "arrownock") {
                // Arrow nocks (2026-10-15)
                const arrows = game.eqrmss?.arrows;
                if (!arrows || typeof arrows.listNocks !== "function") return [];
                return arrows.listNocks()
                    .map(n => ({ id: n.id, name: `${n.name} (+${n.rangeMod} range)` }));
            }
            if (materialType === "dartmaterial") {
                // Dart materials (2026-10-15): single-component darts
                const darts = game.eqrmss?.darts;
                if (!darts || typeof darts.list !== "function") return [];
                return darts.list()
                    .map(m => ({ id: m.id, name: m.poison ? `${m.name} (+poison)` : m.name }));
            }
            if (materialType === "haftpiece") {
                // Haft pieces (2026-10-15): wooden hafts/shafts/staves
                const hafts = game.eqrmss?.hafts;
                if (!hafts || typeof hafts.list !== "function") return [];
                return hafts.list()
                    .map(p => ({ id: p.id, name: p.usable ? `${p.name} (usable)` : p.name }));
            }
            if (materialType === "crossbowtype") {
                // Crossbow types (2026-10-15): Hand, Light, Heavy, cammed variants
                const xbows = game.eqrmss?.crossbows;
                if (!xbows || typeof xbows.list !== "function") return [];
                return xbows.list()
                    .map(t => ({ id: t.id, name: t.name }));
            }
            if (materialType === "cloth" || materialType === "leather") {
                // Armor materials for tailoring
                const armor = game.eqrmss?.armor;
                if (!armor || typeof armor.options !== "function") return [];
                const materials = armor.options()?.materials ?? [];
                const keywords = materialType === "cloth"
                    ? ["cloth", "silk"]
                    : ["leather", "hide", "rawhide"];
                return materials
                    .filter(m => {
                        const id = String(m.id ?? "").toLowerCase();
                        return keywords.some(k => id.includes(k));
                    })
                    .map(m => ({ id: m.id, name: m.name }))
                    .sort((a, b) => a.name.localeCompare(b.name));
            }
            // Default: weapon ores for smithing
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
    _getSelectedMaterial(recipeId, recipe, componentId = null) {
        const key = componentId ? `${recipeId}:${componentId}` : recipeId;
        if (this.selectedMaterials[key]) return this.selectedMaterials[key];
        // Default to recipe's defaultMaterial, or first material of the component's type
        const prod = recipe.product ?? {};
        if (prod.defaultMaterial) return prod.defaultMaterial;
        // For per-component, find the component and default to first of its type
        if (componentId && recipe.components) {
            const comp = recipe.components.find(c => c.id === componentId);
            if (comp?.materialChoice) {
                const matType = comp.materialType ?? "ore";
                const materials = this._getOreMaterials(matType);
                if (materials.length > 0) return materials[0].id;
            }
        }
        return "iron";
    }

    async _prepareContext(options) {
        const recipes = getRecipesForSkill(this.skillId);
        const skillName = this._getSkillName();
        const access = canUseTradeskill(this.actor, this.skillId);

        // Check inventory for each recipe's components
        // Note: oreMaterials is per-component now (materialType varies)
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
                        const matType = c.materialType ?? "ore";
                        const compMaterials = this._getOreMaterials(matType);
                        const compSelectedMat = this._getSelectedMaterial(r.id, r, c.id);
                        base.materialOptions = compMaterials.map(m => ({
                            ...m,
                            selected: m.id === compSelectedMat,
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
                    // For bowChoice/bowstaveChoice/bowstringChoice, add inventory dropdowns (2026-10-15)
                    if (c.bowChoice || c.bowstaveChoice || c.bowstringChoice) {
                        const kind = c.bowChoice ? "bow" : c.bowstaveChoice ? "bowstave" : "bowstring";
                        const items = kind === "bow" ? this._getBows() : kind === "bowstave" ? this._getBowstaves() : this._getBowstrings();
                        const selectedId = this._getSelectedBowItem(r.id, kind);
                        base.bowItemOptions = items.map(w => ({
                            ...w,
                            selected: w.id === selectedId || (!selectedId && w === items[0])
                        }));
                        base.bowItemKind = kind;
                        if (items.length > 0 && !selectedId) {
                            this._setSelectedBowItem(r.id, kind, items[0].id);
                        }
                    }
                    // For shaftChoice, add arrow shaft inventory dropdown (2026-10-15)
                    if (c.shaftChoice) {
                        const items = this._getArrowShafts();
                        const selectedId = this._getSelectedBowItem(r.id, "shaft");
                        base.bowItemOptions = items.map(w => ({
                            ...w,
                            selected: w.id === selectedId || (!selectedId && w === items[0])
                        }));
                        base.bowItemKind = "shaft";
                        if (items.length > 0 && !selectedId) {
                            this._setSelectedBowItem(r.id, "shaft", items[0].id);
                        }
                    }
                    // For haftChoice, add haft inventory dropdown filtered by piece type (2026-10-15)
                    if (c.haftChoice) {
                        const items = this._getHafts(c.haftChoice);
                        const kind = `haft-${c.haftChoice}`;
                        const selectedId = this._getSelectedBowItem(r.id, kind);
                        base.bowItemOptions = items.map(w => ({
                            ...w,
                            selected: w.id === selectedId || (!selectedId && w === items[0])
                        }));
                        base.bowItemKind = kind;
                        if (items.length > 0 && !selectedId) {
                            this._setSelectedBowItem(r.id, kind, items[0].id);
                        }
                    }
                    // For shieldChoice, add wood shield inventory dropdown (2026-10-15)
                    if (c.shieldChoice) {
                        const items = this._getWoodShields();
                        const selectedId = this._getSelectedBowItem(r.id, "shield");
                        base.bowItemOptions = items.map(w => ({
                            ...w,
                            selected: w.id === selectedId || (!selectedId && w === items[0])
                        }));
                        base.bowItemKind = "shield";
                        if (items.length > 0 && !selectedId) {
                            this._setSelectedBowItem(r.id, "shield", items[0].id);
                        }
                    }
                    // Crossbow component choices (2026-10-15)
                    const xbowKinds = {
                        stockChoice: ["stock", "_getCrossbowStocks"],
                        triggerChoice: ["trigger", "_getTriggers"],
                        limbsChoice: ["limbs", "_getLimbs"],
                        riserChoice: ["riser", "_getRisers"],
                        grooveChoice: ["groove", "_getGrooves"],
                        fletchChoice: ["fletch", "_getFletchings"]
                    };
                    for (const [flag, [kind, getter]] of Object.entries(xbowKinds)) {
                        if (c[flag]) {
                            const items = this[getter]();
                            const selectedId = this._getSelectedBowItem(r.id, kind);
                            base.bowItemOptions = items.map(w => ({
                                ...w,
                                selected: w.id === selectedId || (!selectedId && w === items[0])
                            }));
                            base.bowItemKind = kind;
                            if (items.length > 0 && !selectedId) {
                                this._setSelectedBowItem(r.id, kind, items[0].id);
                            }
                        }
                    }
                    // For bowtype materialChoice, filter by class (2026-10-15)
                    if (c.materialChoice && c.materialType === "bowtype" && c.bowClass) {
                        const bows = game.eqrmss?.bows;
                        if (bows && typeof bows.listTypes === "function") {
                            const allowed = bows.listTypes().filter(t => bows.classCanMakeType(c.bowClass, t.id));
                            const compSelectedMat = this._getSelectedMaterial(r.id, r, c.id);
                            base.materialOptions = allowed.map(t => ({
                                id: t.id,
                                name: t.name,
                                selected: t.id === compSelectedMat,
                                have: 1,
                                need: c.qty
                            }));
                            // Auto-select first allowed if current selection not allowed
                            if (!allowed.some(t => t.id === compSelectedMat) && allowed.length > 0) {
                                const key = `${r.id}:${c.id}`;
                                this.selectedMaterials[key] = allowed[0].id;
                                base.materialOptions[0].selected = true;
                            }
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

    // Dynamic difficulty for Fletch Arrows (2026-10-15): max of component trivials
    _getDynamicDifficulty(recipe, recipeId) {
        if (recipe.id === "fletch-arrows") {
            const arrows = game.eqrmss?.arrows;
            if (!arrows) return recipe.difficulty;
            const headComp = recipe.components?.find(c => c.materialType === "arrowhead");
            const nockComp = recipe.components?.find(c => c.materialType === "arrownock");
            const headId = headComp ? this._getSelectedMaterial(recipeId, recipe, headComp.id) : null;
            const nockId = nockComp ? this._getSelectedMaterial(recipeId, recipe, nockComp.id) : null;
            const shaftItemId = this._getSelectedBowItem(recipeId, "shaft");
            const shaftItem = shaftItemId ? this.actor.items.get(shaftItemId) : null;
            const shaftId = shaftItem?.system?.arrowShaft;
            const fletchItemId = this._getSelectedBowItem(recipeId, "fletch");
            const fletchItem = fletchItemId ? this.actor.items.get(fletchItemId) : null;
            const fletchId = fletchItem?.system?.fletchId;
            if (!headId || !fletchId || !nockId || !shaftId) return recipe.difficulty;
            return arrows.difficulty(headId, shaftId, fletchId, nockId);
        }
        // Dynamic difficulty for Fashion Darts (2026-10-15): material trivial
        if (recipe.id === "fashion-darts") {
            const darts = game.eqrmss?.darts;
            if (!darts) return recipe.difficulty;
            const matComp = recipe.components?.find(c => c.materialType === "dartmaterial");
            const matId = matComp ? this._getSelectedMaterial(recipeId, recipe, matComp.id) : null;
            if (!matId) return recipe.difficulty;
            return darts.difficulty(matId);
        }
        // Dynamic difficulty for Fashion Haft (2026-10-15): piece trivial
        if (recipe.id === "fashion-haft") {
            const hafts = game.eqrmss?.hafts;
            if (!hafts) return recipe.difficulty;
            const pieceComp = recipe.components?.find(c => c.materialType === "haftpiece");
            const pieceId = pieceComp ? this._getSelectedMaterial(recipeId, recipe, pieceComp.id) : null;
            if (!pieceId) return recipe.difficulty;
            return hafts.difficulty(pieceId);
        }
        // Dynamic difficulty for Assemble Crossbow (2026-10-15): type trivial
        if (recipe.id === "assemble-crossbow") {
            const xbows = game.eqrmss?.crossbows;
            if (!xbows) return recipe.difficulty;
            const typeComp = recipe.components?.find(c => c.materialType === "crossbowtype");
            const typeId = typeComp ? this._getSelectedMaterial(recipeId, recipe, typeComp.id) : null;
            if (!typeId) return recipe.difficulty;
            return xbows.difficulty(typeId);
        }
        // Dynamic difficulty for Fletch Bolts (2026-10-15): same as arrows
        if (recipe.id === "fletch-bolts") {
            const arrows = game.eqrmss?.arrows;
            if (!arrows) return recipe.difficulty;
            const headComp = recipe.components?.find(c => c.materialType === "arrowhead");
            const nockComp = recipe.components?.find(c => c.materialType === "arrownock");
            const headId = headComp ? this._getSelectedMaterial(recipeId, recipe, headComp.id) : null;
            const nockId = nockComp ? this._getSelectedMaterial(recipeId, recipe, nockComp.id) : null;
            const shaftItemId = this._getSelectedBowItem(recipeId, "shaft");
            const shaftItem = shaftItemId ? this.actor.items.get(shaftItemId) : null;
            const shaftId = shaftItem?.system?.arrowShaft;
            const fletchItemId = this._getSelectedBowItem(recipeId, "fletch");
            const fletchItem = fletchItemId ? this.actor.items.get(fletchItemId) : null;
            const fletchId = fletchItem?.system?.fletchId;
            if (!headId || !fletchId || !nockId || !shaftId) return recipe.difficulty;
            return arrows.difficulty(headId, shaftId, fletchId, nockId);
        }
        return recipe.difficulty;
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

    // Count items matching a material ID (e.g., "iron" matches "Iron Ore", "raw_silk" matches "Raw Silk")
    _countOreMaterial(materialId) {
        let count = 0;
        const matLower = String(materialId ?? "").toLowerCase().replace(/_ore$/, "").replace(/_/g, " ");
        for (const item of this.actor.items) {
            const nameLower = String(item.name ?? "").toLowerCase();
            // Match if item name contains the material name
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
        // For bow item choices (2026-10-15), count 1 if any available
        if (component.bowChoice) {
            return this._getBows().length > 0 ? 1 : 0;
        }
        if (component.bowstaveChoice) {
            return this._getBowstaves().length > 0 ? 1 : 0;
        }
        if (component.bowstringChoice) {
            return this._getBowstrings().length > 0 ? 1 : 0;
        }
        if (component.shaftChoice) {
            return this._getArrowShafts().length > 0 ? 1 : 0;
        }
        if (component.haftChoice) {
            return this._getHafts(component.haftChoice).length > 0 ? 1 : 0;
        }
        if (component.shieldChoice) {
            return this._getWoodShields().length > 0 ? 1 : 0;
        }
        if (component.stockChoice) {
            return this._getCrossbowStocks().length > 0 ? 1 : 0;
        }
        if (component.triggerChoice) {
            return this._getTriggers().length > 0 ? 1 : 0;
        }
        if (component.limbsChoice) {
            return this._getLimbs().length > 0 ? 1 : 0;
        }
        if (component.riserChoice) {
            return this._getRisers().length > 0 ? 1 : 0;
        }
        if (component.grooveChoice) {
            return this._getGrooves().length > 0 ? 1 : 0;
        }
        if (component.fletchChoice) {
            return this._getFletchings().length > 0 ? 1 : 0;
        }
        // For materialChoice, count the selected material's ore
        if (component.materialChoice && recipeId) {
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
            const selectedMat = this._getSelectedMaterial(recipeId, recipe ?? {}, component.id);
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
        return components.every(c => {
            // Optional cams: only required if selected type needs them (2026-10-15)
            if (c.optionalForTypes && recipeId) {
                const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
                const typeComp = recipe?.components?.find(x => x.materialType === "bowtype");
                const selectedType = typeComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, typeComp.id) : null;
                if (selectedType && c.optionalForTypes.includes(selectedType)) return true;
            }
            return this._countItem(c, recipeId) >= c.qty;
        });
    }

    // Consume items matching a material ID
    async _consumeOreMaterial(materialId, qty) {
        let remaining = qty;
        const matLower = String(materialId ?? "").toLowerCase().replace(/_ore$/, "").replace(/_/g, " ");
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
            // Skip bowChoice (restring transforms, not consumes) - 2026-10-15
            if (c.bowChoice) continue;
            // For bowstaveChoice/bowstringChoice, consume the selected inventory item - 2026-10-15
            if ((c.bowstaveChoice || c.bowstringChoice) && recipeId) {
                const kind = c.bowstaveChoice ? "bowstave" : "bowstring";
                const itemId = this._getSelectedBowItem(recipeId, kind);
                if (itemId) {
                    const item = this.actor.items.get(itemId);
                    if (item) await item.delete();
                }
                continue;
            }
            // For shaftChoice, consume the selected arrow shaft - 2026-10-15
            if (c.shaftChoice && recipeId) {
                const itemId = this._getSelectedBowItem(recipeId, "shaft");
                if (itemId) {
                    const item = this.actor.items.get(itemId);
                    if (item) await item.delete();
                }
                continue;
            }
            // For haftChoice/shieldChoice (smith augmenting), the haft/shield is transformed not consumed - 2026-10-15
            if ((c.haftChoice || c.shieldChoice) && recipeId) {
                continue;
            }
            // Crossbow components are consumed in assembly - 2026-10-15
            const xbowConsumeKinds = {
                stockChoice: "stock",
                triggerChoice: "trigger",
                limbsChoice: "limbs",
                riserChoice: "riser",
                grooveChoice: "groove",
                fletchChoice: "fletch"
            };
            for (const [flag, kind] of Object.entries(xbowConsumeKinds)) {
                if (c[flag] && recipeId) {
                    const itemId = this._getSelectedBowItem(recipeId, kind);
                    if (itemId) {
                        const item = this.actor.items.get(itemId);
                        if (item) await item.delete();
                    }
                    break;
                }
            }
            if (c.stockChoice || c.triggerChoice || c.limbsChoice || c.riserChoice || c.grooveChoice || c.fletchChoice) continue;
            // For optionalForTypes (cams), only consume if selected type needs them - 2026-10-15
            if (c.optionalForTypes && recipeId) {
                const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
                const typeComp = recipe?.components?.find(x => x.materialType === "bowtype");
                const selectedType = typeComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, typeComp.id) : null;
                if (selectedType && c.optionalForTypes.includes(selectedType)) {
                    // Type doesn't need cams, skip consumption
                    continue;
                }
                // Fall through to normal consumption
            }
            // For materialChoice, consume the selected material's ore
            if (c.materialChoice && recipeId) {
                const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
                const selectedMat = this._getSelectedMaterial(recipeId, recipe ?? {}, c.id);
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

    // Map a weapon ore ID to an armor material ID (e.g., "iron" -> "iron_chain")
    _mapOreToArmorMaterial(oreId, category) {
        try {
            const armor = game.eqrmss?.armor;
            if (!armor || typeof armor.options !== "function") return null;
            const materials = armor.options()?.materials ?? [];
            const candidateId = `${oreId}_${category}`;
            if (materials.some(m => m.id === candidateId)) return candidateId;
            return null;
        } catch (e) { return null; }
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
            const sys = weapon.system ?? {};
            // Try to recompose name via weapon composer for correctness
            let newName = String(weapon.name ?? "");
            try {
                const weapons = game.eqrmss?.weapons;
                const templateId = sys.template ?? sys.weaponTemplate;
                const materialId = sys.material;
                if (weapons && typeof weapons.compose === "function" && templateId && materialId) {
                    const composed = weapons.compose(templateId, materialId, toCond);
                    if (composed?.name) newName = composed.name;
                } else {
                    // Fallback: strip old condition prefix (case-insensitive, anywhere)
                    newName = newName.replace(new RegExp(`${fromCond}\s+`, "i"), "");
                }
            } catch (e) {
                newName = newName.replace(new RegExp(`${fromCond}\s+`, "i"), "");
            }
            const oldName = weapon.name;
            await weapon.update({
                name: newName,
                "system.condition": toCond
            });
            ui.notifications.info(`Polished ${oldName} to ${newName}.`);
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
                    const matComp = recipe.components.find(c => c.materialChoice);
                    const matType = matComp?.materialType ?? "ore";
                    // Tailoring weapons: map cloth/leather to weapon material IDs
                    if (product.type === "weapon" && (matType === "cloth" || matType === "leather")) {
                        materialId = matType === "cloth" ? "silk" : "leather";
                    }
                    // For armor, use selected material directly if valid, else map ore->armor
                    else if (product.type === "armor" && product.category) {
                        // Check if selected is already a valid armor material
                        const armorMats = game.eqrmss?.armor?.options?.()?.materials ?? [];
                        if (armorMats.some(m => m.id === selected)) {
                            materialId = selected;
                        } else {
                            // Map ore ID to armor material (e.g., "iron" -> "iron_chain")
                            const mapped = this._mapOreToArmorMaterial(selected, product.category);
                            materialId = mapped ?? product.defaultMaterial ?? "iron_chain";
                        }
                    } else {
                        materialId = selected;
                    }
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
                        armorLocation: composed.locationId,
                        armorCategory: composed.categoryId,
                        armorMaterial: composed.materialId,
                        armorCondition: composed.conditionId,
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
        
        // Bow products (2026-10-15): bowstave, bowstring, bow, restring
        if (["bowstave", "bowstring", "bow", "restring"].includes(productType) && recipeId) {            const bows = game.eqrmss?.bows;
            if (!bows) {
                ui.notifications.error("Bow data not loaded.");
                return;
            }
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);

            // Fashion Bowstave: wood dropdown -> "{Wood} Bowstave"
            if (productType === "bowstave") {
                const woodComp = recipe?.components?.find(c => c.materialType === "wood");
                const woodId = woodComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, woodComp.id) : null;
                const wood = woodId ? bows.getWood(woodId) : null;
                if (!wood) {
                    ui.notifications.error("No wood selected.");
                    return;
                }
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: `${wood.name} Bowstave`,
                    type: "weapon",
                    system: {
                        bowWood: wood.id,
                        bowWoodName: wood.name,
                        bowWoodTier: wood.tier,
                        quantity: product.qty ?? 1,
                        description: `Crafted bowstave (${quality}).`
                    }
                }]);
                ui.notifications.info(`Fashioned ${wood.name} Bowstave.`);
                return;
            }

            // Fashion Bowstring: string dropdown -> "{String} Bowstring"
            if (productType === "bowstring") {
                const strComp = recipe?.components?.find(c => c.materialType === "bowstring");
                const stringId = strComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, strComp.id) : null;
                const str = stringId ? bows.getBowstring(stringId) : null;
                if (!str) {
                    ui.notifications.error("No string selected.");
                    return;
                }
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: `${str.name} Bowstring`,
                    type: "weapon",
                    system: {
                        bowString: str.id,
                        bowStringName: str.name,
                        bowStringTier: str.tier,
                        quantity: product.qty ?? 1,
                        description: `Crafted bowstring (${quality}).`
                    }
                }]);
                ui.notifications.info(`Fashioned ${str.name} Bowstring.`);
                return;
            }

            // Fashion Bow: bowstave + bowstring + type + class -> composed bow
            if (productType === "bow") {
                const staveId = this._getSelectedBowItem(recipeId, "bowstave");
                const stringItemId = this._getSelectedBowItem(recipeId, "bowstring");
                const typeComp = recipe?.components?.find(c => c.materialType === "bowtype");
                const typeId = typeComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, typeComp.id) : null;
                const classId = product.bowClass;
                if (!staveId || !stringItemId || !typeId || !classId) {
                    ui.notifications.error("Missing bow components (stave, string, type, or class).");
                    return;
                }
                const stave = this.actor.items.get(staveId);
                const stringItem = this.actor.items.get(stringItemId);
                if (!stave || !stringItem) {
                    ui.notifications.error("Selected stave or string not found.");
                    return;
                }
                const woodId = stave.system?.bowWood;
                const stringId = stringItem.system?.bowString;
                if (!woodId || !stringId) {
                    ui.notifications.error("Stave or string is missing its material data.");
                    return;
                }
                try {
                    const composed = bows.compose(woodId, stringId, typeId, classId, quality);
                    await this.actor.createEmbeddedDocuments("Item", [{
                        name: composed.name,
                        type: "weapon",
                        system: {
                            weaponType: "missile",
                            bowWood: composed.woodId,
                            bowString: composed.stringId,
                            bowType: composed.typeId,
                            bowClass: composed.classId,
                            durability: composed.durability,
                            range: composed.range,
                            obMod: composed.obMod,
                            quantity: product.qty ?? 1,
                            description: composed.description
                        }
                    }]);
                    ui.notifications.info(`Fashioned ${composed.name}.`);
                } catch (e) {
                    ui.notifications.error(`Bow compose failed: ${e.message}`);
                }
                return;
            }

            // Restring Bow: existing bow + new string -> updated bow (2026-10-15)
            if (productType === "restring") {
                const bowId = this._getSelectedBowItem(recipeId, "bow");
                const stringItemId = this._getSelectedBowItem(recipeId, "bowstring");
                if (!bowId || !stringItemId) {
                    ui.notifications.error("No bow or string selected.");
                    return;
                }
                const bow = this.actor.items.get(bowId);
                const stringItem = this.actor.items.get(stringItemId);
                if (!bow || !stringItem) {
                    ui.notifications.error("Selected bow or string not found.");
                    return;
                }
                const woodId = bow.system?.bowWood;
                const newStringId = stringItem.system?.bowString;
                const typeId = bow.system?.bowType;
                const classId = bow.system?.bowClass;
                if (!woodId || !newStringId || !typeId || !classId) {
                    ui.notifications.error("Bow or string is missing data.");
                    return;
                }
                // Validate wood-string compatibility
                if (!bows.woodAcceptsString(woodId, newStringId)) {
                    const wood = bows.getWood(woodId);
                    const str = bows.getBowstring(newStringId);
                    ui.notifications.error(`${wood?.name} cannot accept ${str?.name} string.`);
                    return;
                }
                try {
                    const composed = bows.compose(woodId, newStringId, typeId, classId, quality);
                    const oldName = bow.name;
                    await bow.update({
                        name: composed.name,
                        "system.bowString": composed.stringId,
                        "system.obMod": composed.obMod,
                        "system.description": composed.description
                    });
                    ui.notifications.info(`Restrung ${oldName} -> ${composed.name}.`);
                } catch (e) {
                    ui.notifications.error(`Restring failed: ${e.message}`);
                }
                return;
            }
        }

        // Arrow products (2026-10-15): arrowshaft, arrow
        if (["arrowshaft", "arrow"].includes(productType) && recipeId) {
            const arrows = game.eqrmss?.arrows;
            if (!arrows) {
                ui.notifications.error("Arrow data not loaded.");
                return;
            }
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);

            // Fashion Arrow Shafts: creates "{Shaft} Arrow Shafts" bundle
            if (productType === "arrowshaft") {
                const shaftId = product.shaftId;
                const shaft = shaftId ? arrows.getShaft(shaftId) : null;
                if (!shaft) {
                    ui.notifications.error("Unknown shaft type.");
                    return;
                }
                const shaftNames = {
                    "wood": "Bundled Wooden Arrow Shafts",
                    "bone": "Bundled Bone Arrow Shafts",
                    "ceramic": "Bundled Ceramic Arrow Shafts",
                    "steel": "Bundled Steel Arrow Shafts"
                };
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: shaftNames[shaftId] ?? `${shaft.name} Arrow Shafts`,
                    type: "weapon",
                    system: {
                        arrowShaft: shaft.id,
                        arrowShaftName: shaft.name,
                        quantity: product.qty ?? 1,
                        description: `Crafted arrow shafts (${quality}).`
                    }
                }]);
                ui.notifications.info(`Fashioned ${shaftNames[shaftId] ?? shaft.name} shafts.`);
                return;
            }

            // Fletch Arrows: head + shaft + fletch + nock -> composed arrows
            if (productType === "arrow") {
                const headComp = recipe?.components?.find(c => c.materialType === "arrowhead");
                const nockComp = recipe?.components?.find(c => c.materialType === "arrownock");
                const headId = headComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, headComp.id) : null;
                const nockId = nockComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, nockComp.id) : null;
                const shaftItemId = this._getSelectedBowItem(recipeId, "shaft");
                const fletchItemId = this._getSelectedBowItem(recipeId, "fletch");
                if (!headId || !nockId || !shaftItemId || !fletchItemId) {
                    ui.notifications.error("Missing arrow components.");
                    return;
                }
                const shaftItem = this.actor.items.get(shaftItemId);
                const fletchItem = this.actor.items.get(fletchItemId);
                if (!shaftItem || !fletchItem) {
                    ui.notifications.error("Selected shaft or fletching not found.");
                    return;
                }
                const shaftId = shaftItem.system?.arrowShaft;
                const fletchId = fletchItem.system?.fletchId;
                if (!shaftId || !fletchId) {
                    ui.notifications.error("Shaft or fletching is missing type data.");
                    return;
                }
                try {
                    const composed = arrows.compose(headId, shaftId, fletchId, nockId, quality);
                    await this.actor.createEmbeddedDocuments("Item", [{
                        name: composed.name,
                        type: "weapon",
                        system: {
                            weaponType: "missile",
                            ammoType: "arrow",
                            arrowHead: composed.headId,
                            arrowShaft: composed.shaftId,
                            arrowFletch: composed.fletchId,
                            arrowNock: composed.nockId,
                            arrowClass: composed.arrowClass,
                            damageBonus: composed.damageBonus,
                            rangeMod: composed.rangeMod,
                            quantity: composed.quantity,
                            description: composed.description
                        }
                    }]);
                    ui.notifications.info(`Fletched ${composed.quantity}x ${composed.name}.`);
                } catch (e) {
                    ui.notifications.error(`Arrow compose failed: ${e.message}`);
                }
                return;
            }
        }

        // Dart products (2026-10-15): single-component darts
        if (productType === "dart" && recipeId) {
            const darts = game.eqrmss?.darts;
            if (!darts) {
                ui.notifications.error("Dart data not loaded.");
                return;
            }
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
            const matComp = recipe?.components?.find(c => c.materialType === "dartmaterial");
            const matId = matComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, matComp.id) : null;
            const mat = matId ? darts.get(matId) : null;
            if (!mat) {
                ui.notifications.error("No dart material selected.");
                return;
            }
            const dartName = mat.poison ? `${mat.name} Dart (Poisoned)` : `${mat.name} Dart`;
            await this.actor.createEmbeddedDocuments("Item", [{
                name: dartName,
                type: "weapon",
                system: {
                    weaponType: "thrown",
                    weaponTemplate: "dart",
                    dartMaterial: mat.id,
                    poisoned: mat.poison === true,
                    quantity: product.qty ?? 5,
                    description: `Crafted darts (${quality}).${mat.poison ? " Poisoned." : ""}`
                }
            }]);
            ui.notifications.info(`Fashioned ${product.qty ?? 5}x ${dartName}.`);
            return;
        }

        // Haft and shield products (2026-10-15)
        if (["haft", "woodshield", "augment-javelin", "reinforce-quarterstaff", "reinforce-shield"].includes(productType) && recipeId) {
            const hafts = game.eqrmss?.hafts;
            const bows = game.eqrmss?.bows;
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);

            // Fashion Haft: piece + wood -> wooden haft piece
            if (productType === "haft") {
                const pieceComp = recipe?.components?.find(c => c.materialType === "haftpiece");
                const woodComp = recipe?.components?.find(c => c.materialType === "wood");
                const pieceId = pieceComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, pieceComp.id) : null;
                const woodId = woodComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, woodComp.id) : null;
                const piece = pieceId && hafts ? hafts.get(pieceId) : null;
                const wood = woodId && bows ? bows.getWood(woodId) : null;
                if (!piece || !wood) {
                    ui.notifications.error("No piece or wood selected.");
                    return;
                }
                const itemName = `${wood.name} ${piece.name}`;
                const isWeapon = piece.usable === true;
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: itemName,
                    type: isWeapon ? "weapon" : "weapon",
                    system: {
                        haftPiece: piece.id,
                        haftWood: wood.id,
                        haftWoodName: wood.name,
                        durability: wood.durability ?? 20,
                        weaponTemplate: piece.weaponTemplate ?? null,
                        weaponType: piece.weaponTemplate ? "melee" : null,
                        quantity: product.qty ?? 1,
                        description: `Crafted ${piece.name.toLowerCase()} (${quality}). ${piece.description ?? ""}`
                    }
                }]);
                ui.notifications.info(`Fashioned ${itemName}.`);
                return;
            }

            // Fashion Wood Shield
            if (productType === "woodshield") {
                const woodComp = recipe?.components?.find(c => c.materialType === "wood");
                const woodId = woodComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, woodComp.id) : null;
                const wood = woodId && bows ? bows.getWood(woodId) : null;
                if (!wood) {
                    ui.notifications.error("No wood selected.");
                    return;
                }
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: `${wood.name} Wood Shield`,
                    type: "armor",
                    system: {
                        woodShield: true,
                        shieldWood: wood.id,
                        shieldWoodName: wood.name,
                        durability: wood.durability ?? 20,
                        armorLocation: "shield",
                        quantity: 1,
                        description: `Crafted wood shield (${quality}). Can be reinforced by a blacksmith.`
                    }
                }]);
                ui.notifications.info(`Fashioned ${wood.name} Wood Shield.`);
                return;
            }

            // Smith augmentations: transform the haft/shield in place
            if (["augment-javelin", "reinforce-quarterstaff", "reinforce-shield"].includes(productType)) {
                const kind = productType === "augment-javelin" ? "haft-javelin"
                    : productType === "reinforce-quarterstaff" ? "haft-quarterstaff" : "shield";
                const itemId = this._getSelectedBowItem(recipeId, kind);
                const metalComp = recipe?.components?.find(c => c.materialType === "ore");
                const metalId = metalComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, metalComp.id) : "iron";
                if (!itemId) {
                    ui.notifications.error("No item selected.");
                    return;
                }
                const item = this.actor.items.get(itemId);
                if (!item) {
                    ui.notifications.error("Selected item not found.");
                    return;
                }
                const oldName = item.name;
                const augment = productType === "augment-javelin" ? "Tipped"
                    : productType === "reinforce-quarterstaff" ? "Reinforced" : "Reinforced";
                const metalName = String(metalId).replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                const newName = oldName.replace(/^(Tipped|Reinforced)\s+/i, "");
                await item.update({
                    name: `${augment} ${newName} (${metalName})`,
                    "system.augmented": true,
                    "system.augmentMetal": metalId,
                    "system.description": `${item.system?.description ?? ""} Augmented with ${metalName} (${quality}).`
                });
                ui.notifications.info(`Augmented ${oldName} -> ${augment} ${newName} (${metalName}).`);
                return;
            }
        }

        // Crossbow component products (2026-10-15)
        const xbowComponents = {
            "crossbowstock": ["crossbowStock", "Crossbow Stock"],
            "bowcam": ["bowCam", "Standard Bow Cam"],
            "crosstrigger": ["crossbowTrigger", "Crossbow Trigger"],
            "crosslimbs": ["crossbowLimbs", "Crossbow Limbs"],
            "crossriser": ["crossbowRiser", "Crossbow Riser"],
            "crossgroove": ["crossbowGroove", "Crossbow Groove"]
        };
        if (xbowComponents[productType] && recipeId) {
            const [sysKey, baseName] = xbowComponents[productType];
            // For stock, include wood name
            let itemName = baseName;
            const sysExtra = { [sysKey]: true };
            if (productType === "crossbowstock") {
                const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
                const woodComp = recipe?.components?.find(c => c.materialType === "wood");
                const woodId = woodComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, woodComp.id) : null;
                const bows = game.eqrmss?.bows;
                const wood = woodId && bows ? bows.getWood(woodId) : null;
                if (wood) {
                    itemName = `${wood.name} ${baseName}`;
                    sysExtra.haftWood = wood.id;
                    sysExtra.durability = wood.durability ?? 20;
                }
            }
            await this.actor.createEmbeddedDocuments("Item", [{
                name: itemName,
                type: "weapon",
                system: {
                    ...sysExtra,
                    quantity: product.qty ?? 1,
                    description: `Crafted crossbow component (${quality}).`
                }
            }]);
            ui.notifications.info(`Fashioned ${itemName}.`);
            return;
        }

        // Assemble Crossbow (2026-10-15)
        if (productType === "crossbow" && recipeId) {
            const xbows = game.eqrmss?.crossbows;
            const bows = game.eqrmss?.bows;
            if (!xbows) {
                ui.notifications.error("Crossbow data not loaded.");
                return;
            }
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
            const typeComp = recipe?.components?.find(c => c.materialType === "crossbowtype");
            const typeId = typeComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, typeComp.id) : null;
            const xbowType = typeId ? xbows.get(typeId) : null;
            if (!xbowType) {
                ui.notifications.error("No crossbow type selected.");
                return;
            }
            // Get stock for wood info
            const stockId = this._getSelectedBowItem(recipeId, "stock");
            const stock = stockId ? this.actor.items.get(stockId) : null;
            const woodName = stock?.system?.haftWoodName ?? stock?.system?.haftWood ?? "";
            const itemName = woodName ? `${woodName} ${xbowType.name}` : xbowType.name;
            await this.actor.createEmbeddedDocuments("Item", [{
                name: itemName,
                type: "weapon",
                system: {
                    weaponType: "missile",
                    weaponTemplate: xbowType.id.includes("hand") ? "crossbow_light" : xbowType.id.includes("heavy") ? "crossbow_heavy" : "crossbow_light",
                    crossbowType: xbowType.id,
                    crossbowCams: xbowType.cams,
                    range: xbowType.range,
                    damageBonus: xbowType.damageBonus,
                    quantity: 1,
                    description: `Assembled ${xbowType.name.toLowerCase()} (${quality}). ${xbowType.description ?? ""}`
                }
            }]);
            ui.notifications.info(`Assembled ${itemName}.`);
            return;
        }

        // Fletch Bolts (2026-10-15): same as arrows, called Bolt
        if (productType === "bolt" && recipeId) {
            const arrows = game.eqrmss?.arrows;
            if (!arrows) {
                ui.notifications.error("Arrow data not loaded.");
                return;
            }
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
            const headComp = recipe?.components?.find(c => c.materialType === "arrowhead");
            const nockComp = recipe?.components?.find(c => c.materialType === "arrownock");
            const headId = headComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, headComp.id) : null;
            const nockId = nockComp ? this._getSelectedMaterial(recipeId, recipe ?? {}, nockComp.id) : null;
            const shaftItemId = this._getSelectedBowItem(recipeId, "shaft");
            const shaftItem = shaftItemId ? this.actor.items.get(shaftItemId) : null;
            const shaftId = shaftItem?.system?.arrowShaft;
            const fletchItemId = this._getSelectedBowItem(recipeId, "fletch");
            const fletchItem = fletchItemId ? this.actor.items.get(fletchItemId) : null;
            const fletchId = fletchItem?.system?.fletchId;
            if (!headId || !fletchId || !nockId || !shaftId) {
                ui.notifications.error("Missing bolt components.");
                return;
            }
            try {
                const composed = arrows.compose(headId, shaftId, fletchId, nockId, quality);
                // Rename Arrow -> Bolt
                const boltName = composed.name.replace(/Arrow/g, "Bolt");
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: boltName,
                    type: "weapon",
                    system: {
                        weaponType: "missile",
                        ammoType: "bolt",
                        arrowHead: composed.headId,
                        arrowShaft: composed.shaftId,
                        arrowFletch: composed.fletchId,
                        arrowNock: composed.nockId,
                        arrowClass: composed.arrowClass,
                        damageBonus: composed.damageBonus,
                        rangeMod: composed.rangeMod,
                        quantity: composed.quantity,
                        description: composed.description.replace(/arrows/g, "bolts")
                    }
                }]);
                ui.notifications.info(`Fletched ${composed.quantity}x ${boltName}.`);
            } catch (e) {
                ui.notifications.error(`Bolt compose failed: ${e.message}`);
            }
            return;
        }

        // Fashion Fletchings (2026-10-15): creates fletching items
        if (productType === "fletching" && recipeId) {
            const fletchId = product.fletchId;
            if (!fletchId) {
                ui.notifications.error("Fletching type not specified.");
                return;
            }
            await this.actor.createEmbeddedDocuments("Item", [{
                name: product.name,
                type: "weapon",
                system: {
                    fletchId: fletchId,
                    quantity: product.qty ?? 1,
                    description: `Crafted fletchings (${quality}).`
                }
            }]);
            ui.notifications.info(`Fashioned ${product.name}.`);
            return;
        }
        
        // Generic item (default): consumables, etc.
        // Gem bonuses for enchanted jewelry (2026-10-14)
        const GEM_BONUSES = {
            "malachite": { hpBonus: 5 },
            "turquoise": { manaBonus: 5 },
            "lapis-lazuli": { hpBonus: 3, manaBonus: 3 },
            "hematite": { hpBonus: 10 },
            "cat-s-eye-agate": { chaBonus: 4 },
            "jasper": { wisBonus: 2 },
            "amber": { strBonus: 2 },
            "jade": { agiBonus: 3 },
            "topaz": { dexBonus: 3 },
            "peridot": { staBonus: 3 },
            "sapphire": { intBonus: 3 },
            "ruby": { strBonus: 3, hpBonus: 5 },
            "emerald": { wisBonus: 3 },
            "diamond": { acBonus: 2 },
            "opal": { chaBonus: 2, intBonus: 2 },
            "fire-opal": { intBonus: 4 },
            "black-pearl": { dexBonus: 2, agiBonus: 2 },
            "black-sapphire": { hpBonus: 8, manaBonus: 8 },
            "star-rose-quartz": { chaBonus: 5 },
            "plains-pebble": { wisBonus: 4 },
            "ivory": { wisBonus: 2, intBonus: 2 },
        };
        
        // Deity restrictions for imbued gems
        const IMBUED_DEITIES = {
            "imbued-black-sapphire-bertoxxulous": "Bertoxxulous",
            "imbued-ruby-brell": "Brell Serilis",
            "imbued-peridot-bristlebane": "Bristlebane",
            "imbued-amber-cazic": "Cazic-Thule",
            "imbued-star-rose-quartz-erollisi": "Erollisi Marr",
            "imbued-sapphire-innorruk": "Innorruk",
            "imbued-plains-pebble-karana": "Karana",
            "imbued-diamond-mithaniel": "Mithaniel Marr",
            "imbued-black-pearl-prexus": "Prexus",
            "imbued-topaz-quellious": "Quellious",
            "imbued-jade-rallos": "Rallos Zek",
            "imbued-opal-rodcet": "Rodcet Nife",
            "imbued-fire-opal-solusek": "Solusek Ro",
            "imbued-ivory-tribunal": "The Tribunal",
            "imbued-emerald-tunare": "Tunare",
        };
        
        // Check if enchanted metal was used, or imbued gem
        let enchantedBonus = null;
        let deityRestriction = null;
        if (product.enchantedBonus && recipeId) {
            const recipe = getRecipesForSkill(this.skillId).find(r => r.id === recipeId);
            if (recipe) {
                const metalComp = recipe.components.find(c => c.materialType === "metal");
                const gemComp = recipe.components.find(c => c.materialType === "gem");
                let selectedGem = null;
                if (gemComp) {
                    selectedGem = this._getSelectedMaterial(recipeId, recipe, gemComp.id);
                    // Check for imbued gem (deity restriction)
                    if (selectedGem && IMBUED_DEITIES[selectedGem]) {
                        deityRestriction = IMBUED_DEITIES[selectedGem];
                        // Imbued gems also give bonuses based on base gem
                        const baseGem = selectedGem.replace(/^imbued-/, "").split("-").slice(0, -1).join("-");
                        enchantedBonus = GEM_BONUSES[baseGem] ?? GEM_BONUSES[selectedGem] ?? null;
                    }
                }
                if (metalComp && !deityRestriction) {
                    const selectedMetal = this._getSelectedMaterial(recipeId, recipe, metalComp.id);
                    if (selectedMetal && selectedMetal.startsWith("enchanted-") && selectedGem) {
                        enchantedBonus = GEM_BONUSES[selectedGem] ?? null;
                    }
                }
            }
        }
        
        const itemData = {
            name: product.name ?? product.template ?? "Crafted Item",
            type: "item",
            system: {
                quantity: product.qty ?? 1,
                description: `Crafted via tradeskill (${quality}).` + (enchantedBonus ? " Enchanted." : "") + (deityRestriction ? ` Imbued (${deityRestriction} only).` : ""),
                ...(enchantedBonus ?? {}),
                ...(deityRestriction ? { deityRestriction } : {}),
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
            { ...recipe, difficulty: dialog._getDynamicDifficulty(recipe, recipeId) },
            (c) => dialog._hasComponents(c, recipeId),
            (c) => dialog._consumeComponents(c, recipeId),
            (p, q) => dialog._createProduct(p, q, recipeId),
            skillEngine
        );

        // Post result to chat
        const icon = result.success ? "✅" : result.critFail ? "💥" : "❌";
        const shownDifficulty = dialog._getDynamicDifficulty(recipe, recipeId);
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: dialog.actor }),
            content: `<h2>${icon} ${recipe.name}</h2><p>${result.message}</p>
                ${result.roll ? `<p>Roll: ${result.roll.total} + bonus = ${result.total} vs ${shownDifficulty}</p>` : ""}`
        });

        // Refresh the dialog
        dialog.render();
    }
}
