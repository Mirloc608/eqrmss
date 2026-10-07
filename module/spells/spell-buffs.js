// ============================================================
// SPELL BUFFS (2026-10-07). Spell buff effects (type: "buff")
// apply as timed spellEffects entries with source "spell",
// using the same EQRMSS scaling as bard songs (EQ÷10, min 1,
// AC 1:1 to DB). Mirrors module/spells/songs.js getSongModifiers.
// ============================================================

import { scaleSongValue, checkBuffStacking } from "./songs.js";
import { durationRounds, rollAmount } from "./base-spell.js";
import { spellEffectsOf } from "./spell-mapping.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/**
 * Sum active spell buff modifiers for an actor.
 * Reads system.status.spellEffects entries with source "spell".
 * Returns { statBonuses: {str: 4}, db: 2, movement: 0, mana: 0, hits: 0 }.
 * Mirrors getSongModifiers() in songs.js.
 */
export function getSpellModifiers(actor) {
    const out = { statBonuses: {}, db: 0, movement: 0, mana: 0, hits: 0 };
    const fx = actor?.system?.status?.spellEffects;
    if (!Array.isArray(fx)) return out;
    for (const e of fx) {
        if (e?.source !== "spell") continue;
        // Skip regen entries (they tick, not buff)
        if (e?.kind === "regen") continue;
        const target = e?.scaledTarget;
        const val = Number(e?.scaledValue) || 0;
        if (!target || !val) continue;
        if (target === "statBonus" && e?.scaledStat) {
            const k = String(e.scaledStat).toLowerCase();
            out.statBonuses[k] = (out.statBonuses[k] || 0) + val;
        } else if (target === "db") out.db += val;
        else if (target === "movement") out.movement += val;
        else if (target === "mana") out.mana += val;
        else if (target === "hits" || target === "hp") out.hits += val;
    }
    return out;
}

/**
 * Apply spell buff effects (type: "buff") as timed spellEffects entries.
 * Uses rollAmount() for min/max ranges, scaleSongValue() for EQRMSS scaling.
 * Returns HTML notes for the chat card.
 */
export async function applySpellBuffs(caster, spellItem, target, durationFactor = 1) {
    if (!target) return "";
    const canTouch = target.isOwner || globalThis.game?.user?.isGM;
    const name = spellItem?.name ?? "spell";
    const notes = [];
    
    // Get effects via spellEffectsOf (falls back to catalog)
    const effects = spellEffectsOf(spellItem) ?? [];
    
    for (const eff of effects) {
        if (!eff || typeof eff !== "object") continue;
        if (String(eff.type ?? "").toLowerCase() !== "buff") continue;
        
        const stat = String(eff.stat ?? "").toLowerCase();
        // Skip stat caps (str-cap, dex-cap) — not buffs
        if (stat.endsWith("-cap")) continue;
        // Skip non-mechanical stats (handled as text only)
        // Valid: str, sta, agi, dex, wis, int, cha, ac, hp, hp-max, mana, movement
        
        const rawValue = rollAmount(eff);
        if (!(rawValue > 0)) continue;
        
        // Scale using song scaling (EQ÷10, min 1, AC 1:1)
        // Map hp-max to hp for scaling
        const scaleStat = stat === "hp-max" ? "hp" : stat;
        const scaled = scaleSongValue(scaleStat, rawValue);

        // Stacking (2026-10-07, Option A): per-stat highest wins
        const stack = checkBuffStacking(target, scaled.target, scaled.stat, scaled.value);
        if (stack.action === "block") {
            let bdesc = stat.toUpperCase();
            if (scaled.target === "db") bdesc = "Defense";
            notes.push(`${esc(target.name)}: ${bdesc} +${scaled.value} blocked by stronger ${esc(stack.blockedBy)} (${esc(name)}).`);
            continue;
        }

        const rounds = durationRounds(eff.duration) ?? 10;
        const effRounds = durationFactor === 1 ? rounds : Math.max(1, Math.round(rounds * durationFactor));
        
        if (!canTouch) {
            notes.push(`Buff not applied — you don't control ${esc(target.name)}.`);
            continue;
        }
        
        // Human-readable description (2026-10-07: AC → Defense, not "AC buff")
        let desc = "";
        if (scaled.target === "db") desc = `Defense +${scaled.value}`;
        else if (scaled.target === "movement") desc = `Movement +${scaled.value}`;
        else if (scaled.target === "statBonus") {
            const rmss = { str: "ST", sta: "CO", agi: "AG", dex: "QU", wis: "EM", int: "ME", cha: "PR" }[scaled.stat] ?? scaled.stat.toUpperCase();
            desc = `${rmss} +${scaled.value}`;
        } else if (scaled.target === "hp" || scaled.target === "hits") desc = `Max HP +${scaled.value}`;
        else if (scaled.target === "mana") desc = `Max Mana +${scaled.value}`;
        else desc = `${stat.toUpperCase()} +${scaled.value}`;
        
        let list = [...(Array.isArray(target.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
        if (stack.action === "replace") {
            const toRemove = new Set(stack.replaces);
            list = list.filter(e => !toRemove.has(e));
            notes.push(`${esc(target.name)}: replaces weaker buff for ${esc(stat.toUpperCase())} (${esc(name)}).`);
        }
        list.push({
            label: `${name} — ${desc} (spell)`,
            source: "spell",
            kind: "buff",
            stat: stat,
            scaledTarget: scaled.target,
            scaledStat: scaled.stat ?? null,
            scaledValue: scaled.value,
            roundsLeft: effRounds,
            casterId: caster?.id ?? "",
            spellId: spellItem?.id ?? spellItem?._id ?? "",
            spell: name
        });
        await target.update({ "system.status.spellEffects": list });
        
        notes.push(`${esc(target.name)}: ${desc} for ${effRounds} rounds (${esc(name)}).`);
    }
    
    return notes.length ? `<p><em>${notes.join("<br>")}</em></p>` : "";
}
