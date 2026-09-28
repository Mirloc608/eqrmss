/**
 * RMSS Potential Stat Table — Table 15.1.1 (Character Law & Campaign Law)
 *
 * Canonical implementation. Values are user-supplied (2026-09-28) from the
 * printed Table 15.1.1 and are authoritative; the JSON twin at
 * module/data/stats/potential-stat-table.json is generated from this file
 * (see exportTableJson below) so the two cannot diverge.
 *
 * This module is the SINGLE source of truth for potential stat determination.
 * Do not reimplement with temp+dice anywhere — import from here.
 *
 * Book rule (§15.1.1): roll d100, cross-index the row against the column for
 * the stat's TEMPORARY value. A "—" cell means the potential cannot exceed
 * the temporary stat, i.e. potential = temporary.
 *
 * Transcription corrections applied to the user's 2026-09-28 copy
 * (column progressions confirm these; user to verify):
 *  - "8S"  → 85  (row 58-59, col 75-84)
 *  - "9S"  → 95  (row 90, cols 85-89 and 90-94; row 91, col 85-89)
 *  - "41-45-" → "41-45"
 */

// Columns keyed by the temporary stat value.
const COLUMNS = [
  { min: 1,   max: 24  }, // "under 25"
  { min: 25,  max: 39  },
  { min: 40,  max: 59  },
  { min: 60,  max: 74  },
  { min: 75,  max: 84  },
  { min: 85,  max: 89  },
  { min: 90,  max: 94  },
  { min: 95,  max: 97  },
  { min: 98,  max: 99  },
  { min: 100, max: 100 },
];

// null = "—" in the book (potential = temporary stat).
const ROWS = [
  { min: 1,   max: 10,  cols: [25, null, null, null, null, null, null, null, null, null] },
  { min: 11,  max: 20,  cols: [30, null, null, null, null, null, null, null, null, null] },
  { min: 21,  max: 30,  cols: [35, 39,   null, null, null, null, null, null, null, null] },
  { min: 31,  max: 35,  cols: [38, 42,   59,   null, null, null, null, null, null, null] },
  { min: 36,  max: 40,  cols: [40, 45,   62,   null, null, null, null, null, null, null] },
  { min: 41,  max: 45,  cols: [42, 47,   64,   null, null, null, null, null, null, null] },
  { min: 46,  max: 49,  cols: [44, 49,   66,   null, null, null, null, null, null, null] },
  { min: 50,  max: 51,  cols: [46, 51,   68,   null, null, null, null, null, null, null] },
  { min: 52,  max: 53,  cols: [48, 53,   70,   null, null, null, null, null, null, null] },
  { min: 54,  max: 55,  cols: [50, 55,   71,   null, null, null, null, null, null, null] },
  { min: 56,  max: 57,  cols: [52, 57,   72,   74,   null, null, null, null, null, null] },
  { min: 58,  max: 59,  cols: [54, 59,   73,   75,   85,   null, null, null, null, null] },
  { min: 60,  max: 61,  cols: [56, 61,   74,   76,   86,   null, null, null, null, null] },
  { min: 62,  max: 63,  cols: [58, 63,   75,   77,   87,   null, null, null, null, null] },
  { min: 64,  max: 65,  cols: [60, 65,   76,   78,   88,   null, null, null, null, null] },
  { min: 66,  max: 67,  cols: [62, 67,   77,   79,   88,   89,   null, null, null, null] },
  { min: 68,  max: 69,  cols: [64, 69,   78,   80,   89,   89,   null, null, null, null] },
  { min: 70,  max: 71,  cols: [66, 71,   79,   81,   89,   90,   null, null, null, null] },
  { min: 72,  max: 73,  cols: [68, 73,   80,   82,   90,   90,   null, null, null, null] },
  { min: 74,  max: 75,  cols: [70, 75,   81,   83,   90,   91,   null, null, null, null] },
  { min: 76,  max: 77,  cols: [72, 77,   82,   84,   91,   91,   null, null, null, null] },
  { min: 78,  max: 79,  cols: [74, 79,   83,   85,   91,   92,   null, null, null, null] },
  { min: 80,  max: 81,  cols: [76, 81,   84,   86,   92,   92,   null, null, null, null] },
  { min: 82,  max: 83,  cols: [78, 83,   85,   87,   92,   93,   null, null, null, null] },
  { min: 84,  max: 85,  cols: [80, 85,   86,   88,   93,   93,   94,   null, null, null] },
  { min: 86,  max: 87,  cols: [82, 86,   87,   89,   93,   94,   94,   null, null, null] },
  { min: 88,  max: 89,  cols: [84, 87,   88,   90,   94,   94,   95,   null, null, null] },
  { min: 90,  max: 90,  cols: [86, 88,   89,   91,   94,   95,   95,   97,   null, null] },
  { min: 91,  max: 91,  cols: [88, 89,   90,   92,   95,   95,   96,   97,   null, null] },
  { min: 92,  max: 92,  cols: [90, 90,   91,   93,   95,   96,   96,   97,   null, null] },
  { min: 93,  max: 93,  cols: [91, 91,   92,   94,   96,   96,   97,   98,   null, null] },
  { min: 94,  max: 94,  cols: [92, 92,   93,   95,   96,   97,   97,   98,   null, null] },
  { min: 95,  max: 95,  cols: [93, 93,   94,   96,   97,   97,   98,   98,   99,   null] },
  { min: 96,  max: 96,  cols: [94, 94,   95,   97,   97,   98,   98,   99,   99,   null] },
  { min: 97,  max: 97,  cols: [95, 95,   96,   97,   98,   98,   99,   99,   99,   null] },
  { min: 98,  max: 98,  cols: [96, 96,   97,   98,   98,   99,   99,   99,   100,  null] },
  { min: 99,  max: 99,  cols: [97, 97,   98,   98,   99,   99,   100,  100,  100,  null] },
  { min: 100, max: 100, cols: [98, 98,   99,   99,   99,   100,  100,  100,  100,  101 ] },
];

/**
 * Potential stat per Table 15.1.1.
 * @param {number} tempStat - the temporary (initial) stat value.
 * @param {number} roll - a d100 roll (1-100).
 * @returns the potential stat; equals tempStat when the table shows "—".
 */
export function rmssPotentialStat(tempStat, roll) {
  const t = Math.floor(Number(tempStat) || 0);
  const r = Math.min(100, Math.max(1, Math.floor(Number(roll) || 1)));

  let col = 0;
  for (let i = 0; i < COLUMNS.length; i++) {
    if (t >= COLUMNS[i].min && t <= COLUMNS[i].max) { col = i; break; }
  }
  if (t > 100) col = COLUMNS.length - 1;

  const row = ROWS.find(rw => r >= rw.min && r <= rw.max) ?? ROWS[ROWS.length - 1];
  const cell = row.cols[col];
  // "—": potential cannot exceed the temporary stat.
  return cell === null ? t : Math.max(t, cell);
}

/** Emits the JSON twin of this table (null = "—"). Used to generate the data file. */
export function exportTableJson() {
  return {
    _source: "Character Law & Campaign Law, Table 15.1.1 (Potential Stat Table). Values supplied by the user 2026-09-28; authoritative over any prior transcription. Generated from rmss-potential-stat.js — do not hand-edit.",
    _note: "Columns are keyed by the temporary stat value. null = '—' in the book: potential equals the temporary stat.",
    columns: ["under 25", "25-39", "40-59", "60-74", "75-84", "85-89", "90-94", "95-97", "98-99", "100"],
    rows: ROWS.map(r => ({ min: r.min, max: r.max, cols: r.cols })),
  };
}
