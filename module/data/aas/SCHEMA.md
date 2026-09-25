# EQRMSS Alternate Advancement (AA) Data Schema

**Version:** 1.0
**Location:** `module/data/aas/`
**Status:** Draft — structure only, data files not yet populated.

## Directory layout

```
module/data/aas/
  index.json                  # manifest: schemaVersion, categories, class list
  aa-categories.json          # sheet UI tab definitions
  signature-dependencies.json # prerequisite graph for validation
  general/                    # AAs available to all classes
    <aa-slug>.json
    index.json
  archetype/                  # AAs by archetype (melee/caster/priest/hybrid)
    <aa-slug>.json
    index.json
  <class>/                    # class-specific AAs (warrior, cleric, ... 16 total)
    <aa-slug>.json
    index.json
```

One JSON object per file. The directory a file lives in is organizational;
the `classes` field inside the file is authoritative.

## Per-AA file schema

```json
{
  "schemaVersion": "1.0",
  "id": "aa-first-aid",
  "name": "First Aid",
  "type": "aa",
  "img": "systems/eqrmss/assets/Icons/aa/first-aid.svg",
  "system": {
    "slug": "first-aid",
    "category": "general",
    "archetype": null,
    "classes": [],
    "expansion": "luclin",
    "advanced": false,
    "levelRequired": 55,
    "maxRanks": 3,
    "activation": "activated",
    "costPerRank": [2, 4, 6],
    "prerequisites": [{ "aa": "aa-innate-constitution", "rank": 1 }],
    "ranks": [
      { "rank": 1, "cost": 2, "description": "...", "effects": [] }
    ],
    "description": "..."
  }
}
```

### Field rules

| Field | Type | Required | Rules |
|---|---|---|---|
| `schemaVersion` | string | yes | `"1.0"` |
| `id` | string | yes | Unique, `aa-<slug>` format |
| `name` | string | yes | Display name |
| `type` | string | yes | Always `"aa"` |
| `img` | string | no | Icon path |
| `system.slug` | string | yes | URL-safe id without prefix |
| `system.category` | string | yes | `general` \| `archetype` \| `class` |
| `system.archetype` | string \| null | when archetype | `melee` \| `caster` \| `priest` \| `hybrid` |
| `system.classes` | string[] | yes | Class IDs; empty = all classes |
| `system.expansion` | string | no | Min expansion ID from `EXPANSION_CHOICES`; defaults to `luclin` |
| `system.advanced` | boolean | no | Default `false`; see gating below |
| `system.levelRequired` | number | yes | Minimum character level (typically 51+) |
| `system.maxRanks` | number | yes | Max purchasable ranks (>= 1) |
| `system.activation` | string | yes | `passive` \| `activated` \| `innate` |
| `system.costPerRank` | number[] | yes | Flat array of AA-point costs; length must equal `maxRanks` |
| `system.prerequisites` | object[] | no | `{ "aa": "<id>", "rank": <n> }`; every id must exist in `signature-dependencies.json` |
| `system.ranks` | object[] | yes | Per-rank `{ rank, cost, description, effects }`; `effects` freeform until the effect engine hooks in |
| `system.description` | string | yes | Full description |

### Cost model

- `costPerRank` values are denominated in **AA points** (flat array, one entry per rank).
- **1 AA point = the XP required to reach level 50.**
- The XP/progression system converts AA-point costs to XP using that definition.

## Expansion gating

Gating is applied by the loader at runtime, not stored as derived data.
Uses `EQRMSSExpansionManager` (`module/expansions/expansion-manager.js`):

1. If `!EQRMSSExpansionManager.hasAAs()` — AAs are not unlocked at all
   (global gate from `unlocks.aas` in `module/data/expansions/index.json`,
   currently `"luclin"`). Load nothing.
2. Per AA: skip unless
   `EQRMSSExpansionManager.isExpansionUnlocked(aa.system.expansion ?? "luclin")`.
3. If `aa.system.advanced` is true: additionally require
   `EQRMSSExpansionManager.hasAdvancedAAs()`
   (from `unlocks.advancedAas`, currently `"pop"`).
4. Re-evaluate on the `eqrmssExpansionChanged` hook so changing the active
   expansion live-updates the available AA list.

Rationale for the `advanced` flag (rather than pure `expansion: "pop"`):
the manager already exposes `hasAdvancedAAs()` and the unlocks config
already distinguishes the two tiers, so the data mirrors the system.

## Manifest files

### `index.json`

```json
{
  "schemaVersion": "1.0",
  "categories": ["general", "archetype", "class"],
  "classes": ["warrior", "cleric", "paladin", "ranger", "shadowknight",
              "druid", "monk", "bard", "rogue", "shaman", "necromancer",
              "wizard", "magician", "enchanter", "beastlord", "berserker"]
}
```

### `aa-categories.json`

Sheet UI tab definitions:

```json
{
  "general":   { "label": "General",   "order": 1 },
  "archetype": { "label": "Archetype", "order": 2,
                 "subtypes": ["melee", "caster", "priest", "hybrid"] },
  "class":     { "label": "Class",     "order": 3 }
}
```

### `signature-dependencies.json`

Prerequisite graph for validation: `{ "<aa-id>": ["<prereq-aa-id>", ...] }`.
Every `system.prerequisites[].aa` in every AA file must appear here and
must reference an existing AA `id`. Validated by the loader; a future
script can regenerate this file from the data.

## Loader (planned)

`module/data/loaders/aa-loader.js` exporting `EQRMSSAALoader`:

- Browse `systems/eqrmss/module/data/aas` via FilePicker (same pattern as
  the skill loader in `initialize-data-loaders.js`), fetch each JSON.
- Validate required fields (`id`, `name`, `system.category`,
  `system.maxRanks`, `costPerRank.length === maxRanks`).
- Apply the expansion gating rules above.
- Populate `game.eqrmss.aas = { byId, byClass, byCategory }`.
- Wire into `module/initialization/initialize-data-loaders.js`.

The `aa` compendium pack (`packs/abilities/aa.db`) is separate; like skills,
these JSON files are the runtime source of truth.
