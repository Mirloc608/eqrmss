/**
 * Table resolver for absolute effects (user ruling 2026-10-21:
 * "Route absolutes through the RMSS tables instead").
 *
 * Extends the 2026-10-04 pure-RMSS ruling (bolt spells ignore EQ
 * damage numbers; the bolt table + casting skill produce all hits
 * and crits) to every remaining absolute-point pipeline: item-effect
 * damage / DoTs / heals / HoTs here, base spells, songs and damage
 * shields in later stages. EQ numbers stop being OUTPUT — they stay
 * as content that selects which spell/effect it is; durations,
 * rounds, RR gates and mana costs are unchanged.
 *
 * Pure resolution only: an open-ended d100 + OB - DB cross-indexed
 * on the attack table via attack-resolver.js (the same pure layer
 * rollWeaponAttack uses). No chat cards, no prompts, no state
 * writes — callers apply the result through their own pipelines so
 * their resist / absorb / capstone hooks keep working.
 */

import {
    lookupAttack, parseCritCode, parseCritCodes, lookupCrit,
    critBonusHits, openEndedD100, parseArmorType
} from "./attack-resolver.js";
import {
    BOLT_BY_ELEMENT, directedSpellsOB, directedSpellsBonus, casterLevelOf
} from "../spells/spell-mapping.js";

/**
 * Element → { attackTable, critType } via the spell-mapping bolt
 * table. Untyped / poison / disease (no bolt mapping of their own)
 * fall back to Fire Bolt with Mana crits — the mapping's existing
 * magic/arcane precedent (design choice A, approved 2026-10-21).
 */
export function tableForElement(element) {
    const hit = BOLT_BY_ELEMENT[String(element ?? "").toLowerCase()];
    if (hit) return { attackTable: hit.attackTable, critType: hit.critType ?? null };
    return { attackTable: "Fire Bolt", critType: "M" };
}

/**
 * The OB an absolute effect rolls at (design choice D, approved
 * 2026-10-21): the source actor's Directed Spells OB when they have
 * the skill; otherwise level x 2 (the monk-strike level-band
 * precedent). Procs pass the triggering swing's actor, so a proc
 * rides its wielder's numbers the same way.
 */
export function effectOBFor(actor) {
    if (!actor) return 0;
    if (directedSpellsBonus(actor) > 0) return directedSpellsOB(actor);
    return casterLevelOf(actor) * 2;
}

function d100() {
    return 1 + Math.floor(Math.random() * 100);
}

/**
 * Resolve one absolute application on a table.
 *   element / tableName+critType — table selection (element derives
 *     it through tableForElement when tableName is absent)
 *   ob — the source's effect OB (effectOBFor)
 *   target — defender; supplies AT (armor type) and DB
 *     (system.combat.totalDB; an unconscious defender has none).
 *     Shield-assignment nuance from targetDefense is NOT applied —
 *     absolute effects do not engage per-foe shield assignment.
 *   allowCrit — direct applications roll crits (bonus hits are
 *     folded into total; crit texts are returned for the caller to
 *     apply via applyCritConditions). Ticks pass false (design
 *     choice C: ticks are hits only).
 *   noDefense / atOverride — heals roll against no DB on the AT 1
 *     column (design choice E: healing is not an attack on armor).
 * Returns null when the combat tables are not loaded (callers fall
 * back to their legacy behavior), otherwise
 * { table, roll, net, ob, db, hits, critBonus, total,
 *   crits: [{ type, severity, text }], noEffect, fizzle? }.
 */
export function resolveTableAttack({
    element, tableName, critType, ob = 0, target = null,
    allowCrit = true, noDefense = false, atOverride = null
} = {}) {
    const tables = globalThis.game?.eqrmss?.combatTables;
    if (!tables?.weapons) return null;
    const sel = tableName
        ? { attackTable: tableName, critType: critType ?? null }
        : tableForElement(element);
    const at = atOverride != null
        ? atOverride
        : (target ? (parseArmorType(target.system?.combat?.armorType) ?? 1) : 1);
    const db = (noDefense || !target)
        ? 0
        : (target.system?.status?.unconscious
            ? 0
            : (Number(target.system?.combat?.totalDB) || 0));
    const ar = openEndedD100(d100);
    const net = ar.total + (Number(ob) || 0) - db;
    const lookup = lookupAttack(tables.weapons, sel.attackTable, net, at, null);
    const base = { table: sel.attackTable, roll: ar.total, net: lookup.netRoll ?? net, ob: Number(ob) || 0, db };
    if (lookup.error || lookup.miss || lookup.noEffect) {
        return { ...base, hits: 0, critBonus: 0, total: 0, crits: [], noEffect: true };
    }
    // An "F" cell is a natural spell failure for CAST spells; an
    // item effect is not cast, so the cell simply has no effect.
    if (lookup.damageRaw != null && String(lookup.damageRaw).trim().toUpperCase() === "F") {
        return { ...base, hits: 0, critBonus: 0, total: 0, crits: [], noEffect: true, fizzle: true };
    }
    const hits = Number(lookup.damage) || 0;
    const crits = [];
    let critBonus = 0;
    if (allowCrit && lookup.critCode) {
        const compound = parseCritCodes(lookup.critCode);
        const parts = compound ?? [parseCritCode(lookup.critCode)];
        for (const part of parts) {
            if (!part || part.unparseable) continue;
            const type = part.type ?? sel.critType ?? lookup.impliedCritType ?? null;
            if (!type) continue;
            // "F" severity expands per the table's own rule
            // (mirrors rollWeaponAttack); no rule transcribed →
            // the crit is skipped for GM adjudication.
            const severities = part.severity === "F"
                ? (Array.isArray(lookup.fSeverityRule)
                    ? lookup.fSeverityRule.map(r => r?.severity).filter(Boolean)
                    : [])
                : [part.severity];
            for (const severity of severities) {
                const found = lookupCrit(tables.crits, type, severity, d100());
                if (found?.text) {
                    crits.push({ type, severity, text: found.text });
                    critBonus += critBonusHits(found.text);
                }
            }
        }
    }
    return { ...base, hits, critBonus, total: hits + critBonus, crits, noEffect: false };
}
