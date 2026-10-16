/**
 * ============================================================
 * EQRMSS Tradeskill Recipe Loader
 * ============================================================
 * Loads tradeskill recipes from module/data/tradeskills/recipes/
 * Each .json file (except README.md) contains an array of recipes.
 *
 * Populates: game.eqrmss.tradeskills = { recipes, bySkill, byId }
 *
 * Foundry VTT V13/V14 Compatible
 * ============================================================
 */

const RECIPE_BASE_PATH = "systems/eqrmss/module/data/tradeskills/recipes";

const RECIPE_FILES = [
    "smithing.json",
    "tailoring.json",
    "baking.json",
    "brewing.json",
    "fletching.json",
    "jewelcraft.json",
    "pottery.json",
    "tinkering.json",
    "alchemy.json",
    "poison.json",
    "research.json",
    "fishing.json"
];

async function fetchJson(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${path}`);
    return r.json();
}

function isValidRecipe(r) {
    if (!r || typeof r !== "object") return false;
    if (typeof r.id !== "string" || !r.id) return false;
    if (typeof r.name !== "string" || !r.name) return false;
    if (typeof r.skill !== "string" || !r.skill) return false;
    if (typeof r.difficulty !== "number") return false;
    if (!Array.isArray(r.components)) return false;
    if (!r.product || typeof r.product !== "object") return false;
    return true;
}

export const EQRMSSRecipeLoader = {
    recipes: [],
    byId: {},
    bySkill: {},

    async load() {
        this.recipes = [];
        this.byId = {};
        this.bySkill = {};

        let loaded = 0;
        let invalid = 0;

        for (const file of RECIPE_FILES) {
            try {
                const data = await fetchJson(`${RECIPE_BASE_PATH}/${file}`);
                const list = Array.isArray(data) ? data : [];
                for (const r of list) {
                    if (!isValidRecipe(r)) {
                        invalid++;
                        console.warn(`EQRMSS | Invalid recipe in ${file}:`, r?.id);
                        continue;
                    }
                    this.recipes.push(r);
                    this.byId[r.id] = r;
                    (this.bySkill[r.skill] ??= []).push(r);
                    loaded++;
                }
            } catch (e) {
                console.warn(`EQRMSS | Recipe file failed: ${file}`, e.message);
            }
        }

        console.log(`EQRMSS | Recipes loaded: ${loaded} (invalid: ${invalid})`);
        return { loaded, invalid };
    }
};
