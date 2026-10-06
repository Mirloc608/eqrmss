// ============================================================
// WORN-CAST MODS (Phase 5): worn-effect focus modifiers on the
// cast path.
//
// module/data/item-effects/item-effects.json carries 247 worn
// entries in 28 families; each has a structured modifier
// payload. This module gathers the caster's equipped worn
// effects — deduped highest-rank-wins per family through the
// shared dedupHighestRank() from
// module/item-effects/worn-engine.js (the same rule the
// Status-tab Buffs display and the per-round engine use) — and
// folds the cast-relevant payloads into five factors:
//
//   manaFactor     — mana-cost multipliers (Mana Preservation,
//                    Affliction Efficiency/Haste, Summoning
//                    Efficiency, ...)
//   castFactor     — cast-time multipliers (Spell Haste,
//                    Enhancement/Affliction/Summoning Haste)
//   rangeFactor    — spell-range multiplier (Extended Range)
//   durationFactor — spell-duration multiplier (Extended
//                    Enhancement)
//   healingFactor  — healing-amount multiplier (Improved Healing)
//
// Skipped (acknowledged, no cast-path hook):
//   - flowing-thought: regen is owned by the per-round engine.
//   - burning-affliction / minor-burning-affliction
//     (spellDamage): damage is pure-RMSS book tables per the
//     2026-10-04 ruling — no percent-damage hook exists in the
//     bolt/base/ball resolvers.
//   - reagent-conservation / minor-reagent-conservation:
//     reagents are not modeled in the cast engine.
//   - reanimation-efficiency / minor-reanimation-efficiency
//     (summon-undead-only): no summon-undead effect type exists
//     in the spell catalog, so the limit can never be
//     satisfied — inert until such spells exist.
//   - enduring-breath, see-invisible, serpent-sight,
//     truesight: vision/breath flags, not cast-relevant.
//
// Limit semantics (from the catalog payloads):
//   - maxSpellLevel / decayPerLevelOverCap: past the cap the
//     percent magnitude decays by decayPerLevelOverCap points
//     per spell level over cap (floored at 0 — never reverses).
//   - detrimental-only: bolt/base/ball kinds (attack spells).
//   - beneficial-only: heal/later kinds (buffs classify
//     "later"; debuffs classify "base", so "later" is
//     beneficial).
//   - min-duration-Ns: some spell effect has duration >= N
//     seconds (EQ durations are seconds; 1 round = 6s).
//   - min-cast-time-Ns: the spell's system.castTime >= N.
//   - instant-only: system.castTime is exactly 0 (missing
//     castTime is treated as unknown and does NOT qualify).
//   - complete-heal-excluded / percentage-heal-excluded: the
//     one "Complete Heal" spell, and any percent-based heal
//     effect (none exist in the catalog; guarded anyway).
//   - summon-pet-only / summon-undead-only: the spell has a
//     matching summon effect.
//   - combat-skills-not-allowed: N/A — castSpell never casts
//     combat skills.
// ============================================================

import { getItemEffect } from "../data/item-effects/item-effect-loader.js";
import { dedupHighestRank } from "../item-effects/worn-engine.js";
import { isWorn } from "../utils/equipment/equipment-utils.js";
import { spellEffectsOf } from "./spell-mapping.js";

/** Numeric suffix of a "min-duration-30s" / "min-cast-time-3s" limit. */
function limitSeconds(limits, prefix) {
    for (const l of limits ?? []) {
        if (typeof l === "string" && l.startsWith(prefix)) {
            const n = Number(l.slice(prefix.length).replace(/s$/, ""));
            if (Number.isFinite(n)) return n;
        }
    }
    return null;
}

const isDetrimental = (cls) => ["bolt", "base", "ball"].includes(cls?.kind);
const isBeneficial = (cls) => ["heal", "later"].includes(cls?.kind);

function limitsOk(p, ctx) {
    const limits = p.limits ?? [];
    const has = (s) => limits.includes(s);
    if (has("detrimental-only") && !isDetrimental(ctx.cls)) return false;
    if (has("beneficial-only") && !isBeneficial(ctx.cls)) return false;
    const minDur = limitSeconds(limits, "min-duration-");
    if (minDur != null && !ctx.effs.some(e => Number(e?.duration) >= minDur)) return false;
    const minCt = limitSeconds(limits, "min-cast-time-");
    if (minCt != null && !(Number(ctx.castTime) >= minCt)) return false;
    if (has("instant-only") && Number(ctx.castTime) !== 0) return false;
    if (has("hitpoints-only") && ctx.cls?.kind !== "heal") return false;
    if (has("complete-heal-excluded") && /complete heal/i.test(ctx.spellItem?.name ?? "")) return false;
    if (has("percentage-heal-excluded")
        && ctx.effs.some(e => e?.type === "heal" && (e.percent || e.pct || e.unit === "percent"))) return false;
    if (has("summon-pet-only") && !ctx.effs.some(e => e?.type === "summon-pet")) return false;
    if (has("summon-undead-only") && !ctx.effs.some(e => e?.type === "summon-undead")) return false;
    return true;
}

/** Apply maxSpellLevel decay: past the cap the percent magnitude
 *  shrinks by decayPerLevelOverCap points per spell level over
 *  cap, floored at 0 (it never reverses into a penalty). */
function effectivePercent(p, spellLevel) {
    const value = Number(p.value) || 0;
    const cap = Number(p.maxSpellLevel);
    const lvl = Number(spellLevel) || 0;
    if (Number.isFinite(cap) && lvl > cap) {
        const decay = Number(p.decayPerLevelOverCap) || 0;
        const mag = Math.abs(value) - decay * (lvl - cap);
        if (mag <= 0) return 0;
        return Math.sign(value) * mag;
    }
    return value;
}

function foldEntry(mods, effect, p, ctx) {
    if (p?.type !== "modifier") return; // regen payloads etc. are not cast modifiers
    if (!limitsOk(p, ctx)) return;
    const value = effectivePercent(p, ctx.spellLevel);
    if (!value) return; // decayed to zero past the level cap
    const label = effect.name ?? effect.id;
    const rec = (axis, text) => mods.applied.push({
        family: effect.family ?? effect.id, name: label, rank: effect.rank ?? 0, axis, text
    });
    switch (p.modifier) {
        case "manaCost":
            mods.manaFactor *= 1 + value / 100;
            rec("mana", `mana cost ${value}%`);
            break;
        case "castTime": // value is negative: "reduces cast time by 15%"
            mods.castFactor *= 1 + value / 100;
            rec("cast", `cast time ${value}%`);
            break;
        case "spellHaste": // value is positive: EQ "spell haste +30%" = cast time -30%
            mods.castFactor *= 1 - value / 100;
            rec("cast", `spell haste +${value}%`);
            break;
        case "spellRange":
            mods.rangeFactor *= 1 + value / 100;
            rec("range", `range +${value}%`);
            break;
        case "spellDuration":
            mods.durationFactor *= 1 + value / 100;
            rec("duration", `duration +${value}%`);
            break;
        case "healing":
            mods.healingFactor *= 1 + value / 100;
            rec("healing", `healing +${value}%`);
            break;
        default:
            // spellDamage, reagentConservation, vision, breath:
            // acknowledged, no hook in the cast path (see header).
            break;
    }
}

/**
 * Gather the caster's worn cast modifiers.
 * @returns {{ manaFactor, castFactor, rangeFactor, durationFactor,
 *   healingFactor, applied: Array<{family,name,rank,axis,text}> }}
 * With no worn effects every factor is 1 and applied is empty.
 */
export function gatherWornCastMods(actor, spellItem, cls) {
    const mods = {
        manaFactor: 1, castFactor: 1, rangeFactor: 1,
        durationFactor: 1, healingFactor: 1,
        applied: []
    };
    const worn = (actor?.items ?? []).filter(i => isWorn(i) && i.system?.wornEffect);
    if (!worn.length) return mods;
    const resolved = worn.map(item => ({ item, effect: getItemEffect(item.system.wornEffect) }));
    const { kept } = dedupHighestRank(resolved);
    const ctx = {
        cls,
        spellItem,
        effs: spellEffectsOf(spellItem),
        spellLevel: Number(spellItem?.system?.level) || 0,
        castTime: Number(spellItem?.system?.castTime)
    };
    for (const { effect } of kept) {
        if (!effect || effect.kind !== "worn") continue;
        if (effect.family === "flowing-thought") continue; // per-round engine owns regen
        for (const p of effect.payload ?? []) foldEntry(mods, effect, p, ctx);
    }
    return mods;
}
