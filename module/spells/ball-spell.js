// ============================================================
// BALL / AREA SPELLS (Stage 5; Spell Law §8.4 + Tables 15.4.6
// Cold Ball, 15.4.7 Fire Ball — transcribed from the printed
// pages 144-145, validated by cross-column monotonicity).
//
// Area elemental spells do NOT use the Base Attack Roll. They
// make an Elemental Attack Roll (EAR): an open-ended d100 +
// caster level (pure/hybrid spell users only; semis get no
// level bonus — same house tier as the Stage 4 BAR mapping).
// The book explicitly excludes for area spells: the caster's
// Agility bonus, the Directed Spells skill bonus, and the
// target's shield bonus.
//
// RULING (user, 2026-10-05): ONE shared EAR is rolled and
// applied to every target in the blast. Per-target situation
// then adjusts it: minus the table range modification, cover,
// helmet mods; plus the target's Quickness bonus (moving
// targets only) and +20 for the target at the center point
// (the first targeted token). The result is clamped 03-95,
// cross-indexed with each target's AT on the ball table.
// UM bands key on the UNMODIFIED roll (96-97 / 98-99 / 100
// Fire Ball; 96-99 / 100 Cold Ball); a natural 01-04 is an
// automatic spell failure (F cells likewise) via the Stage 3
// Spell Failure path. Crit type follows the ball table (Heat
// for Fire Ball, Cold for Cold Ball); magic/arcane balls force
// Mana crits and electric balls force Electricity crits (the
// Stage 2 substitution precedent).
//
// Target model: area spells hit every currently-targeted
// token; the first targeted token is the center point (+20).
// A shared "F" fails the whole spell, once.
// ============================================================

import { combatCard } from "../combat/chat-card.js";
import {
    parseArmorType, lookupCrit, critBonusHits
} from "../combat/attack-resolver.js";
import {
    adjudicateCritText, applyCritConditions, checkHitThresholds
} from "../combat/crit-conditions.js";
import { resolveSpellFailure } from "./spell-failure.js";
import { SEMI_CASTERS, d100 } from "./base-spell.js";
import { BALL_BY_ELEMENT, casterLevelOf } from "./spell-mapping.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

// Re-exported for the classifier tests and sheet code.
export { BALL_BY_ELEMENT };

/** EAR range modification (printed on both ball tables). */
export function earRangeMod(feet) {
    if (feet == null || !Number.isFinite(Number(feet))) return 0;
    const f = Number(feet);
    if (f <= 10) return 35;
    if (f <= 50) return 0;
    if (f <= 100) return -25;
    if (f <= 200) return -40;
    if (f <= 300) return -55;
    return -75;
}

/** Caster-level EAR bonus: pure spell users only. */
export function earLevelBonus(actor) {
    const sys = actor?.system ?? {};
    const cls = String(sys.origin?.classId ?? sys.fixed_info?.classId ?? sys.classId ?? "").toLowerCase();
    if (SEMI_CASTERS.has(cls)) return 0;
    return casterLevelOf(actor);
}

function ballTables() {
    return globalThis.game?.eqrmss?.combatTables?.weapons ?? [];
}

function findBallTable(name) {
    return ballTables().find(t => t.name === name && t.ball) ?? null;
}

/** Cross-index a roll on a ball table. UM bands key on the
 *  unmodified (first) die; everything else clamps to 03-95.
 *  Returns { band, row } or { error }. */
export function lookupBall(table, natural, total, at) {
    if (!table) return { error: "Ball table not loaded." };
    const bands = table.ranges ?? [];
    let band;
    if (natural >= 96) {
        band = bands.find(r => r.um && natural >= r.low && natural <= r.high)
            ?? bands.filter(r => r.um).pop();
    } else if (natural <= 4) {
        band = bands.find(r => r.low === 1 && r.high === 4);
    } else {
        const roll = Math.min(95, Math.max(3, total));
        // The printed 01-04 band is UM-flagged in the data; a
        // clamped roll below 05 still lands there (all F).
        band = bands.find(r => !r.um && roll >= r.low && roll <= r.high)
            ?? (roll < 5 ? bands.find(r => r.low === 1 && r.high === 4) : undefined);
    }
    if (!band) return { error: `Roll ${natural}/${total} is off the ${table.name}.` };
    const row = (band.rows ?? []).find(r => Number(r.at) === Number(at));
    if (!row) return { error: `No AT ${at} row on the ${table.name} (band ${band.low}-${band.high}).` };
    const label = band.um ? `UM ${band.low}${band.high > band.low ? "-" + band.high : ""}`
        : `${band.low}-${String(band.high).padStart(2, "0")}`;
    return { band: label, row };
}

async function addHits(target, n) {
    const cur = Number(target.system?.hits?.value) || 0;
    await target.update({ "system.hits.value": cur + n });
    await checkHitThresholds(target);
    return cur + n;
}

async function rollCrit(caster, target, critTables, critType, severity, rollD100) {
    const cr = await d100(rollD100);
    const res = lookupCrit(critTables, critType, severity, cr);
    if (res.error) return { html: `<p><em>Crit lookup failed: ${esc(res.error)} — GM adjudicates.</em></p>` };
    const adjudicated = adjudicateCritText(res.text, target);
    let note = "";
    if (adjudicated.applied) note += ` <em>(${esc(adjudicated.applied)})</em>`;
    if (adjudicated.unresolved?.length) {
        note += ` <em>GM adjudicates: ${adjudicated.unresolved.map(u => esc(u.phrase)).join("; ")}</em>`;
    }
    const bonus = critBonusHits(adjudicated.text);
    let bonusNote = "";
    if (bonus > 0) {
        const cur = Number(target.system?.hits?.value) || 0;
        await target.update({ "system.hits.value": cur + bonus });
        await checkHitThresholds(target);
        bonusNote = ` <em>(+${bonus} bonus hits — ${cur + bonus} concussion hits)</em>`;
    }
    const condNote = await applyCritConditions(target, caster, adjudicated.text);
    return {
        html: `<p><em>${esc(res.table)} ${esc(severity)} (${cr}): ${esc(adjudicated.text)}.${bonusNote}${note}${condNote ? ` ${condNote}` : ""}</em></p>`
    };
}

/**
 * Resolve a ball spell against every targeted token with the
 * one shared EAR (user ruling 2026-10-05). Posts the Spell
 * Failure card itself when the shared roll fails; otherwise
 * returns { failed:false, html } for the CALLER's cast card.
 * opts: { rangeFeet, centerId, coverMod, helmetMods, quBonus,
 *         rollD100, critTables }
 */
export async function resolveBallCast(caster, spellItem, targets, ball, opts = {}) {
    const table = findBallTable(ball.table);
    if (!table) {
        return { failed: true, error: `Ball table "${ball.table}" not loaded.` };
    }
    const name = spellItem?.name ?? "ball spell";
    const critType = ball.critType ?? table.critType ?? "H";

    // ---- Shared Elemental Attack Roll (open-ended high) ----
    const dice = [];
    let natural = await d100(opts.rollD100);
    dice.push(natural);
    let total = natural;
    while (natural >= 96) {
        // UM 96-00: the explosion counts, but the UM BAND is keyed
        // on the unmodified first die.
        natural = await d100(opts.rollD100);
        dice.push(natural);
        total += natural;
    }
    const first = dice[0];
    if (first <= 4) {
        await resolveSpellFailure(caster, spellItem, {
            section: "attack", esfTotal: 0, rollD100: opts.rollD100,
            headerHtml: `<p><strong>Elemental Attack Roll ${first}</strong> — automatic spell failure (Spell Law 8.4.1).</p>`
        });
        return { failed: true, natural: first };
    }
    const lvlBonus = earLevelBonus(caster);
    const rangeMod = earRangeMod(opts.rangeFeet);
    // Book EAR (printed on the ball tables): roll + level + range
    // + cover + helmet - Qu (moving targets only) + 20 center.
    // Helmet buckets: none (+5), normal (+0), full (-5). Shield
    // mods do not apply to area spells (Spell Law 15.4).
    const modified = total + lvlBonus + rangeMod;
    const rangeLine = `${lvlBonus ? ` + ${lvlBonus} level` : ""}${rangeMod ? ` ${rangeMod > 0 ? "+" : ""}${rangeMod} range` : ""}`;
    const earLine = `<strong>Elemental Attack Roll:</strong> ${dice.join(", ")} = ${total}${rangeLine} = <strong>${modified}</strong>`
        + ` → ${esc(ball.table)} (shared; user ruling 2026-10-05)`;

    const critTables = opts.critTables ?? globalThis.game?.eqrmss?.combatTables?.crits ?? [];
    const centerId = opts.centerId ?? targets[0]?.id ?? null;
    const coverMod = Number(opts.coverMod) || 0;
    const quBonus = Number(opts.quBonus) || 0; // moving targets only
    const helmetMods = opts.helmetMods ?? {};
    let body = `<p>${earLine}.</p>`;
    let anyFailure = false;

    for (const target of targets) {
        const tName = esc(target?.name ?? "target");
        // The table's helmet bucket defaults to "none worn" (+5);
        // full helmets read -5. The book subtracts the target's Qu
        // bonus for moving targets (stationary targets use cover
        // instead); no movement state is plumbed yet, so quBonus
        // arrives 0 until a caller supplies it.
        const helmetMod = Number(helmetMods[target?.id] ?? 5);
        const isCenter = centerId != null && target?.id === centerId;
        const eff = modified + coverMod + helmetMod - quBonus + (isCenter ? 20 : 0);
        const parts = [];
        if (coverMod) parts.push(`${coverMod} cover`);
        if (helmetMod) parts.push(`${helmetMod > 0 ? "+" : ""}${helmetMod} helmet`);
        if (quBonus) parts.push(`-${quBonus} Qu`);
        if (isCenter) parts.push("+20 center");
        const adjNote = parts.length ? ` (${parts.join(", ")})` : "";

        let at = parseArmorType(target?.system?.combat?.armorType);
        let atNote = "";
        if (at == null) {
            at = 1;
            atNote = ` <em>AT unknown — GM adjudicates; resolved at AT 1.</em>`;
        }
        const cell = lookupBall(table, first, eff, at);
        if (cell.error) {
            body += `<p><strong>${tName}</strong> (AT ${at}): ${esc(cell.error)}${atNote}</p>`;
            continue;
        }
        if (cell.row.damage === "F") {
            anyFailure = true;
            body += `<p><strong>${tName}</strong> (AT ${at}): EAR ${eff}${adjNote} → band ${cell.band} = <strong>F — spell failure.</strong></p>`;
            continue;
        }
        const hits = Number(cell.row.damage) || 0;
        let line = `<strong>${tName}</strong> (AT ${at}): EAR ${eff}${adjNote} → band ${cell.band} = ${esc(cell.row.damage)}${cell.row.critical ?? ""}${atNote}`;
        let after = null;
        if (hits > 0 && (target.isOwner || globalThis.game?.user?.isGM)) {
            after = await addHits(target, hits);
            line += ` <em>(${after} concussion hits)</em>`;
        } else if (hits > 0) {
            line += ` <em>hits not applied — you don't control ${tName}.</em>`;
        } else {
            line += ` <em>(no effect)</em>`;
        }
        body += `<p>${line}.</p>`;
        if (cell.row.critical && hits > 0) {
            const crit = await rollCrit(caster, target, critTables, critType, cell.row.critical, opts.rollD100);
            body += crit.html;
        }
    }

    if (anyFailure) {
        // The shared roll put at least one target on F: the whole
        // ball fails once (the F-cell entries on the ball tables
        // fail the spell, not the single target).
        await resolveSpellFailure(caster, spellItem, {
            section: "attack", esfTotal: 0, rollD100: opts.rollD100,
            headerHtml: `<p><strong>${esc(name)}</strong> — an "F" result on the ${esc(ball.table)}: spell failure.</p>${body}`
        });
        return { failed: true, natural: first, modified };
    }
    return { failed: false, natural: first, modified, html: body };
}
