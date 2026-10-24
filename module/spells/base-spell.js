// ============================================================
// BASE SPELL ATTACKS (Stage 4; Spell Law §8.3 + Tables 15.1 /
// 15.2 / 15.5 / 15.6, render-verified 2026-10-05). Base spells
// are the hostile EQ spells that are not directed bolts:
// poison/disease damage, DoTs, controls, debuffs, lifetaps.
//
// Procedure (book): the caster makes a Base Attack Roll — a
// FLAT d100 (explicitly not open-ended) + caster level (pure
// casters only) + range/cover modifiers, cross-indexed on
// Table 15.1 by the realm column the target's defenses select.
// The result modifies the target's Resistance Roll (open-ended
// d100 + realm stat bonus + same-realm +15 + willing -50 +
// element resist points, Table 15.6 — 2026-10-23 ruling),
// resisted on >= the Table 15.5 level cross-index. A natural
// BAR of 01-02 is an automatic spell failure, and an "F" cell
// on 15.1 likewise — both go to the Attack section of the
// Spell Failure Table (Stage 3 path).
//
// RULING (user, 2026-10-05): BOOK-PURE resist axis. The
// defender's stat bonus follows the SPELL'S REALM (15.6):
// Essence -> Empathy, Channeling -> Intuition, Mentalism ->
// Presence. EQ's per-effect resist/resistMod fields are not
// used.
//
// RULING (user, 2026-10-21): damage and lifetap amounts no
// longer come from the EQ description. On a failed RR the
// amount resolves on the RMSS tables (module/combat/
// table-resolver.js) at the caster's Directed Spells OB —
// the same scale as bolt spells. DoTs register their table
// + OB and tick on it. Controls/debuffs are unchanged.
// ============================================================

import { combatCard } from "../combat/chat-card.js";
import { checkHitThresholds, applyCritConditions } from "../combat/crit-conditions.js";
import { casterRealm, resolveSpellFailure, wornArmorAt, helmetKind } from "./spell-failure.js";
import { CASTING_STAT_BY_CLASS, casterLevelOf, statBonusFor, classifySpell, directedSpellsOB } from "./spell-mapping.js";
import { resolveTableAttack, tableForElement } from "../combat/table-resolver.js";
import { isWorn } from "../utils/equipment/equipment-utils.js";
import { baseActorOf } from "./status-wiring.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

// ------------------------------------------------------------
// Table 15.1 — Base Spell Attack Table (printed p.152).
// Columns: general | essence metal armor | essence leather
// armor | channeling metal armor | channeling metal shield |
// mentalism metal helmet | mentalism leather helmet.
// "F" = spell failure. UM bands key on the UNMODIFIED roll.
// ------------------------------------------------------------

const BSA_COLUMNS = ["general", "essMetal", "essLeather", "chanMetal", "chanShield", "mentMetal", "mentLeather"];
const BSA_COLUMN_LABEL = {
    general: "General", essMetal: "Essence vs metal armor", essLeather: "Essence vs leather armor",
    chanMetal: "Channeling vs metal armor", chanShield: "Channeling vs metal shield",
    mentMetal: "Mentalism vs metal helmet", mentLeather: "Mentalism vs leather helmet"
};
// [low, high, general, essMetal, essLeather, chanMetal, chanShield, mentMetal, mentLeather]
const BSA_ROWS = [
    [3, 4, "F", "F", "F", "F", "F", "F", "F"],
    [5, 8, 70, "F", "F", "F", "F", "F", "F"],
    [9, 12, 65, "F", "F", "F", "F", "F", "F"],
    [13, 16, 60, "F", 45, "F", "F", "F", 45],
    [17, 20, 50, 45, 40, "F", 45, "F", 40],
    [21, 24, 45, 40, 35, "F", 40, "F", 35],
    [25, 28, 35, 35, 30, 45, 35, 45, 30],
    [29, 32, 30, 30, 25, 40, 30, 35, 25],
    [33, 36, 20, 25, 20, 35, 25, 30, 20],
    [37, 40, 15, 20, 15, 30, 20, 25, 15],
    [41, 44, 5, 15, 10, 25, 15, 20, 10],
    [45, 48, 0, 10, 5, 20, 10, 15, 5],
    [49, 52, 0, 5, 0, 15, 5, 10, 0],
    [53, 56, -5, 0, 0, 10, 0, 5, 0],
    [57, 60, -10, 0, -5, 5, 0, 0, -5],
    [61, 64, -15, -5, -5, 0, -5, 0, -5],
    [65, 68, -20, -5, -10, 0, -5, -5, -10],
    [69, 72, -25, -10, -15, -5, -10, -5, -15],
    [73, 76, -30, -25, -20, -10, -15, -10, -20],
    [77, 80, -35, -30, -25, -15, -20, -15, -25],
    [81, 84, -40, -35, -30, -20, -25, -20, -30],
    [85, 88, -45, -40, -35, -25, -30, -25, -35],
    [89, 92, -50, -45, -40, -30, -35, -30, -40],
    [93, 95, -55, -50, -45, -35, -40, -35, -45]
];
const BSA_UM_ROWS = [
    [96, 97, -75, -60, -65, -55, -60, -55, -65],
    [98, 99, -100, -85, -90, -80, -85, -80, -90],
    [100, 100, -125, -110, -115, -105, -110, -105, -115]
];

/** Look up a BAR on Table 15.1. Natural 96+ uses the UM bands;
 *  any other roll is clamped to 03-95 before cross-indexing. */
export function lookupBAR(natural, modified, column) {
    const ci = BSA_COLUMNS.indexOf(column) + 2;
    if (natural >= 96) {
        const row = BSA_UM_ROWS.find(r => natural >= r[0] && natural <= r[1]) ?? BSA_UM_ROWS[2];
        return { value: row[ci], band: `UM ${row[0]}${row[1] > row[0] ? "-" + row[1] : ""}` };
    }
    const roll = Math.min(95, Math.max(3, modified));
    const row = BSA_ROWS.find(r => roll >= r[0] && roll <= r[1]) ?? BSA_ROWS[BSA_ROWS.length - 1];
    return { value: row[ci], band: `${row[0]}-${String(row[1]).padStart(2, "0")}` };
}

/** Table 15.2 range modification by distance in feet. */
export function rangeModFor(feet) {
    if (feet == null || !Number.isFinite(Number(feet))) return 0;
    const f = Number(feet);
    if (f <= 0) return 30; // touching
    if (f <= 10) return 10;
    if (f <= 50) return 0;
    if (f <= 100) return -10;
    if (f <= 300) return -20;
    return -30;
}

// ------------------------------------------------------------
// Table 15.5 — Resistance Roll target number. 50 at equal
// level; the attacker's level raises it (+5/lvl to 5, +3/lvl
// to 10, +2/lvl to 15, +1/lvl beyond), the target's lowers it.
// ------------------------------------------------------------

function levelFactor(level) {
    const l = Math.max(1, Math.floor(Number(level) || 1));
    if (l <= 5) return 5 * (l - 1);
    if (l <= 10) return 20 + 3 * (l - 5);
    if (l <= 15) return 35 + 2 * (l - 10);
    return 45 + (l - 15);
}

export function rrTargetNumber(attackLevel, targetLevel) {
    return 50 + levelFactor(attackLevel) - levelFactor(targetLevel);
}

/** 15.6: the defender's stat bonus is keyed to the spell's
 *  realm (book-pure per user ruling 2026-10-05). */
export const RESIST_STAT_BY_REALM = { essence: "EM", channeling: "IN", mentalism: "PR" };

// Semi-spell users get no caster-level bonus to the BAR (15.2:
// "Pure and hybrid spell users only"; EQ has no hybrid tier, so
// the melee-caster classes read as semi). Flagged house mapping.
export const SEMI_CASTERS = new Set(["paladin", "ranger", "shadowknight", "beastlord", "bard"]);

function classIdOf(actor) {
    const sys = actor?.system ?? {};
    return String(sys.origin?.classId ?? sys.fixed_info?.classId ?? sys.classId ?? "").toLowerCase();
}

/** Caster-level BAR bonus (0 for semi and non-casters). */
export function barLevelBonus(actor) {
    const cls = classIdOf(actor);
    if (!CASTING_STAT_BY_CLASS[cls] || SEMI_CASTERS.has(cls)) return 0;
    return casterLevelOf(actor);
}

// ------------------------------------------------------------
// Table 15.1 column selection. The realm picks the column pair;
// the target's actual defenses pick within it, else General.
// Armor class derives from the worn AT (2-8 leather, 9+ metal;
// natural hide at AT 2-8 reads as leather — house derivation).
// If a Channeling target qualifies for both columns, metal
// armor (listed first in the book) wins.
// ------------------------------------------------------------

const METAL_MATERIAL = /steel|iron|bronze|mithril|adamantine|electrum|gold|platinum|silver|copper|metal|chain|plate/;

function wornItems(actor) {
    return [...(actor?.items?.contents ?? actor?.items ?? [])].filter(i => i && isWorn(i));
}

export function bsaColumnFor(realm, target) {
    const items = wornItems(target);
    const at = wornArmorAt(target);
    const armorClass = at == null || at <= 1 ? null : (at <= 8 ? "leather" : "metal");
    if (realm === "essence") {
        if (armorClass === "metal") return "essMetal";
        if (armorClass === "leather") return "essLeather";
        return "general";
    }
    if (realm === "channeling") {
        if (armorClass === "metal") return "chanMetal";
        const shield = items.find(i => i.type === "shield");
        const shieldMat = String(shield?.system?.shieldMaterial ?? shield?.system?.material ?? shield?.system?.materialId ?? "").toLowerCase();
        if (shield && METAL_MATERIAL.test(shieldMat)) return "chanShield";
        return "general";
    }
    if (realm === "mentalism") {
        const helm = items.find(i => i.type === "armor" && (i.system?.armorLocation === "head" || i.system?.slot === "head"));
        if (!helm) return "general";
        const kind = helmetKind(helm);
        return kind === "leather" ? "mentLeather" : "mentMetal";
    }
    return "general";
}

// ------------------------------------------------------------
// Rolls
// ------------------------------------------------------------

export async function d100(rollD100) {
    if (rollD100) return Number(await rollD100()) || 0;
    return (await new Roll("1d100").evaluate()).total;
}

/** Resistance Rolls are open-ended both ways: 96-100 rolls
 *  again and adds; an opening 01-05 rolls again and subtracts. */
export async function rrOpenEnded(rollD100) {
    const rolls = [];
    let die = await d100(rollD100);
    rolls.push(die);
    let total = die;
    if (die >= 96) {
        while (die >= 96) { die = await d100(rollD100); rolls.push(die); total += die; }
    } else if (die <= 5) {
        while (die <= 5) { die = await d100(rollD100); rolls.push(die); total -= die; }
    }
    return { rolls, total };
}

/** Element resist points for a target: gear resistances
 *  (system.resistances[element]) + spellEffects buffs with
 *  scaledTarget "resist-<element>", summed. This is exactly
 *  the resist sum getTargetModifiers performs in
 *  module/item-effects/damage-pipeline.js — keep the two
 *  identical. It is replicated here rather than imported
 *  because the pipeline imports this module's RR helpers
 *  (rrOpenEnded / rrTargetNumber), so a back-import would
 *  close a module cycle. */
export function elementResistFor(target, element) {
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

// ------------------------------------------------------------
// Resolution
// ------------------------------------------------------------

/**
 * Resolve a base spell attack. Posts the Spell Failure card
 * itself on a natural 01-02 or an "F" cell; otherwise returns
 * { failed:false, resisted, html, ... } and the CALLER posts
 * the cast card (so effect notes ride the same card).
 * opts: { rangeFeet, cover: "partial"|"full", staticTarget,
 *         willing, rrMod, rollD100, sharedBar } — sharedBar
 *         { natural, modified } injects one BAR rolled by the
 *         caller (Stage 5: area base spells make one Base Attack
 *         Roll, cross-indexed per target); the natural-failure
 *         roll is then the caller's to post.
 */
export async function resolveBaseSpellAttack(caster, spellItem, target, opts = {}) {
    const realm = casterRealm(caster, spellItem);
    const column = bsaColumnFor(realm, target);
    const name = spellItem?.name ?? "spell";

    // ---- Base Attack Roll (flat d100, not open-ended) ----
    const natural = opts.sharedBar ? opts.sharedBar.natural : await d100(opts.rollD100);
    if (natural <= 2 && !opts.sharedBar) {
        await resolveSpellFailure(caster, spellItem, {
            section: "attack", esfTotal: 0, rollD100: opts.rollD100,
            headerHtml: `<p><strong>Base attack roll ${natural}</strong> — automatic spell failure (Spell Law 8.3).</p>`
        });
        return { failed: true, natural };
    }
    const lvlBonus = barLevelBonus(caster);
    const rangeMod = rangeModFor(opts.rangeFeet);
    const coverMod = opts.cover === "full" ? -20 : opts.cover === "partial" ? -10 : 0;
    const staticMod = opts.staticTarget ? 10 : 0;
    const modified = opts.sharedBar ? opts.sharedBar.modified
        : natural + lvlBonus + rangeMod + coverMod + staticMod;
    const cell = lookupBAR(natural, modified, column);
    const barLine = `<strong>Base attack roll:</strong> ${natural}`
        + `${lvlBonus ? ` + ${lvlBonus} level` : ""}${rangeMod ? ` ${rangeMod > 0 ? "+" : ""}${rangeMod} range` : ""}`
        + `${coverMod ? ` ${coverMod} cover` : ""}${staticMod ? ` +10 static` : ""} = ${modified}`
        + ` → Table 15.1 (${esc(BSA_COLUMN_LABEL[column])}, band ${cell.band})`;

    if (cell.value === "F") {
        await resolveSpellFailure(caster, spellItem, {
            section: "attack", esfTotal: 0, rollD100: opts.rollD100,
            headerHtml: `<p>${barLine}: <strong>F — spell failure.</strong></p>`
        });
        return { failed: true, natural, modified };
    }

    // ---- Resistance Roll ----
    const willing = !!opts.willing;
    const attackLevel = casterLevelOf(caster);
    const targetLevel = willing ? 1 : casterLevelOf(target);
    const need = rrTargetNumber(attackLevel, targetLevel);
    const rr = await rrOpenEnded(opts.rollD100);
    const statCode = RESIST_STAT_BY_REALM[realm];
    const statBonus = statBonusFor(target, statCode);
    const targetStat = CASTING_STAT_BY_CLASS[classIdOf(target)];
    const sameRealm = targetStat && casterRealm(target, null) === realm ? 15 : 0;
    const willingMod = willing ? -50 : 0;
    const extraMod = Number(opts.rrMod) || 0;
    // Worn combat effects (2026-10-13, user ruling): Spell Shield / DoT
    // Shielding fold into RR bonuses (EQ÷10, min 1) via spellEffects entries
    // with scaledTarget "rr" / "rr-dot". DoT Shielding applies only when the
    // incoming spell is a damage-over-time spell.
    let rrShield = 0, rrDotShield = 0;
    const tfx = target?.system?.status?.spellEffects;
    if (Array.isArray(tfx)) {
        for (const e of tfx) {
            const st = String(e?.scaledTarget ?? "").toLowerCase();
            const v = Number(e?.scaledValue) || 0;
            if (!v) continue;
            if (st === "rr") rrShield += v;
            else if (st === "rr-dot") rrDotShield += v;
        }
    }
    let dotShieldApplies = false;
    if (rrDotShield > 0) {
        try {
            const cls = classifySpell(spellItem);
            dotShieldApplies = cls?.kind === "base" && cls?.subtype === "dot";
        } catch (e) { /* ignore — treat as non-DoT */ }
    }
    const shieldMod = rrShield + (dotShieldApplies ? rrDotShield : 0);
    // Element resistance (user ruling 2026-10-23: "go with the
    // book"): Spell Law Table 15.6 — items and spells that grant
    // resistance give the target a modification to his RR. The
    // target's resist points for THIS SPELL's element (gear +
    // resist-<element> buffs, summed by elementResistFor) add to
    // the RR. The element is the classification's element — the
    // same determination the cast flow and effect application
    // use. Non-elemental spells (element "") get no modification.
    // This rides the RR where one is rolled; bolt and ball
    // spells resolve on the Elemental Attack Table and roll no
    // RR, so they gain no resist term here (flagged 2026-10-23,
    // no RR invented for them).
    let spellElement = "";
    try { spellElement = String(classifySpell(spellItem)?.element ?? "").toLowerCase(); } catch (e) { /* unclassifiable — no element */ }
    const resistMod = spellElement ? elementResistFor(target, spellElement) : 0;
    const rrTotal = rr.total + cell.value + statBonus + sameRealm + willingMod + extraMod + shieldMod + resistMod;
    const resisted = rrTotal >= need;

    const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
    const rrLine = `<strong>Resistance roll (${esc(target.name)}):</strong> ${rr.rolls.join(", ")} = ${rr.total}`
        + ` ${fmt(cell.value)} BAR, ${fmt(statBonus)} ${statCode}`
        + `${sameRealm ? `, +15 same realm` : ""}${willingMod ? `, -50 willing` : ""}${extraMod ? `, ${fmt(extraMod)} spell` : ""}${shieldMod ? `, ${fmt(shieldMod)} shield` : ""}${resistMod ? `, ${fmt(resistMod)} ${esc(spellElement)} resist` : ""}`
        + ` = <strong>${rrTotal}</strong> vs ${need} (levels ${attackLevel} vs ${targetLevel}) — ${resisted ? "RESISTED" : "spell takes effect"}`;

    return {
        failed: false, resisted, realm, column,
        bar: { natural, modified, value: cell.value, band: cell.band },
        rr: { rolls: rr.rolls, total: rrTotal, need, element: spellElement, resistMod },
        html: `<p>${barLine}: RR modification <strong>${fmt(cell.value)}</strong>.</p><p>${rrLine}.</p>`
    };
}

// ------------------------------------------------------------
// Effect application (target failed to resist). EQ durations
// are seconds; 1 round = 6 seconds (standing ruling).
// ------------------------------------------------------------

export function durationRounds(seconds) {
    const sec = Number(seconds);
    if (!sec || sec <= 0) return null;
    return Math.max(1, Math.ceil(sec / 6));
}

function effectAmount(eff) {
    return Number(eff?.amount ?? eff?.max ?? eff?.min) || 0;
}

/** Roll an EQ min-max amount (fixed when min == max). */
export function rollAmount(eff) {
    const lo = Number(eff?.min ?? eff?.amount) || 0;
    const hi = Number(eff?.max ?? eff?.amount ?? lo) || lo;
    if (hi <= lo) return lo;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
}

async function addHits(target, n) {
    const cur = Number(target.system?.hits?.value) || 0;
    await target.update({ "system.hits.value": cur + n });
    await checkHitThresholds(target);
    return cur + n;
}

/**
 * Tables routing (2026-10-21 ruling): resolve a base spell's
 * damage on the tables at the caster's Directed Spells OB —
 * crits allowed on the initial application. Returns
 * { amount, crits, note }; amount includes crit bonus hits.
 * Falls back to the EQ amount only when the tables are not
 * loaded (resolveTableAttack returns null).
 */
function tableDamageFor(caster, target, eff) {
    const res = resolveTableAttack({ element: eff?.element, ob: directedSpellsOB(caster), target, allowCrit: true });
    if (!res) return { amount: rollAmount(eff), crits: [], note: "" };
    const critText = res.crits.map(c => ` Critical ${c.severity} (${c.type}): ${c.text}`).join("");
    return {
        amount: res.total,
        crits: res.crits,
        note: `${res.table} table: roll ${res.roll} + OB ${res.ob} − DB ${res.db} = ${res.net} → ${res.hits} hits${res.critBonus ? ` + ${res.critBonus} critical` : ""}.${critText}`
    };
}

async function applyTableCrits(caster, target, crits) {
    for (const c of crits ?? []) {
        try { await applyCritConditions(target, caster, c.text); } catch (e) { /* non-fatal: bonus hits already counted */ }
    }
}

/**
 * Apply a base spell's payload to a target that failed its RR.
 * Returns an HTML note for the cast card. DoTs and timed
 * controls/debuffs land in system.status.dots /
 * system.status.spellEffects and tick in tickConditions.
 */
export async function applyBaseSpellEffect(caster, target, classification, spellItem) {
    // Unlinked tokens (2026-10-12): resolve to the base actor so effects
    // persist and are visible to ticks/sheets sweeping game.actors.
    target = baseActorOf(target);
    const eff = classification?.effect ?? {};
    const name = spellItem?.name ?? "spell";
    const subtype = classification?.subtype ?? eff.type ?? "damage";
    const tName = esc(target.name);

    if (subtype === "damage") {
        const amount = effectAmount(eff);
        if (amount <= 0) return `<p><em>${esc(name)} takes effect on ${tName} (no damage amount recorded).</em></p>`;
        const td = tableDamageFor(caster, target, eff);
        const after = await addHits(target, td.amount);
        await applyTableCrits(caster, target, td.crits);
        return `<p><em>${tName} takes ${td.amount} hits (${after} concussion hits). ${td.note}</em></p>`;
    }

    if (subtype === "lifetap") {
        const td = tableDamageFor(caster, target, eff);
        const amount = td.amount;
        const after = await addHits(target, amount);
        await applyTableCrits(caster, target, td.crits);
        const cCur = Number(caster.system?.hits?.value) || 0;
        const healed = Math.min(amount, cCur);
        await caster.update({ "system.hits.value": cCur - healed });
        await checkHitThresholds(caster);
        return `<p><em>${tName} takes ${amount} hits (${after} concussion hits); ${esc(caster.name)} drains ${healed} hits (${cCur} → ${cCur - healed}). ${td.note}</em></p>`;
    }

    if (subtype === "dot") {
        const rounds = durationRounds(eff.duration);
        if (rounds == null) {
            const td = tableDamageFor(caster, target, eff);
            const after = await addHits(target, td.amount);
            await applyTableCrits(caster, target, td.crits);
            return `<p><em>${tName} takes ${td.amount} hits (${after} concussion hits). ${td.note}</em></p>`;
        }
        // Tables routing: the entry carries its table + the
        // caster's Directed Spells OB; ticks resolve on the table
        // (hits only) in tickConditions. casterId also enables
        // the capstone DoT hooks keyed on it.
        const { attackTable, critType } = tableForElement(eff.element);
        const ob = directedSpellsOB(caster);
        const dots = [...(Array.isArray(target.system?.status?.dots) ? target.system.status.dots : [])];
        dots.push({
            name, element: String(eff.element ?? ""), damageType: String(eff.element ?? ""),
            min: Number(eff.min ?? eff.amount) || 0, max: Number(eff.max ?? eff.amount) || 0,
            table: attackTable, critType, ob,
            casterId: caster?.id ?? caster?._id ?? null,
            roundsLeft: rounds
        });
        await target.update({ "system.status.dots": dots });
        return `<p><em>${esc(name)} settles on ${tName}: ${attackTable} table at OB ${ob}/round for ${rounds} rounds.</em></p>`;
    }

    if (subtype === "control") {
        const rounds = durationRounds(eff.duration);
        const effectName = String(eff.effect ?? "control").toLowerCase();
        if ((effectName === "stun" || effectName === "mez") && rounds != null) {
            const pool = { stunned: 0, stunNoParry: 0, downOrOut: 0, ...(target.system?.status?.stun ?? {}) };
            if (effectName === "stun") pool.stunned += rounds; else pool.downOrOut += rounds;
            await target.update({ "system.status.stun": pool });
            return `<p><em>${tName} is ${effectName === "stun" ? `stunned for ${rounds} rounds` : `mesmerized (down or out) for ${rounds} rounds`}.</em></p>`;
        }
        const list = [...(Array.isArray(target.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
        list.push({ label: `${name} (${effectName})`, roundsLeft: rounds });
        await target.update({ "system.status.spellEffects": list });
        return `<p><em>${tName} suffers ${esc(effectName)}${rounds != null ? ` for ${rounds} rounds` : ""} (${esc(name)}).</em></p>`;
    }

    // Attack-speed slow (2026-10-12, e.g., Enalam's Drowse): negative
    // attack-speed is a mechanical slow percentage. Creates a proper
    // scaledTarget:"slow" entry and dispels haste per the 2026-10-12 ruling.
    if (String(eff.stat ?? "").toLowerCase() === "attack-speed") {
        const amt = rollAmount(eff);
        if (amt < 0) {
            const slowPct = Math.max(1, Math.round(Math.abs(amt)));
            const rounds = durationRounds(eff.duration);
            const { hasteSlowExclusion, dispelHaste, applyStatusEffect } = await import("./status-wiring.js");
            let dispelNote = "";
            if (hasteSlowExclusion(target, "slow", "spell") === "dispel") {
                const cleared = await dispelHaste(target);
                if (cleared) dispelNote = ` ${tName}'s haste is dispelled.`;
            }
            const slowList = [...(Array.isArray(target.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
            slowList.push({
                label: `${name} — Slow ${slowPct}% (spell)`,
                source: "spell",
                kind: "debuff",
                category: "debuff",
                scaledTarget: "slow",
                scaledStat: "slow",
                scaledValue: slowPct,
                roundsLeft: rounds,
                spellId: spellItem?.id ?? spellItem?._id ?? "",
                spell: name
            });
            await target.update({ "system.status.spellEffects": slowList });
            await applyStatusEffect(target, "slowed", `${name} (Slow)`, rounds ?? 10, "icons/svg/net.svg", { source: "spell", category: "debuff" });
            return `<p><em>${esc(name)} takes hold on ${tName} — slowed ${slowPct}%${rounds != null ? ` for ${rounds} rounds` : ""}.${dispelNote}</em></p>`;
        }
        // Positive attack-speed on a base spell is unusual; fall through to generic handling.
    }

    // debuff and anything else with a duration: recorded as a
    // timed spell effect for the GM (counters, vulnerabilities,
    // slows — no engine pool of their own yet).
    const rounds = durationRounds(eff.duration);
    const list = [...(Array.isArray(target.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
    const detail = [eff.effect, eff.stat, eff.amount != null ? `${eff.amount}` : ""].filter(Boolean).join(" ");
    list.push({ label: `${name}${detail ? ` — ${detail}` : ""}`, roundsLeft: rounds });
    await target.update({ "system.status.spellEffects": list });
    return `<p><em>${esc(name)} takes hold on ${tName}${detail ? ` (${esc(detail)})` : ""}${rounds != null ? ` for ${rounds} rounds` : ""}.</em></p>`;
}
