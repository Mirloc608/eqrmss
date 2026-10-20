// ============================================================
// EQRMSS — NPC Build Engine (2026-10-20 rework)
//
// Level-by-level DP simulation that builds an NPC with the SAME
// rules as a PC (user rulings, 2026-10-20):
//   - Step 1 race gives the level-1 template: temps start at the
//     quick-build average (50), racial modifiers ride separately,
//     potentials rolled per stat (Table 15.1.1, canonical roller).
//   - Each level: stat gain rolls (Table 15.1.2) for every stat
//     below potential, then a DP pool (Table 15.1.1 DP values for
//     CO/AG/SD/RE/ME temps, post-gain — same order as applyLevelUp).
//   - The role/class profile spends the pool in priority order via
//     the dp-engine pass rules (max 2 ranks per skill per level
//     unless the cost is "a/*"; first/second rank costs).
//   - Unspent DP accumulates (PC ruling) and is returned as the
//     leftover for the actor's development point pool.
//   - Body Development ranks roll the racial hit die into base
//     hits (§3.8: base = ceil(temp CO / 10) + BD rolls, capped at
//     the racial maximum). Once capped, BD buys stop and DP flows
//     to the next priority.
//   - Roles buy at role-mapped profession costs (user ruling A);
//     a PC-class build buys at its own class costs with a class
//     purchase profile (user exception).
//
// Pure logic (dice injected), no Foundry document access — the
// finalizer feeds it data and grants the results.
// ============================================================

import { rmssPotentialStat } from "../data/stats/rmss-potential-stat.js";
import { statGainFor } from "../data/stats/rmss-stat-gain.js";
import { developmentPointsForStat } from "../progression/xp-engine.js";
import { parseCost, nextRankCost, maxRanksPerPass, WEAPON_CATEGORIES } from "../development/dp-engine.js";

export const NPC_STAT_KEYS = ["ST", "AG", "SD", "CO", "ME", "RE", "IN", "PR", "QU", "EM"];
const DEV_STAT_KEYS = ["CO", "AG", "SD", "RE", "ME"];
const BASE_TEMP = 50;

// ------------------------------------------------------------
// Profiles. Each priority: { key, perLevel, maxRanks? } — the
// engine tries to buy up to perLevel ranks of that skill each
// level, in order, subject to DP and the per-pass rank cap, and
// stops at maxRanks total. "weapon" is a pseudo-key resolved by
// the caller to a weapon category (kit weapon for sentients,
// naturalWeapons for creatures). Unspent DP is expected at high
// levels (a real PC spreads across dozens of skills) — it lands
// in the actor's DP pool for the GM to spend.
// ------------------------------------------------------------

export const ROLE_PROFILES = {
  striker: {
    name: "Striker",
    costsClass: "warrior",
    priorities: [
      { key: "weapon", perLevel: 2 },
      { key: "bodyDevelopment", perLevel: 1 },
      { key: "perception", perLevel: 1, maxRanks: 50 },
      { key: "adrenalMoves", perLevel: 1, maxRanks: 30 },
      { key: "stalkHide", perLevel: 1, maxRanks: 50 },
      { key: "climbing", perLevel: 1, maxRanks: 30 },
      { key: "riding", perLevel: 1, maxRanks: 30 },
      { key: "swimming", perLevel: 1, maxRanks: 20 }
    ]
  },
  defender: {
    name: "Defender",
    costsClass: "warrior",
    priorities: [
      { key: "bodyDevelopment", perLevel: 2 },
      { key: "armor:chain", perLevel: 1, maxRanks: 100 },
      { key: "weapon", perLevel: 1 },
      { key: "perception", perLevel: 1, maxRanks: 50 },
      { key: "adrenalMoves", perLevel: 1, maxRanks: 30 },
      { key: "climbing", perLevel: 1, maxRanks: 30 }
    ]
  },
  caster: {
    name: "Caster",
    costsClass: "wizard",
    priorities: [
      { key: "directedSpells", perLevel: 2 },
      { key: "channeling", perLevel: 1, maxRanks: 100 },
      { key: "bodyDevelopment", perLevel: 1 },
      { key: "runes", perLevel: 1, maxRanks: 50 },
      { key: "perception", perLevel: 1, maxRanks: 50 },
      { key: "linguistics", perLevel: 1, maxRanks: 30 }
    ]
  },
  healer: {
    name: "Healer",
    costsClass: "cleric",
    priorities: [
      { key: "channeling", perLevel: 2, maxRanks: 150 },
      { key: "directedSpells", perLevel: 1, maxRanks: 100 },
      { key: "bodyDevelopment", perLevel: 1 },
      { key: "weapon", perLevel: 1, maxRanks: 100 },
      { key: "perception", perLevel: 1, maxRanks: 50 }
    ]
  }
};

// PC-class builds (user exception): profile shape by class, costs
// always the class's own. "hybrid" = weapon-first with casting support.
const CLASS_PROFILES = {
  warrior: "striker", berserker: "striker", monk: "striker", rogue: "striker",
  paladin: "hybrid", shadowknight: "hybrid", ranger: "hybrid",
  beastlord: "hybrid", bard: "hybrid",
  wizard: "caster", magician: "caster", enchanter: "caster", necromancer: "caster",
  cleric: "healer", druid: "healer", shaman: "healer"
};

const PROFILE_BODIES = {
  striker: ROLE_PROFILES.striker.priorities,
  defender: ROLE_PROFILES.defender.priorities,
  caster: ROLE_PROFILES.caster.priorities,
  healer: ROLE_PROFILES.healer.priorities,
  hybrid: [
    { key: "weapon", perLevel: 2 },
    { key: "bodyDevelopment", perLevel: 1 },
    { key: "channeling", perLevel: 1, maxRanks: 100 },
    { key: "directedSpells", perLevel: 1, maxRanks: 50 },
    { key: "perception", perLevel: 1, maxRanks: 50 }
  ]
};

// Extra per-class priorities appended after the profile body.
const CLASS_EXTRAS = {
  rogue: [{ key: "stalkHide", perLevel: 1 }, { key: "pickLocks", perLevel: 1 }],
  monk: [{ key: "martialArts", perLevel: 1 }, { key: "adrenalDefense", perLevel: 1 }],
  ranger: [{ key: "stalkHide", perLevel: 1 }],
  bard: [{ key: "perception", perLevel: 1 }]
};

/** Profile (priorities + costs class) for a build spec. */
export function profileFor({ buildMode, role, classId }) {
  if (buildMode === "class") {
    const shape = CLASS_PROFILES[String(classId ?? "").toLowerCase()] ?? "striker";
    return {
      costsClass: String(classId ?? "").toLowerCase(),
      priorities: [...(PROFILE_BODIES[shape] ?? []), ...(CLASS_EXTRAS[String(classId ?? "").toLowerCase()] ?? [])]
    };
  }
  const r = ROLE_PROFILES[String(role ?? "striker").toLowerCase()] ?? ROLE_PROFILES.striker;
  return { costsClass: r.costsClass, priorities: r.priorities };
}

/** True when the build casts (band spell packages instead of starter sets). */
export function buildCasts({ buildMode, role, classId }) {
  if (buildMode === "class") {
    const shape = CLASS_PROFILES[String(classId ?? "").toLowerCase()];
    return shape === "caster" || shape === "healer" || shape === "hybrid";
  }
  const r = String(role ?? "").toLowerCase();
  return r === "caster" || r === "healer";
}

/** The spell class whose band packages a casting build draws from. */
export function spellClassFor({ buildMode, role, classId }) {
  if (buildMode === "class") return String(classId ?? "").toLowerCase();
  const r = ROLE_PROFILES[String(role ?? "").toLowerCase()];
  return r ? r.costsClass : "";
}

// ------------------------------------------------------------
// Cost lookup against class-development-costs.json data.
// Returns { cost: "a/b", group } or null when the class cannot
// buy the key at all.
// ------------------------------------------------------------

function findCost(costs, key) {
  if (!costs || !key) return null;
  if (key.startsWith("weapon:")) {
    const cat = key.slice("weapon:".length);
    const idx = WEAPON_CATEGORIES.indexOf(cat);
    const cost = idx >= 0 ? costs.weaponCosts?.[idx] : null;
    return cost != null && cost !== "" ? { cost: String(cost), group: "Weapon" } : null;
  }
  if (key.startsWith("armor:")) {
    const armorKey = key.slice("armor:".length);
    const cost = costs.maneuveringInArmor?.[armorKey];
    return cost != null && cost !== "" ? { cost: String(cost), group: "Maneuvering" } : null;
  }
  for (const [table, group] of [["generalSkills", "General"], ["magicalSkills", "Magical"], ["specialSkills", "Special"], ["maneuveringInArmor", "Maneuvering"]]) {
    const cost = costs[table]?.[key];
    if (cost != null && cost !== "") return { cost: String(cost), group };
  }
  return null;
}

// ------------------------------------------------------------
// Simulation.
//   race:      { chart?: {hits,...} } (chart races keep chart hits)
//   hitDie:    racial hit die sides (base-hits.json)
//   maxBaseHits: racial base-hits cap
//   costs:     class-development-costs entry for the costs class
//   profile:   from profileFor()
//   weaponKey: resolved weapon priority key ("weapon:<cat>") or
//              null (creature without a kit weapon — weapon buys
//              are skipped; natural weapons are granted separately)
//   targetLevel, rng: () => [0,1)
// Returns { stats, skills: [{key, group, cost, ranks}],
//           baseHits, dpLeftover, log }
// ------------------------------------------------------------

export function simulateBuild({ race, hitDie = 10, maxBaseHits = 150, costs, profile, weaponKey = null, targetLevel = 1, rng = Math.random }) {
  const d100 = () => 1 + Math.floor(rng() * 100);
  const rollDie = (sides) => 1 + Math.floor(rng() * sides);
  const log = [];

  // --- Level-1 template: temps at the average, potentials rolled.
  const temps = {}, potentials = {};
  for (const key of NPC_STAT_KEYS) {
    temps[key] = BASE_TEMP;
    potentials[key] = Math.max(BASE_TEMP, rmssPotentialStat(BASE_TEMP, d100()));
  }

  // --- Hits seed (§3.8): ceil(temp CO / 10); BD rolls add on top.
  const chartHits = Number(race?.chart?.hits) || 0;
  let baseHits = chartHits > 0 ? Math.round(chartHits) : Math.ceil(temps.CO / 10);
  const hitsCapped = () => chartHits <= 0 && baseHits >= maxBaseHits;

  const ranks = {};   // skill key -> total ranks
  const boughtThisLevel = {}; // reset per level (pass rules)
  let dpPool = 0;

  const buy = (rawKey, want, maxRanks = Infinity) => {
    let key = rawKey;
    if (key === "weapon") {
      if (!weaponKey) return 0;
      key = weaponKey;
    }
    const found = findCost(costs, key);
    if (!found) return 0;
    const cost = parseCost(found.cost);
    const realKeyEarly = key.startsWith("weapon:") ? key.slice(7) : key.startsWith("armor:") ? key.slice(6) : key;
    let bought = 0;
    while (bought < want && (ranks[realKeyEarly] ?? 0) < maxRanks) {
      const thisLevel = boughtThisLevel[key] ?? 0;
      if (thisLevel >= maxRanksPerPass(cost)) break;
      if (key === "bodyDevelopment" && hitsCapped()) break;
      const c = nextRankCost(cost, thisLevel);
      if (!Number.isFinite(c) || c > dpPool) break;
      dpPool -= c;
      boughtThisLevel[key] = thisLevel + 1;
      bought++;
      // Real skill key behind pseudo-keys for the grant list.
      const realKey = key.startsWith("weapon:") ? key.slice(7) : key.startsWith("armor:") ? key.slice(6) : key;
      ranks[realKey] = (ranks[realKey] ?? 0) + 1;
      if (key === "bodyDevelopment" && chartHits <= 0) {
        baseHits = Math.min(maxBaseHits, baseHits + rollDie(hitDie));
      }
    }
    return bought;
  };

  for (let level = 1; level <= targetLevel; level++) {
    // Stat gains first (levels 2+), then DP from the new temps —
    // the applyLevelUp order.
    if (level > 1) {
      for (const key of NPC_STAT_KEYS) {
        const diff = potentials[key] - temps[key];
        if (diff <= 0) continue;
        const { gain } = statGainFor(d100(), diff);
        if (gain > 0) temps[key] = Math.min(potentials[key], temps[key] + gain);
      }
    }
    let dp = 0;
    for (const key of DEV_STAT_KEYS) dp += developmentPointsForStat(temps[key]);
    dpPool += dp;

    for (const k of Object.keys(boughtThisLevel)) delete boughtThisLevel[k];
    for (const p of profile.priorities) buy(p.key, p.perLevel, p.maxRanks ?? Infinity);
    log.push({ level, dp, poolAfter: dpPool, baseHits });
  }

  // Grant list with groups/costs resolved.
  const skills = [];
  for (const [key, r] of Object.entries(ranks)) {
    if (r <= 0) continue;
    const isWeaponCat = WEAPON_CATEGORIES.includes(key);
    const found = isWeaponCat
      ? findCost(costs, `weapon:${key}`)
      : findCost(costs, key) ?? findCost(costs, `armor:${key}`);
    skills.push({ key, group: found?.group ?? "General", cost: found?.cost ?? "", ranks: r });
  }

  const stats = {};
  for (const key of NPC_STAT_KEYS) {
    stats[key] = { temp: temps[key], potential: potentials[key] };
  }

  return { stats, skills, baseHits, dpLeftover: dpPool, log };
}
