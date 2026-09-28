# EQ-RMSS Races - Schema Guide

This folder contains the 16 core race definitions for EQ-RMSS, validated against `gnome.json` as the canonical template.

## Canonical Race

**`gnome.json`** is the gold standard. All other races must match its 20 top-level keys:

```
id, key, name, type, img, description, lore, stats, racialTalents, movement, size, height, weight, lifespan, skillBonuses, skillCosts, favoredProfessions, restrictedProfessions, startingLanguages, startingEquipment
```

## Index

`index.json` lists all 16 implemented races:

```json
["barbarian","dark-elf","drakkin","dwarf","erudite","froglok","gnome","half-elf","halfling","high-elf","human","iksar","ogre","troll","vah-shir","wood-elf"]
```

The loader should iterate this index and load `module/data/races/<key>.json`.

## Stats

All races use 10 RMSS stats:

- **Ag** Agility
- **Co** Constitution
- **Me** Memory
- **Re** Reasoning
- **SD** Self Discipline
- **Em** Empathy
- **In** Intuition
- **Pr** Presence
- **Qu** Quickness
- **St** Strength

Values typically range -10 to +20, with 0 as human baseline.

## Lore Object

```json
"lore": {
  "homeland": ["Ak'Anon", "Steamfont Mountains"],
  "culture": "...",
  "alignment": "Often Neutral or Good...",
  "languages": ["Common", "Gnomish"]
}
```

- `homeland`: array, at least 1
- `culture`: string
- `alignment`: string
- `languages`: array, at least 1

## Racial Talents

Each race has 4-5 talents:

```json
{
  "id": "clockwork_insight",
  "name": "Clockwork Insight",
  "description": "...",
  "effects": [
    { "type": "skillCategory", "target": "lore", "value": 10 }
  ]
}
```

### Effect Types - Extended Enum

The canonical set was originally:

- `skillCategory` - bonus to a skill category (combat, physical, subterfuge, magical, lore, social)
- `affinity` - magical affinity (magical, divine, nature, etc)
- `stat` - direct stat bonus (Re, Me, etc)
- `resistance` - resistance (magic, poison, disease, cold, etc)
- `sense` - sensory ability (lowLightVision, darkvision, underwaterBreathing, etc)

**Extended types now in use (added after gnome.json):**

- `armor` - natural armor
  - Example: `drakkin` scaled_skin, `dwarf` stout_frame, `iksar` scaled_hide
  - Target: `naturalArmor`, value: 1-3

- `movement` - movement bonuses
  - Targets: `balance`, `swimSpeed`, `travelBonus`, `jumpBonus`, `swimSpeed`, `breathHold`, `jumpBonus`
  - Example: `barbarian` sure_footed (balance 10), `froglok` amphibious (swimSpeed 30)

- `regeneration` - regeneration
  - Example: `troll` regeneration (hpPerRound 2)

**All 8 types should be considered valid going forward:**

```
["skillCategory","affinity","stat","resistance","sense","armor","movement","regeneration"]
```

## Movement

```json
"movement": {
  "base": 25,
  "pace": "Normal", // Slow, Normal, Fast
  "encumbranceMultiplier": 1.0
}
```

- Small races (gnome, halfling): base 20, Slow or Normal
- Medium races: base 25, Normal
- Large/fast races (ogre, troll, vah-shir): base 30, Fast

## Size

- `Small`: gnome, halfling
- `Medium`: most races
- `Large`: ogre, troll

## SkillBonuses

All 6 categories must exist, even if empty:

```json
"skillBonuses": {
  "combat": { "axes": 10 },
  "physical": { "survival": 10 },
  "subterfuge": {},
  "magical": {},
  "lore": { "nature": 5 },
  "social": {}
}
```

## SkillCosts

Grades A (cheapest) to D (most expensive):

- A = favored, easy to learn
- B = normal
- C = harder
- D = very hard / culturally restricted

Example:
- Barbarian: combat A, magical D (barbarians bad at magic)
- Erudite: combat D, magical A (scholars bad at fighting, good at magic)
- Ogre: subterfuge D, magical D

Grades A-D are all valid.

## Validation

Run tests:

```bash
npm test -- races
# or
node module/data/races/races.test.js
```

Uses `race-schema.json` (Draft-07 JSON Schema) with Ajv.

## Adding a New Race

1. Copy `gnome.json` as template
2. Update `id` to `eqrmss-<key>`, `key` to slug, `name`, `img`
3. Fill `description`, `lore`, `stats` (10 stats), `racialTalents` (4-5)
4. Set `movement`, `size`, `height`, `weight`, `lifespan`
5. Fill `skillBonuses` (6 categories), `skillCosts` (6 categories, A-D)
6. Set `favoredProfessions`, `restrictedProfessions`
7. Set `startingLanguages` (Common rank 3, native rank 5), `startingEquipment`
8. Add key to `index.json`
9. Run `npm test` - must pass schema validation

## Notes

- `img` path must be `systems/eqrmss/assets/Icons/race/<key>.png`
- `id` must match pattern `^eqrmss-[a-z-]+$`
- `startingLanguages` rank: 3 = known, 5 = native fluency
- No extra top-level keys allowed (additionalProperties: false)