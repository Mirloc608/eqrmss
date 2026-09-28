/**
 * RMSS Rank Bonus Table — Table 15.2.2 (Character Law & Campaign Law)
 *
 * Canonical implementation. Values are user-supplied (2026-09-28) from the
 * printed Table 15.2.2 and are authoritative; the JSON twin at
 * module/data/skills/rank-bonus-table.json is the data source of record.
 *
 * This module is the SINGLE source of truth for skill rank bonuses.
 * Do not reimplement with `ranks * 5` anywhere — import from here.
 *
 * Book rule: rank 0 → -25; ranks 1-10 → +5/rank; ranks 11-20 → +2/rank;
 * ranks 21-30 → +1/rank; each rank over 30 → +0.5 (i.e. +1 per 2 ranks).
 */

/**
 * Rank bonus for a skill with the given number of ranks.
 * Fractional ranks are floored (ranks are whole numbers in the book).
 * Negative ranks are treated as 0 (untrained → -25).
 */
export function rmssRankBonus(ranks) {
  const r = Math.max(0, Math.floor(Number(ranks) || 0));
  if (r <= 10) return r === 0 ? -25 : r * 5;
  if (r <= 20) return 50 + (r - 10) * 2;
  if (r <= 30) return 70 + (r - 20);
  return 80 + (r - 30) * 0.5;
}
