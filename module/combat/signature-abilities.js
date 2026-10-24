/**
 * Signature Abilities: Paladin Lay on Hands, Shadowknight Harm Touch
 * (2026-10-07)
 * 
 * Lay on Hands: Heals 15% of max HP + 10% per rank. Melee range. Once per combat. Free.
 * Harm Touch: Damage = ((50 × rank) + (10 × level)) / 10 — the 2026-10-19
 * formula rescaled to RMSS hit totals (ruling 2026-10-20); equals
 * (5 × rank) + level. Melee range. Disease RR at -20 (difficult to
 * resist), three outcome bands — fully / partially / not resisted
 * (ruling 2026-10-23). Once per combat. Free.
 */

import { rrTargetNumber, rrOpenEnded } from "../spells/base-spell.js";
import { EQRMSSAAAdvancement } from "../aa/aa-advancement.js";
import { trackXPHits, trackXPKill } from "../progression/xp-tracker.js";
import { checkHitThresholds } from "./crit-conditions.js";

// ------------------------------------------------------------
// Harm Touch resistance (rulings 2026-10-23)
// ------------------------------------------------------------

// "Difficult to resist": the disease RR carries a flat -20
// penalty. This is the quantification the ability has carried
// since 2026-10-07 — kept as-is by the 2026-10-23 ruling.
const HT_RR_PENALTY = 20;

// PLACEHOLDER (2026-10-23): half-width of the partial-resist
// band around the Table 15.5 target number, in RR points. The
// ruling ("fully or partially resisted") names the bands but
// no width; 20 mirrors the magnitude of the difficulty penalty
// above, so the two are easy to reason about together.
// margin >= +HT_PARTIAL_MARGIN: fully resisted (no damage).
// -HT_PARTIAL_MARGIN <= margin < +HT_PARTIAL_MARGIN: partial.
// margin < -HT_PARTIAL_MARGIN: full effect.
const HT_PARTIAL_MARGIN = 20;

// PLACEHOLDER (2026-10-23): fraction of Harm Touch damage a
// partially-resisted target takes. No partial-resist fraction
// exists anywhere in the system to inherit; halving (floored)
// is the codebase's standard reduction shape (combat-rolls.js,
// subdue.js). One-line flip if the user rules otherwise.
const HT_PARTIAL_DAMAGE_FRACTION = 0.5;

/** Element resist points for a target: gear resistances
 *  (system.resistances[element]) + spellEffects buffs with
 *  scaledTarget "resist-<element>", summed. This replicates —
 *  exactly — elementResistFor in module/spells/base-spell.js
 *  (staged patch, 2026-10-23) and the resist sum performed by
 *  getTargetModifiers in module/item-effects/damage-pipeline.js;
 *  keep all three identical. It is replicated rather than
 *  imported so this file does not stack on the staged patch. */
function elementResistFor(target, element) {
    if (!target || !element) return 0;
    const sys = target.system ?? {};
    const resistances = sys.resistances ?? {};
    let buffResist = 0;
    const fx = sys.status?.spellEffects;
    if (Array.isArray(fx)) {
        const key = `resist-${String(element).toLowerCase()}`;
        for (const e of fx) {
            if (String(e?.scaledTarget ?? "").toLowerCase() === key) {
                buffResist += Number(e?.scaledValue) || 0;
            }
        }
    }
    return (resistances[element] ?? 0) + buffResist;
}

/** The sheet's Poison/Disease resistance-roll block
 *  (system.resistance_rolls.poison_disease: value + race_mod =
 *  total). Grep evidence (2026-10-23): NO code computes .total
 *  and nothing writes .value — the block's only live writer is
 *  the sheet's hand-edited race_mod input, whose intended total
 *  never reached Harm Touch. A stored .total (hand-set outside
 *  the sheet) is respected when present; otherwise the intended
 *  value + race_mod is used, so the sheet block finally counts. */
function legacyPoisonDiseaseResist(target) {
    const pd = target?.system?.resistance_rolls?.poison_disease;
    if (!pd) return 0;
    if (pd.total !== undefined && pd.total !== null && pd.total !== ""
        && Number.isFinite(Number(pd.total))) {
        return Number(pd.total);
    }
    return (Number(pd.value) || 0) + (Number(pd.race_mod) || 0);
}

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function tokenDistanceFt(fromTok, toTok) {
    const canvas = globalThis.canvas;
    const size = Number(canvas?.dimensions?.size) || 0;
    const dist = Number(canvas?.dimensions?.distance) || 0;
    if (!(size > 0) || !(dist > 0)) return null;
    const a = fromTok?.center, b = toTok?.center;
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y) / size * dist;
}

const MELEE_REACH_FT = 8;

// Signature ability -> AA id mapping (2026-10-07): ranks come from the
// actor's purchased AA ranks in system.aa.abilities [{id, rank}].
const SIGNATURE_AA_IDS = {
    "lay-on-hands": "aa-lay-on-hands",
    "harm-touch": "aa-harm-touch"
};

function getSignatureRank(actor, abilityId) {
    const aaId = SIGNATURE_AA_IDS[abilityId];
    if (!aaId) return 1;
    try {
        const rank = EQRMSSAAAdvancement.getPurchasedRank(actor, aaId);
        // Uncapped (2026-10-19 ruling): 34 ranks per EQ Live progression.
        // LoH: 15% + 10%/rank. HT: (50 x rank) + (10 x level).
        return Math.max(1, rank);
    } catch {
        return 1;
    }
}

async function checkUsable(actor, target, abilityName) {
    if (actor.system?.status?.[`${abilityName}Used`]) {
        return { ok: false, reason: `${abilityName} has already been used this combat.` };
    }
    const attackerTok = actor.getActiveTokens?.()?.[0] ?? null;
    const targetTok = target?.getActiveTokens?.()?.[0] ?? null;
    if (attackerTok && targetTok) {
        const feet = tokenDistanceFt(attackerTok, targetTok);
        if (feet !== null && feet > MELEE_REACH_FT + 1e-6) {
            return { ok: false, reason: `${target.name} is ${Math.round(feet)} ft away — out of melee reach.` };
        }
    }
    return { ok: true };
}

export async function layOnHands(actor, target) {
    const name = "Lay on Hands";
    const check = await checkUsable(actor, target, "layOnHands");
    if (!check.ok) {
        ui?.notifications?.warn(check.reason);
        return { ok: false, reason: check.reason };
    }
    const rank = getSignatureRank(actor, "lay-on-hands");
    const percent = 15 + (rank - 1) * 10;
    const maxHp = Number(target.system?.hits?.max) || Number(target.system?.attributes?.hits?.max) || 0;
    const healAmount = Math.floor(maxHp * percent / 100);
    const hitsTaken = Number(target.system?.hits?.value) || 0;
    const newTaken = Math.max(0, hitsTaken - healAmount);
    await target.update({
        "system.hits.value": newTaken,
        "system.status.bleed": { perRound: 0 }
    });
    await checkHitThresholds(target);
    await actor.update({ "system.status.layOnHandsUsed": true });
    const actualHealed = hitsTaken - newTaken;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<h2>${esc(name)}</h2><p><em>${esc(actor.name)} lays hands on ${esc(target.name)}, restoring ${actualHealed} hits (${percent}% of max) and halting bleeding.</em></p>`
    });
    return { ok: true, healed: actualHealed };
}

export async function harmTouch(actor, target) {
    const name = "Harm Touch";
    const check = await checkUsable(actor, target, "harmTouch");
    if (!check.ok) {
        ui?.notifications?.warn(check.reason);
        return { ok: false, reason: check.reason };
    }
    const rank = getSignatureRank(actor, "harm-touch");
    const level = Number(actor.system?.attributes?.level?.value) || 1;
    // Rescaled /10 to RMSS hit scale (ruling 2026-10-20): rank 3 @ 130 = 145,
    // rank 34 @ 130 = 300 (one peer-level hit pool), was 1,450 / 3,000.
    let damage = Math.round(((50 * rank) + (10 * level)) / 10);
    // Era Capstones (2026-10-09): harm-touch-pct increases Harm Touch damage.
    // Unholy Aura: +X% Harm Touch damage.
    try {
        const effects = actor.system?.status?.spellEffects || [];
        for (const e of effects) {
            if (e.source !== "capstone") continue;
            for (const m of (e.modifiers || [])) {
                if (m.target === "harm-touch-pct") {
                    const pct = Number(m.value) || 0;
                    if (pct > 0) damage = Math.round(damage * (1 + pct / 100));
                }
            }
        }
    } catch (e) { /* non-fatal */ }
    
    // Disease RR (2026-10-07; reworked 2026-10-23): canonical
    // Table 15.5 target number and open-ended-both-ways RR from
    // base-spell.js, at -HT_RR_PENALTY (difficult to resist).
    // The defender's disease resistance is the system's unified
    // resist sum — gear + resist-disease buffs (elementResistFor,
    // "disease") — PLUS the sheet's Poison/Disease RR block,
    // which is real hand-maintained data, not dropped. Three
    // bands by margin vs the need (ruling 2026-10-23, "fully or
    // partially resisted"): fully resisted = no damage; partial =
    // HT_PARTIAL_DAMAGE_FRACTION of the damage; else full effect.
    const attackLevel = level;
    const targetLevel = Number(target.system?.attributes?.level?.value) || 1;
    const need = rrTargetNumber(attackLevel, targetLevel);
    const rr = await rrOpenEnded();
    const diseaseResist = elementResistFor(target, "disease") + legacyPoisonDiseaseResist(target);
    const rrTotal = rr.total + diseaseResist - HT_RR_PENALTY;
    const margin = rrTotal - need;
    const band = margin >= HT_PARTIAL_MARGIN ? "full"
        : (margin >= -HT_PARTIAL_MARGIN ? "partial" : "none");
    const appliedDamage = band === "full" ? 0
        : (band === "partial" ? Math.floor(damage * HT_PARTIAL_DAMAGE_FRACTION) : damage);
    const bandLabel = band === "full" ? "FULLY RESISTED"
        : (band === "partial" ? "PARTIALLY RESISTED" : "takes full effect");

    let html = `<h2>${esc(name)}</h2>`;
    html += `<p><strong>Disease resistance roll (${esc(target.name)}):</strong> ${rr.rolls.join(", ")} = ${rr.total} + ${diseaseResist} disease - ${HT_RR_PENALTY} penalty = <strong>${rrTotal}</strong> vs ${need} (levels ${attackLevel} vs ${targetLevel}) — ${bandLabel}</p>`;

    if (band === "full") {
        await actor.update({ "system.status.harmTouchUsed": true });
        html += `<p><em>${esc(target.name)} resists the unholy power!</em></p>`;
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: html
        });
        return { ok: true, damage: 0, resisted: true, partiallyResisted: false, band };
    }

    const wasDead = !!target.system?.status?.dead;
    const currentTaken = Number(target.system?.hits?.value) || 0;
    await target.update({ "system.hits.value": currentTaken + appliedDamage });
    await checkHitThresholds(target);
    // XP tracker (2026-10-20): signature damage counts on the
    // Table 15.4.2 scoreboard like any other damage source.
    await trackXPHits(actor, target, appliedDamage);
    if (!wasDead && target.system?.status?.dead) {
        await trackXPKill(actor, target);
    }
    await actor.update({ "system.status.harmTouchUsed": true });
    html += band === "partial"
        ? `<p><em>${esc(target.name)} partially resists — the unholy power deals ${appliedDamage} of ${damage} damage.</em></p>`
        : `<p><em>${esc(actor.name)} touches ${esc(target.name)} with unholy power, dealing ${damage} damage.</em></p>`;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: html
    });
    return { ok: true, damage: appliedDamage, resisted: false, partiallyResisted: band === "partial", band, fullDamage: damage };
}

export async function resetSignatureAbilities(actor) {
    await actor.update({
        "system.status.layOnHandsUsed": false,
        "system.status.harmTouchUsed": false
    });
}
