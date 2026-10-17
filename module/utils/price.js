/**
 * Standardized item pricing for EQRMSS.
 *
 * Prices are stored as a single integer number of tin pieces (tp), the
 * smallest RMSS denomination. Display breaks the value down into
 * gp / sp / bp / cp / tp using the book-pure Character Law exchange rates:
 *
 *   1 gp = 10 sp = 100 bp = 1000 cp = 10000 tp
 *   (1 mp = 100 gp; 1 tp = 10 ip)
 */

export const TP_PER_UNIT = { gp: 10000, sp: 1000, bp: 100, cp: 10, tp: 1 };

const DISPLAY_ORDER = ["gp", "sp", "bp", "cp", "tp"];

// Legacy string costs ("2bp", "1sp", "5cp", "9tp") parse back to tp so old
// actors and data keep displaying correctly without a migration.
const LEGACY_MULTIPLIER = { tp: 1, cp: 10, bp: 100, sp: 1000, gp: 10000, pp: 100000, mp: 1000000 };

export function parsePriceToTp(value) {
    if (value == null || value === "") return 0;
    if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    const m = /^\s*([\d.]+)\s*(tp|cp|bp|sp|gp|pp|mp)?\s*$/i.exec(String(value));
    if (!m) return 0;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return 0;
    const mult = LEGACY_MULTIPLIER[(m[2] ?? "tp").toLowerCase()] ?? 1;
    return Math.max(0, Math.round(n * mult));
}

/**
 * Format a tin-piece price as "2 gp 3 sp 4 bp". Zero denominations are
 * omitted; 0 / missing prices render as "".
 */
export function formatPrice(value) {
    let tp = parsePriceToTp(value);
    if (tp <= 0) return "";
    const parts = [];
    for (const unit of DISPLAY_ORDER) {
        const per = TP_PER_UNIT[unit];
        const n = Math.floor(tp / per);
        if (n > 0) {
            parts.push(`${n} ${unit}`);
            tp -= n * per;
        }
    }
    return parts.join(" ");
}
