// ============================================================
// EQRMSS Catalog Picker
// ============================================================
// Browse the loaded item catalog (game.eqrmss.items.byId) and add
// entries to an actor. Stackable items merge into existing stacks
// via tryStackInto; everything else creates a new Item document.
// ============================================================

import { formatPrice } from "../price.js";
import { tryStackInto } from "./inventory-stacking.js";

const { DialogV2 } = foundry.applications.api;

// Display order and labels for catalog type groups
const TYPE_GROUPS = [
    ["container", "Containers"],
    ["weapon", "Weapons"],
    ["armor", "Armor"],
    ["shield", "Shields"],
    ["item", "Goods"],
    ["consumable", "Consumables"],
    ["tool", "Tools"],
    ["tradeskill", "Tradeskill"],
    ["jewelry", "Jewelry"],
    ["herb_or_poison", "Herbs & Poisons"],
    ["transport", "Transport"],
];

function getCatalog() {
    return game?.eqrmss?.items?.byId ?? {};
}

function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Add a catalog entry to an actor. Stacks when possible.
 * Returns true on success.
 */
// Jewelry slots in EQ data — these map to the "jewelry" item type
const JEWELRY_SLOTS = ["ear", "finger", "charm", "neck", "wrist"];

/**
 * Normalize EQ catalog data to the system's expected structure.
 * - Jewelry (by slot) gets type "jewelry" for the dedicated sheet/document
 * - Armor entries become real armor documents: AT from the declared
 *   material, DB bonus = EQ AC above that AT (user ruling 2026-10-21)
 * - Weapon entries become real weapon documents carrying their
 *   weapon-type slug in system.type
 * - Stat keys are uppercased (EQ data uses lowercase, sheets expect uppercase)
 * - Resists stay in EQ structure (fire/cold/magic/poison/disease/corruption)
 */
export async function normalizeCatalogData(data) {
    const sys = data.system ?? {};
    // Jewelry type detection by slot
    if (data.type === "item" && JEWELRY_SLOTS.includes(sys.slot)) {
        data.type = "jewelry";
    }
    // Armor: derive the RMSS fields the defense engine reads
    // (system.at, system.armorLocation, system.dbBonus, penalties).
    if (data.type === "armor") {
        const slot = String(sys.slot ?? "");
        let at = 0;
        let maneuverPenalty = 0;
        let quicknessPenalty = 0;
        let missilePenalty = 0;
        let category = String(sys.armorCategory ?? "");
        try {
            const mRes = await fetch("systems/eqrmss/module/data/armor/materials.json");
            const mData = await mRes.json();
            const mat = (mData.materials ?? []).find(m => m.id === sys.material);
            if (mat) {
                at = Number(mat.baseAT) || 0;
                category = category || String((mat.categories ?? [])[0] ?? "");
            }
            if (category && sys.material) {
                const { loadArmorData, composeArmor } = await import("../../data/armor/armor-composer.js");
                await loadArmorData();
                const composed = composeArmor(slot, category, String(sys.material), "normal");
                at = Number(composed.armorType) || at;
                maneuverPenalty = Number(composed.maneuverPenalty) || 0;
                quicknessPenalty = Number(composed.quicknessPenalty) || 0;
                missilePenalty = Number(composed.missilePenalty) || 0;
            }
        } catch (e) {
            console.warn(`EQRMSS | Catalog armor derivation failed for ${data.name}`, e);
        }
        sys.armorLocation = slot;
        sys.armorCategory = category;
        sys.armorMaterial = String(sys.material ?? "");
        sys.armorCondition = "normal";
        sys.armorQuality = "average";
        sys.armorThickness = "standard";
        sys.at = at;
        sys.dbBonus = Math.max(0, (Number(sys.defense) || 0) - at);
        sys.maneuverPenalty = maneuverPenalty;
        sys.quicknessPenalty = quicknessPenalty;
        sys.missilePenalty = missilePenalty;
        delete sys.slot;
        delete sys.defense;
        delete sys.material;
    }
    // Weapons: the type slug drives class restrictions and skill OB.
    if (data.type === "weapon") {
        sys.type = String(sys.weaponType ?? "");
        if (sys.obMod == null) sys.obMod = 0;
        if (sys.damageMod == null) sys.damageMod = 0;
        delete sys.weaponType;
        delete sys.slot;
    }
    // Uppercase stat keys
    if (sys.stats && typeof sys.stats === "object") {
        const normalized = {};
        for (const [k, v] of Object.entries(sys.stats)) {
            normalized[k.toUpperCase()] = v;
        }
        sys.stats = normalized;
    }
    return data;
}

export async function addCatalogItemToActor(actor, catalogId) {
    const entry = getCatalog()[catalogId];
    if (!entry || !actor) return false;
    const data = await normalizeCatalogData({
        name: entry.name,
        type: entry.type,
        img: entry.img || "icons/svg/item-bag.svg",
        system: JSON.parse(JSON.stringify(entry.system ?? {})),
    });
    if (data.system.quantity == null) data.system.quantity = 1;
    try {
        const stacked = await tryStackInto(actor, data);
        if (!stacked) await actor.createEmbeddedDocuments("Item", [data]);
        ui.notifications.info(`Added ${entry.name}.`);
        return true;
    } catch (e) {
        console.warn("EQRMSS | Catalog add failed", e);
        ui.notifications.warn(`Could not add ${entry.name}.`);
        return false;
    }
}

/**
 * Open the catalog picker dialog for an actor.
 */
export async function openCatalogPicker(actor) {
    if (!actor) return;
    const catalog = getCatalog();
    const ids = Object.keys(catalog);
    if (!ids.length) {
        ui.notifications.warn("Item catalog is empty or still loading.");
        return;
    }

    // Group entries by type
    const groups = [];
    for (const [type, label] of TYPE_GROUPS) {
        const items = ids
            .map(id => ({ id, ...catalog[id] }))
            .filter(e => e.type === type)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        if (items.length) groups.push({ type, label, items });
    }
    // Any types not in the group list go under "Other"
    const known = new Set(TYPE_GROUPS.map(([t]) => t));
    const other = ids.map(id => ({ id, ...catalog[id] }))
        .filter(e => !known.has(e.type))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (other.length) groups.push({ type: "other", label: "Other", items: other });

    const rowHtml = (e) => {
        const price = formatPrice(e.system?.cost);
        const wt = e.system?.weight;
        const wtTxt = Number.isFinite(Number(wt)) ? `${wt} lb` : "";
        return `<div class="catalog-row" data-name="${esc(e.name.toLowerCase())}" data-catalog-id="${esc(e.id)}">`
            + `<span class="catalog-name">${esc(e.name)}</span>`
            + `<span class="catalog-price">${esc(price)}</span>`
            + `<span class="catalog-weight">${esc(wtTxt)}</span>`
            + `<button type="button" data-action="catalog-add" data-catalog-id="${esc(e.id)}">Add</button>`
            + `</div>`;
    };

    const content = `
        <div class="eqrmss-catalog-picker">
        <input type="text" data-catalog-search placeholder="Search the catalog..." style="width: 100%; margin-bottom: 8px;" />
        <div data-catalog-list style="max-height: 420px; overflow-y: auto;">
        ${groups.map(g => `<h3>${esc(g.label)} (${g.items.length})</h3>` + g.items.map(rowHtml).join("")).join("")}
        </div>
        </div>`;

    const dlg = new DialogV2({
        window: { title: `Item Catalog — ${actor.name}` },
        content,
        buttons: [{ action: "close", label: "Close", default: true }],
        position: { width: 560 },
    });
    await dlg.render(true);

    // Wire search + add buttons after render
    const el = dlg.element;
    if (!el) return;
    const search = el.querySelector("[data-catalog-search]");
    const list = el.querySelector("[data-catalog-list]");
    if (search && list) {
        search.addEventListener("input", () => {
            const q = search.value.trim().toLowerCase();
            list.querySelectorAll(".catalog-row").forEach(row => {
                row.style.display = !q || row.dataset.name.includes(q) ? "" : "none";
            });
            // Hide empty group headers
            list.querySelectorAll("h3").forEach(h => {
                let next = h.nextElementSibling;
                let visible = false;
                while (next && next.tagName !== "H3") {
                    if (next.style.display !== "none") { visible = true; break; }
                    next = next.nextElementSibling;
                }
                h.style.display = visible ? "" : "none";
            });
        });
    }
    el.querySelectorAll('[data-action="catalog-add"]').forEach(btn => {
        btn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            await addCatalogItemToActor(actor, btn.dataset.catalogId);
        });
    });
}
