// ============================================================
// EQRMSS Attack Resolver — Arms Law attack resolution (RMSS §6.2–6.4)
//
// Pure logic: no Foundry dependencies, testable in plain Node.
// Dice are injected (rollD100: () => 1..100) so tests are deterministic.
// Foundry wiring (targets, chat, damage application) lives in
// module/combat/combat-rolls.js.
// ============================================================

// Weapon type slug (system.type) → weapon skill item slug (system.slug)
export const WEAPON_TYPE_TO_SKILL_ID = {
    "one-handed-edged": "oneHandedEdged",
    "one-handed-crushing": "oneHandedCrushing",
    "two-handed": "twoHanded",
    "polearm": "poleArms",
    "missile": "bows",
    "thrown": "thrown",
    "natural": "naturalWeapons"
};

// Weapon type slug → Weapon Fumble Table (8.2.1) column
export const WEAPON_TYPE_TO_FUMBLE_COLUMN = {
    "one-handed-edged": "hand1",
    "one-handed-crushing": "hand1",
    "two-handed": "hand2",
    "polearm": "spearPole",
    "missile": "bows",
    "thrown": "thrown"
};

// Crit-code type letter → critical-table code in crit-tables.json.
// S/P/K occur on the Arms Law weapon tables; G/U/T occur on the
// Claw Law animal attack tables (AL&CL 11.1: G = Grapple, U =
// Unbalance, T = Tiny). Spell Law elemental types: H = Heat,
// C = Cold, E = Electricity, I = Impact (bolt tables). Anything
// else is left for GM adjudication (never invented).
export const CRIT_TYPE_TO_TABLE_CODE = {
    "S": "S",   // Slash
    "P": "P",   // Puncture
    "K": "K",   // Krush
    "G": "G",   // Grapple (Claw Law 11.3.1)
    "U": "Un",  // Unbalance (Claw Law 11.3.5)
    "T": "Ti",  // Tiny (Claw Law 11.3.4)
    "H": "H",   // Heat (Spell Law)
    "C": "C",   // Cold (Spell Law)
    "E": "E",   // Electricity (Spell Law)
    "I": "I",   // Impact (Spell Law)
    "M": "M"    // Mana (Spell Law; reached only via the spell cast path's forced crit type —
                // the "M" in MA Strikes codes is attack size, never a crit type)
};

export const NET_ROLL_CAP = 150; // §6.4: net attack rolls above 150 are treated as 150

// ------------------------------------------------------------
// Fumble range: "01-04" → { low: 1, high: 4 }
// ------------------------------------------------------------
export function parseFumbleRange(str) {
    if (!str) return null;
    const m = String(str).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!m) return null;
    return { low: Number(m[1]), high: Number(m[2]) };
}

export function inFumbleRange(roll, range) {
    return !!range && roll >= range.low && roll <= range.high;
}

// ------------------------------------------------------------
// Fumble check resolution (§6.2–6.3). Natural (animal) attacks
// never roll on the Weapon Fumble Table: an unmodified roll in
// the attack's fumble range is an automatic Failure with no
// effect on attacker or defender (Claw Law tables print 01–02,
// onFumble "F"). The item's baked range wins; the attack table's
// transcribed fumble range is the fallback; 01–02 is the book
// default. Manufactured weapons keep the classic §6.3 Fumble
// Table roll.
// Returns { kind: "fumble" | "failure" | null, range }.
// ------------------------------------------------------------
export function resolveFumbleCheck({ weaponType, itemFumbleRange, table } = {}) {
    const item = parseFumbleRange(itemFumbleRange);
    if (weaponType === "natural") {
        const meta = (table && Number.isFinite(Number(table.fumbleLow)) && Number.isFinite(Number(table.fumbleHigh)))
            ? { low: Number(table.fumbleLow), high: Number(table.fumbleHigh) }
            : null;
        return { kind: "failure", range: item ?? meta ?? { low: 1, high: 2 } };
    }
    return { kind: item ? "fumble" : null, range: item };
}

// ------------------------------------------------------------
// High open-ended d100 (§6.2): 96–100 → roll again and add,
// repeating while 96–100 comes up.
// Returns { rolls: [...], total, exploded }
// ------------------------------------------------------------
export function openEndedD100(rollD100) {
    const rolls = [];
    let total = 0;
    for (;;) {
        const r = rollD100();
        rolls.push(r);
        total += r;
        if (r < 96 || r > 100) break;
    }
    return { rolls, total, exploded: rolls.length > 1 };
}

// ------------------------------------------------------------
// Attack table lookup (§6.4 + AL&CL 11.1): net roll capped at 150,
// cross-indexed with defender AT. Claw Law animal tables also carry
// four maximum-result thresholds (S/M/L/H): an attack's net roll
// cannot exceed the threshold for its attack size — the maximum
// allowed result is used as the net roll instead.
// Returns { table, netRoll, uncappedRoll, capped, cap, attackSize,
//           fSeverityRule, impliedCritType, damage, critCode, damageRaw }
// or { error }.
// ------------------------------------------------------------
export function lookupAttack(weaponTables, tableName, netRoll, at, attackSize) {
    const table = (weaponTables ?? []).find(t => t.name === tableName);
    if (!table) return { error: `No attack table "${tableName}" found.` };
    const sizeKey = String(attackSize ?? "").trim().toUpperCase();
    const threshold = table.maxResult?.[sizeKey];
    const cap = threshold != null && Number.isFinite(Number(threshold))
        ? Math.min(Number(threshold), NET_ROLL_CAP)
        : NET_ROLL_CAP;
    const net = Math.min(netRoll, cap);
    const capped = netRoll > cap;
    const range = (table.ranges ?? []).find(r => net >= r.low && net <= r.high);
    if (!range) {
        return { table: table.name, netRoll: net, miss: true,
                 error: `Net roll ${net} is below the ${table.name} table — clean miss.` };
    }
    const row = (range.rows ?? []).find(x => Number(x.at) === Number(at));
    if (!row) return { error: `AT ${at} is not on the ${table.name} table.` };
    const dmgStr = String(row.damage ?? "").trim();
    const damage = /^\d+$/.test(dmgStr) ? Number(dmgStr) : null;
    return {
        table: table.name,
        netRoll: net,
        uncappedRoll: netRoll,
        capped,
        cap,
        attackSize: sizeKey || null,
        fSeverityRule: table.fSeverityRule ?? null,
        impliedCritType: table.impliedCritType ?? null,
        damage,
        damageRaw: row.damage,
        critCode: row.critical || null
    };
}

// ------------------------------------------------------------
// Crit code parse (§6.4, AL&CL 11.1): "ES" → { severity: "E", type: "S" }.
// Claw Law adds G (Grapple), U (Unbalance), T (Tiny). A lone letter
// ("A") carries severity only — the type is indicated on the attack
// table itself (MA Striking / MA Sweeps & Throws). "F" severity means
// two critical strikes per the table's fSeverityRule.
// Anything else is returned unparseable for GM adjudication — never guessed.
// ------------------------------------------------------------
export function parseCritCode(code) {
    if (!code) return null;
    const c = String(code).trim().toUpperCase();
    let m = c.match(/^([A-E])([SPKGUTHCEI])$/);
    if (m) return { severity: m[1], type: m[2], raw: code };
    m = c.match(/^F([SPKGUTHCEI])?$/);
    if (m) return { severity: "F", type: m[1] ?? null, raw: code };
    m = c.match(/^([A-E])$/);
    if (m) return { severity: m[1], type: null, implied: true, raw: code };
    return { raw: code, unparseable: true };
}

// Compound crit codes (Spell Law bolt tables, e.g. Lightning Bolt
// "EE,AI" delivers an Electricity E crit AND an Impact A crit):
// parse each comma-separated part. Returns null when not compound
// (no comma); otherwise the array of parsed parts (a part may be
// unparseable, which the caller surfaces for GM adjudication).
export function parseCritCodes(code) {
    if (!code || !String(code).includes(",")) return null;
    return String(code).split(",").map(p => parseCritCode(p.trim()));
}

// ------------------------------------------------------------
// Critical strike lookup (§6.4.2): flat 1–100 (NOT open-ended),
// cross-indexed with severity on the critical table of the type.
// Returns { table, severity, text } or { error }.
// ------------------------------------------------------------
export function lookupCrit(critTables, typeCode, severity, roll) {
    const tableCode = CRIT_TYPE_TO_TABLE_CODE[typeCode];
    if (!tableCode) {
        return { error: `No critical table mapped for crit type "${typeCode}".` };
    }
    const table = (critTables ?? []).find(t => t.code === tableCode);
    if (!table) return { error: `Critical table "${tableCode}" not loaded.` };
    const column = (table.criticals ?? []).filter(
        c => String(c.severity).toUpperCase() === String(severity).toUpperCase()
    );
    if (!column.length) {
        return { error: `No ${severity} column on the ${table.name}.` };
    }
    const entry = column.find(c => roll >= c.low && roll <= c.high);
    if (!entry) return { error: `Crit roll ${roll} is off the ${severity} column of the ${table.name}.` };
    return { table: table.name, severity, text: entry.result };
}

// ------------------------------------------------------------
// Fumble table lookup (§6.3): flat d100 vs the weapon's column.
// ------------------------------------------------------------
export function lookupFumble(fumbleTable, column, roll) {
    if (!fumbleTable) return { error: "Fumble table not loaded." };
    const columns = fumbleTable.columns ?? [];
    const col = columns.includes(column) ? column : columns[0];
    const range = (fumbleTable.ranges ?? []).find(r => roll >= r.low && roll <= r.high);
    if (!range) return { error: `Fumble roll ${roll} is off the table.` };
    return { column: col, text: range[col] ?? range[columns[0]] ?? "" };
}

// ------------------------------------------------------------
// "AT 15" → 15 ; "No Armor" → 1 (RMSS AT 1 = no armor)
// ------------------------------------------------------------
export function parseArmorType(str) {
    if (str == null) return null;
    const s = String(str).trim();
    if (/^no armor$/i.test(s)) return 1;
    const m = s.match(/AT\s*(\d+)/i);
    return m ? Number(m[1]) : null;
}

// ------------------------------------------------------------
// "+# hits" from a crit result (§6.4.4): bonus concussion hits
// added to the table result. "per round" (bleeding) is excluded —
// the GM adjudicates ongoing effects.
// ------------------------------------------------------------
export function critBonusHits(critText) {
    if (!critText) return 0;
    const s = String(critText);
    const m = s.match(/\+(\d+)\s*hits?\b(?!\s*per\s+round)/i);
    if (m) return Number(m[1]);
    // Spell Law shorthand "+NH" (also glued forms like "+13H2*").
    const sh = s.match(/\+\s*(\d+)\s*H(?=[\s,.*@!;)]|$)/);
    return sh ? Number(sh[1]) : 0;
}
