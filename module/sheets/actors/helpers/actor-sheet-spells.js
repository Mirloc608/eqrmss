// EQRMSS Actor Sheet Spells Helper
// - Spell tab behavior
// - Spell list interactions
// - Spell gem bar drag-and-drop + casting

import { EQRMSSSpellcastingEngine } from "../../../utils/spells/spellcasting-engine.js";
import { visibleSpells } from "../../../utils/item-visibility.js";

// ------------------------------------------------------------
// Spell-line grouping
// Spell ranks may share an exact name (rank in _id "-rN" suffix,
// e.g. "mag-scorching-skin-73-r2") OR have roman numeral suffixes
// in the name itself (e.g. "Sweet Breath" / "Sweet Breath II").
// Groups collapse all rank variants into one row showing the
// highest rank.
// ------------------------------------------------------------

const RANK_SUFFIX_RE = /-r(\d+)$/;

// Roman numeral suffix in spell name, e.g. "Sweet Breath II" -> "II"
const NAME_RANK_RE = /\s+(II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)$/;

const ROMAN_NUMERALS = ["I","II","III","IV","V","VI","VII","VIII","IX","X",
  "XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX"];

const ROMAN_TO_NUM = Object.fromEntries(ROMAN_NUMERALS.map((r, i) => [r, i + 1]));

function toRoman(n) {
  return ROMAN_NUMERALS[n - 1] ?? String(n);
}

/**
 * Base spell name with rank suffix stripped.
 * "Sweet Breath II" -> "Sweet Breath"; "Bond of Bonemaw" -> "Bond of Bonemaw"
 */
export function spellBaseName(name) {
  if (!name) return "";
  return name.replace(NAME_RANK_RE, "").trim();
}

/**
 * Rank number for a spell item.
 * Priority: (1) _id "-rN" suffix, (2) roman numeral in name, (3) default 1.
 */
export function spellRankNumber(item) {
  const id = item?._id ?? item?.id ?? "";
  const m = RANK_SUFFIX_RE.exec(id);
  if (m) return parseInt(m[1], 10);
  const name = item?.name ?? "";
  const nm = NAME_RANK_RE.exec(name);
  if (nm && ROMAN_TO_NUM[nm[1]]) return ROMAN_TO_NUM[nm[1]];
  return 1;
}

function spellRow(item) {
  const s = item?.system ?? {};
  return {
    id: item?.id ?? item?._id ?? "",
    name: item?.name ?? "",
    level: s.level ?? 0,
    manaCost: s.manaCost ?? 0,
    spellList: s.spell_list ?? "",
    type: s.type ?? "",
    range: s.range ?? "",
    duration: s.duration ?? "",
    isReady: !!item?.isReady
  };
}

/**
 * Group a flat spell list by spell line (base name with rank suffix stripped).
 * "Sweet Breath", "Sweet Breath II", "Sweet Breath III" -> one group.
 * @param {Array} spells - spell items/documents
 * @param {Set<string>} [expandedNames] - group names currently expanded
 * @returns {Array} groups sorted alphabetically; each group's ranks sorted
 *   by level desc, then rank desc (first rank = highest known).
 */
export function groupSpellsByLine(spells, expandedNames) {
  const byName = new Map();
  for (const item of spells ?? []) {
    if (!item?.name) continue;
    const baseName = spellBaseName(item.name);
    const row = { ...spellRow(item), rank: spellRankNumber(item) };
    if (!byName.has(baseName)) byName.set(baseName, []);
    byName.get(baseName).push(row);
  }

  const groups = [];
  for (const [name, rows] of byName) {
    rows.sort((a, b) => (b.level - a.level) || (b.rank - a.rank));
    const top = rows[0];
    groups.push({
      name,
      count: rows.length,
      multi: rows.length > 1,
      highestId: top.id,
      highest: top,
      expanded: !!expandedNames?.has(name),
      ranks: rows.map(r => ({ ...r, rankRoman: toRoman(r.rank) }))
    });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));
  return groups;
}

export class EQRMSSActorSpellsHelper {
  constructor(sheet) {
    this.sheet = sheet;
    // Spell-group expander state; persists across re-renders because the
    // helper instance is constructed once per sheet.
    this.expandedGroups = new Set();
  }

  prepare(context) {
    const actor = this.sheet.actor;

    context.spells = visibleSpells(actor.items);
    context.memorized = actor.system.memorized ?? [
      {}, {}, {}, {}, {}, {}, {}, {}
    ];

    return context;
  }

  activate() {
    const html = this.sheet.element;
    if (!html) return;

    // Spell-group expand/collapse
    html.querySelectorAll(".spell-group-toggle").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const name = el.dataset.group;
        if (this.expandedGroups.has(name)) this.expandedGroups.delete(name);
        else this.expandedGroups.add(name);
        this.sheet.render();
      });
    });

    // Expand / collapse all spell groups
    html.querySelectorAll(".spell-expand-all").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        html.querySelectorAll(".spell-group-header[data-group]").forEach(h => {
          this.expandedGroups.add(h.dataset.group);
        });
        this.sheet.render();
      });
    });
    html.querySelectorAll(".spell-collapse-all").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        this.expandedGroups.clear();
        this.sheet.render();
      });
    });

    // Drag from spell list
    html.querySelectorAll(".eq-spell-entry").forEach(el => {
      el.addEventListener("dragstart", ev => {
        const itemId = el.dataset.itemId;
        ev.dataTransfer.setData("text/plain", itemId);
      });
    });

    // Drop onto spell gem
    html.querySelectorAll(".eq-spell-gem").forEach(el => {
      el.addEventListener("dragover", ev => ev.preventDefault());

      el.addEventListener("drop", async ev => {
        ev.preventDefault();
        const itemId = ev.dataTransfer.getData("text/plain");
        const item = this.sheet.actor.items.get(itemId);
        if (!item) return;

        const index = Number(el.dataset.index);
        const memorized = foundry.utils.deepClone(this.sheet.actor.system.memorized ?? [
          {}, {}, {}, {}, {}, {}, {}, {}
        ]);

        memorized[index] = {
          id: item.id,
          name: item.name,
          icon: item.img
        };

        await this.sheet.actor.update({ "system.memorized": memorized });
        this.sheet.render();
      });

      // Click to cast
      el.addEventListener("click", async () => {
        const index = Number(el.dataset.index);
        const memorized = this.sheet.actor.system.memorized ?? [];
        const entry = memorized[index];
        if (!entry) return;

        const item = this.sheet.actor.items.get(entry.id);
        if (!item) return;

        await EQRMSSSpellcastingEngine.cast(this.sheet.actor, item);
      });
    });
  }
}
