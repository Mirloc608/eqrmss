// ============================================================
// EQRMSS — Development Point engine
// RMSS Character Law §16.4 (adolescence) and §10.5 (apprenticeship).
// Pure logic: no Foundry dependencies, testable with node.
// ============================================================

/** The six RMSS weapon development categories (§3.5). */
export const WEAPON_CATEGORIES = [
  "oneHandedEdged",
  "oneHandedCrushing",
  "twoHanded",
  "bows",
  "thrown",
  "poleArms"
];

export const WEAPON_CATEGORY_NAMES = {
  oneHandedEdged: "One-Handed Edged",
  oneHandedCrushing: "One-Handed Crushing",
  twoHanded: "Two-Handed",
  bows: "Bows",
  thrown: "Thrown",
  poleArms: "Pole Arms"
};

/** Display names for the Table 15.2.1 development areas. */
export const SKILL_DISPLAY_NAMES = {
  // General
  climbing: "Climbing",
  disarmTraps: "Disarm Traps",
  perception: "Perception",
  pickLocks: "Pick Locks",
  riding: "Riding",
  stalkHide: "Stalk & Hide",
  swimming: "Swimming",
  // Magical (spellLists excluded in the wizard by user ruling 2026-09-29)
  channeling: "Channeling",
  directedSpells: "Directed Spells",
  runes: "Runes",
  stavesWands: "Staves & Wands",
  // Maneuvering in armor (EQ armor categories)
  cloth: "Maneuvering in Cloth",
  leather: "Maneuvering in Leather",
  chain: "Maneuvering in Chain",
  plate: "Maneuvering in Plate",
  // Special
  adrenalDefense: "Adrenal Defense",
  adrenalMoves: "Adrenal Moves",
  ambush: "Ambush",
  bodyDevelopment: "Body Development",
  linguistics: "Linguistics",
  martialArts: "Martial Arts"
};

export function displayName(key) {
  return SKILL_DISPLAY_NAMES[key] ?? WEAPON_CATEGORY_NAMES[key] ?? key;
}

// ------------------------------------------------------------
// Cost parsing. "a/b" = a DP for the first rank step in a pass,
// b DP for the second; "a/*" = a DP per rank, unlimited ranks.
// A bare number behaves as a/a.
// ------------------------------------------------------------
export function parseCost(costStr) {
  const s = String(costStr ?? "").trim();
  if (s.endsWith("/*")) {
    return { first: Number(s.slice(0, -2)), second: null, unlimited: true, raw: s };
  }
  if (s.includes("/")) {
    const [a, b] = s.split("/");
    return { first: Number(a), second: Number(b), unlimited: false, raw: s };
  }
  const n = Number(s);
  return { first: n, second: n, unlimited: false, raw: s };
}

/** DP cost of the NEXT rank, given ranks already bought this pass. */
export function nextRankCost(cost, ranksBoughtThisPass) {
  if (cost.unlimited) return cost.first;
  return ranksBoughtThisPass === 0 ? cost.first : cost.second;
}

/** Max ranks purchasable in one pass (Infinity for "a/*" costs). */
export function maxRanksPerPass(cost) {
  return cost.unlimited ? Infinity : 2;
}

// ------------------------------------------------------------
// Pass state. Each pass (adolescence, apprenticeship) gets the
// FULL DP pool; pools never combine. Cost progression resets
// each pass while total ranks accumulate across passes.
// ------------------------------------------------------------
export function createPassState(dpPool) {
  return { dpPool, spent: 0, ranks: {}, bodyDevRolls: [] };
}

export function buyRank(pass, skillKey, cost) {
  const bought = pass.ranks[skillKey] ?? 0;
  if (bought >= maxRanksPerPass(cost)) return { ok: false, reason: "rank-cap" };
  const c = nextRankCost(cost, bought);
  if (pass.spent + c > pass.dpPool) return { ok: false, reason: "insufficient-dp" };
  pass.ranks[skillKey] = bought + 1;
  pass.spent += c;
  return { ok: true, cost: c };
}

export function refundRank(pass, skillKey, cost) {
  const bought = pass.ranks[skillKey] ?? 0;
  if (bought <= 0) return { ok: false, reason: "no-ranks" };
  // LIFO: refund what the last rank step cost.
  const c = nextRankCost(cost, bought - 1);
  const left = bought - 1;
  if (left === 0) delete pass.ranks[skillKey];
  else pass.ranks[skillKey] = left;
  pass.spent -= c;
  return { ok: true, cost: c };
}

export function remainingDp(pass) {
  return pass.dpPool - pass.spent;
}

export function totalRanks(adolescencePass, apprenticeshipPass, skillKey) {
  return (adolescencePass?.ranks?.[skillKey] ?? 0) + (apprenticeshipPass?.ranks?.[skillKey] ?? 0);
}

// ------------------------------------------------------------
// Weapon-category assignment (§3.5). The player assigns the six
// cost figures once during adolescence; every figure must be
// used exactly as often as supplied. Permanent thereafter.
// ------------------------------------------------------------
export function validateWeaponAssignment(figures, assignment) {
  if (!assignment) return { ok: false, reason: "unassigned" };
  for (const cat of WEAPON_CATEGORIES) {
    if (!assignment[cat]) return { ok: false, reason: "incomplete", category: cat };
  }
  const count = arr => {
    const m = {};
    for (const f of arr) m[f] = (m[f] ?? 0) + 1;
    return m;
  };
  const need = count(figures);
  const got = count(WEAPON_CATEGORIES.map(c => assignment[c]));
  for (const f of new Set([...Object.keys(need), ...Object.keys(got)])) {
    if ((need[f] ?? 0) !== (got[f] ?? 0)) return { ok: false, reason: "mismatch", figure: f };
  }
  return { ok: true };
}

// ------------------------------------------------------------
// Body Development: one hit-die roll per rank, added to BHPT.
// ------------------------------------------------------------
export function rollHitDie(sides, rng = Math.random) {
  return Math.floor(rng() * sides) + 1;
}

// ------------------------------------------------------------
// Skill list for a class. Returns the 21 non-weapon development
// areas (spellLists excluded by user ruling); weapons are driven
// by the assignment and rendered as their own section.
// ------------------------------------------------------------
const SKILL_GROUPS = [
  ["generalSkills", "General"],
  ["magicalSkills", "Magical"],
  ["maneuveringInArmor", "Maneuvering"],
  ["specialSkills", "Special"]
];

export function buildSkillList(classCosts) {
  const list = [];
  for (const [table, group] of SKILL_GROUPS) {
    const skills = classCosts?.[table] ?? {};
    for (const [key, cost] of Object.entries(skills)) {
      if (key === "spellLists") continue;
      list.push({ key, name: displayName(key), group, cost: String(cost) });
    }
  }
  return list;
}
