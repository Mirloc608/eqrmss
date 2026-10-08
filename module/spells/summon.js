// ============================================================
// Summoned Items Engine
//
// EverQuest - Rolemaster Standard System
//
// Creates Item documents on the caster for summon-item spell
// effects and clicky payloads. Distinct from the creature
// "summon" type (which is a GM-placed token prompt).
//
// Item definitions live in module/data/summons/items.json.
// ============================================================

import { combatCard } from "../combat/chat-card.js";

let _summonItems = null;

/**
 * Load the summoned item catalog (cached).
 */
async function loadSummonItems() {
    if (_summonItems) return _summonItems;
    try {
        const resp = await fetch("systems/eqrmss/module/data/summons/items.json");
        const data = await resp.json();
        _summonItems = data.items ?? {};
    } catch {
        _summonItems = {};
    }
    return _summonItems;
}

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

// Summoned items last 1 day of game time (2026-10-07 ruling).
export const SUMMONED_ITEM_LIFETIME = 86400; // seconds

/**
 * Summon an item onto an actor.
 *
 * @param {object} args { caster, itemId, quantity, intoBag, spellName, source }
 *   caster: the actor receiving the item
 *   itemId: key into items.json (normalized lowercase)
 *   quantity: override stack size (defaults to item data)
 *   intoBag: if true, note that it goes into the summoned satchel
 *   spellName/source: for chat messages
 * @returns {Promise<string>} HTML chat note
 */
export async function summonItem({ caster, itemId, quantity, intoBag, spellName, source }) {
    const who = caster?.name ?? "Someone";
    const catalog = await loadSummonItems();
    const key = String(itemId ?? "").toLowerCase().trim();
    const def = catalog[key];

    if (!def) {
        return `<p><em>${esc(who)} attempts to summon "${esc(itemId)}" — item not defined in summons catalog.</em></p>`;
    }

    const qty = Number(quantity ?? def.quantity ?? 1) || 1;
    const bagNote = intoBag ? " (placed in summoned satchel)" : "";
    const now = typeof game !== "undefined" ? (game.time?.worldTime ?? 0) : 0;

    // Build the Foundry Item data.
    const itemData = {
        name: def.name,
        type: def.type,
        img: def.img ?? "icons/svg/item-bag.svg",
        system: {
            ...(def.system ?? {}),
            summoned: true,
        },
        flags: {
            eqrmss: {
                summoned: true,
                summonedAt: now,
                summonSource: spellName ?? source ?? "summon-item",
            }
        }
    };

    // Stackable consumables get quantity.
    if (qty > 1) {
        itemData.system.quantity = qty;
    }

    let note;
    try {
        if (!(caster?.isOwner ?? false) && !(globalThis.game?.user?.isGM ?? false)) {
            note = `<p><em>Summoned item not created — you don't control ${esc(who)}.</em></p>`;
        } else if (typeof caster?.createEmbeddedDocuments === "function") {
            await caster.createEmbeddedDocuments("Item", [itemData]);
            const qtyStr = qty > 1 ? ` (x${qty})` : "";
            note = `<p><em>${esc(who)} summons ${esc(def.name)}${qtyStr}${bagNote}.</em></p>`;
        } else {
            note = `<p><em>${esc(who)} summons ${esc(def.name)} — no actor to receive it.</em></p>`;
        }
    } catch (e) {
        note = `<p><em>${esc(who)} summons ${esc(def.name)} — creation failed: ${esc(e.message)}.</em></p>`;
    }

    // Post to chat if we're in a Foundry context.
    if (typeof ChatMessage !== "undefined" && typeof combatCard !== "undefined") {
        try {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: caster }),
                content: combatCard("Summoning", `<h2>${esc(spellName ?? source ?? "Summon Item")}</h2>${note}`)
            });
        } catch { /* headless or no chat — note is still returned */ }
    }

    return note;
}

/**
 * Get the summoned item definition for an item ID (for testing/inspection).
 */
export async function getSummonItemDef(itemId) {
    const catalog = await loadSummonItems();
    return catalog[String(itemId ?? "").toLowerCase().trim()] ?? null;
}

/**
 * Remove expired summoned items from all actors.
 *
 * Called on the updateWorldTime hook (GM-only). Any item flagged
 * eqrmss.summoned with a summonedAt timestamp older than
 * SUMMONED_ITEM_LIFETIME (1 day of game time) is deleted.
 *
 * @param {number} worldTime current game.time.worldTime
 */
export async function expireSummonedItems(worldTime) {
    if (typeof game === "undefined" || !game.actors) return;
    const now = Number(worldTime ?? game.time?.worldTime ?? 0);
    const expired = [];
    for (const actor of game.actors) {
        const dead = [];
        for (const item of actor.items ?? []) {
            const flags = item.flags?.eqrmss;
            if (!flags?.summoned) continue;
            const born = Number(flags.summonedAt ?? 0);
            // No timestamp (pre-expiry items): leave alone, don't nuke.
            if (!born) continue;
            if (now - born >= SUMMONED_ITEM_LIFETIME) dead.push(item.id);
        }
        if (dead.length) {
            expired.push({ actor: actor.name, count: dead.length });
            try {
                await actor.deleteEmbeddedDocuments("Item", dead);
            } catch (e) {
                console.error(`EQRMSS | expireSummonedItems failed for ${actor.name}`, e);
            }
        }
    }
    if (expired.length && typeof ChatMessage !== "undefined") {
        try {
            const lines = expired.map(e => `${esc(e.actor)}: ${e.count} summoned item${e.count === 1 ? "" : "s"} crumbled to dust`).join("<br>");
            await ChatMessage.create({
                content: combatCard("Summoning", `<h2>Summoned Items Expire</h2><p><em>${lines}.</em></p>`)
            });
        } catch { /* non-blocking */ }
    }
    return expired;
}
