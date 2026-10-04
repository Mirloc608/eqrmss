#!/usr/bin/env node
/**
 * EQRMSS geography isolation script
 *
 * Purpose:
 *   Split the monolithic system geography tree into four data-only Foundry
 *   module packages, one per world, without touching character-creation origin
 *   data or any live rules code.
 *
 * Source tree:
 *   module/data/geography/worlds/<world>/...
 *
 * Generated module layout (default: <repo>/modules):
 *   modules/eqrmss-geography-norrath/
 *     module.json
 *     README.md
 *     data/geography/worlds/norrath/...
 *   modules/eqrmss-geography-kuua/
 *   modules/eqrmss-geography-luclin/
 *   modules/eqrmss-geography-planes/
 *
 * Safety model:
 *   - Dry-run is the default. Nothing is written unless --apply is passed.
 *   - Default mode is copy. Move mode must be requested explicitly with
 *     --mode move --apply.
 *   - Existing destination files are skipped unless --overwrite is passed.
 *   - The script never edits eqrmss.js, initialize-subsystems.js, loaders, or
 *     module/data/origin. Those code changes are reported as follow-ups only.
 *
 * Usage:
 *   node tools/isolate-geography-modules.mjs
 *   node tools/isolate-geography-modules.mjs --apply
 *   node tools/isolate-geography-modules.mjs --apply --mode move
 *   node tools/isolate-geography-modules.mjs --worlds luclin,kuua --apply
 *   node tools/isolate-geography-modules.mjs --out modules --apply --overwrite
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALL_WORLDS = {
  norrath: { title: "Norrath", packageTitle: "EQRMSS Geography - Norrath" },
  kuua: { title: "Kuua", packageTitle: "EQRMSS Geography - Kuua" },
  luclin: { title: "Luclin", packageTitle: "EQRMSS Geography - Luclin" },
  planes: { title: "The Planes", packageTitle: "EQRMSS Geography - The Planes" }
};

const SHARED_CODE_FILES = [
  "module/data/geography/geography-loader.js",
  "module/data/geography/scene-registry.js",
  "module/data/geography/geography.test.js"
];

const STALE_OR_FOLLOWUP_CODE = [
  "eqrmss.js imports EQRMSSGeography/EQRMSSSceneRegistry and calls loadAll/registerAllScenes in ready.",
  "module/initialization/initialize-subsystems.js also lazy-loads geography and scene registry on ready.",
  "module/data/loaders/{region,faction,lore,influence,travel}-loader.js point at the old Sanctus Seru geography path and should be retired or moved with a future geography-core module.",
  "module/data/origin is character-creation origin data and must stay in the core system."
];

function parseArgs(argv) {
  const opts = {
    apply: false,
    mode: "copy",
    out: "modules",
    worlds: Object.keys(ALL_WORLDS),
    overwrite: false,
    source: null,
    report: null,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") opts.apply = true;
    else if (a === "--overwrite") opts.overwrite = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--mode") opts.mode = String(argv[++i] ?? "").toLowerCase();
    else if (a === "--out") opts.out = String(argv[++i] ?? "");
    else if (a === "--source") opts.source = String(argv[++i] ?? "");
    else if (a === "--report") opts.report = String(argv[++i] ?? "");
    else if (a === "--worlds") {
      opts.worlds = String(argv[++i] ?? "")
        .split(",")
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (a.startsWith("--mode=")) opts.mode = a.slice("--mode=".length).toLowerCase();
    else if (a.startsWith("--out=")) opts.out = a.slice("--out=".length);
    else if (a.startsWith("--source=")) opts.source = a.slice("--source=".length);
    else if (a.startsWith("--report=")) opts.report = a.slice("--report=".length);
    else if (a.startsWith("--worlds=")) {
      opts.worlds = a.slice("--worlds=".length).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`EQRMSS geography isolation script

Default is a dry-run. Add --apply to write files.

Options:
  --apply              Actually copy/move files and write module manifests.
  --mode copy|move     Default: copy. Move removes source files after transfer.
  --worlds a,b         Default: norrath,kuua,luclin,planes.
  --out <dir>          Default: modules (relative to repo root).
  --source <dir>       Repo root or geography worlds dir. Usually unnecessary.
  --overwrite          Replace destination files that already exist.
  --report <file>      Report path. Default: <out>/eqrmss-geography-isolation-report.json on --apply.
  --help               Show this help.
`);
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function findRepoRoot(explicitSource) {
  if (explicitSource) {
    const p = path.resolve(explicitSource);
    if (isDirectory(path.join(p, "module/data/geography/worlds"))) return p;
    if (path.basename(p) === "worlds" && isDirectory(p)) return path.resolve(p, "../../../..");
    if (isDirectory(path.join(p, "worlds"))) return path.resolve(p, "../..");
    throw new Error(`Could not locate module/data/geography/worlds under --source ${explicitSource}`);
  }

  const cwd = process.cwd();
  if (isDirectory(path.join(cwd, "module/data/geography/worlds"))) return cwd;

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const fromScript = path.resolve(scriptDir, "..");
  if (isDirectory(path.join(fromScript, "module/data/geography/worlds"))) return fromScript;

  throw new Error("Could not find module/data/geography/worlds. Run from the eqrmss repo root or pass --source.");
}

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.isFile()) out.push(p);
    }
  }
  return out.sort();
}

function summarizeFiles(files) {
  let bytes = 0;
  for (const f of files) {
    try { bytes += fs.statSync(f).size; } catch { /* ignore vanished file */ }
  }
  return { files: files.length, bytes };
}

function assertInside(child, parent, label) {
  const rel = path.relative(parent, child);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`${label} escapes its parent: ${child}`);
  }
}

function moduleJson(worldSlug, worldMeta, summary) {
  const id = `eqrmss-geography-${worldSlug}`;
  return {
    id,
    title: worldMeta.packageTitle,
    description: `Data-only EverQuest geography package for ${worldMeta.title}. Isolated from the EQRMSS core system for later completion; no rules runtime is wired yet.`,
    version: "0.1.0",
    authors: [
      { name: "Mirloc608", url: "https://github.com/Mirloc608" }
    ],
    compatibility: {
      minimum: "13",
      verified: "14"
    },
    relationships: {
      systems: [
        {
          id: "eqrmss",
          type: "system",
          manifest: "https://raw.githubusercontent.com/Mirloc608/eqrmss/main/system.json",
          compatibility: { minimum: "1.0.20", verified: "1.0.20" }
        }
      ]
    },
    flags: {
      eqrmssGeography: {
        world: worldSlug,
        status: "isolated-data",
        runtime: "not-wired",
        sourcePath: `module/data/geography/worlds/${worldSlug}`,
        fileCount: summary.files,
        byteCount: summary.bytes
      }
    }
  };
}

function readme(worldSlug, worldMeta, summary) {
  return `# ${worldMeta.packageTitle}

Data-only geography package isolated from the EQRMSS core system.

- World: ${worldMeta.title} (\`${worldSlug}\`)
- Source: \`module/data/geography/worlds/${worldSlug}\`
- Files: ${summary.files}
- Bytes: ${summary.bytes}
- Status: isolated data; no loader, scene registration, encounter roller, or rules runtime is wired yet.

Later completion should add one narrow consumer first, such as a GM zone browser,
an encounter roller mapped to the creature registry, or hazard/travel resolution
through the existing RMSS engines.
`;
}

function writeText(file, text, overwrite, counters) {
  if (fs.existsSync(file) && !overwrite) {
    counters.skipped++;
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  counters.written++;
}

function copyOrMoveFile(src, dest, mode, overwrite, counters) {
  if (fs.existsSync(dest) && !overwrite) {
    counters.skipped++;
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (mode === "move") {
    try {
      fs.renameSync(src, dest);
    } catch {
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    }
    counters.moved++;
  } else {
    fs.copyFileSync(src, dest);
    counters.copied++;
  }
}

function pruneEmptyDirs(root) {
  if (!isDirectory(root)) return;
  const dirs = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    dirs.push(dir);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isDirectory()) stack.push(path.join(dir, e.name));
  }
  dirs.sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch { /* leave non-empty or locked dirs alone */ }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { printHelp(); return; }

  if (!["copy", "move"].includes(opts.mode)) {
    throw new Error(`--mode must be copy or move, got ${opts.mode}`);
  }
  const badWorlds = opts.worlds.filter(w => !ALL_WORLDS[w]);
  if (badWorlds.length) throw new Error(`Unknown world(s): ${badWorlds.join(", ")}`);

  const repoRoot = findRepoRoot(opts.source);
  const geographyRoot = path.join(repoRoot, "module/data/geography");
  const worldsRoot = path.join(geographyRoot, "worlds");
  const outRoot = path.resolve(repoRoot, opts.out);

  if (path.relative(repoRoot, outRoot).startsWith("..")) {
    throw new Error("--out must stay inside the repo root.");
  }
  assertInside(outRoot, repoRoot, "--out");
  if (outRoot === geographyRoot || path.relative(geographyRoot, outRoot) === "") {
    throw new Error("--out must not be the live geography tree.");
  }

  const counters = { copied: 0, moved: 0, skipped: 0, written: 0 };
  const report = {
    generatedAt: new Date().toISOString(),
    mode: opts.mode,
    apply: opts.apply,
    repoRoot,
    source: worldsRoot,
    outRoot,
    worlds: [],
    unassigned: {},
    followUps: STALE_OR_FOLLOWUP_CODE
  };

  console.log("EQRMSS geography isolation");
  console.log(`Repo: ${repoRoot}`);
  console.log(`Source: ${worldsRoot}`);
  console.log(`Output: ${outRoot}`);
  console.log(`Mode: ${opts.apply ? opts.mode.toUpperCase() : "DRY-RUN"}`);
  console.log("");

  for (const world of opts.worlds) {
    const meta = ALL_WORLDS[world];
    const srcDir = path.join(worldsRoot, world);
    if (!isDirectory(srcDir)) {
      console.log(`- ${world}: missing source directory, skipped`);
      report.worlds.push({ world, missing: true, files: 0, bytes: 0 });
      continue;
    }

    const files = walkFiles(srcDir);
    const summary = summarizeFiles(files);
    const moduleDir = path.join(outRoot, `eqrmss-geography-${world}`);
    const destDataDir = path.join(moduleDir, "data/geography/worlds", world);

    console.log(`- ${meta.title}: ${summary.files} files, ${summary.bytes} bytes -> ${path.relative(repoRoot, destDataDir)}`);
    report.worlds.push({
      world,
      title: meta.title,
      source: path.relative(repoRoot, srcDir),
      destination: path.relative(repoRoot, destDataDir),
      files: summary.files,
      bytes: summary.bytes
    });

    if (!opts.apply) continue;

    writeText(path.join(moduleDir, "module.json"), JSON.stringify(moduleJson(world, meta, summary), null, 2) + "\n", opts.overwrite, counters);
    writeText(path.join(moduleDir, "README.md"), readme(world, meta, summary), opts.overwrite, counters);

    for (const src of files) {
      const rel = path.relative(srcDir, src);
      const dest = path.join(destDataDir, rel);
      assertInside(dest, destDataDir, "destination file");
      copyOrMoveFile(src, dest, opts.mode, opts.overwrite, counters);
    }

    if (opts.mode === "move") pruneEmptyDirs(srcDir);
  }

  const coreFilesDir = path.join(geographyRoot, "core-files");
  const coreFiles = isDirectory(coreFilesDir) ? walkFiles(coreFilesDir) : [];
  report.unassigned.coreFiles = {
    path: path.relative(repoRoot, coreFilesDir),
    ...summarizeFiles(coreFiles),
    note: "Not copied. Current core-files are empty and were skipped by the geography loader."
  };
  report.unassigned.sharedCode = SHARED_CODE_FILES.map(rel => {
    const p = path.join(repoRoot, rel);
    return { path: rel, exists: isFile(p), bytes: isFile(p) ? fs.statSync(p).size : 0 };
  });

  console.log("");
  console.log(`Unassigned core-files: ${report.unassigned.coreFiles.files} files, ${report.unassigned.coreFiles.bytes} bytes (not copied)`);
  console.log("Shared geography code left in place:");
  for (const f of report.unassigned.sharedCode) console.log(`  - ${f.path}${f.exists ? "" : " (missing)"}`);

  if (opts.apply) {
    const reportPath = opts.report ? path.resolve(repoRoot, opts.report) : path.join(outRoot, "eqrmss-geography-isolation-report.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log("");
    console.log(`Wrote report: ${path.relative(repoRoot, reportPath)}`);
    console.log(`Files copied: ${counters.copied}, moved: ${counters.moved}, skipped existing: ${counters.skipped}, generated written: ${counters.written}`);
    if (opts.mode === "move") {
      console.log("Move mode complete. Review git status before committing; use sync --delete when deploying removals.");
    } else {
      console.log("Copy mode complete. Source geography remains in the core system until you remove it separately.");
    }
  } else {
    console.log("");
    console.log("Dry-run only. Re-run with --apply to copy, or --apply --mode move to relocate.");
  }

  console.log("");
  console.log("Follow-ups not done by this script:");
  for (const item of STALE_OR_FOLLOWUP_CODE) console.log(`  - ${item}`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
