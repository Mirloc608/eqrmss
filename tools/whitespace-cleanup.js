#!/usr/bin/env node

// Whitespace normalization script for eqrmss
// Rules:
// - 4-space indentation (tabs converted to 4 spaces)
// - Normalize line endings to LF ("\n")
// - Remove trailing spaces
// - Collapse multiple blank lines to a single blank line
// - Skip binary / asset-like files (.png, .svg, .jpg, .jpeg, .webm, .ttf, .woff, .woff2, .otf, .eot, .ico)
// - Skip the `assets` and `packs` directories

const fs = require("fs");
const path = require("path");

const ROOT = process.argv[2] || path.resolve(__dirname, "..");

const BINARY_EXTS = new Set([
  ".png", ".svg", ".jpg", ".jpeg", ".webm",
  ".ttf", ".woff", ".woff2", ".otf", ".eot", ".ico"
]);

const SKIP_DIRS = new Set(["assets", "packs"]);

function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXTS.has(ext);
}

function normalizeWhitespace(text) {
  // Normalize line endings to LF
  let s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const lines = s.split("\n");
  const out = [];
  let lastWasBlank = false;

  for (let line of lines) {
    // Remove trailing spaces/tabs
    line = line.replace(/[ \t]+$/g, "");

    // Convert leading tabs to 4 spaces
    line = line.replace(/^([ \t]+)/, (m) => {
      let result = "";
      for (const ch of m) {
        if (ch === "\t") result += "    ";
        else result += ch;
      }
      return result;
    });

    const isBlank = line.trim().length === 0;
    if (isBlank) {
      if (lastWasBlank) continue; // collapse multiple blank lines
      lastWasBlank = true;
      out.push("");
    } else {
      lastWasBlank = false;
      out.push(line);
    }
  }

  // Join with LF
  return out.join("\n");
}

function processFile(filePath) {
  if (isBinaryFile(filePath)) return;

  let original;
  try {
    original = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.warn(`Skipping unreadable file: ${filePath} (${e.message})`);
    return;
  }

  const normalized = normalizeWhitespace(original);
  if (normalized !== original) {
    fs.writeFileSync(filePath, normalized, "utf8");
    console.log("Normalized:", filePath);
  }
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full);
    } else if (entry.isFile()) {
      processFile(full);
    }
  }
}

console.log("Whitespace normalization starting at:", ROOT);
walk(ROOT);
console.log("Whitespace normalization complete.");
