// Ability handlers (2026-10-10)
// Implements the 18 shared ability handlers referenced by
// module/data/abilities/shared/*.json via the "handler" field.
//
// Categories:
// - Monk strikes (kick, crescent-kick, flying-kick, round-kick,
//   tiger-claw): real attacks on the MA Strikes table, level-scaled
//   (user ruling 2026-10-21)
// - Fixed strikes: bash, slam
// - Backstab: readied-weapon attack with level-scaled OB bonus and
//   damage multiplier (user ruling 2026-10-21)
// - Extra attacks: double-attack, triple-attack, flurry, frenzy, dual-wield
// - Defensive: block, evade, riposte
// - Taunt: provoke, taunt

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

/**
 * Dispatch an ability by handler name.
 * @param {Actor} actor - The acting character.
 * @param {Actor} target - The target (if any).
 * @param {object} ability - The ability data (name, handler, effects).
 * @param {Array} notes - Chat notes array.
 */
export async function executeAbility(actor, target, ability, notes = []) {
    if (!actor || !ability) return;
    const handler = String(ability.handler || ability.id || "").toLowerCase();

    // Active shield use (Shield Bash) requires shield training: the
    // Shield Mastery skill or the Shield Bash ability granted by class.
    // Passive shield wear (DB bonus) remains available to all classes.
    if (handler === "bash") {
        try {
            const { hasShieldTraining } =
                await import("../utils/equipment/equipment-restrictions.js");
            if (!hasShieldTraining(actor)) {
                notes.push(`<em>${esc(ability.name)}: requires Shield Mastery training to use actively.</em>`);
                try { ui?.notifications?.warn?.(`EQRMSS | ${ability.name}: requires Shield Mastery training to use actively.`); } catch (e) {}
                return;
            }
        } catch (e) { /* fail-open on import error */ }
    }

    switch (handler) {
        case "kick":
        case "crescent-kick":
        case "flying-kick":
        case "round-kick":
        case "tiger-claw": return await martialStrikeAbility(actor, target, ability, notes);
        case "bash": return await strikeAbility(actor, target, ability, notes, { damage: 8, interrupt: true });
        case "slam": return await strikeAbility(actor, target, ability, notes, { damage: 10, stun: true });
        
        case "backstab": return await backstabAbility(actor, target, ability, notes);
        
        case "double-attack": return await extraAttackAbility(actor, ability, notes, 1);
        case "triple-attack": return await extraAttackAbility(actor, ability, notes, 2);
        case "flurry": return await extraAttackAbility(actor, ability, notes, 3);
        case "frenzy": return await extraAttackAbility(actor, ability, notes, 2);
        case "dual-wield": return await extraAttackAbility(actor, ability, notes, 1);
        
        case "block": return await defensiveAbility(actor, ability, notes, "block");
        case "evade": return await defensiveAbility(actor, ability, notes, "evade");
        case "riposte": return await defensiveAbility(actor, ability, notes, "riposte");
        
        case "provoke":
        case "taunt": return await tauntAbility(actor, target, ability, notes);
        
        default:
            notes.push(`<em>${esc(ability.name)}: no handler implemented.</em>`);
            break;
    }
}

/**
 * Strike abilities: direct melee damage with optional riders.
 */
async function strikeAbility(actor, target, ability, notes, opts = {}) {
    if (!target) {
        notes.push(`<em>${esc(ability.name)}: no target.</em>`);
        return;
    }
    const damage = Number(opts.damage) || 5;
    try {
        const { applyCapstoneDamage } = await import("./capstone-effects.js");
        await applyCapstoneDamage(target, damage, "physical", notes, actor);
        notes.push(`<em>${esc(actor.name)} ${esc(ability.name.toLowerCase())}s ${esc(target.name)} for ${damage}.</em>`);
        if (opts.interrupt) notes.push(`<em>${esc(target.name)} is interrupted.</em>`);
        if (opts.stun) {
            try {
                const { applyStatusEffect } = await import("../spells/status-wiring.js");
                await applyStatusEffect(target, "stunned", "Stunned", 1, "icons/svg/paralysis.svg", { source: ability.name });
                notes.push(`<em>${esc(target.name)} is stunned for 1 round.</em>`);
            } catch (e) { /* ignore */ }
        }
    } catch (e) {
        console.error("EQRMSS | Strike ability failed", e);
    }
}

/**
 * Level scaling for the strike abilities (user ruling 2026-10-21).
 * Bands: 1-20 / 21-50 / 51-80 / 81-110 / 111+.
 * Backstab: OB +10/+20/+25/+30/+40, damage x2/x2/x3/x3/x4.
 * Monk martial strikes: same OB bands, x2 hits from level 51.
 */
export function backstabScaleForLevel(level) {
    const lv = Math.max(1, Number(level) || 1);
    if (lv <= 20) return { obBonus: 10, damageMultiplier: 2 };
    if (lv <= 50) return { obBonus: 20, damageMultiplier: 2 };
    if (lv <= 80) return { obBonus: 25, damageMultiplier: 3 };
    if (lv <= 110) return { obBonus: 30, damageMultiplier: 3 };
    return { obBonus: 40, damageMultiplier: 4 };
}

export function martialStrikeScaleForLevel(level) {
    const lv = Math.max(1, Number(level) || 1);
    if (lv <= 20) return { obBonus: 10, damageMultiplier: 1 };
    if (lv <= 50) return { obBonus: 20, damageMultiplier: 1 };
    if (lv <= 80) return { obBonus: 25, damageMultiplier: 2 };
    if (lv <= 110) return { obBonus: 30, damageMultiplier: 2 };
    return { obBonus: 40, damageMultiplier: 2 };
}

function actorLevel(actor) {
    return Math.max(1, Number(actor?.system?.attributes?.level?.value)
        || Number(actor?.system?.character?.level) || 1);
}

function targetTokenOf(target) {
    try { return target?.getActiveTokens?.()[0] ?? null; } catch (e) { return null; }
}

/**
 * Monk martial strikes: real attacks on the MA Strikes table through
 * the normal combat pipeline. OB = Hand to Hand / Martial Arts skill
 * bonus + the level-scaled bonus; hits doubled from level 51.
 */
async function martialStrikeAbility(actor, target, ability, notes) {
    if (!target) {
        notes.push(`<em>${esc(ability.name)}: no target.</em>`);
        return;
    }
    try {
        const { rollWeaponAttack } = await import("./combat-rolls.js");
        const scale = martialStrikeScaleForLevel(actorLevel(actor));
        const synthetic = {
            _id: `ability-${ability.id || "strike"}`,
            id: `ability-${ability.id || "strike"}`,
            name: ability.name,
            type: "weapon",
            system: {
                type: "hand-to-hand",
                attackTable: "MA Strikes",
                obMod: 0,
                damageMod: 0,
                location: "equipped",
                equipped: true
            }
        };
        const token = targetTokenOf(target);
        const options = {
            obBonus: scale.obBonus,
            obBonusLabel: ability.name,
            ...(token ? { targetToken: token } : {})
        };
        if (scale.damageMultiplier > 1) {
            options.damageMultiplier = scale.damageMultiplier;
            options.damageMultiplierLabel = ability.name;
        }
        await rollWeaponAttack(actor, synthetic, options);
        notes.push(`<em>${esc(ability.name)} resolved on the MA Strikes table.</em>`);
    } catch (e) {
        console.error("EQRMSS | Martial strike failed", e);
        notes.push(`<em>${esc(ability.name)} failed to resolve.</em>`);
    }
}

/**
 * The actor's readied weapon for Backstab: the current bandolier
 * set's right hand, then left, then any worn weapon.
 */
async function readiedWeapon(actor) {
    const items = [...(actor?.items?.contents ?? actor?.items ?? [])];
    const byId = (id) => items.find(i => i.id === id || i._id === id) ?? null;
    try {
        const band = actor?.getFlag?.("eqrmss", "bandolier");
        const set = band?.sets?.[Number(band?.current) || 0];
        for (const id of [set?.right, set?.left]) {
            const it = id ? byId(id) : null;
            if (it) return it;
        }
    } catch (e) { /* fall through to the worn scan */ }
    try {
        const { isWorn } = await import("../utils/equipment/equipment-utils.js");
        return items.find(i => isWorn(i) && (i.system?.attackTable || i.type === "weapon")) ?? null;
    } catch (e) { return null; }
}

/**
 * Backstab: the rogue's readied-weapon attack with a level-scaled
 * OB bonus and damage multiplier (user ruling 2026-10-21).
 */
async function backstabAbility(actor, target, ability, notes) {
    if (!target) {
        notes.push(`<em>${esc(ability.name)}: no target.</em>`);
        return;
    }
    const weapon = await readiedWeapon(actor);
    if (!weapon) {
        notes.push(`<em>${esc(ability.name)}: no readied weapon.</em>`);
        try { ui?.notifications?.warn?.(`EQRMSS | ${ability.name}: no readied weapon.`); } catch (e) {}
        return;
    }
    try {
        const { rollWeaponAttack } = await import("./combat-rolls.js");
        const scale = backstabScaleForLevel(actorLevel(actor));
        const token = targetTokenOf(target);
        await rollWeaponAttack(actor, weapon, {
            obBonus: scale.obBonus,
            obBonusLabel: "backstab",
            damageMultiplier: scale.damageMultiplier,
            damageMultiplierLabel: "backstab",
            ...(token ? { targetToken: token } : {})
        });
        notes.push(`<em>${esc(actor.name)} backstabs with ${esc(weapon.name)} (+${scale.obBonus} OB, x${scale.damageMultiplier} hits).</em>`);
    } catch (e) {
        console.error("EQRMSS | Backstab failed", e);
        notes.push(`<em>${esc(ability.name)} failed to resolve.</em>`);
    }
}

/**
 * Extra attack abilities: grant additional attacks this round.
 */
async function extraAttackAbility(actor, ability, notes, count) {
    try {
        const status = actor.system?.status ?? {};
        const cur = Number(status.extraAttacks) || 0;
        await actor.update({ "system.status.extraAttacks": cur + count });
        notes.push(`<em>${esc(actor.name)} gains ${count} extra attack${count > 1 ? "s" : ""} (${esc(ability.name)}).</em>`);
    } catch (e) {
        console.error("EQRMSS | Extra attack ability failed", e);
    }
}

/**
 * Defensive abilities: block, evade, riposte.
 */
async function defensiveAbility(actor, ability, notes, type) {
    try {
        const status = actor.system?.status ?? {};
        const buffs = Array.isArray(status.disciplineBuffs) ? status.disciplineBuffs : [];
        const duration = 1; // Until next round
        
        const targets = {
            block: { target: "db", value: 20 },
            evade: { target: "db", value: 15 },
            riposte: { target: "riposte", value: 1 }
        };
        const mod = targets[type] || { target: "db", value: 10 };
        
        buffs.push({
            source: ability.name,
            target: mod.target,
            value: mod.value,
            expiresRound: (game.combat?.round || 0) + duration
        });
        await actor.update({ "system.status.disciplineBuffs": buffs });
        notes.push(`<em>${esc(actor.name)} uses ${esc(ability.name)} (+${mod.value} ${mod.target}).</em>`);
    } catch (e) {
        console.error("EQRMSS | Defensive ability failed", e);
    }
}

/**
 * Taunt/Provoke: generate hate on target.
 */
async function tauntAbility(actor, target, ability, notes) {
    if (!target) {
        notes.push(`<em>${esc(ability.name)}: no target.</em>`);
        return;
    }
    try {
        const aggro = target.system?.status?.aggro ?? {};
        const key = String(actor.id);
        const existing = aggro[key] ?? { damage: 0, debuffs: 0, heal: 0, lastRound: 0, name: String(actor.name ?? "unknown") };
        const hateAmount = 50; // Base taunt hate
        aggro[key] = {
            damage: (Number(existing.damage) || 0) + hateAmount,
            debuffs: Number(existing.debuffs) || 0,
            heal: Number(existing.heal) || 0,
            lastRound: game.combat?.round || 0,
            name: String(actor.name ?? existing.name ?? "unknown")
        };
        await target.update({ "system.status.aggro": aggro });
        notes.push(`<em>${esc(actor.name)} taunts ${esc(target.name)} (+${hateAmount} hate).</em>`);
    } catch (e) {
        console.error("EQRMSS | Taunt failed", e);
    }
}
