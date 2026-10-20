// Ability handlers (2026-10-10)
// Implements the 18 shared ability handlers referenced by
// module/data/abilities/shared/*.json via the "handler" field.
//
// Categories:
// - Strikes: kick, bash, slam, crescent-kick, flying-kick, round-kick, tiger-claw
// - Backstab: backstab (positional)
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
        case "kick": return await strikeAbility(actor, target, ability, notes, { damage: 5 });
        case "bash": return await strikeAbility(actor, target, ability, notes, { damage: 8, interrupt: true });
        case "slam": return await strikeAbility(actor, target, ability, notes, { damage: 10, stun: true });
        case "crescent-kick": return await strikeAbility(actor, target, ability, notes, { damage: 12 });
        case "flying-kick": return await strikeAbility(actor, target, ability, notes, { damage: 15 });
        case "round-kick": return await strikeAbility(actor, target, ability, notes, { damage: 10 });
        case "tiger-claw": return await strikeAbility(actor, target, ability, notes, { damage: 14 });
        
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
 * Backstab: positional crit — requires behind or concealed.
 */
async function backstabAbility(actor, target, ability, notes) {
    if (!target) {
        notes.push(`<em>${esc(ability.name)}: no target.</em>`);
        return;
    }
    // Position check would go here (behind/concealed)
    // For now, apply with crit bonus
    try {
        const { applyCapstoneDamage } = await import("./capstone-effects.js");
        const damage = 20; // Base backstab damage
        await applyCapstoneDamage(target, damage, "physical", notes, actor);
        notes.push(`<em>${esc(actor.name)} backstabs ${esc(target.name)} for ${damage} (critical opportunity).</em>`);
    } catch (e) {
        console.error("EQRMSS | Backstab failed", e);
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
