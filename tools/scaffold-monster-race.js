#!/usr/bin/env node
// ============================================================
// EQRMSS — Monster race scaffolder
// Generates a schema-valid placeholder race JSON for a new
// NPC/monster race and registers its hit-die entry.
//
// Usage (from the repo root):
//   node tools/scaffold-monster-race.js --key gnoll --name Gnoll --type sentient
//   node tools/scaffold-monster-race.js --key wolf --name Wolf --type animal \
//        --hit-die 10 --max-hits 100 --soul-rounds 6 --size Medium
//
// Every stat/lore/cost field is emitted as an explicit PLACEHOLDER.
// The script prints a checklist of fields the designer must fill in.
// It never overwrites an existing race file unless --force is given.
//
// Creature types: sentient, animal, undead, insect, plant,
//                 construct, dragon, elemental
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const TYPES = ["sentient", "animal", "undead", "insect", "plant", "construct", "dragon", "elemental"];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[k] = next; i++; }
    else out[k] = true;
  }
  return out;
}

function fail(msg) {
  console.error(`scaffold-monster-race: ${msg}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const key = String(args.key || "").toLowerCase().trim();
const name = String(args.name || "").trim();
const creatureType = String(args.type || "").toLowerCase().trim();
const force = args.force === true || args.force === "true";

if (!key || !/^[a-z-]+$/.test(key)) fail("--key is required (lowercase letters and hyphens, e.g. gnoll)");
if (!name) fail("--name is required (e.g. Gnoll)");
if (!TYPES.includes(creatureType)) fail(`--type is required, one of: ${TYPES.join(", ")}`);

const hitDie = Number(args.hitDie ?? 10);
const maxBaseHits = Number(args.maxHits ?? 100);
const soulRounds = Number(args.soulRounds ?? 6);
const size = String(args.size || "Medium");

if (![8, 10].includes(hitDie)) fail("--hit-die must be 8 or 10");
if (!Number.isFinite(maxBaseHits) || maxBaseHits <= 0) fail("--max-hits must be a positive number");
if (!Number.isFinite(soulRounds) || soulRounds < 0) fail("--soul-rounds must be a non-negative number");

const racesDir = join(ROOT, "module", "data", "races");
const creaturesDir = join(ROOT, "module", "data", "creatures");
const racePath = join(racesDir, `${key}.json`);
const baseHitsPath = join(racesDir, "base-hits.json");

if (existsSync(racePath) && !force) fail(`${racePath} already exists (use --force to overwrite)`);

const race = {
  id: `eqrmss-${key}`,
  key,
  name,
  type: "race",
  creatureType,

  img: "systems/eqrmss/assets/Icons/race/placeholder.png",

  description: `PLACEHOLDER — replace with a 20+ character description of ${name.toLowerCase()}.`,

  lore: {
    homeland: ["PLACEHOLDER"],
    culture: "PLACEHOLDER",
    alignment: "PLACEHOLDER",
    languages: []
  },

  stats: { Ag: 0, Co: 0, Me: 0, Re: 0, SD: 0, Em: 0, In: 0, Pr: 0, Qu: 0, St: 0 },

  racialTalents: [],

  movement: { base: 30, pace: "Average", encumbranceMultiplier: 1.0 },

  size,

  height: { male: "PLACEHOLDER", female: "PLACEHOLDER" },
  weight: { male: "PLACEHOLDER", female: "PLACEHOLDER" },

  lifespan: { average: "PLACEHOLDER" },

  skillBonuses: { combat: {}, physical: {}, subterfuge: {}, magical: {}, lore: {}, social: {} },

  skillCosts: { combat: "C", physical: "C", subterfuge: "C", magical: "C", lore: "C", social: "C" },

  favoredProfessions: [],
  restrictedProfessions: [],

  startingLanguages: [],
  startingEquipment: [],

  _scaffold: {
    placeholder: true,
    generatedBy: "tools/scaffold-monster-race.js",
    note: "All stats, lore, talents and costs are neutral placeholders. Fill them in before using this race.",
    fieldsToReview: [
      "description", "img", "lore", "stats", "racialTalents", "movement",
      "size", "height", "weight", "lifespan", "skillBonuses", "skillCosts",
      "favoredProfessions", "restrictedProfessions", "startingLanguages",
      "startingEquipment"
    ]
  }
};

mkdirSync(racesDir, { recursive: true });
writeFileSync(racePath, JSON.stringify(race, null, 4) + "\n");
console.log(`wrote ${racePath}`);

// --- base-hits.json: targeted text insertion to preserve the file's single-line format ---
if (!existsSync(baseHitsPath)) fail(`base-hits.json not found at ${baseHitsPath}`);
const raw = readFileSync(baseHitsPath, "utf8");
let data;
try { data = JSON.parse(raw); }
catch { fail("base-hits.json is not valid JSON"); }

if (data.races[key] && !force) {
  console.log(`base-hits.json already has "${key}" — leaving it (use --force to overwrite)`);
} else {
  const entry = `"${key}":{"hitDie":${hitDie},"maxBaseHits":${maxBaseHits},"roundsToSoulDeparture":${soulRounds},"placeholder":true}`;
  const marker = `"races":{`;
  const at = raw.indexOf(marker);
  if (at === -1) fail('could not find "races":{ in base-hits.json');
  const insertAt = at + marker.length;
  // If an entry already exists and --force was given, remove it first.
  let updated = raw;
  if (data.races[key]) {
    updated = updated.replace(new RegExp(`"${key}":\\{[^}]*\\},?`), "");
  }
  updated = updated.slice(0, insertAt) + entry + "," + updated.slice(insertAt);
  JSON.parse(updated); // sanity: still valid JSON
  writeFileSync(baseHitsPath, updated);
  console.log(`registered "${key}" in base-hits.json (hitDie d${hitDie}, max ${maxBaseHits}, soul ${soulRounds} — placeholders)`);
}

// --- creatures/types.json vocabulary (created once, never overwritten) ---
const typesPath = join(creaturesDir, "types.json");
if (!existsSync(typesPath)) {
  const descs = {
    sentient: "Self-aware peoples (including giants, orcs, kerran). Uses classes.",
    animal: "Natural beasts. Attacks via natural-weapon packages.",
    undead: "Animated dead. Attacks via natural-weapon packages.",
    insect: "Giant insects and arachnids. Attacks via natural-weapon packages.",
    plant: "Animate flora. Attacks via natural-weapon packages.",
    construct: "Built beings (golems, clockworks). Attacks via natural-weapon packages.",
    dragon: "Dragons, drakes, wurms. Attacks via natural-weapon packages.",
    elemental: "Living elements. Attacks via natural-weapon packages."
  };
  const types = {};
  for (const t of TYPES) {
    types[t] = {
      name: t[0].toUpperCase() + t.slice(1),
      sentient: t === "sentient",
      description: descs[t]
    };
  }
  mkdirSync(creaturesDir, { recursive: true });
  writeFileSync(typesPath, JSON.stringify({
    _note: "Creature-type vocabulary for the NPC system. Race files declare creatureType; the NPC wizard uses the sentient flag to choose class vs attack-package.",
    types
  }, null, 4) + "\n");
  console.log(`wrote ${typesPath}`);
}

console.log(`
Next steps for "${key}":
  1. Add art at systems/eqrmss/assets/Icons/race/${key}.png and update the img field.
  2. Fill in description, lore, stats, racialTalents, movement, size, height, weight, lifespan.
  3. Set skillBonuses / skillCosts and favored/restricted professions${creatureType === "sentient" ? "" : " (non-sentients normally leave professions empty)"}.
  4. Confirm hitDie / maxBaseHits / roundsToSoulDeparture in base-hits.json${creatureType === "undead" ? " — undead soul departure needs a design ruling" : ""}.
  5. Delete the _scaffold block once the race is finalized.
`);
