// One-shot: consolidate per-song files into 5-level band files.
// Usage: node consolidate-songs.js /path/to/eqrmss
// Then:  git rm <listed files>   (command printed at the end)
const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2] || ".";
const DIR = path.join(ROOT, "module/data/songs/bard");
const files = fs.readdirSync(DIR).filter(f => f.endsWith(".json") && f !== "index.json" && !f.startsWith("songs_"));

const bands = new Map();
for (const f of files) {
  const song = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
  const lv = song.level_required;
  if (typeof lv !== "number" || lv < 1) throw new Error(`bad level in ${f}`);
  const b = Math.floor((lv - 1) / 5);
  if (!bands.has(b)) bands.set(b, []);
  bands.get(b).push({ file: f, song });
}

const pad = n => String(n).padStart(2, "0");
const bandFiles = [];
let total = 0;
for (let b = 0; b <= 24; b++) {
  const list = bands.get(b) || [];
  list.sort((a, c) =>
    a.song.level_required - c.song.level_required ||
    String(a.song.name).localeCompare(String(c.song.name)) ||
    String(a.song.id).localeCompare(String(c.song.id)));
  const lo = b * 5 + 1, hi = b * 5 + 5;
  const fname = `songs_${pad(lo)}-${pad(hi)}.json`;
  fs.writeFileSync(path.join(DIR, fname), JSON.stringify(list.map(e => e.song), null, 2) + "\n");
  bandFiles.push(fname);
  total += list.length;
}

// verify id sets match before rewriting index
const bandIds = new Set();
for (const bf of bandFiles)
  for (const s of JSON.parse(fs.readFileSync(path.join(DIR, bf), "utf8"))) bandIds.add(s.id);
const origIds = new Set(files.map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")).id));
const missing = [...origIds].filter(id => !bandIds.has(id));
if (missing.length || bandIds.size !== origIds.size) throw new Error(`MISMATCH: missing=${missing.length}`);

fs.writeFileSync(path.join(DIR, "index.json"), JSON.stringify({ bands: bandFiles }, null, 2) + "\n");
console.log(`OK: ${total} songs -> ${bandFiles.length} band files, zero loss`);
console.log(`\nNow delete the originals:\ncd ${DIR} && ls *.json | grep -v "^songs_" | grep -v "^index.json" | xargs git rm -q`);
