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
    "thrown": "thrown"
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
// Only S/P/K occur on the 32 book weapon tables; anything else is
// left for GM adjudication (never invented).
export const CRIT_TYPE_TO_TABLE_CODE = {
    "S": "S", // Slash
    "P": "P", // Puncture
    "K": "K"  // Krush
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
// Attack table lookup (§6.4): net roll capped at 150,
// cross-indexed with defender AT.
// Returns { table, netRoll, damage, critCode, damageRaw }
// or { error }.
// ------------------------------------------------------------
export function lookupAttack(weaponTables, tableName, netRoll, at) {
    const table = (weaponTables ?? []).find(t => t.name === tableName);
    if (!table) return { error: `No attack table "${tableName}" found.` };
    const net = Math.min(netRoll, NET_ROLL_CAP);
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
        damage,
        damageRaw: row.damage,
        critCode: row.critical || null
    };
}

// ------------------------------------------------------------
// Crit code parse (§6.4): "ES" → { severity: "E", type: "S" }.
// Anything outside A–E + S/P/K (lone "K", "RS", "AF", "F", …)
// is returned unparseable for GM adjudication — never guessed.
// ------------------------------------------------------------
export function parseCritCode(code) {
    if (!code) return null;
    const c = String(code).trim().toUpperCase();
    const m = c.match(/^([A-E])([SPK])$/);
    if (m) return { severity: m[1], type: m[2], raw: code };
    return { raw: code, unparseable: true };
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
    const m = String(critText).match(/\+(\d+)\s*hits?\b(?!\s*per\s+round)/i);
    return m ? Number(m[1]) : 0;
}
