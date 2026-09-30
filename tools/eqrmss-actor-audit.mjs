#!/usr/bin/env node
// ============================================================
// EQRMSS — Actor JSON Audit v1
//
// Validates exported actor JSON files (e.g. the 16 wizard-test
// harness characters) against the eqrmss repo data: starter kits,
// §3.8 hits, rank bonuses, background, origin, starting spells,
// and icon paths (system assets + V13 core inventory).
//
// USAGE:
//   node eqrmss-actor-audit.mjs [--repo <eqrmss-clone>] [--core-icons <file>]
//        <actor.json> [<actor.json> ...]
//
// --repo        path to an up-to-date eqrmss clone (default: ./eqrmss)
// --core-icons  path to the V13 core icons inventory, one icons/... path
//               per line (default: ./v13-core-icons.txt; if missing, core
//               icon checks are skipped with a note)
//
// Exit 0 = all actors PASS, 1 = at least one FAIL. Warnings never fail.
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(process.argv[1]);
const args = process.argv.slice(2);
let REPO = join(SCRIPT_DIR, "eqrmss");
let CORE_ICONS = join(SCRIPT_DIR, "v13-core-icons.txt");
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--repo" && args[i + 1]) { REPO = resolve(args[++i]); continue; }
  if (args[i] === "--core-icons" && args[i + 1]) { CORE_ICONS = resolve(args[++i]); continue; }
  if (args[i].startsWith("--")) continue;
  files.push(args[i]);
}
REPO = resolve(REPO); CORE_ICONS = resolve(CORE_ICONS);

// ---------- repo data ----------
const jread = (p) => JSON.parse(readFileSync(join(REPO, p), "utf8"));
const kits = jread("module/data/starter-kits.json");
const startingSpells = jread("module/data/spells/starting-spells.json");
const baseHits = jread("module/data/races/base-hits.json").races;
const { rmssRankBonus } = await import(pathToFileURL(join(REPO, "module/data/skills/rmss-rank-bonus.js")).href);
let LEGACY_ICON_REMAP = {};
try {
  ({ LEGACY_ICON_REMAP } = await import(pathToFileURL(join(REPO, "module/documents/item/legacy-icon-remap.js")).href));
} catch { /* older repo: no remap table */ }
let coreIcons = null;
if (existsSync(CORE_ICONS)) {
  coreIcons = new Set(readFileSync(CORE_ICONS, "utf8").split("\n").map(s => s.trim()).filter(Boolean));
}

const BG_FIELDS = ["home_town", "deity", "nationality", "history", "family_notes",
  "experiences", "parents", "spouse", "children", "special_abilities", "special_equipment"];

function checkIcon(p, problems, warnings, where) {
  if (!p || typeof p !== "string") return;
  if (p.startsWith("systems/eqrmss/")) {
    const disk = join(REPO, p.replace("systems/eqrmss/", ""));
    if (!existsSync(disk)) problems.push(`${where}: system icon missing: ${p}`);
  } else if (p.startsWith("icons/")) {
    if (LEGACY_ICON_REMAP[p]) {
      warnings.push(`${where}: legacy icon (runtime-remapped): ${p}`);
    } else if (coreIcons && !coreIcons.has(p)) {
      problems.push(`${where}: core icon not in V13 inventory: ${p}`);
    }
  }
}

let grandFail = false;

for (const file of files) {
  const label = file.split("/").pop();
  const problems = [], warnings = [];
  const ok = (name, cond, detail = "") => { if (!cond) problems.push(detail ? `${name}: ${detail}` : name); };
  let actor;
  try {
    actor = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`\n### ${label}: UNREADABLE (${e.message})`);
    grandFail = true;
    continue;
  }
  const sys = actor.system ?? {};
  const items = actor.items ?? [];
  const classKey = String(sys.origin?.classId ?? "").toLowerCase();
  const raceKey = String(sys.origin?.raceId ?? "").toLowerCase().replace(/^eqrmss-/, "");
  const byName = (n) => items.filter(i => i.name === n);

  // --- class / kit ---
  const kit = kits[classKey];
  ok("class-kit", !!kit, `no starter kit for classId "${classKey}"`);

  if (kit) {
    const missing = (kit.items ?? []).filter(e => byName(e.name).length < 1).map(e => e.name);
    ok("kit-contents", missing.length === 0, `missing: ${missing.join(", ")}`);

    const wEntry = (kit.items ?? []).find(e => e.weaponTemplate);
    const wItem = wEntry && byName(wEntry.name)[0];
    ok("kit-weapon-equipped", !!wItem && wItem.system?.equipped === true,
      wEntry ? `"${wEntry.name}" equipped=${wItem?.system?.equipped}` : "no weapon entry");

    const badClothing = (kit.items ?? []).filter(e => e.type === "armor").map(e => {
      const it = byName(e.name)[0];
      return (it && it.system?.at === 1 && (it.system?.maneuverPenalty ?? 0) === 0) ? null : e.name;
    }).filter(Boolean);
    ok("clothing-stats", badClothing.length === 0, badClothing.join(", "));

    ok("core-swap",
      byName("Water skin").length >= 1 && byName("Week's rations").length >= 1 &&
      byName("Bread Cakes").length === 0 && byName("Skin of Milk").length === 0,
      "want Water skin + Week's rations, no Bread Cakes / Skin of Milk");
  }

  // --- money ---
  const w = sys.wealth ?? {};
  ok("money", ["pp", "gp", "sp", "cp"].every(k =>
    Number.isInteger(w[k] ?? 0) && (w[k] ?? 0) >= 0),
    `wealth=${JSON.stringify(w)}`);

  // --- skills ---
  for (const s of items.filter(i => i.type === "skill")) {
    const r = s.system?.ranks, b = s.system?.bonus;
    ok("skill-ranks", Number.isInteger(r) && r >= 0, `"${s.name}" ranks=${r}`);
    ok("skill-bonus", b === rmssRankBonus(r), `"${s.name}" bonus=${b} want=${rmssRankBonus(r)}`);
    const f = s.flags?.eqrmss;
    if (f?.fromWizardDevelopment) {
      ok("skill-pass-flags",
        (f.adolescenceRanks ?? 0) + (f.apprenticeshipRanks ?? 0) === r,
        `"${s.name}" ado=${f.adolescenceRanks} app=${f.apprenticeshipRanks} total=${r}`);
    }
  }

  // --- development / DP ---
  const dev = sys.development ?? {};
  for (const pass of ["adolescence", "apprenticeship"]) {
    const p = dev[pass] ?? {};
    ok(`dp-${pass}`, (p.dpPool ?? 0) > 0 && (p.spent ?? 0) <= (p.dpPool ?? 0),
      `pool=${p.dpPool} spent=${p.spent}`);
  }

  // --- hits (§3.8) ---
  const rolls = [...(dev.adolescence?.bodyDevRolls ?? []), ...(dev.apprenticeship?.bodyDevRolls ?? [])];
  const expectBase = Math.ceil(Number(sys.stats?.CO?.temp ?? 0) / 10) + rolls.reduce((a, b) => a + b, 0);
  ok("hits", sys.hits?.base === expectBase,
    `base=${sys.hits?.base} want=${expectBase} (CO temp ${sys.stats?.CO?.temp}, rolls ${rolls.join("+")})`);
  const cap = baseHits[raceKey]?.maxBaseHits;
  if (cap !== undefined) ok("hits-cap", (sys.hits?.base ?? 0) <= cap, `base ${sys.hits?.base} > racial max ${cap}`);

  // --- background / origin ---
  const missingBg = BG_FIELDS.filter(f => sys.background?.[f] === undefined);
  ok("background", missingBg.length === 0, `missing fields: ${missingBg.join(", ")}`);
  const o = sys.origin ?? {};
  ok("origin",
    !!(o.classId && o.raceId && (o.cityId || o.originId || (o.originType === "city" && o.cityName))),
    JSON.stringify(o));

  // --- starting spells/songs ---
  const spells = items.filter(i => i.type === "spell" || i.type === "song");
  const wantSpells = (startingSpells[classKey] ?? []).length;
  if (spells.length !== wantSpells) {
    warnings.push(`spells: ${spells.length} on actor vs ${wantSpells} in starting-spells.json (unresolvable names are skipped by the finalizer)`);
  }

  // --- icons ---
  checkIcon(actor.img, problems, warnings, "actor img");
  for (const i of items) checkIcon(i.img, problems, warnings, `item "${i.name}"`);

  // --- report ---
  const pass = problems.length === 0;
  if (!pass) grandFail = true;
  console.log(`\n### ${label} (${actor.name ?? "unnamed"}): ${pass ? "PASS" : "FAIL"}`);
  for (const p of problems) console.log(`  ✗ ${p}`);
  for (const wr of warnings) console.log(`  ~ ${wr}`);
  if (pass && warnings.length === 0) console.log("  ✓ all checks");
}

if (!coreIcons) console.log("\n(note: V13 core-icon inventory not found — core icons/… paths not verified)");
console.log(`\n== ${grandFail ? "FAILURES PRESENT" : "ALL ACTORS PASS"} ==`);
process.exit(grandFail ? 1 : 0);
