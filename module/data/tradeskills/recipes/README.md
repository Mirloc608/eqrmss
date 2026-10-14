# Tradeskill Recipe Schema (2026-10-14)

Each file in `recipes/` is named for a tradeskill (e.g. `smithing.json`) and contains
a JSON array of recipe objects.

## Recipe fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique recipe id (e.g. "iron-dagger") |
| `name` | string | Display name |
| `skill` | string | Tradeskill skill id (e.g. "skill-smithing") |
| `difficulty` | number | Target number: d100 + skill bonus must meet/exceed this |
| `components` | array | Materials/items consumed (on success or crit fail) |
| `product` | object | What is created on success |

## Component fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | "material" \| "item" | Material id (from shared materials) or item id |
| `id` | string | Material or item id |
| `qty` | number | Quantity required |

## Product fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | "weapon" \| "armor" \| "item" | Product category |
| `template` | string | Template id (weapon/armor template) |
| `material` | string | Material id (optional) |
| `qty` | number | Quantity produced |

## Combine resolution (user rulings 2026-10-14)

- d100 (open-ended) + skill bonus vs. difficulty
- **Success** (total >= difficulty): consume components, create product
- **Failure** (total < difficulty): keep components, no product
- **Critical failure** (natural 01-05): lose components, no product
