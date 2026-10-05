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
// ============================================================

import { combatCard } from "../combat/chat-card.js";
import { classifySpell, directedSpellsOB } from "./spell-mapping.js";
import { esfGate, resolveSpellFailure } from "./spell-failure.js";
import {
    resolveBaseSpellAttack, applyBaseSpellEffect,
    d100, barLevelBonus, rangeModFor
} from "./base-spell.js";
import { resolveBallCast } from "./ball-spell.js";
import { rollWeaponAttack } from "../combat/combat-rolls.js";
import { applyHealingSpell, checkHitThresholds } from "../combat/crit-conditions.js";

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

/**
 * Cast a spell from an actor's spell item. Returns a small
 * summary object; posts chat for every outcome.
 * opts: { prepRoundsShort } — preparation shortage for the ESF
 * sum (the cast path assumes book-standard preparation).
 */
export async function castSpell(actor, spellItem, opts = {}) {
    if (!actor || !spellItem) return { ok: false, reason: "missing" };
    const name = spellItem.name ?? "spell";
    const cls = classifySpell(spellItem);
    const cost = Math.max(0, Number(spellItem.system?.manaCost) || 0);
    const pool = actor.system?.attributes?.mana ?? { value: 0, max: 0 };
    const before = Number(pool.value) || 0;
    if (cost > before) {
        ui.notifications?.warn(`${actor.name} cannot cast ${name}: needs ${cost} mana, has ${before}.`);
        return { ok: false, reason: "mana" };
    }

    // Targets are required before anything else for base and
    // ball spells (checked before the ESF gate so a missing
    // target never triggers a failure roll). Area base spells
    // and balls resolve against every targeted token.
    let baseTargets = [];
    if (cls.kind === "base") {
        baseTargets = targetedActors().filter(t => t !== actor);
        if (!baseTargets.length) {
            ui.notifications?.warn(`${actor.name} cannot cast ${name}: base spells need a target other than the caster.`);
            return { ok: false, reason: "target" };
        }
    }
    let ballTargets = [];
    if (cls.kind === "ball") {
        ballTargets = targetedActors();
        if (!ballTargets.length) {
            ui.notifications?.warn(`${actor.name} cannot cast ${name}: ball spells need at least one targeted token.`);
            return { ok: false, reason: "target" };
        }
    }

    // ---- ESF gate (before the mana is spent) ----
    const gate = await esfGate(actor, spellItem, {
        attackSpell: cls.kind === "bolt" || cls.kind === "base" || cls.kind === "ball",
        prepRoundsShort: opts.prepRoundsShort
    });
    if (gate.required && !gate.passed) {
        return { ok: false, reason: "esf", esf: gate.esf.total, failure: gate.failure?.entry ?? null };
    }
    const esfNote = gate.required ? `<p><em>${esc(gate.note)}</em></p>` : "";

    const spendMana = async () => {
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
    const manaNote = cost > 0 ? ` Mana ${before} → ${before - cost}.` : "";

    if (cls.kind === "bolt") {
        await spendMana();
        const synthetic = {
            _id: spellItem.id ?? spellItem._id ?? "cast-spell",
            id: spellItem.id ?? spellItem._id ?? "cast-spell",
            name,
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
        if (esfNote) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: combatCard("Spellcasting", `
                    <h2>${esc(actor.name)} casts ${esc(name)}</h2>
                    ${esfNote}`)
            });
        }
        await rollWeaponAttack(actor, synthetic, { forcedCritType: cls.critType });
        return { ok: true, kind: "bolt", attackTable: cls.attackTable };
    }

    if (cls.kind === "heal") {
        await spendMana();
        const target = targetedActor() ?? actor;
        const canTouch = target.isOwner || game.user?.isGM;
        let healLine = "";
        if (canTouch) {
            // Per ruling, ANY direct healing magic stops bleeding and
            // clears the death timer; then hits are restored.
            await applyHealingSpell(target);
            const cur = Number(target.system?.hits?.value) || 0;
            const restored = Math.min(cls.amount, cur);
            await target.update({ "system.hits.value": cur - restored });
            await checkHitThresholds(target);
            healLine = `<p><em>${esc(target.name)} recovers ${restored} hits (${cur} → ${cur - restored}).</em></p>`;
        } else {
            healLine = `<p><em>Healing not applied — you don't control ${esc(target.name)}.</em></p>`;
        }
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Spellcasting", `
                <h2>${esc(actor.name)} casts ${esc(name)} on ${esc(target.name)}</h2>
                ${healLine}${esfNote}<p><em>${manaNote.trim()}</em></p>`)
        });
        return { ok: true, kind: "heal", amount: cls.amount };
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
                ${body}<p><em>${manaNote.trim()}</em></p>`)
        });
        return { ok: true, kind: "base", targets: applied, resisted: baseTargets.length === 1 ? applied[0].resisted : undefined };
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
        const res = await resolveBallCast(actor, spellItem, ballTargets, {
            table: cls.attackTable, critType: cls.critType
        }, {
            rangeFeet: opts.rangeFeet, centerId: opts.centerId ?? ballTargets[0]?.id ?? null,
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
                <h2>${esc(actor.name)} casts ${esc(name)} (${ballTargets.length} in the blast)</h2>
                ${res.html}<p><em>${manaNote.trim()}</em></p>`)
        });
        return { ok: true, kind: "ball" };
    }

    // Announced cast (buff/utilities and later-stage tracks land
    // their mechanics in later stages; the mana economy is live).
    await spendMana();
    const note = cls.kind === "later" ? esc(cls.reason) : "no mechanical payload";
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: combatCard("Spellcasting", `
            <h2>${esc(actor.name)} casts ${esc(name)}</h2>
            ${esfNote}<p><em>Cast announced — ${note}.${manaNote}</em></p>`)
    });
    return { ok: true, kind: cls.kind };
}
