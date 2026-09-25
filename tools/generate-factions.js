// tools/generate-factions.js
// Utility to normalize packs/world/factions.db for EQRMSS.
// - Keeps existing JSON faction entries as-is.
// - Converts trailing plain-text faction names into JSON entries
//   using a standard template (Citizens of Freeport style).
// - Skips obvious race-only / removed markers.
//
// Run from the system root with:  node tools/generate-factions.js

import fs from "fs";
import path from "path";

const factionsPath = path.join("packs", "world", "factions.db");

const raw = fs.readFileSync(factionsPath, "utf8");
const lines = raw.split(/\r?\n/);

const jsonLines = [];
const tailLines = [];

for (const line of lines) {
  if (!line.trim()) continue;
  if (line.trim().startsWith("{\"_id\"")) jsonLines.push(line.trim());
  else tailLines.push(line.trim());
}

// Helper: convert display name to system.id (camelCase, strip punctuation)
function makeId(name) {
  // strip numeric parens, e.g. "Citizens of Takish-Hiz (1085)" -> "Citizens of Takish-Hiz"
  let base = name.replace(/\([^)]*\d+[^)]*\)/g, "");

  base = base
    .replace(/[`'’]/g, "")         // drop apostrophes/backticks
    .replace(/[^A-Za-z0-9 ]+/g, " ") // non-alnum -> space
    .trim();

  if (!base) return "";

  const parts = base.split(/\s+/);
  return parts
    .map((p, i) =>
      i === 0
        ? p.charAt(0).toLowerCase() + p.slice(1)
        : p.charAt(0).toUpperCase() + p.slice(1)
    )
    .join("");
}

// Obvious lines to skip (race-only, removed markers, etc.)
const skipExact = new Set([
  "Human",
  "HalfElf",
  "Half Elf",
  "Lizard Man",
  "Lizardman",
  "Goblin (removed)",
  "Goblin",
  "Kobold",
  "Kobold ",
]);

function shouldSkip(name) {
  if (!name) return true;
  if (skipExact.has(name.trim())) return true;
  if (/\(removed\)/i.test(name)) return true;
  // single-word generic creature types are likely not real EQ factions
  const base = name.replace(/\([^)]*\)/g, "").trim();
  const wordCount = base.split(/\s+/).length;
  if (wordCount === 1 && /^[A-Za-z]+$/.test(base)) return true;
  return false;
}

// Determine the highest existing numeric suffix in _id
let maxNum = 0;
for (const l of jsonLines) {
  const m = l.match(/"eqwf(\d{9,})"/);
  if (!m) continue;
  const n = Number(m[1]);
  if (!Number.isNaN(n) && n > maxNum) maxNum = n;
}

// Base templates from your existing data
const baseRaceMods = {
  barbarian: -1000,
  darkElf: -1000,
  drakkin: -1000,
  dwarf: -1000,
  erudite: -1000,
  froglok: -1000,
  gnome: -1000,
  halfElf: -1000,
  halfling: -1000,
  highElf: -1000,
  human: -1000,
  iksar: -1000,
  ogre: -1000,
  troll: -1000,
  vahShir: -1000,
  woodElf: -1000
};

const baseClassMods = {
  bard: 0,
  beastlord: 0,
  berserker: 0,
  cleric: 0,
  druid: -500,
  enchanter: 0,
  magician: 0,
  monk: 0,
  necromancer: 0,
  paladin: 0,
  ranger: 0,
  rogue: 0,
  shadowknight: 0,
  shaman: 0,
  warrior: 0,
  wizard: 0
};

const newLines = [];

for (const rawName of tailLines) {
  const name = rawName.trim();
  if (!name) continue;
  if (shouldSkip(name)) continue;

  const sysId = makeId(name);
  if (!sysId) continue;

  maxNum += 1;
  const idNum = String(maxNum).padStart(9, "0");

  const entry = {
    _id: `eqwf${idNum}`,
    name,
    type: "faction",
    img: "icons/skills/social/handshake-friends.webp",
    system: {
      id: sysId,
      min: -2000,
      max: 2000,
      raceModifiers: baseRaceMods,
      classModifiers: baseClassMods,
      flavor: ""
    }
  };

  newLines.push(JSON.stringify(entry));
}

const out = [...jsonLines, ...newLines].join("\r\n") + "\r\n";
fs.writeFileSync(factionsPath, out, "utf8");

console.log(`EQRMSS | Factions normalized: kept ${jsonLines.length}, added ${newLines.length}.`);
