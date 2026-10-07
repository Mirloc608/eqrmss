// ============================================================
// SPELL FAILURE & EXTRAORDINARY SPELL FAILURE (Spell Law
// §10.9 + Table 15.7; Stage 3, user ruling 2026-10-04: full
// book modifier set). The EQ spell catalog is the content; this
// module supplies the RMSS casting-risk mechanics.
//
// Flow (book §10.9): when a spell is cast, sum every applicable
// ESF modification. If the sum is 0, no roll is made. Otherwise
// an open-ended ESF roll must EXCEED the sum or the spell fails;
// on failure a high open-ended roll plus TRIPLE the ESF sum is
// applied to the caster's column of the Spell Failure Table
// (Attack spells vs Non-Attack spells). A directed spell whose
// bolt table yields an "F" cell is a "natural" failure: same
// high open-ended roll on the Attack column, no ESF multiple.
//
// Realm columns come from the caster's casting stat (the mana
// derivation map): Memory casters are Essence, Empathy casters
// Channeling, Presence casters Mentalism. The book prints no
// armor/equipment columns for Mentalism, so those channels are
// zero there (nothing invented).
// ============================================================

import { combatCard } from "../combat/chat-card.js";
import { applyCritConditions, checkHitThresholds } from "../combat/crit-conditions.js";
import { isWorn } from "../utils/equipment/equipment-utils.js";
import { CASTING_STAT_BY_CLASS, casterLevelOf } from "./spell-mapping.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

// ------------------------------------------------------------
// Book data — Spell Law §10.9.2 (printed p.32), verified
// cell-by-cell against the page render 2026-10-04.
// ------------------------------------------------------------

/** Spell level minus caster level -> ESF modification. */
export const ESF_SPELL_LEVEL = {
    1: 20, 2: 25, 3: 30, 4: 35, 5: 40, 6: 55, 7: 60, 8: 65, 9: 70, 10: 75,
    11: 90, 12: 95, 13: 100, 14: 105, 15: 110, 16: 150, 17: 155, 18: 160,
    19: 165, 20: 170
};
export function spellLevelEsf(diff) {
    if (diff <= 0) return 0;
    return ESF_SPELL_LEVEL[diff] ?? 200; // 21+
}

/** Worn armor type (AT) -> { essence, channeling }. */
export const ESF_ARMOR = {
    1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [0, 0], 5: [10, 0], 6: [15, 0],
    7: [20, 0], 8: [25, 0], 9: [15, 0], 10: [30, 0], 11: [40, 0], 12: [50, 0],
    13: [35, 25], 14: [45, 35], 15: [70, 60], 16: [70, 60], 17: [40, 30],
    18: [50, 40], 19: [75, 60], 20: [90, 75]
};

/** Helmet construction -> { essence, channeling, mentalism }. */
export const ESF_HELMET = {
    leather: { essence: 20, channeling: 0, mentalism: 30 },
    leatherMetal: { essence: 30, channeling: 10, mentalism: 45 },
    metal: { essence: 40, channeling: 20, mentalism: 60 }
};

/** Preparation rounds short of the book norm -> ESF modification. */
export function prepEsf(roundsShort) {
    const n = Math.max(0, Math.floor(Number(roundsShort) || 0));
    if (n >= 2) return 50;
    return n === 1 ? 25 : 0;
}

/** No free hand -> ESF modification, by realm. */
export function freeHandEsf(realm) {
    return realm === "mentalism" ? 10 : 30;
}

// EQ hybrid classes (ruling 2026-10-05): casting with weapons in
// hand is their core function — their spells are already the
// weaker trade — so they ignore the free-hand ESF channel
// entirely. (Bard is not an EQ hybrid class.)
export const HYBRID_CASTERS = new Set(["paladin", "ranger", "shadowknight", "beastlord"]);
// Divine casters (ruling 2026-10-06): ignore armor AT, helmet, and
// carried-weight ESF channels. They retain overlevel, non-standard
// list, free-hand, and preparation penalties.
export const DIVINE_CASTERS = new Set(["cleric", "druid", "shaman"]);

export const ESF_NONSTANDARD_LIST = 20;

// ------------------------------------------------------------
// Spell Failure Table 15.7 (printed p.150), transcribed from the
// page render 2026-10-04. Roll runs open-ended, so the top band
// is unbounded.
// ------------------------------------------------------------

export const SPELL_FAILURE_TABLE = {
    nonattack: [
        { low: 1, high: 20, text: "Momentary lapse in concentration delays casting of spell one rnd." },
        { low: 21, high: 30, text: "Subconscious second thoughts cause caster to lose spell (but not the spell points)." },
        { low: 31, high: 40, text: "Strain causes caster to lose spell (but not the spell points)." },
        { low: 41, high: 60, text: "Moderate mental lapse causes caster to cast an ineffectual spell (but not lose spell points)." },
        { low: 61, high: 80, text: "Apparently inconvenient distraction causes caster to cast a useless spell (but not lose the spell pts). Stunned for 1 rnd." },
        { low: 81, high: 95, text: "Serious strain causes caster to misfire. Caster does not lose the spell pts. Stunned for 2 rnds." },
        { low: 96, high: 100, text: "Caster internalizes spell, takes 10 hits. Stunned for 12 long rounds." },
        { low: 101, high: 125, text: "Spell strays and travels to points unknown. It proves useless. Caster is stunned for 3 rounds." },
        { low: 126, high: 150, text: "Spell has no effect. Caster is confused and stunned for 4 rounds." },
        { low: 151, high: 175, text: "Severe strain takes toll on caster. Spell misfires; caster takes 5 hits, and is stunned for 6 rounds." },
        { low: 176, high: 185, text: "Caster internalizes spell, takes 8 hits, is knocked down, and is unable to function for 1 hour." },
        { low: 186, high: 191, text: "Caster internalizes spell, takes 10 hits, is knocked down, and is unable to function for 6 hours." },
        { low: 192, high: 195, text: "Caster suffers from nervous disorder, takes 25 hits, and is knocked out for 12 hours. Caster loses all spell casting ability for 4 weeks." },
        { low: 196, high: 200, text: "Mild stroke. Caster loses spell casting ability for 2 wks, takes 20 hits, must operate at 50% of normal for 3 days." },
        { low: 201, high: 250, text: "Caster internalizes spell, loses all spell casting ability for 3 weeks, takes 20 hits, and is knocked out for 9 hours." },
        { low: 251, high: 300, text: "Nervous disorder. Caster is stunned for 12 rounds, and loses all ability to throw the attempted spell (it may be relearned after 1 yr)." },
        { low: 301, high: Infinity, text: "Caster suffers a severe stroke, and falls into a 3 month coma." }
    ],
    attack: [
        { low: 1, high: 20, text: "The strain causes caster to lose concentration. The spell is lost (but not pts.)" },
        { low: 21, high: 30, text: "Mild mental lapse causes caster to lose spell (but not spell pts). Caster operates at -50 for 1 rnd." },
        { low: 31, high: 40, text: "Moderate, but serious, strain causes caster to lose spell (but not spell pts). Stunned for 1 rnd." },
        { low: 41, high: 60, text: "Serious mental lapse causes caster to throw an ineffectual spell. Stunned for 1 round." },
        { low: 61, high: 75, text: "Subconscious fear causes caster to cast an ineffectual spell. Stunned for 1 round." },
        { low: 76, high: 90, text: "Severe strain causes caster to misfire. Caster takes 5 hits, and is stunned for 3 rounds." },
        { low: 91, high: 95, text: "Extreme mental pressure causes caster to misfire and collapse to the ground. Caster takes 10 hits, and is stunned for 6 rnds." },
        { low: 96, high: 100, text: "Caster internalizes spell, takes 20 hits. Knocked out for 12 hrs." },
        { low: 101, high: 125, displace: "right", text: "Spell strays and travels to a point 20 feet right of target. Roll on appropriate table for effect. Caster is stunned for 1 round and takes 10 hits." },
        { low: 126, high: 150, displace: "left", text: "Spell strays and travels to a point 20 feet left of target. Roll on appropriate table for effect. Caster is stunned for 2 rounds and takes 5 hits." },
        { low: 151, high: 175, text: "Spell is cast in direction opposite to the intended line. Caster suffers mental collapse, takes 25 hits, and is unable to function for 6 hours." },
        { low: 176, high: 185, text: "Caster internalizes spell, takes 30 hits, and suffers nerve damage in brain. Unfortunate fool loses all spell casting ability for 1 wk, must operate at 50% of normal for 3 months (or until nerves are repaired, whichever period is shorter)." },
        { low: 186, high: 191, text: "Caster internalizes spell, loses all spell casting ability for 2 weeks, takes 35 hits, and falls into a coma for 1 week." },
        { low: 192, high: 195, text: "Caster suffers a massive stroke, takes 50 hits, and lapses into a month long coma. Caster will regain consciousness, but will die 3 hours later." },
        { low: 196, high: 200, text: "Caster suffers severe stroke, is paralyzed from the waist down." },
        { low: 201, high: 250, text: "Caster internalizes spell, loses all spell casting ability for 3 weeks, takes 40 hits, and falls into a coma for 3 weeks." },
        { low: 251, high: 300, text: "Severe nervous disorder causes caster to misfire spell, and lost all spell casting ability for 3 months." },
        { low: 301, high: Infinity, text: "Massive internalization of power. Brain death. Caster dies instantly." }
    ]
};

/** Look up a failure roll on a column of Table 15.7. */
export function lookupSpellFailure(section, roll) {
    const col = SPELL_FAILURE_TABLE[section] ?? SPELL_FAILURE_TABLE.nonattack;
    return col.find(r => roll >= r.low && roll <= r.high) ?? col[col.length - 1];
}

// ------------------------------------------------------------
// Realm + caster facts
// ------------------------------------------------------------

const REALM_BY_STAT = { ME: "essence", EM: "channeling", PR: "mentalism" };

function classIdOf(actor) {
    const sys = actor?.system ?? {};
    return String(sys.origin?.classId ?? sys.fixed_info?.classId ?? sys.classId ?? "").toLowerCase();
}

/** The caster's realm: from their class casting stat, else the
 *  spell's own class list, else Essence by default. An authored
 *  system.rmss.realm on the spell wins when present. */
export function casterRealm(actor, spellItem) {
    const authored = spellItem?.system?.rmss?.realm;
    if (authored) {
        const a = String(authored).toLowerCase();
        if (["essence", "channeling", "mentalism"].includes(a)) return a;
        const byStat = REALM_BY_STAT[String(authored).toUpperCase()];
        if (byStat) return byStat;
    }
    const byClass = CASTING_STAT_BY_CLASS[classIdOf(actor)];
    if (byClass) return REALM_BY_STAT[byClass];
    const spellClass = String(spellItem?.system?.spell_list ?? spellItem?.system?.class ?? "").toLowerCase();
    const bySpell = CASTING_STAT_BY_CLASS[spellClass];
    if (bySpell) return REALM_BY_STAT[bySpell];
    return "essence";
}

function wornItems(actor) {
    return [...(actor?.items?.contents ?? actor?.items ?? [])].filter(i => i && isWorn(i));
}

/** The AT the book's armor column keys on: the derived combat AT
 *  (chest piece sets the base per APAC), falling back to the best
 *  worn armor piece. */
export function wornArmorAt(actor) {
    const derived = actor?.system?.combat?.armorType;
    const m = derived != null ? String(derived).match(/(\d+)/) : null;
    if (m) return Math.min(20, Math.max(1, Number(m[1])));
    const ats = wornItems(actor)
        .filter(i => i.type === "armor")
        .map(i => Number(i.system?.at ?? i.system?.armorType) || 0)
        .filter(n => n > 0);
    return ats.length ? Math.min(20, Math.max(...ats)) : null;
}

function headPiece(actor) {
    return wornItems(actor).find(i => i.type === "armor"
        && (i.system?.armorLocation === "head" || i.system?.slot === "head")) ?? null;
}

/** Book helmet construction from the composer's category/material
 *  fields: chain/plate and metal materials are "metal"; leather
 *  with metal parts is "leather/metal"; anything else (cloth,
 *  leather, hide) reads as the all-leather row. */
export function helmetKind(piece) {
    if (!piece) return null;
    const cat = String(piece.system?.armorCategory ?? "").toLowerCase();
    const mat = String(piece.system?.armorMaterial ?? piece.system?.material ?? piece.system?.materialId ?? "").toLowerCase();
    const name = String(piece.name ?? "").toLowerCase();
    if (cat === "chain" || cat === "plate") return "metal";
    const metal = /steel|iron|mithril|adamantine|bronze|electrum|gold|platinum|silver|copper|chain|plate|metal/.test(mat);
    const organic = /leather|hide|silk|cloth/.test(mat);
    if (metal && organic) return "leatherMetal";
    if (metal) return "metal";
    if (/leather|hide/.test(mat) && /chain|steel|iron|metal/.test(name)) return "leatherMetal";
    return "leather";
}

/** Hands occupied by held gear: two-handers (incl. polearms) use
 *  both, a one-hander or a shield one each. >= 2 = no free hand. */
export function handsOccupied(actor) {
    let hands = 0;
    for (const i of wornItems(actor)) {
        if (i.type === "weapon") {
            const explicit = Number(i.system?.hands ?? i.system?.weapon?.hands);
            if (Number.isFinite(explicit) && explicit > 0) { hands += explicit; continue; }
            const t = String(i.system?.type ?? "").toLowerCase();
            if (t === "natural" || t === "spell") continue;
            hands += (t === "two-handed" || t === "polearm") ? 2 : 1;
        } else if (i.type === "shield") {
            hands += 1;
        }
    }
    return hands;
}

// ------------------------------------------------------------
// Carried equipment (§10.9.2): everything on the person EXCEPT
// helm, armor and boots. Weights split into the book's three
// buckets from the composer's material field. There is no
// "organic (living)" item class in the data, so that bucket is
// always empty for now (its term still computes).
// ------------------------------------------------------------

const METAL_MATERIAL = /steel|iron|bronze|mithril|adamantine|electrum|gold|platinum|silver|copper|tin|lead|metal|chain|plate|acrylia|velium/;
const ORGANIC_MATERIAL = /leather|hide|silk|cloth|wood|bone|fur|feather|silk/;

export function carriedEquipmentWeights(actor) {
    const out = { organicLiving: 0, organicNonliving: 0, inorganic: 0 };
    const items = [...(actor?.items?.contents ?? actor?.items ?? [])];
    for (const i of items) {
        if (!i) continue;
        // Armor (incl. helm and boots) is excluded by the book note.
        if (i.type === "armor") continue;
        if (["skill", "skill_category", "spell", "song", "aa", "class", "race", "language", "deity", "faction", "training_package"].includes(i.type)) continue;
        const w = Number(i.system?.weight ?? i.system?.item?.weight) || 0;
        if (w <= 0) continue;
        const qty = Number(i.system?.quantity ?? 1);
        const total = w * (Number.isFinite(qty) && qty > 0 ? qty : 1);
        const mat = String(i.system?.material ?? i.system?.shieldMaterial ?? i.system?.materialId ?? "").toLowerCase();
        if (ORGANIC_MATERIAL.test(mat)) out.organicNonliving += total;
        else if (METAL_MATERIAL.test(mat)) out.inorganic += total;
        else if (i.type === "consumable" || i.type === "herb_or_poison" || i.type === "instrument") out.organicNonliving += total;
        else out.inorganic += total; // metal/stone/glass default for unclassified gear
    }
    return out;
}

function equipmentEsf(weights, realm) {
    if (realm === "mentalism") return 0; // no Mentalism column in the book table
    let mod = 0;
    if (realm === "essence") {
        mod += Math.floor(Math.max(0, weights.organicLiving - 50) / 5);
        mod += Math.max(0, Math.ceil(weights.organicNonliving) - 3);
        mod += 2 * Math.max(0, Math.ceil(weights.inorganic) - 5);
    } else if (realm === "channeling") {
        mod += Math.max(0, Math.ceil(weights.inorganic) - 10);
    }
    return mod;
}

// ------------------------------------------------------------
// ESF summation
// ------------------------------------------------------------

/**
 * Sum the applicable ESF modifications for a cast.
 * opts: { prepRoundsShort, attackSpell }
 * Returns { realm, total, parts: [{ label, mod }] } — parts lists
 * only the nonzero contributors (label feeds the chat card).
 */
export function computeESF(actor, spellItem, opts = {}) {
    // EQ hybrids (ruling 2026-10-05): no ESF penalties for casting —
    // armor, weight, helm, overlevel, etc. are all ignored. Their
    // spells are already the weaker trade.
    const casterClass = classIdOf(actor);
    if (HYBRID_CASTERS.has(casterClass)) {
        return { total: 0, parts: [] };
    }
    const realm = casterRealm(actor, spellItem);
    const parts = [];
    const add = (label, mod) => { if (mod > 0) parts.push({ label, mod }); };

    // Spell above the caster's level.
    const spellLevel = Number(spellItem?.system?.level) || 0;
    const casterLevel = casterLevelOf(actor);
    if (spellLevel > 0) {
        add(`spell level ${spellLevel} over caster level ${casterLevel}`, spellLevelEsf(spellLevel - casterLevel));
    }

    // Non-standard spell list: the spell belongs to another class's
    // list than the caster's own.
    const spellClass = String(spellItem?.system?.spell_list ?? spellItem?.system?.class ?? "").toLowerCase();
    if (spellClass && casterClass && spellClass !== casterClass) {
        add("non-standard spell list", ESF_NONSTANDARD_LIST);
    }

    // Worn armor type (no Mentalism column in the book).
    // Divine casters ignore this channel (ruling 2026-10-06).
    const isDivine = DIVINE_CASTERS.has(casterClass);
    if (!isDivine) {
        const at = wornArmorAt(actor);
        if (at != null && realm !== "mentalism") {
            const row = ESF_ARMOR[at];
            if (row) add(`armor AT ${at}`, realm === "essence" ? row[0] : row[1]);
        }

        // Helmet worn.
        const helm = headPiece(actor);
        if (helm) {
            const kind = helmetKind(helm);
            const row = ESF_HELMET[kind];
            if (row) add(`helmet (${kind === "leatherMetal" ? "leather/metal" : kind})`, row[realm] ?? 0);
        }
    }

    // Free hand status. EQ hybrids ignore this channel
    // entirely (ruling 2026-10-05): weapons in hand are their
    // core casting posture.
    if (handsOccupied(actor) >= 2 && !HYBRID_CASTERS.has(casterClass)) {
        add("no free hand", freeHandEsf(realm));
    }

    // Carried equipment weight. Divine casters ignore (ruling 2026-10-06).
    if (!isDivine) {
        const weights = carriedEquipmentWeights(actor);
        const eqMod = equipmentEsf(weights, realm);
        if (eqMod > 0) {
            const bits = [];
            if (weights.organicNonliving > 0) bits.push(`${Math.ceil(weights.organicNonliving)} lb organic`);
            if (weights.inorganic > 0) bits.push(`${Math.ceil(weights.inorganic)} lb inorganic`);
            if (weights.organicLiving > 0) bits.push(`${weights.organicLiving} lb living organic`);
            add(`carried equipment (${bits.join(", ")})`, eqMod);
        }
    }

    // Preparation rounds. The cast path assumes book-standard
    // preparation; a caller with a prep tracker passes the shortage.
    add("short preparation", prepEsf(opts.prepRoundsShort));

    return { realm, total: parts.reduce((s, p) => s + p.mod, 0), parts };
}

// ------------------------------------------------------------
// Resolution
// ------------------------------------------------------------

async function d100roll(rollD100) {
    if (rollD100) return Number(await rollD100()) || 0;
    return (await new Roll("1d100").evaluate()).total;
}

/** High open-ended d100: 96-100 rolls again and adds. */
export async function highOpenEnded(rollD100) {
    const rolls = [];
    let total = 0;
    for (;;) {
        const r = await d100roll(rollD100);
        rolls.push(r);
        total += r;
        if (r < 96 || r > 100) break;
    }
    return { rolls, total };
}

/** Apply a Table 15.7 result's parseable effects to the caster:
 *  "takes N hits" concussion hits, crit-condition shorthand
 *  (stun, penalties, knocked down), explicit knockout/coma, and
 *  instant death. Long-duration prose (weeks of lost casting,
 *  strokes) stays in the chat text for the GM. */
export async function applySpellFailureEffects(caster, entry) {
    const text = entry?.text ?? "";
    const notes = [];
    if (!caster) return notes;
    const condNote = await applyCritConditions(caster, caster, text);
    if (condNote) notes.push(condNote.replace(/^<p>|<\/p>$/g, ""));

    const hitsMatch = text.match(/takes\s+(\d+)\s+hits/i);
    if (hitsMatch && (caster.isOwner || game.user?.isGM)) {
        const n = Number(hitsMatch[1]);
        const cur = Number(caster.system?.hits?.value) || 0;
        await caster.update({ "system.hits.value": cur + n });
        notes.push(`${esc(caster.name)} takes ${n} hits (${cur} → ${cur + n}).`);
        await checkHitThresholds(caster);
    }

    if (/dies instantly|brain death/i.test(text)) {
        await caster.update({ "system.status.dead": true, "system.status.unconscious": true });
        notes.push(`<strong>${esc(caster.name)} dies.</strong>`);
    } else if (/knocked out|coma/i.test(text) && !(Number(caster.system?.hits?.value) > Number(caster.system?.hits?.max || 0))) {
        await caster.update({ "system.status.unconscious": true });
        notes.push(`${esc(caster.name)} is knocked out.`);
    }
    return notes;
}

/**
 * Roll on the Spell Failure Table and apply the result to the
 * caster. esfTotal > 0 triples into the roll (ESF failures);
 * natural failures (bolt-table "F") pass 0.
 * opts: { section, esfTotal, reason, rollD100, headerHtml }
 */
export async function resolveSpellFailure(caster, spellItem, opts = {}) {
    const section = opts.section === "attack" ? "attack" : "nonattack";
    const esfTotal = Math.max(0, Number(opts.esfTotal) || 0);
    const fr = await highOpenEnded(opts.rollD100);
    const rollTotal = fr.total + esfTotal * 3;
    const entry = lookupSpellFailure(section, rollTotal);
    const notes = await applySpellFailureEffects(caster, entry);
    const name = spellItem?.name ?? "the spell";
    // Displaced attack spells: click-to-place landing (user ruling
    // 2026-10-05). The book-directed start point is computed here
    // while the target token is local to the casting client; the GM
    // places the splash, either immediately (GM caster) or from the
    // card button.
    let displaceBtn = "";
    let displaceCtx = null;
    if (entry.displace && opts.displace?.targetToken) {
        try {
            const { displacementStartPoint } = await import("./displaced-spell.js");
            const start = displacementStartPoint(
                opts.displace.targetToken, opts.displace.casterToken ?? null, entry.displace);
            displaceCtx = {
                kind: opts.displace.kind,
                direction: entry.displace,
                targetName: opts.displace.targetToken?.name ?? "the target",
                casterUuid: caster.uuid ?? "",
                spellUuid: spellItem.uuid ?? "",
                startX: Math.round(start.x), startY: Math.round(start.y)
            };
            const d = displaceCtx;
            displaceBtn = `<p><button type="button" class="eqrmss-place-stray"`
                + ` data-caster-uuid="${esc(d.casterUuid)}" data-spell-uuid="${esc(d.spellUuid)}"`
                + ` data-kind="${esc(d.kind)}" data-direction="${esc(d.direction)}"`
                + ` data-target-name="${esc(d.targetName)}"`
                + ` data-x="${d.startX}" data-y="${d.startY}">Place the stray spell (GM)</button></p>`;
        } catch (e) { console.warn("EQRMSS | stray-spell placement unavailable", e); }
    }
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        content: combatCard("Spell Failure", `
            ${opts.headerHtml ?? ""}
            <h2>${esc(caster.name)} — ${esc(name)} fails</h2>
            <p><strong>Failure roll:</strong> ${fr.rolls.join(" + ")}${fr.rolls.length > 1 ? ` = ${fr.total}` : ""}${esfTotal ? ` + ${esfTotal * 3} (triple ESF ${esfTotal})` : ""} = <strong>${rollTotal}</strong> on the Spell Failure Table (${section === "attack" ? "Attack" : "Non-Attack"} Spells)</p>
            <p>${esc(entry.text)}</p>
            ${notes.length ? `<p><em>${notes.join("<br>")}</em></p>` : ""}
            ${displaceBtn}`)
    });
    if (displaceCtx && game.user?.isGM) {
        const { openDisplacedCrosshair } = await import("./displaced-spell.js");
        await openDisplacedCrosshair({ caster, spellItem, ...displaceCtx });
    }
    return { entry, roll: rollTotal, section };
}

/**
 * The ESF gate, run before a cast resolves. Returns:
 * { required: false } when the sum is 0 (no roll per book),
 * { required: true, passed: true, roll, esf } on success, or
 * { required: true, passed: false, esf, failure } after the
 * failure has been rolled, applied, and posted. `note` is a
 * one-line HTML summary for the caller's own cast card.
 */
export async function esfGate(caster, spellItem, opts = {}) {
    const esf = computeESF(caster, spellItem, opts);
    if (esf.total <= 0) return { required: false, esf };
    const roll = await highOpenEnded(opts.rollD100);
    const partsText = esf.parts.map(p => `${p.label} +${p.mod}`).join(", ");
    if (roll.total > esf.total) {
        return {
            required: true, passed: true, esf, roll: roll.total,
            note: `ESF ${roll.total} vs ${esf.total} (${partsText}) — the spell resolves.`
        };
    }
    const failure = await resolveSpellFailure(caster, spellItem, {
        section: opts.attackSpell ? "attack" : "nonattack",
        esfTotal: esf.total,
        rollD100: opts.rollD100,
        displace: opts.displace ?? null,
        headerHtml: `<p><strong>ESF roll:</strong> ${roll.rolls.join(" + ")}${roll.rolls.length > 1 ? ` = ${roll.total}` : ""} vs ESF ${esf.total} (${esc(partsText)}) — the spell fails.</p>`
    });
    return { required: true, passed: false, esf, roll: roll.total, failure };
}
