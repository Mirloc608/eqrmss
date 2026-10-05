// ============================================================
// SPELL MAPPING (EQ content -> RMSS mechanics, user rulings
// 2026-10-04): the EQ spell catalog stays the content; RMSS
// Spell Law supplies resolution.
//
// - Resource: EQ mana (attributes.mana pool, EQ manaCost). No PP.
// - Damage: PURE RMSS. EQ damage amounts are ignored; the bolt
//   attack table plus the casting (Directed Spells) bonus produce
//   all hits and crits.
// - Element axes: fire -> Fire Bolt (Heat crits), cold -> Ice
//   Bolt (Impact), electricity -> Lightning Bolt (Electricity +
//   Impact compounds), magic/arcane -> Fire Bolt table with Mana
//   crits substituted. Poison/disease direct damage routes to
//   the base-spell/RR track (later stage), not bolts.
// - Heal effects: direct healing (applyHealingSpell + hit
//   restoration).
//
// Classification is rule-derived from the spell's FIRST damage
// effect, else its heal effect. Payload comes from the item's
// system.effects (finalizer preserves it for new grants); older
// items fall back to the loaded EQ catalog (game.eqrmss.spells)
// matched by class + name. A per-spell authored override field
// (system.rmss) wins when present.
// ============================================================

// Element -> { attackTable, critType? }. critType forces the
// crit table (Mana) regardless of the attack table's cell type.
export const BOLT_BY_ELEMENT = {
    fire: { attackTable: "Fire Bolt" },
    cold: { attackTable: "Ice Bolt" },
    electric: { attackTable: "Lightning Bolt" },
    electricity: { attackTable: "Lightning Bolt" },
    lightning: { attackTable: "Lightning Bolt" },
    water: { attackTable: "Water Bolt" },
    magic: { attackTable: "Fire Bolt", critType: "M" },
    arcane: { attackTable: "Fire Bolt", critType: "M" }
};

function catalogEffectsFor(spellItem) {
    const byClass = globalThis.game?.eqrmss?.spells ?? {};
    const list = byClass[String(spellItem?.system?.spell_list ?? "").toLowerCase()] ?? [];
    const hit = list.find(s => s.name === spellItem?.name);
    return Array.isArray(hit?.system?.effects) ? hit.system.effects : null;
}

/** The spell's typed effect list, from its item payload or the catalog. */
export function spellEffectsOf(spellItem) {
    const own = spellItem?.system?.effects;
    if (Array.isArray(own) && own.length) return own;
    return catalogEffectsFor(spellItem) ?? (Array.isArray(own) ? own : []);
}

/**
 * Classify a spell for cast resolution:
 * { kind: "bolt", element, attackTable, critType|null }
 * { kind: "heal", amount }
 * { kind: "later", reason } — known-but-unbuilt track (Stage 4+)
 * { kind: "none" } — no mechanical payload (announcement only)
 */
export function classifySpell(spellItem) {
    const override = spellItem?.system?.rmss;
    if (override?.kind === "bolt" && override.attackTable) {
        return { kind: "bolt", element: override.element ?? "", attackTable: override.attackTable, critType: override.critType ?? null };
    }
    const effects = spellEffectsOf(spellItem);
    const dmg = effects.find(e => e?.type === "damage");
    if (dmg) {
        const element = String(dmg.element ?? "").toLowerCase();
        const bolt = BOLT_BY_ELEMENT[element];
        if (bolt) return { kind: "bolt", element, attackTable: bolt.attackTable, critType: bolt.critType ?? null };
        return { kind: "later", reason: `${element || "untyped"} damage resolves on the base-spell/RR track (later stage)` };
    }
    const heal = effects.find(e => e?.type === "heal");
    if (heal) {
        const amount = Number(heal.amount ?? heal.max ?? heal.min) || 0;
        if (amount > 0) return { kind: "heal", amount };
    }
    if (effects.length) return { kind: "later", reason: "buffs, debuffs and DoTs land in a later stage" };
    return { kind: "none" };
}

/** The caster's Directed Spells skill bonus (skill item), or 0. */
export function directedSpellsBonus(actor) {
    const items = [...(actor?.items?.contents ?? actor?.items ?? [])];
    const skill = items.find(i => i?.type === "skill" && i.system?.slug === "directedSpells");
    return Number(skill?.system?.bonus) || 0;
}

/** Live character level: the sheet's Level Up writes
 *  system.attributes.level.value; system.character.level is a
 *  legacy field that never advances. */
export function casterLevelOf(actor) {
    const sys = actor?.system ?? {};
    return Math.max(1, Number(sys.attributes?.level?.value ?? sys.character?.level) || 1);
}

/** Directed Spells OB (Spell Law bolt-table formula, Stage 3):
 *  caster level + Agility stat bonus + Directed Spells rank bonus.
 *  With no skill item the aim is untrained: level + Agility only. */
export function directedSpellsOB(actor) {
    const items = [...(actor?.items?.contents ?? actor?.items ?? [])];
    const skill = items.find(i => i?.type === "skill" && i.system?.slug === "directedSpells");
    const ranks = Number(skill?.system?.rankBonus ?? skill?.system?.bonus) || 0;
    return casterLevelOf(actor) + statBonusFor(actor, "AG") + ranks;
}

// ------------------------------------------------------------
// MANA POOL (user ruling 2026-10-04): max = character level x
// primary casting stat bonus, class-aware (EQ flavor). Pure
// melee classes have no pool. Rest/regen is not modeled.
// ------------------------------------------------------------

export const CASTING_STAT_BY_CLASS = {
    // EQ INT casters -> RMSS Memory (class prime requisite),
    // EQ WIS casters -> Empathy, bards -> Presence (no CHA stat code).
    wizard: "ME", magician: "ME", enchanter: "ME", necromancer: "ME", shadowknight: "ME",
    cleric: "EM", druid: "EM", shaman: "EM", paladin: "EM", ranger: "EM", beastlord: "EM",
    bard: "PR"
};

/** RMSS stat bonus per the system's house pattern: a stored nonzero
 *  basic bonus wins; otherwise floor((temp - 50) / 5); no temp, no bonus. */
export function statBonusFor(actor, code) {
    const st = actor?.system?.stats?.[code];
    if (!st || typeof st !== "object") return 0;
    const stored = st.basic_bonus ?? st.basicBonus ?? 0;
    if (Number(stored) !== 0) return Number(stored);
    if (st.temp == null) return 0;
    return Math.floor((Number(st.temp) - 50) / 5);
}

/** Derived mana maximum for an actor (0 for non-casters). */
export function manaMaxFor(actor) {
    const sys = actor?.system ?? {};
    // World actors carry their class at system.origin.classId
    // (the wizard finalizer's origin block); keep the legacy spots
    // as fallbacks.
    const classId = String(sys.origin?.classId ?? sys.fixed_info?.classId ?? sys.classId ?? "").toLowerCase();
    const stat = CASTING_STAT_BY_CLASS[classId];
    if (!stat) return 0;
    const level = casterLevelOf(actor);
    // EQ scale (user ruling 2026-10-04): (level x bonus) +
    // (level x primary stat / 10), the stat being its temp value.
    const temp = Number(actor?.system?.stats?.[stat]?.temp) || 0;
    return Math.max(0, level * statBonusFor(actor, stat) + level * Math.floor(temp / 10));
}
