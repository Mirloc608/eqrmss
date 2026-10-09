// ============================================================
// EQRMSS Swarm Pet Combat — Option A (2026-10-08)
//
// Swarm pets stay DoTs (no actor/token/combatant — "basically just
// dots"), but each tick resolves one REAL RMSS attack per swarm pet
// through the standard attack-table machinery: open-ended d100 +
// OB vs the target's AT/DB on the swarm's family attack table,
// with critical strikes resolved and applied normally.
//
// Pet-buff auras/AAs (flurry, crits) are a follow-up: there is no
// mechanical pet-buff pipeline to hook into yet (AA effects are
// display-only; warder buffs are beastlord-only).
// ============================================================

import {
    lookupAttack,
    parseCritCode,
    parseCritCodes,
    lookupCrit,
    critBonusHits,
    parseArmorType,
} from "../../combat/attack-resolver.js";
import { applyCritConditions, adjudicateCritText } from "../../combat/crit-conditions.js";
import { targetDefense } from "../../combat/combat-rolls.js";
import { highOpenEnded } from "../spell-failure.js";
import { d100 } from "../base-spell.js";
import { PET_ATTACK_TABLES } from "./pet-combat.js";

/** Swarm pet OB — mirrors scalePetStats (summon-pet.js): level * 1.5 + 10. */
export function swarmPetOB(level) {
    return Math.round(Math.max(1, Number(level) || 1) * 1.5) + 10;
}

/** Attack table for a swarm family; default is small biting creatures. */
export function swarmAttackTable(family) {
    return PET_ATTACK_TABLES[String(family ?? "").toLowerCase()] ?? "Bite";
}

function stripP(s) {
    return String(s ?? "").replace(/^<p>|<\/p>$/g, "");
}

async function resolveOneCrit(tables, targetActor, type, severity, notes) {
    const cr = await d100();
    const critResult = lookupCrit(tables.crits, type, severity, cr);
    if (critResult.error) {
        notes.push(`crit ${severity}${type ?? ""}: ${critResult.error} (GM adjudicates)`);
        return 0;
    }
    const adjudicated = adjudicateCritText(critResult.text, targetActor);
    const bonus = critBonusHits(adjudicated.text);
    const condNote = await applyCritConditions(targetActor, null, adjudicated.text);
    if (condNote) notes.push(stripP(condNote));
    return bonus;
}

/** Expand a crit code into {type, severity} strikes (compound + F-severity). */
function expandCritStrikes(lookup, notes) {
    const code = lookup.critCode;
    if (!code) return [];
    const strikes = [];
    const pushStrike = (type, severity) => {
        if (severity) strikes.push({ type: type ?? lookup.impliedCritType ?? null, severity });
    };
    const pushF = (raw) => {
        const rule = lookup.fSeverityRule;
        if (Array.isArray(rule) && rule.length) {
            for (const r of rule) pushStrike(r.type, r.severity);
        } else {
            notes.push(`crit ${raw}: F-severity with no table rule (GM adjudicates)`);
        }
    };
    const compound = parseCritCodes(code);
    if (compound) {
        for (const p of compound) {
            if (!p || p.unparseable) {
                notes.push(`crit ${p?.raw ?? code}: unparseable (GM adjudicates)`);
                continue;
            }
            if (p.severity === "F") pushF(p.raw);
            else pushStrike(p.type, p.severity);
        }
        return strikes;
    }
    const c = parseCritCode(code);
    if (!c || c.unparseable) {
        notes.push(`crit ${code}: unparseable (GM adjudicates)`);
        return [];
    }
    if (c.severity === "F") pushF(c.raw);
    else pushStrike(c.type, c.severity);
    return strikes;
}

/**
 * Resolve one swarm pet's attack against the target actor.
 * @returns {{hits:number, detail:string}}
 */
async function oneSwarmAttack(targetActor, { level, tableName }) {
    const tables = globalThis.game?.eqrmss?.combatTables;
    if (!tables) return { hits: 0, detail: "combat tables not loaded" };
    const ob = swarmPetOB(level);
    const ar = await highOpenEnded();
    const firstDie = ar.rolls[0];
    // Natural attacks: an unmodified 01-02 is an automatic failure —
    // no roll on the Weapon Fumble Table (same as pet attacks).
    if (firstDie <= 2) return { hits: 0, detail: `roll ${firstDie} — automatic failure` };
    const db = targetDefense(targetActor, false, null).db;
    const at = parseArmorType(targetActor?.system?.combat?.armorType);
    const net = ar.total + ob - db;
    const lookup = lookupAttack(tables.weapons, tableName, net, at, null);
    if (lookup.error && lookup.miss) return { hits: 0, detail: "miss" };
    if (lookup.error) return { hits: 0, detail: lookup.error };
    if (lookup.noEffect) return { hits: 0, detail: "no effect" };
    const notes = [];
    let critBonus = 0;
    for (const s of expandCritStrikes(lookup, notes)) {
        if (!s.type) {
            notes.push(`crit ${s.severity}: no crit type (GM adjudicates)`);
            continue;
        }
        critBonus += await resolveOneCrit(tables, targetActor, s.type, s.severity, notes);
    }
    const hits = (Number(lookup.damage) || 0) + critBonus;
    const rollStr = ar.rolls.length > 1 ? `${ar.rolls.join("+")}=${ar.total}` : `${ar.total}`;
    let detail = `${rollStr}+${ob}−${db}=${net} → ${hits}`;
    if (lookup.critCode) detail += ` (${lookup.critCode}${critBonus ? ` +${critBonus}` : ""})`;
    if (notes.length) detail += ` [${notes.join("; ")}]`;
    return { hits, detail };
}

/**
 * Resolve a swarm DoT's tick: one attack per swarm pet.
 * @param {object} targetActor - Actor carrying the swarm DoT
 * @param {object} dot - DoT entry (isSwarm, swarmLevel, swarmCount, swarmFamily)
 * @returns {{total:number, count:number, details:string[]}}
 */
export async function resolveSwarmTick(targetActor, dot) {
    const count = Math.max(1, Number(dot?.swarmCount) || 1);
    const level = Math.max(1, Number(dot?.swarmLevel) || 1);
    const tableName = swarmAttackTable(dot?.swarmFamily);
    let total = 0;
    const details = [];
    for (let i = 0; i < count; i++) {
        const r = await oneSwarmAttack(targetActor, { level, tableName });
        total += r.hits;
        details.push(`#${i + 1} ${r.detail}`);
    }
    return { total, count, details };
}
