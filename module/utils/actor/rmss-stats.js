// ============================================================
// EQRMSS — Canonical Stat Utilities
// ============================================================
//
// Single source of truth for RMSS stat identity.
//
// The system has historically used three different spellings
// for the same stats:
//
//   - Race/class JSON definitions:  St, Ag, Co, Me, Re, SD, Em, In, Pr, Qu
//   - Wizard characterData.stats:   ST, AG, CO, ME, RE, SD, QU, MEM, EM, IN
//   - Actor documents:              mixed, per-document
//
// Every consumer MUST go through these helpers instead of doing
// raw `modifiers[key]` lookups or hand-rolled alias tables, so a
// change to one spelling cannot silently zero out racial bonuses
// again.
//
// ============================================================

/**
 * Canonical RMSS stat keys (uppercase), in display order.
 */
export const RMSS_STAT_KEYS = Object.freeze([
  "ST", "AG", "CO", "ME", "RE", "SD", "QU", "EM", "IN", "PR"
]);

const ALIASES = new Map([
  ["ST", "ST"],
  ["STR", "ST"],
  ["AG", "AG"],
  ["AGI", "AG"],
  ["CO", "CO"],
  ["CON", "CO"],
  ["ME", "ME"],
  ["MEM", "ME"],
  ["SD", "SD"],
  ["QU", "QU"],
  ["EM", "EM"],
  ["IN", "IN"],
  ["PR", "PR"]
]);

/** Normalize any stat spelling ("St", "st", "MEM"…) to its canonical key. */
export function canonicalStatKey(key) {
  return ALIASES.get(String(key ?? "").toUpperCase()) ?? null;
}

/** Case-insensitive lookup of a stat-shaped object; returns [key, value]. */
export function findStatEntry(record = {}, wantedKey) {
  const wanted = canonicalStatKey(wantedKey);
  if (wanted == null) return null;

  for (const [key, value] of Object.entries(record)) {
    if (canonicalStatKey(key) === wanted) return [key, value];
  }
  return null;
}

/** Case-insensitive numeric read from a stat-shaped object. */
export function getStatModifier(record = {}, wantedKey) {
  const entry = findStatEntry(record, wantedKey);
  if (!entry) return 0;
  const raw = entry[1];

  // Accept numbers, {racial}/{bonus} wrappers, and numeric strings.
  const num =
    typeof raw === "number" ? raw :
    typeof raw === "object" && raw !== null ? (raw.racial ?? raw.bonus ?? 0) :
    Number(raw);

  return Number.isFinite(num) ? num : 0;
}

/** Build a canonical-keyed copy of a stat record (drops unknown keys). */
export function normalizeStatRecord(record = {}) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    const canon = canonicalStatKey(key);
    if (canon != null) out[canon] = value;
  }
  return out;
}

/**
 * Extract racial modifiers for all canonical stats from any race document.
 * Returns { ST: n, AG: n, ... } — missing entries are 0.
 */
export function extractRacialModifiers(race = {}) {
  const source =
    race.system?.stat_modifiers ??
    race.stat_modifiers ??
    race.system?.attributes ??
    race.system?.bonuses ??
    race.stats ??
    {};

  const out = {};
  for (const key of RMSS_STAT_KEYS) {
    out[key] = getStatModifier(source, key);
  }
  return out;
}
