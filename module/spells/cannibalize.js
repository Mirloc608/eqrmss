// ============================================================
// CANNIBALIZE / CANNIBALIZATION (2026-10-19)
// Shaman HP -> mana conversion (user ruling).
// Formula: HP cost = 2 x level; mana gained = cost / ratio.
// Ratios from EQ Live (high end of each tier's range):
//   Cannibalize I:   2.63   Cannibalize IV: 1.83
//   Cannibalize II:  2.23   Early AA:       1.80
//   Cannibalize III: 2.56   End-game AA:    1.66
// Cannibalize cannot kill the caster: cost is capped so at
// least 1 hit remains, and fails if that leaves nothing.
// ============================================================

import { combatCard } from "../combat/chat-card.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

const CANNIBALIZE_SPELL_RATIOS = {
    "Cannibalize": 2.63,
    "Cannibalize II": 2.23,
    "Cannibalize III": 2.56,
    "Cannibalize IV": 1.83,
};

// AA Cannibalization ranks 1-9 (user ruling 2026-10-19).
// Ranks 1-4 mirror the spell tiers; rank 5 is early-AA; ranks 6-9 end-game.
const CANNIBALIZATION_AA_RATIOS = [2.63, 2.23, 2.56, 1.83, 1.80, 1.66, 1.66, 1.66, 1.66];

export function cannibalizeSpellRatio(spellName) {
    return CANNIBALIZE_SPELL_RATIOS[spellName] ?? null;
}

export function cannibalizeAARatio(rank) {
    const r = Math.max(1, Math.min(9, Math.floor(Number(rank) || 1)));
    return CANNIBALIZATION_AA_RATIOS[r - 1];
}

export async function applyCannibalize(actor, ratio, label = "Cannibalize") {
    if (!actor) return { ok: false, reason: "No actor." };
    const level = Number(actor.system?.attributes?.level?.value)
        || Number(actor.system?.character?.level) || 1;

    const hpCost = Math.max(1, 2 * level);

    const maxHp = Number(actor.system?.hits?.max)
        ?? Number(actor.system?.attributes?.hits?.max) ?? 0;
    const taken = Number(actor.system?.hits?.taken) || 0;
    const currentHp = maxHp - taken;

    // Cannot kill: leave at least 1 hit, fail if nothing available.
    const affordable = Math.max(0, currentHp - 1);
    if (affordable < hpCost) {
        return {
            ok: false,
            reason: `${actor.name} does not have enough hits to cannibalize (needs ${hpCost}, has ${currentHp}).`
        };
    }

    const manaGained = Math.floor(hpCost / ratio);

    const manaMax = Number(actor.system?.attributes?.mana?.max) || 0;
    const manaValue = Number(actor.system?.attributes?.mana?.value) || 0;
    const newMana = Math.min(manaMax, manaValue + manaGained);

    await actor.update({
        "system.hits.taken": taken + hpCost,
        "system.attributes.mana.value": newMana
    });

    const note = combatCard("Cannibalize", `
        <h2>${esc(label)}</h2>
        <p><em>${esc(actor.name)} sacrifices ${hpCost} hits, gaining ${manaGained} mana (ratio ${ratio}:1).</em></p>`);

    return { ok: true, hpCost, manaGained, note };
}
