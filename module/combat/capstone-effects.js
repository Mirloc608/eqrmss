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
 * - triggered: Conditional effects (when X happens, apply Y)
 *
 * Triggered mechanics schema:
 * {
 *   "type": "triggered",
 *   "durationRounds": 20,
 *   "trigger": { "event": "spellCast", "spellTypes": ["mez", "stun"], "chance": 100 },
 *   "effect": { "type": "buff", "target": "group", "durationRounds": 5,
 *               "modifiers": [{"target": "ob", "value": 2}] }
 * }
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
    
    // Era Capstones (2026-10-09): check for vulnerability modifiers on target.
    // vuln-<type> increases damage taken by X% (e.g., vuln-cold 20 = +20% cold damage).
    let vulnPct = 0;
    try {
        const effects = target.system?.status?.spellEffects || [];
        const dmgType = String(damageType).toLowerCase();
        for (const e of effects) {
            if (e.source !== "capstone") continue;
            const mods = e.modifiers || [];
            for (const m of mods) {
                const t = String(m.target || "").toLowerCase();
                if (t === `vuln-${dmgType}` || t === "vuln-all") {
                    vulnPct += Number(m.value) || 0;
                }
            }
            // Also check scaledTarget format
            const st = String(e.scaledTarget || "").toLowerCase();
            if (st === `vuln-${dmgType}` || st === "vuln-all") {
                vulnPct += Number(e.scaledValue) || 0;
            }
        }
    } catch (err) { /* non-fatal */ }
    
    let finalAmount = amount;
    if (vulnPct > 0) {
        finalAmount = Math.round(amount * (1 + vulnPct / 100));
        notes.push(`<em>${esc(target.name)} is vulnerable (+${vulnPct}% ${esc(damageType)} damage).</em>`);
    }
    
    const cur = Number(target.system?.hits?.value) || 0;
    const newVal = cur + finalAmount;
    await target.update({ "system.hits.value": newVal });
    notes.push(`${esc(target.name)} takes ${finalAmount} ${esc(damageType)} damage (${newVal} concussion hits).`);
    return finalAmount;
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
        else if (mod.target === "see-invisible") desc = `See invisible`;
        else desc = `${mod.target} +${mod.value}`;
        
        notes.push(`${esc(target.name)}: ${desc} (${durationRounds} rounds).`);

        // Era Capstones (2026-10-09): see-invisible sets the status flag.
        if (mod.target === "see-invisible") {
            try {
                await target.update({
                    "system.status.seeInvisible": {
                        roundsLeft: durationRounds,
                        source: `capstone:${capstone.name}`
                    }
                });
            } catch (e) { /* non-fatal */ }
        }

        // Era Capstones (2026-10-09): hp-max-pct increases max HP by percentage.
        if (mod.target === "hp-max-pct") {
            try {
                const pct = Number(mod.value) || 0;
                const currentMax = Number(target.system?.hits?.max) || 1;
                const bonus = Math.round((pct / 100) * currentMax);
                if (bonus > 0) {
                    await target.update({ "system.hits.max": currentMax + bonus });
                    // Store the bonus amount for restoration on expiry
                    entry.hpMaxBonus = bonus;
                    notes.push(`${esc(target.name)}: Max HP +${bonus} (${pct}%).`);
                }
            } catch (e) { /* non-fatal */ }
        }
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

        case "triggered": {
            const duration = mech.durationRounds || 20;
            // Remove any existing triggers from the same capstone (prevent stacking)
            const triggers = (caster.system?.status?.triggers || [])
                .filter(t => !(t.source === "capstone" && t.capstoneId === capstone.id));
            triggers.push({
                source: "capstone",
                capstoneId: capstone.id,
                capstoneName: capstone.name,
                trigger: mech.trigger || {},
                effect: mech.effect || {},
                expiresRound: (game.combat?.round ?? 0) + duration,
            });
            await caster.update({ "system.status.triggers": triggers });
            notes.push(`${esc(caster.name)}: ${esc(capstone.name)} trigger active for ${duration} rounds.`);
            break;
        }
            
        case "special":
            notes.push(`<em>${esc(capstone.name)}: Special mechanics not yet implemented.</em>`);
            // TODO: Implement Headshot, Decapitation, etc.
            break;

        case "equalize": {
            // Balance group's HP: set all to average HP%, with a minimum floor.
            const combatants = game.combat?.combatants ?? [];
            const allies = combatants
                .filter(c => c.actor)
                .map(c => c.actor);
            if (!allies.includes(caster)) allies.unshift(caster);

            // Calculate average HP% (clamped 0-100)
            let totalPct = 0;
            const hpData = [];
            for (const a of allies) {
                const max = Number(a.system?.hits?.max) || 1;
                const cur = max - (Number(a.system?.hits?.value) || 0);
                const pct = Math.max(0, Math.min(100, (cur / max) * 100));
                totalPct += pct;
                hpData.push({ actor: a, max });
            }
            const avgPct = totalPct / hpData.length;
            const minFloor = mech.minFloorPct || 50;
            const targetPct = Math.max(avgPct, minFloor);

            // Set all to target HP%
            for (const { actor: a, max } of hpData) {
                const newCur = Math.round((targetPct / 100) * max);
                const newValue = max - newCur; // hits.value is damage taken
                await a.update({ "system.hits.value": Math.max(0, newValue) });
            }
            if (targetPct > avgPct) {
                notes.push(`Group HP balanced to ${Math.round(avgPct)}%, then healed to ${minFloor}% floor.`);
            } else {
                notes.push(`Group HP balanced to ${Math.round(avgPct)}%.`);
            }
            break;
        }

        case "memblur": {
            // Apply memory blur to all enemies: chance to forget the caster.
            const chance = mech.chance || 50;
            const { applyMemblur } = await import("../spells/memblur.js");
            const combatants = game.combat?.combatants ?? [];
            for (const c of combatants) {
                if (!c.actor || c.actor.id === caster.id) continue;
                const note = await applyMemblur(caster, c.actor, chance, capstone.name);
                if (note) notes.push(note);
            }
            break;
        }

        case "group-heal": {
            // Heal group for % of max HP + cure detrimental effects.
            const pct = mech.healPct || 50;
            const combatants = game.combat?.combatants ?? [];
            const allies = combatants
                .filter(c => c.actor)
                .map(c => c.actor);
            if (!allies.includes(caster)) allies.unshift(caster);

            for (const a of allies) {
                const max = Number(a.system?.hits?.max) || 1;
                const healAmount = Math.round((pct / 100) * max);
                const cur = Number(a.system?.hits?.value) || 0;
                await a.update({ "system.hits.value": Math.max(0, cur - healAmount) });
                notes.push(`${esc(a.name)} recovers ${healAmount} hits.`);

                // Cure detrimental effects if requested
                if (mech.cure) {
                    const dots = [...(a.system?.status?.dots || [])];
                    const spellEffects = [...(a.system?.status?.spellEffects || [])];
                    // Remove dots and debuffs from enemies (negative effects)
                    const cleanDots = dots.filter(d => d.source !== "enemy" && d.source !== "spell");
                    const cleanEffects = spellEffects.filter(e => {
                        // Keep buffs, remove debuffs
                        return e.source === "capstone" || e.source === "spell-buff" || !e.modifiers?.some(m => m.value < 0);
                    });
                    if (cleanDots.length !== dots.length || cleanEffects.length !== spellEffects.length) {
                        await a.update({
                            "system.status.dots": cleanDots,
                            "system.status.spellEffects": cleanEffects
                        });
                        notes.push(`${esc(a.name)}: detrimental effects cured.`);
                    }
                }
            }
            break;
        }
            
        default:
            notes.push(`<em>Unknown mechanics type: ${esc(mech.type)}</em>`);
    }
    
    return notes;
}

/**
 * Check and fire triggers for an actor on a game event.
 * @param {Actor} actor - The actor to check triggers for
 * @param {string} event - Event name (e.g., "spellCast")
 * @param {Object} data - Event data (e.g., {spellType: "mez", spell: spellItem})
 * @returns {string[]} - Notes for chat
 */
export async function checkCapstoneTriggers(actor, event, data = {}) {
    const notes = [];
    const triggers = [...(actor.system?.status?.triggers || [])];
    if (!triggers.length) return notes;
    
    const currentRound = game.combat?.round ?? 0;
    const remaining = [];
    let fired = false;
    
    for (const t of triggers) {
        // Expire old triggers
        if (t.expiresRound && currentRound > t.expiresRound) continue;
        if (t.source !== "capstone") {
            remaining.push(t);
            continue;
        }
        
        const trig = t.trigger || {};
        // Check event match
        if (trig.event !== event) {
            remaining.push(t);
            continue;
        }
        
        // Check spell type match (for spellCast events)
        if (event === "spellCast" && trig.spellTypes?.length) {
            const spellType = String(data.spellType || "").toLowerCase();
            const matched = trig.spellTypes.some(st => spellType.includes(st.toLowerCase()));
            if (!matched) {
                remaining.push(t);
                continue;
            }
        }
        
        // Check chance
        const chance = Number(trig.chance) || 100;
        if (chance < 100 && Math.random() * 100 >= chance) {
            remaining.push(t);
            continue;
        }
        
        // Fire the trigger!
        fired = true;
        const effect = t.effect || {};
        const targetType = effect.target || "self";
        
        // Determine targets
        let targets = [actor];
        if (targetType === "group") {
            // Group = all allies (for now, just the caster's allies in combat)
            // TODO: Proper group detection
            const combatants = game.combat?.combatants ?? [];
            targets = combatants
                .filter(c => c.actor && c.actor.id !== actor.id)
                .map(c => c.actor);
            targets.unshift(actor); // Include caster
        } else if (targetType === "spell-target" && data.spellTarget) {
            // Use the spell's target (for duplicate heal, etc.)
            targets = [data.spellTarget];
        }
        
        // Apply the effect to each target
        for (const tgt of targets) {
            if (effect.type === "buff" && effect.modifiers?.length) {
                const duration = effect.durationRounds || 5;
                // Create a pseudo-capstone for the buff application
                const pseudoCap = { id: t.capstoneId, name: t.capstoneName };
                const tNotes = [];
                await applyCapstoneBuff(tgt, pseudoCap, effect.modifiers, duration, tNotes);
                notes.push(...tNotes);
            } else if (effect.type === "heal" && data.healAmount > 0) {
                // Duplicate heal: apply the same amount again
                const cur = Number(tgt.system?.hits?.value) || 0;
                const restored = Math.min(data.healAmount, cur);
                await tgt.update({ "system.hits.value": cur - restored });
                notes.push(`<em>${esc(t.capstoneName)} triggers! ${esc(tgt.name)} recovers ${restored} additional hits.</em>`);
            }
        }
        
        if (trig.consumes !== false) {
            // Trigger is consumed after firing (default)
            // Don't add back to remaining
        } else {
            remaining.push(t);
        }
        
        notes.push(`<em>${esc(t.capstoneName)} triggers!</em>`);
    }
    
    if (fired || remaining.length !== triggers.length) {
        await actor.update({ "system.status.triggers": remaining });
    }
    
    return notes;
}
