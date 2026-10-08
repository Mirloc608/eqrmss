// ============================================================
// CAST SPELL (Stages 2-3): the cast path from an actor's spell
// item. Resource is EQ mana (attributes.mana, EQ manaCost;
// ruling 2026-10-04). Directed (bolt) spells run through the
// weapon-attack engine — the spell is presented as a synthetic
// weapon carrying the derived attack table and the book's
// Directed Spells OB (caster level + Agility bonus + Directed
// Spells rank bonus).
// Heal spells restore hits and trigger the healing-magic hook
// (bleed stopped, death timer cleared).
//
// Stage 3 casting risk (Spell Law §10.9, full book modifier
// set): before anything is spent, the ESF gate sums the
// applicable modifications; a failed ESF roll sends the caster
// to the Spell Failure Table (15.7) and the mana is never spent
// (the book's "lose spell (but not pts.)" outcome). A passed
// ESF roll is noted on the cast card. A bolt table "F" cell is
// a natural failure, resolved inside the attack engine.
//
// Stage 4: hostile non-bolt spells (poison/disease damage,
// DoTs, controls, debuffs, lifetaps) resolve as base spell
// attacks — Base Attack Roll + Resistance Roll (module/spells/
// base-spell.js), effects landing in the condition tick.
//
// Stage 5: area-target elemental spells resolve on the ball
// attack tables with ONE shared Elemental Attack Roll per the
// user's ruling (module/spells/ball-spell.js); area base
// spells make one shared BAR cross-indexed per target.
//
// Phase 5: worn-effect focus modifiers (Mana Preservation,
// Spell Haste, Extended Range, ...) from
// module/spells/worn-cast-mods.js apply before the ESF gate
// and the mana spend: the reduced cost is what's deducted,
// and the applied modifiers are posted on the cast card.
// ============================================================

import { combatCard } from "../combat/chat-card.js";
import { classifySpell, directedSpellsOB, spellEffectsOf } from "./spell-mapping.js";
import { applySpellBuffs } from "./spell-buffs.js";
import { applyInvisibility, invisTypeOf, breakInvisibility } from "./invisibility.js";
import { applyLevitate } from "./levitate.js";
import { applyIllusion } from "../item-effects/damage-pipeline.js";
import { applyTeleport } from "./teleport.js";
import { summonItem } from "./summon.js";
import { gatherWornCastMods } from "./worn-cast-mods.js";
import { esfGate, resolveSpellFailure } from "./spell-failure.js";
import {
    resolveBaseSpellAttack, applyBaseSpellEffect,
    d100, barLevelBonus, rangeModFor, rollAmount, durationRounds
} from "./base-spell.js";
import { resolveBallCast } from "./ball-spell.js";
import { rollWeaponAttack } from "../combat/combat-rolls.js";
import { applyHealingSpell, checkHitThresholds } from "../combat/crit-conditions.js";
import {
    getCastTimeMode, waitRoundsFor, checkRange,
    storePendingCast, clearPendingCast
} from "./cast-timing.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

function targetedActor() {
    const t = [...(globalThis.game?.user?.targets ?? [])][0];
    return t?.actor ?? null;
}

/** Every currently-targeted actor (ball spells and area base
 *  spells resolve against all of them). */
function targetedActors() {
    return [...(globalThis.game?.user?.targets ?? [])]
        .map(t => t?.actor)
        .filter(a => a && a !== undefined);
}

/** Blast radius in feet, from the spell's damage effect. */
export function blastRadiusFt(spellItem) {
    const effs = spellItem?.system?.effects ?? [];
    const dmg = effs.find(e => e?.type === "damage" && Number(e?.radius) > 0);
    return Number(dmg?.radius) || 0;
}

/** Everyone caught in a ball blast: every token within the
 *  spell's radius of the aim point — not just targeted tokens.
 *  Center-based measurement; returns null when the canvas is
 *  unavailable so the caller keeps the targeted list. */
function blastActors(aimActor, radiusFt) {
    const canvas = globalThis.canvas;
    const placeables = canvas?.tokens?.placeables ?? [];
    if (!aimActor || !(radiusFt > 0) || !placeables.length) return null;
    // Deterministic pixel math (no grid-API dependence): feet =
    // pixel distance / px-per-square * feet-per-square.
    const size = Number(canvas?.dimensions?.size) || 0;
    const dist = Number(canvas?.dimensions?.distance) || 0;
    if (!(size > 0) || !(dist > 0)) return null;
    const aimTok = placeables.find(t => t?.actor?.id === aimActor.id)
        ?? aimActor.getActiveTokens?.()?.[0] ?? null;
    const from = aimTok?.center;
    if (!from) return null;
    const seen = new Map();
    for (const t of placeables) {
        const a = t?.actor;
        const c = t?.center;
        if (!a || !c || seen.has(a.id)) continue;
        const feet = Math.hypot(c.x - from.x, c.y - from.y) / size * dist;
        if (feet <= radiusFt + 1e-6) seen.set(a.id, a);
    }
    // The aim point is always inside its own blast.
    if (!seen.has(aimActor.id)) seen.set(aimActor.id, aimActor);
    return seen.size ? [...seen.values()] : null;
}

/** The synthetic "weapon" a bolt cast rolls on the attack table. */
export function syntheticBoltWeapon(actor, spellItem, cls) {
    return {
        _id: spellItem.id ?? spellItem._id ?? "cast-spell",
        id: spellItem.id ?? spellItem._id ?? "cast-spell",
        name: spellItem.name ?? "spell",
        type: "weapon",
        system: {
            type: "spell",
            attackTable: cls.attackTable,
            obMod: directedSpellsOB(actor),
            damageMod: 0,
            criticalType: cls.critType ?? "",
            location: "equipped",
            equipped: true
        }
    };
}

/**
 * Mana-regen buffs (Clarity, the beastlord purity line) land as
 * timed regen entries ticking each round in tickConditions; a
 * heal-over-time component lands as hits regen the same way.
 * Other buff payloads stay announced-only.
 */
async function applyRegenBuff(caster, spellItem, durationFactor = 1) {
    const target = targetedActor() ?? caster;
    if (!target) return "";
    const canTouch = target.isOwner || globalThis.game?.user?.isGM;
    const name = spellItem?.name ?? "spell";
    const notes = [];
    for (const eff of spellEffectsOf(spellItem)) {
        if (!eff || typeof eff !== "object") continue;
        const isManaRegen = eff.type === "regen" && (eff.stat === "mana" || eff.pool === "mana");
        const isHot = eff.type === "heal" && Number(eff.duration) > 0;
        if (!isManaRegen && !isHot) continue;
        const amount = rollAmount(eff);
        const rounds = durationRounds(eff.duration);
        // Phase 5: Extended Enhancement stretches buff
        // durations; with no worn effects this is rounds.
        const effRounds = durationFactor === 1 ? rounds : Math.max(1, Math.round(rounds * durationFactor));
        if (!(amount > 0) || effRounds == null) continue;
        if (!canTouch) {
            notes.push(`Regen not applied — you don't control ${esc(target.name)}.`);
            continue;
        }
        const list = [...(Array.isArray(target.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
        list.push({
            kind: "regen",
            pool: isManaRegen ? "mana" : "hits",
            amount, roundsLeft: effRounds,
            label: name, source: "spell"
        });
        await target.update({ "system.status.spellEffects": list });
        notes.push(isManaRegen
            ? `${esc(target.name)} regenerates ${amount} mana/round for ${effRounds} rounds (${esc(name)}).`
            : `${esc(target.name)} regenerates ${amount} hits/round for ${effRounds} rounds (${esc(name)}).`);
    }
    return notes.length ? `<p><em>${notes.join("<br>")}</em></p>` : "";
}

/**
 * Cast a spell from an actor's spell item. Returns a small
 * summary object; posts chat for every outcome.
 * opts: { prepRoundsShort } — preparation shortage for the ESF
 * sum (the cast path assumes book-standard preparation).
 */
/** One-line chat-card note of the worn focus modifiers that
 *  applied to this cast, or "" when none did. Follows the
 *  existing <p><em> note pattern. */
function wornNoteFor(worn, spellItem, baseCost, cost) {
    if (!worn.applied.length) return "";
    const r2 = (n) => Math.round(n * 100) / 100;
    const bits = [];
    const seen = new Set();
    for (const a of worn.applied) {
        const key = `${a.family}:${a.axis}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (a.axis === "mana") bits.push(`${esc(a.name)} (mana ${baseCost} → ${cost})`);
        else if (a.axis === "cast") {
            const ct = Number(spellItem?.system?.castTime);
            bits.push(Number.isFinite(ct)
                ? `${esc(a.name)} (cast ${ct}s → ${r2(ct * worn.castFactor)}s)`
                : `${esc(a.name)} (cast time ×${r2(worn.castFactor)})`);
        }
        else if (a.axis === "range") {
            const r = Number(spellItem?.system?.range);
            bits.push(Number.isFinite(r)
                ? `${esc(a.name)} (range ${r} → ${Math.round(r * worn.rangeFactor)})`
                : `${esc(a.name)} (range ×${r2(worn.rangeFactor)})`);
        }
        else if (a.axis === "duration") bits.push(`${esc(a.name)} (duration ×${r2(worn.durationFactor)})`);
        else if (a.axis === "healing") bits.push(`${esc(a.name)} (healing ×${r2(worn.healingFactor)})`);
    }
    return `<p><em>Worn focus: ${bits.join("; ")}.</em></p>`;
}

export async function castSpell(actor, spellItem, opts = {}) {
    if (!actor || !spellItem) return { ok: false, reason: "missing" };
    // Invisibility (2026-10-07): casting any spell breaks the
    // caster's invisibility BEFORE the action resolves — even if
    // the cast later fails at the ESF gate or on mana.
    await breakInvisibility(actor, "casting");
    const name = spellItem.name ?? "spell";
    const cls = classifySpell(spellItem);
    // Phase 5: worn-effect focus modifiers (deduped
    // highest-rank-wins per family) gather BEFORE the ESF gate
    // and the mana spend, so the reduced cost is what the
    // mana check and the spend below see. With no worn effects
    // every factor is 1 and this block is a no-op.
    const worn = gatherWornCastMods(actor, spellItem, cls);
    const baseCost = Math.max(0, Number(spellItem.system?.manaCost) || 0);
    const cost = worn.manaFactor === 1 ? baseCost : Math.max(0, Math.round(baseCost * worn.manaFactor));
    const wornNote = wornNoteFor(worn, spellItem, baseCost, cost);
    // Compact factor summary attached to the success returns so
    // a future cast-timer / range check can consume it.
    const mods = {
        manaFactor: worn.manaFactor, castFactor: worn.castFactor,
        rangeFactor: worn.rangeFactor, durationFactor: worn.durationFactor,
        healingFactor: worn.healingFactor
    };
    const pool = actor.system?.attributes?.mana ?? { value: 0, max: 0 };
    const before = Number(pool.value) || 0;

    // ---- Delayed fire (Option A): ESF passed and mana spent at declaration.
    // Skip checks/gate/spend; resolve with stored targets.
    let delayedTargets = null;
    let skipToResolution = false;
    if (opts._delayedFire) {
        delayedTargets = Array.isArray(opts._delayedTargets) ? opts._delayedTargets : [];
        // No-op the mana spend (already spent at declaration)
        skipToResolution = true;
    }

    if (!skipToResolution && cost > before) {
        ui.notifications?.warn(`${actor.name} cannot cast ${name}: needs ${cost} mana, has ${before}.`);
        return { ok: false, reason: "mana" };
    }

    // Targets are required before anything else for base and
    // ball spells (checked before the ESF gate so a missing
    // target never triggers a failure roll). Area base spells
    // and balls resolve against every targeted token.
    let baseTargets = [];
    if (cls.kind === "base") {
        baseTargets = delayedTargets ?? targetedActors().filter(t => t !== actor);
        if (!baseTargets.length) {
            ui.notifications?.warn(`${actor.name} cannot cast ${name}: base spells need a target other than the caster.`);
            return { ok: false, reason: "target" };
        }
    }
    let ballTargets = [];
    if (cls.kind === "ball") {
        ballTargets = delayedTargets ?? targetedActors();
        if (!ballTargets.length) {
            ui.notifications?.warn(`${actor.name} cannot cast ${name}: ball spells need at least one targeted token.`);
            return { ok: false, reason: "target" };
        }
    }

    // Displaced-spell landing (Table 15.7): the failure path needs
    // the target token for the book-directed start point.
    let displaceCtx = null;
    {
        const casterTok = actor.getActiveTokens?.()?.[0] ?? null;
        let targetTok = null;
        if (cls.kind === "bolt") targetTok = [...(globalThis.game?.user?.targets ?? [])][0] ?? null;
        else if (cls.kind === "base") targetTok = baseTargets[0]?.getActiveTokens?.()?.[0] ?? null;
        else if (cls.kind === "ball") targetTok = ballTargets[0]?.getActiveTokens?.()?.[0] ?? null;
        if (targetTok) displaceCtx = { kind: cls.kind, targetToken: targetTok, casterToken: casterTok };
    }

    // ---- Range check (before ESF: out-of-range never triggers a failure roll) ----
    // (skipped for delayed fire — checked at declaration)
    if (!skipToResolution) {
        const rangeTargets = cls.kind === "base" ? baseTargets
            : cls.kind === "ball" ? ballTargets
            : cls.kind === "bolt" ? [targetedActor()].filter(Boolean)
            : [targetedActor() ?? actor].filter(Boolean);
        const rangeCheck = checkRange(actor, spellItem, rangeTargets, worn.rangeFactor);
        if (!rangeCheck.ok) {
            ui.notifications?.warn(`${actor.name} cannot cast ${name}: ${rangeCheck.detail}`);
            return { ok: false, reason: "range", detail: rangeCheck.detail };
        }
    }

    // ---- Ready-spell check (user ruling 2026-10-06): spells not in
    // the caster's ready list suffer the ESF short-preparation penalty
    // (+25, 1 round short), regardless of cast time. Ready spells are
    // managed on the Spells tab (out of combat only).
    let prepRoundsShort = Number(opts.prepRoundsShort) || 0;
    {
        const spellId = spellItem.id ?? spellItem._id;
        const readySpells = actor.system?.status?.readySpells ?? [];
        if (spellId && !readySpells.includes(spellId)) {
            prepRoundsShort = Math.max(prepRoundsShort, 1);
        }
    }

    // ---- ESF gate (before the mana is spent) ----
    // (skipped for delayed fire — passed at declaration)
    const gate = skipToResolution ? { required: false, passed: true }
        : await esfGate(actor, spellItem, {
        attackSpell: cls.kind === "bolt" || cls.kind === "base" || cls.kind === "ball",
        prepRoundsShort,
        displace: displaceCtx
    });
    if (gate.required && !gate.passed) {
        return { ok: false, reason: "esf", esf: gate.esf.total, failure: gate.failure?.entry ?? null };
    }
    const esfNote = skipToResolution ? "" : (gate.required ? `<p><em>${esc(gate.note)}</em></p>` : "");

    // ---- Cast time enforcement (GM setting: rounds / instant / off) ----
    // (skipped for delayed fire — already handled at declaration)
    const castMode = skipToResolution ? "off" : getCastTimeMode();
    if (castMode === "instant") {
        // Option B: fizzle if the caster took damage this round
        if (actor.system?.status?.damagedThisRound) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<p><em>${esc(actor.name)} tries to cast ${esc(name)} but is reeling from damage — the spell fizzles! (no mana spent)</em></p>`
            });
            return { ok: false, reason: "interrupted", mode: "instant" };
        }
    } else if (castMode === "rounds") {
        // Option A: delayed casting for longer spells
        const waitRounds = waitRoundsFor(spellItem, worn.castFactor);
        if (waitRounds > 1) {
            // Spend mana upfront, store pending, fire after (waitRounds - 1) full rounds
            const delayRounds = waitRounds - 1;
            const pendingTargetIds = (cls.kind === "base" ? baseTargets
                : cls.kind === "ball" ? ballTargets
                : [targetedActor()].filter(Boolean)
            ).map(t => t.id).filter(Boolean);
            // Spend mana now (duplicate of spendMana to avoid closure issues)
            if (cost > 0) {
                const derivedMax = Number(actor.system?.derived?.manaMax) || Number(pool.max) || 0;
                await actor.update({
                    "system.attributes.mana.value": before - cost,
                    "system.attributes.mana.max": Math.max(Number(pool.max) || 0, derivedMax)
                });
            }
            await storePendingCast(actor, spellItem, pendingTargetIds, opts, delayRounds);
            const castSecs = (Number(spellItem.system?.castTime) || 0) * (worn.castFactor || 1);
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: combatCard("Spellcasting", `
                    <h2>${esc(actor.name)} begins casting ${esc(name)}</h2>
                    ${esfNote}${wornNote}
                    <p><em>Cast time ${Math.round(castSecs * 10) / 10}s — fires in ${delayRounds} round${delayRounds === 1 ? "" : "s"}. Mana ${before} → ${before - cost}.</em></p>`)
            });
            return { ok: true, kind: cls.kind, delayed: true, waitRounds: delayRounds, mods };
        }
        // waitRounds <= 1: cast immediately (fall through)
    }
    // mode "off": no cast-time enforcement (fall through)

    const spendMana = async () => {
        if (skipToResolution) return; // already spent at declaration
        if (cost <= 0) return;
        // Persist the derived max with the spend: prepare only lifts
        // the in-memory pool, so without a stored max the lift would
        // re-apply on top of the spent value at the next prepare.
        const derivedMax = Number(actor.system?.derived?.manaMax) || Number(pool.max) || 0;
        await actor.update({
            "system.attributes.mana.value": before - cost,
            "system.attributes.mana.max": Math.max(Number(pool.max) || 0, derivedMax)
        });
    };
    const manaNote = skipToResolution ? " (mana spent at declaration)"
        : cost > 0 ? ` Mana ${before} → ${before - cost}.` : "";

    if (cls.kind === "bolt") {
        await spendMana();
        const synthetic = syntheticBoltWeapon(actor, spellItem, cls);
        // Bolt casts have no final card of their own (the
        // attack engine posts next), so the worn note rides the
        // ESF pre-card, posted when either note is non-empty.
        if (esfNote || wornNote) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: combatCard("Spellcasting", `
                    <h2>${esc(actor.name)} casts ${esc(name)}</h2>
                    ${esfNote}${wornNote}`)
            });
        }
        await rollWeaponAttack(actor, synthetic, { forcedCritType: cls.critType });
        return { ok: true, kind: "bolt", attackTable: cls.attackTable, mods };
    }

    if (cls.kind === "heal") {
        await spendMana();
        const target = targetedActor() ?? actor;
        const canTouch = target.isOwner || game.user?.isGM;
        let healLine = "";
        // Spells with both heal and buffs (e.g., Inner Fire) apply buffs too (2026-10-07 fix).
        const healBuffNote = await applySpellBuffs(actor, spellItem, target, worn.durationFactor);
        // Phase 5: Improved Healing (and kin) scale the heal
        // amount; with no worn effects this is exactly cls.amount.
        // Always round (2026-10-07 fix: fractional heals left float garbage).
        const healAmount = Math.round(cls.amount * (worn.healingFactor || 1));
        if (canTouch) {
            // Per ruling, ANY direct healing magic stops bleeding and
            // clears the death timer; then hits are restored.
            await applyHealingSpell(target);
            const cur = Number(target.system?.hits?.value) || 0;
            const restored = Math.min(healAmount, cur);
            await target.update({ "system.hits.value": Math.round(cur - restored) });
            await checkHitThresholds(target);
            healLine = `<p><em>${esc(target.name)} recovers ${restored} hits (${cur} → ${cur - restored}).</em></p>`;
        } else {
            healLine = `<p><em>Healing not applied — you don't control ${esc(target.name)}.</em></p>`;
        }
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Spellcasting", `
                <h2>${esc(actor.name)} casts ${esc(name)} on ${esc(target.name)}</h2>
                ${healLine}${healBuffNote}${esfNote}${wornNote}<p><em>${manaNote.trim()}</em></p>`)
        });
        return { ok: true, kind: "heal", amount: healAmount, mods };
    }

    if (cls.kind === "base") {
        await spendMana();
        if (esfNote) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: combatCard("Spellcasting", `
                    <h2>${esc(actor.name)} casts ${esc(name)}</h2>
                    ${esfNote}`)
            });
        }
        // Area base spells make ONE Base Attack Roll, cross-
        // indexed per target; single-target base spells roll
        // inside resolveBaseSpellAttack as before.
        let sharedBar = null;
        if (baseTargets.length > 1) {
            const natural = await d100(opts.rollD100);
            if (natural <= 2) {
                await resolveSpellFailure(actor, spellItem, {
                    section: "attack", esfTotal: 0, rollD100: opts.rollD100,
                    headerHtml: `<p><strong>Base attack roll ${natural}</strong> — automatic spell failure (Spell Law 8.3).</p>`
                });
                return { ok: true, kind: "base", failed: true };
            }
            const coverMod = opts.cover === "full" ? -20 : opts.cover === "partial" ? -10 : 0;
            sharedBar = {
                natural,
                modified: natural + barLevelBonus(actor) + rangeModFor(opts.rangeFeet)
                    + coverMod + (opts.staticTarget ? 10 : 0)
            };
        }
        let body = "";
        const applied = [];
        for (const baseTarget of baseTargets) {
            const res = await resolveBaseSpellAttack(actor, spellItem, baseTarget, {
                rangeFeet: opts.rangeFeet, cover: opts.cover, staticTarget: opts.staticTarget,
                willing: opts.willing, rrMod: opts.rrMod, rollD100: opts.rollD100, sharedBar
            });
            if (res.failed) return { ok: true, kind: "base", failed: true };
            let effectNote = "";
            if (!res.resisted) {
                effectNote = (baseTarget.isOwner || game.user?.isGM)
                    ? await applyBaseSpellEffect(actor, baseTarget, cls, spellItem)
                    : `<p><em>Effect not applied — you don't control ${esc(baseTarget.name)}.</em></p>`;
            }
            body += `<h3>${esc(baseTarget.name)}</h3>${res.html}${effectNote}`;
            applied.push({ target: baseTarget.name, resisted: res.resisted });
        }
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Base Spell Attack", `
                <h2>${esc(actor.name)} casts ${esc(name)}${baseTargets.length > 1 ? ` (${baseTargets.length} targets)` : ` on ${esc(baseTargets[0].name)}`}</h2>
                ${body}${wornNote}<p><em>${manaNote.trim()}</em></p>`)
        });
        return { ok: true, kind: "base", targets: applied, resisted: baseTargets.length === 1 ? applied[0].resisted : undefined, mods };
    }

    if (cls.kind === "ball") {
        await spendMana();
        if (esfNote) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: combatCard("Spellcasting", `
                    <h2>${esc(actor.name)} casts ${esc(name)}</h2>
                    ${esfNote}`)
            });
        }
        const aimActor = ballTargets[0] ?? null;
        const centerId = opts.centerId ?? aimActor?.id ?? null;
        // The blast catches everyone in the radius, not just the
        // targeted tokens: sweep the canvas around the aim point.
        const swept = blastActors(aimActor, blastRadiusFt(spellItem));
        const blastList = swept ?? ballTargets;
        const res = await resolveBallCast(actor, spellItem, blastList, {
            table: cls.attackTable, critType: cls.critType
        }, {
            rangeFeet: opts.rangeFeet, centerId,
            coverMod: opts.cover === "full" ? -60 : opts.cover === "partial" ? -30 : 0,
            rollD100: opts.rollD100
        });
        if (res.failed && res.error) {
            ui.notifications?.warn(res.error);
            return { ok: false, reason: "table" };
        }
        if (res.failed) return { ok: true, kind: "ball", failed: true };
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Ball Spell", `
                <h2>${esc(actor.name)} casts ${esc(name)} (${blastList.length} in the blast)</h2>
                ${res.html}${wornNote}<p><em>${manaNote.trim()}</em></p>`)
        });
        return { ok: true, kind: "ball", mods };
    }

    // Announced cast (buff/utilities and later-stage tracks land
    // their mechanics in later stages; the mana economy is live).
    await spendMana();
    const regenNote = await applyRegenBuff(actor, spellItem, worn.durationFactor);
    const buffTarget = targetedActor() ?? actor;
    const buffNote = await applySpellBuffs(actor, spellItem, buffTarget, worn.durationFactor);
    // Invisibility (2026-10-07): wire to Foundry's native `invisible` status.
    let invisNote = "";
    for (const eff of spellEffectsOf(spellItem) ?? []) {
        if (String(eff?.type ?? "").toLowerCase() !== "invisibility") continue;
        const itype = invisTypeOf(eff);
        const rounds = durationRounds(eff.duration) ?? 200;
        invisNote += await applyInvisibility(buffTarget, name, itype, rounds);
    }
    // Levitate (2026-10-07): wire to `flying` status.
    let levNote = "";
    for (const eff of spellEffectsOf(spellItem) ?? []) {
        if (String(eff?.type ?? "").toLowerCase() !== "levitate") continue;
        const rounds = durationRounds(eff.duration) ?? 200;
        levNote += await applyLevitate(buffTarget, name, rounds);
    }
    // Illusion (2026-10-07): racial appearance illusion, same mechanics
    // as illusion clickies. Spell durations are seconds — convert to rounds.
    let illusionNote = "";
    const illusionEffs = (spellEffectsOf(spellItem) ?? []).filter(e => String(e?.type ?? "").toLowerCase() === "illusion");
    if (illusionEffs.length) {
        if (!(buffTarget.isOwner || globalThis.game?.user?.isGM)) {
            illusionNote = `<p><em>Illusion not applied — you don't control ${esc(buffTarget.name)}.</em></p>`;
        } else {
            for (const eff of illusionEffs) {
                const rounds = durationRounds(eff.duration) ?? 360;
                const res = await applyIllusion({ effect: { ...eff, rounds }, target: buffTarget, source: name });
                illusionNote += `<p><em>${esc(buffTarget.name)}: ${esc(res.notes.join(" "))}</em></p>`;
            }
        }
    }
    // Teleport (2026-10-07): EQ teleport/gate/translocate/evac/bind mechanics.
    // Spell data uses effect names: teleport-self, teleport, teleport-group,
    // teleport-anchor, teleport-to-caster, translocate, translocate-bind,
    // translocate-bind-group, evacuate-group, evacuate-self, evacuate-single,
    // gate, bind, bind-affinity.
    let teleportNote = "";
    const teleportEffs = (spellEffectsOf(spellItem) ?? []).filter(e => {
        const k = String(e?.effect ?? "").toLowerCase();
        return ["teleport-self", "teleport", "teleport-group", "teleport-anchor",
            "teleport-to-caster", "translocate", "translocate-bind",
            "translocate-bind-group", "evacuate-group", "evacuate-self",
            "evacuate-single", "gate", "bind", "bind-affinity"].includes(k);
    });
    if (teleportEffs.length) {
        for (const eff of teleportEffs) {
            teleportNote += await applyTeleport({ effect: eff, caster: actor, target: buffTarget, spellName: name });
        }
    }
    // Summon Item (2026-10-07): EQ summon-item spells create Item documents
    // on the caster. Spell data uses effect: "summon-item" with item/quantity.
    let summonNote = "";
    const summonEffs = (spellEffectsOf(spellItem) ?? []).filter(e =>
        String(e?.effect ?? "").toLowerCase() === "summon-item");
    if (summonEffs.length) {
        for (const eff of summonEffs) {
            summonNote += await summonItem({
                caster: buffTarget,
                itemId: eff.item,
                quantity: eff.quantity,
                intoBag: eff.intoBag,
                spellName: name,
            });
        }
    }
    const note = cls.kind === "later" ? esc(cls.reason) : "no mechanical payload";
    // Suppress the "announced" line if the buff/regen/invis/levitate/illusion/
    // teleport/summon pipeline already produced output (2026-10-07: redundant when buffs
    // applied or were blocked by stacking — the pipeline's own message says
    // what happened).
    const announcedLine = (regenNote || buffNote || invisNote || levNote || illusionNote || teleportNote || summonNote)
        ? ""
        : `<p><em>Cast announced — ${note}.</em></p>`;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: combatCard("Spellcasting", `
            <h2>${esc(actor.name)} casts ${esc(name)}</h2>
            ${esfNote}${wornNote}${regenNote}${buffNote}${invisNote}${levNote}${illusionNote}${teleportNote}${summonNote}${announcedLine}<p><em>${manaNote.trim()}</em></p>`)
    });
    return { ok: true, kind: cls.kind, mods };
}

/**
 * Fire a delayed (Option A) pending cast.
 * The ESF gate passed and mana was spent at declaration time;
 * this skips straight to resolution with the stored targets.
 */
export async function fireDelayedCast(actor, pending) {
    if (!actor || !pending?.spellItemId) return { ok: false, reason: "missing" };
    const spellItem = actor.items?.get(pending.spellItemId);
    if (!spellItem) {
        await globalThis.ChatMessage?.create({
            speaker: globalThis.ChatMessage.getSpeaker({ actor }),
            content: `<p><em>${actor.name}'s ${pending.spellName || "spell"} fizzles — the spell is gone!</em></p>`
        });
        return { ok: false, reason: "spell-gone" };
    }
    // Resolve stored target IDs to actors
    const targetActors = (pending.targetIds ?? [])
        .map(id => globalThis.game?.actors?.get(id))
        .filter(Boolean);
    // Re-invoke castSpell in "resolve-only" mode: skips target/range/
    // ESF/mana (done at declaration), goes straight to the kind branch.
    return castSpell(actor, spellItem, {
        ...(pending.opts ?? {}),
        _delayedFire: true,
        _delayedTargets: targetActors
    });
}
