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
// d100 + realm stat bonus + same-realm +15 + willing -50),
// resisted on >= the Table 15.5 level cross-index. A natural
// BAR of 01-02 is an automatic spell failure, and an "F" cell
// on 15.1 likewise — both go to the Attack section of the
// Spell Failure Table (Stage 3 path).
//
// RULING (user, 2026-10-05): BOOK-PURE resist axis. The
// defender's stat bonus follows the SPELL'S REALM (15.6):
// Essence -> Empathy, Channeling -> Intuition, Mentalism ->
// Presence. EQ's per-effect resist/resistMod fields are not
// used. EQ effect amounts are the spell's described effect
// (15.5: the target "suffers the results given in the
// description of that spell"), exactly as heal amounts are.
// ============================================================

import { combatCard } from "../combat/chat-card.js";
import { checkHitThresholds } from "../combat/crit-conditions.js";
import { casterRealm, resolveSpellFailure, wornArmorAt, helmetKind } from "./spell-failure.js";
import { CASTING_STAT_BY_CLASS, casterLevelOf, statBonusFor } from "./spell-mapping.js";
import { isWorn } from "../utils/equipment/equipment-utils.js";

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
    const rrTotal = rr.total + cell.value + statBonus + sameRealm + willingMod + extraMod;
    const resisted = rrTotal >= need;

    const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
    const rrLine = `<strong>Resistance roll (${esc(target.name)}):</strong> ${rr.rolls.join(", ")} = ${rr.total}`
        + ` ${fmt(cell.value)} BAR, ${fmt(statBonus)} ${statCode}`
        + `${sameRealm ? `, +15 same realm` : ""}${willingMod ? `, -50 willing` : ""}${extraMod ? `, ${fmt(extraMod)} spell` : ""}`
        + ` = <strong>${rrTotal}</strong> vs ${need} (levels ${attackLevel} vs ${targetLevel}) — ${resisted ? "RESISTED" : "spell takes effect"}`;

    return {
        failed: false, resisted, realm, column,
        bar: { natural, modified, value: cell.value, band: cell.band },
        rr: { rolls: rr.rolls, total: rrTotal, need },
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
 * Apply a base spell's payload to a target that failed its RR.
 * Returns an HTML note for the cast card. DoTs and timed
 * controls/debuffs land in system.status.dots /
 * system.status.spellEffects and tick in tickConditions.
 */
export async function applyBaseSpellEffect(caster, target, classification, spellItem) {
    const eff = classification?.effect ?? {};
    const name = spellItem?.name ?? "spell";
    const subtype = classification?.subtype ?? eff.type ?? "damage";
    const tName = esc(target.name);

    if (subtype === "damage") {
        const amount = effectAmount(eff);
        if (amount <= 0) return `<p><em>${esc(name)} takes effect on ${tName} (no damage amount recorded).</em></p>`;
        const after = await addHits(target, amount);
        return `<p><em>${tName} takes ${amount} hits (${after} concussion hits).</em></p>`;
    }

    if (subtype === "lifetap") {
        const amount = rollAmount(eff);
        const after = await addHits(target, amount);
        const cCur = Number(caster.system?.hits?.value) || 0;
        const healed = Math.min(amount, cCur);
        await caster.update({ "system.hits.value": cCur - healed });
        await checkHitThresholds(caster);
        return `<p><em>${tName} takes ${amount} hits (${after} concussion hits); ${esc(caster.name)} drains ${healed} hits (${cCur} → ${cCur - healed}).</em></p>`;
    }

    if (subtype === "dot") {
        const rounds = durationRounds(eff.duration);
        const per = rollAmount(eff);
        if (rounds == null) {
            const after = await addHits(target, per);
            return `<p><em>${tName} takes ${per} hits (${after} concussion hits).</em></p>`;
        }
        const dots = [...(Array.isArray(target.system?.status?.dots) ? target.system.status.dots : [])];
        dots.push({ name, element: String(eff.element ?? ""), min: Number(eff.min ?? eff.amount) || 0, max: Number(eff.max ?? eff.amount) || 0, roundsLeft: rounds });
        await target.update({ "system.status.dots": dots });
        return `<p><em>${esc(name)} settles on ${tName}: ${Number(eff.min ?? eff.amount) || 0}${Number(eff.max ?? eff.amount) !== Number(eff.min ?? eff.amount) ? `-${Number(eff.max ?? eff.amount)}` : ""} hits/round for ${rounds} rounds.</em></p>`;
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
