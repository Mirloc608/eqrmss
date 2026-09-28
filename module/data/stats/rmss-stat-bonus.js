/**
 * RMSS Stat Bonus Table — Table 15.1.3 (Character Law & Campaign Law)
 *
 * Canonical implementation. Values are user-supplied (2026-09-28) from the
 * printed Table 15.1.3 and are authoritative; the JSON twin at
 * module/data/stats/stat-bonus-table.json is the data source of record.
 *
 * This module is the SINGLE source of truth for stat-derived numbers.
 * Do not reimplement these bands anywhere else — import from here.
 *
 * Book rules applied:
 *  - §2.4: stat bonus read from this table for the stat's CURRENT value.
 *  - §2.2: Development Points = sum of the DP column over the five
 *    development stats (Co, Ag, SD, Me, Re). No class modifier.
 *  - §15.1.3: Power Points column, by realm association
 *    (Empathy→Essence, Intuition→Channeling, Presence→Mentalism).
 */

// Bands ordered high → low. `max: null` = open-ended top band (102+).
const BANDS = [
  { min: 102, max: null, d100:  35, d20:  7, dp: 11, pp: 4 },
  { min: 101, max: 101,  d100:  30, d20:  6, dp: 10, pp: 3 },
  { min: 100, max: 100,  d100:  25, d20:  5, dp: 10, pp: 3 },
  { min:  98, max:  99,  d100:  20, d20:  4, dp:  9, pp: 2 },
  { min:  95, max:  97,  d100:  15, d20:  3, dp:  9, pp: 2 },
  { min:  90, max:  94,  d100:  10, d20:  2, dp:  8, pp: 1 },
  { min:  85, max:  89,  d100:   5, d20:  1, dp:  8, pp: 1 },
  { min:  75, max:  84,  d100:   5, d20:  1, dp:  7, pp: 1 },
  { min:  60, max:  74,  d100:   0, d20:  0, dp:  6, pp: 0 },
  { min:  40, max:  59,  d100:   0, d20:  0, dp:  5, pp: 0 },
  { min:  25, max:  39,  d100:   0, d20:  0, dp:  4, pp: 0 },
  { min:  15, max:  24,  d100:  -5, d20: -1, dp:  3, pp: 0 },
  { min:  10, max:  14,  d100:  -5, d20: -1, dp:  2, pp: 0 },
  { min:   5, max:   9,  d100: -10, d20: -2, dp:  2, pp: 0 },
  { min:   3, max:   4,  d100: -15, d20: -3, dp:  1, pp: 0 },
  { min:   2, max:   2,  d100: -20, d20: -4, dp:  1, pp: 0 },
  { min:   1, max:   1,  d100: -25, d20: -4, dp:  1, pp: 0 },
];

function bandFor(value) {
  const v = Math.floor(Number(value));
  if (!Number.isFinite(v)) return BANDS[BANDS.length - 1];
  for (const b of BANDS) {
    if (v >= b.min && (b.max === null || v <= b.max)) return b;
  }
  // Below 1: clamp to the bottom band (book minimum stat is 1).
  return BANDS[BANDS.length - 1];
}

/** Stat bonus on d100 rolls — the classic RMSS stat bonus. */
export function rmssStatBonus(value) {
  return bandFor(value).d100;
}

/** Stat bonus on d20 rolls. */
export function rmssStatD20Bonus(value) {
  return bandFor(value).d20;
}

/** Development Points granted by a single development stat. */
export function rmssStatDP(value) {
  return bandFor(value).dp;
}

/** Power Points granted by a single stat (realm stat for the caster's realm). */
export function rmssStatPP(value) {
  return bandFor(value).pp;
}

/**
 * Total Development Points per §2.2: sum of the DP column over the five
 * development stats (Constitution, Agility, Self-Discipline, Memory,
 * Reasoning). `devStats` is an object keyed by stat abbreviation —
 * e.g. { Co: 90, Ag: 75, SD: 60, Me: 80, Re: 70 } — or an array of
 * five values. No class modifier exists in the book.
 */
export function rmssDevelopmentPoints(devStats) {
  const vals = Array.isArray(devStats) ? devStats : [devStats.Co, devStats.Ag, devStats.SD, devStats.Me, devStats.Re];
  return vals.reduce((sum, v) => sum + rmssStatDP(v ?? 0), 0);
}
