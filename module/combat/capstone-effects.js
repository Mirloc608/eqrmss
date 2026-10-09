/**
 * Era Capstone Effects (Phase 2, 2026-10-09)
 *
 * Executes the mechanical effects of capstone abilities.
 * Each capstone has a `mechanics` object in its JSON defining what it does.
 *
 * Mechanics types:
 * - damage: Instant direct damage to target
 * - heal: Instant healing to target (usually self)
 * - lifetap: Damage to target + heal caster by % of damage dealt
 * - buff: Timed stat/DB/OB/etc bonuses (via spellEffects with source "capstone")
 * - debuff: Timed penalties to target
 * - dot: Damage over time (via system.status.dots)
 * - regen: Heal over time (via system.status.spellEffects kind "regen")
 * - defensive: Immunities and damage reduction
 * - utility: Teleport, invis, feign death, etc.
 * - special: Unique mechanics handled individually
 *
 * RMSS mapping: EQ percentages ÷10 for stats (min 1), AC 1:1 to DB.
 * Damage formulas use "level" variable (caster level).
 * Durations: 1 minute = 10 rounds.
 */

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

/**
 * Evaluate a damage/heal formula with variable substitution.
 * Supports: "500 + (level × 10)", "currentHP * 0.5", "currentMana * 2", etc.
 * Variables: level, currentHP, currentMana, maxHP, maxMana
 */
export function evalFormula(formula, actor) {
    if (typeof formula === "number") return formula;
    if (!formula) return 0;
    const level = Number(actor.system?.attributes?.level?.value) || 1;
    const currentHP = (Number(actor.system?.hits?.max) || 0) - (Number(actor.system?.hits?.value) || 0);
    const maxHP = Number(actor.system?.hits?.max) || 0;
    const currentMana = Number(actor.system?.attributes?.mana?.value) || 0;
    const maxMana = Number(actor.system?.attributes?.mana?.max) || 0;
    
    let expr = String(formula)
        .replace(/×/g, "*")
        .replace(/\blevel\b/g, String(level))
        .replace(/\bcurrentHP\b/g, String(currentHP))
        .replace(/\bmaxHP\b/g, String(maxHP))
        .replace(/\bcurrentMana\b/g, String(currentMana))
        .replace(/\bmaxMana\b/g, String(maxMana))
        .replace(/[^0-9+\-*/(). ]/g, "");
    try {
        const val = Function(`"use strict"; return (${expr})`)();
        return Math.max(0, Math.floor(Number(val) || 0));
    } catch {
        return 0;
    }
}

/**
 * Apply direct damage to a target actor.
 * Increases system.hits.value (concussion hits taken).
 */
export async function applyCapstoneDamage(target, amount, damageType = "magic", notes = []) {
    if (!target || amount <= 0) return 0;
    const cur = Number(target.system?.hits?.value) || 0;
    const newVal = cur + amount;
    await target.update({ "system.hits.value": newVal });
    notes.push(`${esc(target.name)} takes ${amount} ${esc(damageType)} damage (${newVal} concussion hits).`);
    return amount;
}

/**
 * Apply direct healing to a target actor.
 * Decreases system.hits.value (concussion hits taken), min 0.
 */
export async function applyCapstoneHeal(target, amount, notes = []) {
    if (!target || amount <= 0) return 0;
    const cur = Number(target.system?.hits?.value) || 0;
    const healed = Math.min(cur, amount);
    await target.update({ "system.hits.value": cur - healed });
    notes.push(`${esc(target.name)} heals ${healed} hits (${cur - healed} concussion hits remaining).`);
    return healed;
}

/**
 * Apply a timed buff via spellEffects (source "capstone").
 * Modifiers: [{target: "db"|"ob"|"stat"|"haste"|"slow"|"resist-<elem>", stat?: "st", value: N}]
 * Duration in rounds.
 */
export async function applyCapstoneBuff(target, capstone, modifiers, durationRounds, notes = []) {
    if (!target || !modifiers?.length) return;
    
    const fx = [...(target.system?.status?.spellEffects || [])];
    const now = Date.now();
    // Convert rounds to ms for expiry (1 round = 6 seconds)
    // Actually spellEffects use rounds directly in the tick system
    const capstoneId = capstone.id;
    
    for (const mod of modifiers) {
        const entry = {
            source: "capstone",
            capstoneId,
            capstoneName: capstone.name,
            scaledTarget: mod.target,
            scaledStat: mod.stat || null,
            scaledValue: mod.value,
            durationRounds,
            startRound: game.combat?.round ?? 0,
            // For compatibility with spell buff display
            name: capstone.name,
            kind: "buff",
        };
        fx.push(entry);
        
        let desc = "";
        if (mod.target === "db") desc = `Defense +${mod.value}`;
        else if (mod.target === "ob") desc = `OB +${mod.value}`;
        else if (mod.target === "stat" && mod.stat) desc = `${mod.stat.toUpperCase()} +${mod.value}`;
        else if (mod.target === "haste") desc = `Haste +${mod.value}%`;
        else if (mod.target === "slow") desc = `Slow ${mod.value}%`;
        else if (mod.target.startsWith("resist-")) desc = `${mod.target.slice(7)} resist +${mod.value}`;
        else desc = `${mod.target} +${mod.value}`;
        
        notes.push(`${esc(target.name)}: ${desc} (${durationRounds} rounds).`);
    }
    
    await target.update({ "system.status.spellEffects": fx });
}

/**
 * Apply damage-over-time via system.status.dots.
 */
export async function applyCapstoneDoT(target, capstone, tickAmount, numTicks, damageType = "magic", notes = []) {
    if (!target || tickAmount <= 0 || numTicks <= 0) return;
    
    const dots = [...(target.system?.status?.dots || [])];
    dots.push({
        source: "capstone",
        capstoneId: capstone.id,
        name: capstone.name,
        amount: tickAmount,
        ticksRemaining: numTicks,
        damageType,
    });
    await target.update({ "system.status.dots": dots });
    notes.push(`${esc(target.name)}: ${tickAmount} ${esc(damageType)} damage for ${numTicks} rounds.`);
}

/**
 * Apply regeneration (heal over time) via spellEffects kind "regen".
 */
export async function applyCapstoneRegen(target, capstone, tickAmount, numTicks, notes = []) {
    if (!target || tickAmount <= 0 || numTicks <= 0) return;
    
    const fx = [...(target.system?.status?.spellEffects || [])];
    fx.push({
        source: "capstone",
        capstoneId: capstone.id,
        capstoneName: capstone.name,
        name: capstone.name,
        kind: "regen",
        scaledTarget: "hits",
        scaledValue: tickAmount,
        durationRounds: numTicks,
        startRound: game.combat?.round ?? 0,
    });
    await target.update({ "system.status.spellEffects": fx });
    notes.push(`${esc(target.name)}: regenerates ${tickAmount} hits/round for ${numTicks} rounds.`);
}

/**
 * Main entry point: execute a capstone's mechanics.
 * @param {Actor} caster - The actor using the capstone
 * @param {Object} capstone - The capstone data (with mechanics object)
 * @param {Actor} target - The target (may be null for self-only)
 * @returns {string[]} - Array of HTML notes for the chat card
 */
export async function executeCapstoneMechanics(caster, capstone, target = null) {
    const notes = [];
    const mech = capstone.mechanics;
    
    if (!mech || !mech.type) {
        notes.push(`<em>${esc(capstone.name)} has no mechanical effect defined yet.</em>`);
        return notes;
    }
    
    const level = Number(caster.system?.attributes?.level?.value) || 1;
    const actualTarget = target || caster;
    
    switch (mech.type) {
        case "damage": {
            const amount = evalFormula(mech.formula, caster);
            await applyCapstoneDamage(actualTarget, amount, mech.damageType || "magic", notes);
            break;
        }
        
        case "heal": {
            const amount = evalFormula(mech.formula, caster);
            await applyCapstoneHeal(actualTarget, amount, notes);
            break;
        }
        
        case "lifetap": {
            const dmg = evalFormula(mech.damageFormula, caster);
            const dealt = await applyCapstoneDamage(actualTarget, dmg, mech.damageType || "magic", notes);
            const healPct = Number(mech.healPercent) || 100;
            const healAmt = Math.floor(dealt * healPct / 100);
            if (healAmt > 0) {
                await applyCapstoneHeal(caster, healAmt, notes);
            }
            break;
        }
        
        case "buff": {
            const duration = mech.durationRounds || 20;
            await applyCapstoneBuff(actualTarget, capstone, mech.modifiers, duration, notes);
            break;
        }
        
        case "debuff": {
            const duration = mech.durationRounds || 10;
            // Debuffs are negative buffs
            const negMods = (mech.modifiers || []).map(m => ({ ...m, value: -Math.abs(m.value) }));
            await applyCapstoneBuff(actualTarget, capstone, negMods, duration, notes);
            break;
        }
        
        case "dot": {
            const tick = evalFormula(mech.tickFormula, caster);
            const ticks = mech.ticks || 5;
            await applyCapstoneDoT(actualTarget, capstone, tick, ticks, mech.damageType || "magic", notes);
            break;
        }
        
        case "regen": {
            const tick = evalFormula(mech.tickFormula, caster);
            const ticks = mech.ticks || 10;
            await applyCapstoneRegen(actualTarget, capstone, tick, ticks, notes);
            break;
        }
        
        case "defensive": {
            // Immunities and damage reduction - store as a buff-like effect
            const duration = mech.durationRounds || 20;
            const mods = [];
            if (mech.immunities?.length) {
                for (const imm of mech.immunities) {
                    mods.push({ target: `immunity-${imm}`, value: 1 });
                }
            }
            if (mech.damageReduction) {
                mods.push({ target: "damage-reduction", value: mech.damageReduction });
            }
            if (mods.length) {
                await applyCapstoneBuff(actualTarget, capstone, mods, duration, notes);
            }
            break;
        }
        
        case "utility":
            notes.push(`<em>${esc(capstone.name)}: ${esc(mech.description || "Utility effect.")}</em>`);
            // TODO: Implement specific utility actions (teleport, invis, feign)
            break;
            
        case "special":
            notes.push(`<em>${esc(capstone.name)}: Special mechanics not yet implemented.</em>`);
            // TODO: Implement Headshot, Decapitation, etc.
            break;
            
        default:
            notes.push(`<em>Unknown mechanics type: ${esc(mech.type)}</em>`);
    }
    
    return notes;
}
