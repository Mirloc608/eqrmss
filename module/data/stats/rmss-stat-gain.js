/**
 * RMSS Stat Gain Table — Table 15.1.2 (Character Law §5.3 step A).
 *
 * Canonical data for level-up stat gain rolls. Values transcribed from
 * the GM Screen reference rows (user-supplied table image, 2026-10-16;
 * the book's worked example is a known typo — the TABLE values govern).
 *
 * Lookup: roll d100; find the roll band row; the column is the
 * difference (potential − temporary): 1, 2, 3, 4–5, 6–7, 8–9, 10–11,
 * 12–14, 15+. The cell is the temporary-stat gain. A temporary stat
 * never exceeds its potential.
 *
 * Rolls of 01–04 are "*" in the book (overstress) for every column.
 * Overstress handling lives with the callers — statGainFor returns
 * gain 0 with overstressed: true. Ruling 2026-10-20 (per the user's
 * table image): the temporary value decreases by twice the roll;
 * implemented in module/progression/stat-gain.js (PC level-up) and
 * module/apps/npc-build-engine.js (NPC build sim).
 */

// Difference columns: [minDiff, maxDiff] per column index.
const DIFF_COLUMNS = [
  [1, 1], [2, 2], [3, 3], [4, 5], [6, 7],
  [8, 9], [10, 11], [12, 14], [15, Infinity]
];

// Gain rows: [maxRoll, gains per column]. Roll bands are 5 wide
// (05–10, 11–15, …, 96–100); 01–04 is the overstress row.
const GAIN_ROWS = [
  [10,  [0, 0, 0, 0, 0, 0, 1, 1, 1]],
  [15,  [0, 0, 0, 0, 0, 1, 1, 2, 2]],
  [20,  [0, 0, 0, 0, 1, 1, 2, 3, 3]],
  [25,  [0, 0, 0, 1, 1, 2, 2, 4, 4]],
  [30,  [0, 0, 1, 1, 2, 2, 3, 5, 5]],
  [35,  [0, 1, 1, 1, 2, 2, 3, 5, 6]],
  [40,  [0, 1, 1, 1, 2, 3, 4, 6, 7]],
  [45,  [0, 1, 1, 2, 3, 3, 4, 6, 8]],
  [50,  [0, 1, 1, 2, 3, 3, 5, 7, 9]],
  [55,  [1, 1, 2, 2, 3, 4, 5, 7, 10]],
  [60,  [1, 1, 2, 2, 4, 4, 6, 8, 11]],
  [65,  [1, 1, 2, 3, 4, 4, 6, 8, 11]],
  [70,  [1, 2, 2, 3, 4, 5, 7, 9, 12]],
  [75,  [1, 2, 2, 3, 5, 5, 7, 9, 12]],
  [80,  [1, 2, 3, 3, 5, 6, 8, 10, 13]],
  [85,  [1, 2, 3, 4, 5, 6, 8, 10, 13]],
  [90,  [1, 2, 3, 4, 6, 7, 9, 11, 14]],
  [95,  [1, 2, 3, 4, 6, 7, 9, 11, 14]],
  [100, [1, 2, 3, 4, 6, 8, 10, 12, 15]]
];

/**
 * Stat gain for one roll.
 * @param {number} roll  d100 result (1–100).
 * @param {number} diff  potential − temporary (<= 0 means no roll needed).
 * @returns {{gain: number, overstressed: boolean}}
 */
export function statGainFor(roll, diff) {
  const r = Math.min(100, Math.max(1, Math.floor(Number(roll) || 1)));
  const d = Math.floor(Number(diff) || 0);
  if (d <= 0) return { gain: 0, overstressed: false };
  if (r <= 4) return { gain: 0, overstressed: true };
  const col = DIFF_COLUMNS.findIndex(([lo, hi]) => d >= lo && d <= hi);
  const row = GAIN_ROWS.find(([maxRoll]) => r <= maxRoll) ?? GAIN_ROWS[GAIN_ROWS.length - 1];
  return { gain: row[1][col] ?? 0, overstressed: false };
}
