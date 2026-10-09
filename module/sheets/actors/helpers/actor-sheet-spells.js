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

// ------------------------------------------------------------
// Functional category grouping (2026-10-08)
// Spells are grouped by functional category derived from their
// primary effect type. Categories render as collapsible sections
// on the Spells tab, each containing spell-line groups.
// ------------------------------------------------------------

/** Maps system.effects[].type -> display category. Unmapped -> "Utility". */
const EFFECT_TYPE_TO_CATEGORY = {
  buff: "Buff",
  debuff: "Debuff",
  "summon-pet": "Pet",
  damage: "Direct Damage",
  dot: "Damage Over Time",
  "damage-over-time": "Damage Over Time",
  heal: "Heals",
  regen: "Heals",
  cure: "Heals",
  restore: "Heals",
  control: "Crowd Control",
  hate: "Hate",
  "hate-modifier": "Hate",
  "hate-mod": "Hate",
  movement: "Travel",
  levitate: "Travel",
  lifetap: "Lifetap",
  "lifetap-over-time": "Lifetap",
};

/** Display order for categories on the Spells tab. */
const CATEGORY_ORDER = [
  "Direct Damage",
  "Damage Over Time",
  "Lifetap",
  "Heals",
  "Buff",
  "Debuff",
  "Crowd Control",
  "Hate",
  "Pet",
  "Travel",
  "Utility",
];

/**
 * Effect types that describe mechanics, not function — skipped when
 * determining a spell's primary category.
 */
const META_EFFECT_TYPES = new Set(["stacking", "stack-block", "persistent", "proc"]);

/**
 * Name patterns for travel spells. Teleport/gate spells use generic
 * "utility" effects, so they're detected by name instead.
 */
const TRAVEL_NAME_RE = /teleport|evacuate|\bgate\b|circle of/i;

/**
 * Functional category for a spell item, from its primary effect type.
 * Teleport/gate spells use generic "utility" effects, so they're detected
 * by name — but only when the effect type doesn't already give a clear
 * category (e.g. "Circle of Winter" is a buff, not a teleport).
 * @param {object} item - spell item/document
 * @returns {string} category display name
 */
export function spellCategory(item) {
  const name = item?.name ?? "";
  const effects = item?.system?.effects ?? [];
  let primary = null;
  for (const e of effects) {
    const t = e?.type;
    if (!t || META_EFFECT_TYPES.has(t)) continue;
    primary = t;
    break;
  }
  if (primary && EFFECT_TYPE_TO_CATEGORY[primary]) {
    return EFFECT_TYPE_TO_CATEGORY[primary];
  }
  // Unmapped or no effects: check travel name patterns before falling
  // back to Utility (teleport/gate spells use generic utility effects).
  if (TRAVEL_NAME_RE.test(name)) return "Travel";
  return "Utility";
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
    // Rank inference (2026-10-09): if all rows report rank 1 (catalog
    // _id lost when items were created), infer rank from mana cost
    // ascending — higher ranks cost more mana.
    const allRankOne = rows.every(r => r.rank === 1);
    if (allRankOne && rows.length > 1) {
      const byMana = [...rows].sort((a, b) => (a.manaCost ?? 0) - (b.manaCost ?? 0));
      byMana.forEach((r, i) => { r.rank = i + 1; });
    }
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

/**
 * Group a flat spell list by functional category, then by spell line
 * within each category.
 * @param {Array} spells - spell items/documents
 * @param {Set<string>} [expandedGroups] - spell-line names currently expanded
 * @param {Set<string>} [collapsedCategories] - category names currently collapsed
 * @returns {Array} categories in CATEGORY_ORDER; each has name, groups
 *   (from groupSpellsByLine), lineCount, spellCount, and expanded flag.
 *   Empty categories are omitted.
 */
export function groupSpellsByCategory(spells, expandedGroups, collapsedCategories) {
  const byCategory = new Map();
  for (const item of spells ?? []) {
    if (!item?.name) continue;
    const cat = spellCategory(item);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(item);
  }

  const categories = [];
  for (const [name, items] of byCategory) {
    const groups = groupSpellsByLine(items, expandedGroups);
    categories.push({
      name,
      groups,
      lineCount: groups.length,
      spellCount: items.length,
      expanded: !collapsedCategories?.has(name),
    });
  }
  categories.sort((a, b) => CATEGORY_ORDER.indexOf(a.name) - CATEGORY_ORDER.indexOf(b.name));
  return categories;
}

export class EQRMSSActorSpellsHelper {
  constructor(sheet) {
    this.sheet = sheet;
    // Spell-group expander state; persists across re-renders because the
    // helper instance is constructed once per sheet.
    this.expandedGroups = new Set();
    // Collapsed category sections (categories default to expanded).
    this.collapsedCategories = new Set();
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

    // Spell-category expand/collapse
    html.querySelectorAll(".spell-category-toggle").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const name = el.dataset.category;
        if (this.collapsedCategories.has(name)) this.collapsedCategories.delete(name);
        else this.collapsedCategories.add(name);
        this.sheet.render();
      });
    });

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

    // Expand all: categories and spell groups
    html.querySelectorAll(".spell-expand-all").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        this.collapsedCategories.clear();
        html.querySelectorAll(".spell-group-header[data-group]").forEach(h => {
          this.expandedGroups.add(h.dataset.group);
        });
        this.sheet.render();
      });
    });
    // Collapse all: categories and spell groups
    html.querySelectorAll(".spell-collapse-all").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        html.querySelectorAll(".spell-category-header[data-category]").forEach(h => {
          this.collapsedCategories.add(h.dataset.category);
        });
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
