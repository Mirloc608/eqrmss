// Discipline mechanical effects (2026-10-10)
// Maps EQ discipline effect types to RMSS mechanics.
// EQ-specific types (HATE_*, SHIELDING, ABSORB_*) are noted
// but not implemented — they need user rulings.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

/**
 * Apply a discipline's mechanical effects.
 * @param {Actor} actor - The actor activating the discipline.
 * @param {object} disc - The discipline data (name, effects, durationRounds).
 * @param {Array} notes - Chat notes array to append to.
 */
export async function applyDisciplineEffects(actor, disc, notes = []) {
    if (!actor || !disc) return;
    
    const effects = Array.isArray(disc.effects) ? disc.effects : [];
    const duration = Number(disc.durationRounds) || 10;
    
    for (const eff of effects) {
        const type = String(eff.type || "").toUpperCase();
        const value = Number(eff.value) || 0;
        
        switch (type) {
            // Direct damage
            case "STRIKE_DAMAGE":
            case "DIRECT_DAMAGE": {
                notes.push(`<em>${esc(disc.name)}: ${value} strike damage.</em>`);
                break;
            }
            
            // OB / Accuracy
            case "ACCURACY_BONUS":
            case "OB_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "ob", value }], duration, notes);
                break;
            }
            
            // DB / Defense
            case "AC_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "db", value }], duration, notes);
                break;
            }
            case "DODGE_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "db", value }], duration, notes);
                break;
            }
            
            // Damage bonuses
            case "DAMAGE_BONUS":
            case "FLAT_DAMAGE_BONUS":
            case "MIN_DAMAGE_BONUS":
            case "MINIMUM_DAMAGE_BONUS":
            case "SKILL_DAMAGE_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "damageBonus", value }], duration, notes);
                break;
            }
            
            // Critical
            case "CRITICAL_BONUS":
            case "CRITICAL_HIT_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "critBonus", value }], duration, notes);
                break;
            }
            
            // Regeneration
            case "REGENERATION": {
                await applyDisciplineBuff(actor, disc, [{ target: "regen", value }], duration, notes);
                break;
            }
            case "ENDURANCE_REGENERATION":
            case "ENDURANCE_REGEN": {
                await applyDisciplineBuff(actor, disc, [{ target: "enduranceRegen", value }], duration, notes);
                break;
            }
            case "ENDURANCE_RESTORE": {
                try {
                    const cur = Number(actor.system?.attributes?.endurance?.value) || 0;
                    const max = Number(actor.system?.attributes?.endurance?.max) || 100;
                    await actor.update({ "system.attributes.endurance.value": Math.min(max, cur + value) });
                    notes.push(`<em>${esc(disc.name)} restores ${value} endurance.</em>`);
                } catch (e) { /* ignore */ }
                break;
            }
            
            // Mitigation
            case "MELEE_MITIGATION": {
                await applyDisciplineBuff(actor, disc, [{ target: "meleeMitigation", value }], duration, notes);
                break;
            }
            
            // Haste
            case "HASTE_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "haste", value }], duration, notes);
                break;
            }
            
            // Resistances
            case "RESIST_ALL":
            case "MENTAL_RESISTANCE": {
                await applyDisciplineBuff(actor, disc, [{ target: "resistAll", value }], duration, notes);
                break;
            }
            
            // Fear immunity
            case "FEAR_IMMUNITY": {
                await applyDisciplineBuff(actor, disc, [{ target: "fearImmune", value: 1 }], duration, notes);
                break;
            }
            
            // Archery
            case "ARCHERY_HIT_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "missileOb", value }], duration, notes);
                break;
            }
            case "ARCHERY_DAMAGE_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "missileDamage", value }], duration, notes);
                break;
            }
            
            // Backstab
            case "BACKSTAB_HIT_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "backstabOb", value }], duration, notes);
                break;
            }
            case "BACKSTAB_DAMAGE_BONUS":
            case "BACKSTAB_MINIMUM_DAMAGE_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "backstabDamage", value }], duration, notes);
                break;
            }
            case "BACKSTAB_CRITICAL_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "backstabCrit", value }], duration, notes);
                break;
            }
            
            // Riposte
            case "RIPOSTE_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "riposte", value }], duration, notes);
                break;
            }
            
            // Death threshold
            case "DEATH_THRESHOLD_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "deathThreshold", value }], duration, notes);
                break;
            }
            
            // Absorb (uses existing system.status.absorb pool)
            case "MELEE_ABSORB":
            case "ABSORB_HITS":
            case "SHIELDING": {
                try {
                    const cur = Number(actor.system?.status?.absorb?.value) || 0;
                    await actor.update({ "system.status.absorb.value": cur + value });
                    notes.push(`<em>${esc(disc.name)}: absorbs ${value} damage.</em>`);
                } catch (e) { /* ignore */ }
                break;
            }
            
            // Hate / Aggro (uses system.status.aggro on targets)
            case "HATE_BONUS": {
                await addHateToEnemies(actor, value, disc, notes);
                break;
            }
            case "HATE_PER_TICK": {
                const total = value * duration;
                await addHateToEnemies(actor, total, disc, notes);
                break;
            }
            case "HATE_GENERATION_BONUS": {
                await applyDisciplineBuff(actor, disc, [{ target: "hateGenBonus", value }], duration, notes);
                break;
            }
            case "AGGRO_LOCK": {
                await aggroLockEnemies(actor, disc, duration, notes);
                break;
            }
            
            // EQ-specific: note but don't implement (need rulings)
            case "RUNE_PROC":
            case "SOCIAL_RADIUS_REDUCTION":
            case "AGGRO_RADIUS_REDUCTION":
            case "HIT_LIMIT":
            case "ENDURANCE_CAP":
            case "WEAPON_DELAY_PENALTY":
            case "PROC_RATE_BONUS":
            case "VINDICATION":
            case "POISON_DAMAGE_BONUS":
            case "ARCHERY_VULNERABILITY":
            case "DEFENSIVE_PROC":
            case "STUN_PROC":
            case "DEFENSIVE_LIFEDRAW":
            case "HEAL_ON_FADE":
            case "MELEE_AVOIDANCE": {
                notes.push(`<em>${esc(disc.name)}: ${type} (${value}) — EQ-specific, not yet implemented.</em>`);
                break;
            }
            
            default: {
                notes.push(`<em>${esc(disc.name)}: unhandled effect ${type} (${value}).</em>`);
                break;
            }
        }
    }
}

/**
 * Add hate to all hostile combatants' aggro tables.
 * Follows the memblur.js aggro structure.
 */
async function addHateToEnemies(actor, amount, disc, notes) {
    try {
        // Apply hate generation bonus (percentage) if active
        const discBuffs = actor.system?.status?.disciplineBuffs ?? [];
        let hateBonusPct = 0;
        for (const b of discBuffs) {
            if (b.target === "hateGenBonus") hateBonusPct += Number(b.value) || 0;
        }
        const finalAmount = Math.round(amount * (1 + hateBonusPct / 100));
        
        const combatants = game.combat?.combatants ?? [];
        let count = 0;
        for (const c of combatants) {
            if (!c.actor || c.actor.id === actor.id) continue;
            // Only hostile targets (different disposition)
            const actorDisp = actor.token?.disposition ?? 0;
            const targetDisp = c.token?.disposition ?? 0;
            if (actorDisp === targetDisp) continue;
            
            const aggro = c.actor.system?.status?.aggro ?? {};
            const key = String(actor.id);
            const existing = aggro[key] ?? { damage: 0, debuffs: 0, heal: 0, lastRound: 0, name: String(actor.name ?? "unknown") };
            aggro[key] = {
                damage: (Number(existing.damage) || 0) + finalAmount,
                debuffs: Number(existing.debuffs) || 0,
                heal: Number(existing.heal) || 0,
                lastRound: game.combat?.round || 0,
                name: String(actor.name ?? existing.name ?? "unknown")
            };
            await c.actor.update({ "system.status.aggro": aggro });
            count++;
        }
        const bonusNote = hateBonusPct ? ` (${hateBonusPct}% bonus)` : "";
        notes.push(`<em>${esc(disc.name)}: +${finalAmount} hate on ${count} enemies${bonusNote}.</em>`);
    } catch (e) {
        console.error("EQRMSS | Discipline hate failed", e);
    }
}

/**
 * Aggro lock: ensure the actor is #1 on each hostile's hate list.
 * Sets their damage to 1 above the current max.
 */
async function aggroLockEnemies(actor, disc, duration, notes) {
    try {
        const combatants = game.combat?.combatants ?? [];
        let count = 0;
        for (const c of combatants) {
            if (!c.actor || c.actor.id === actor.id) continue;
            const actorDisp = actor.token?.disposition ?? 0;
            const targetDisp = c.token?.disposition ?? 0;
            if (actorDisp === targetDisp) continue;
            
            const aggro = c.actor.system?.status?.aggro ?? {};
            // Find current max threat
            let maxThreat = 0;
            for (const entry of Object.values(aggro)) {
                const threat = (Number(entry.damage) || 0) + (Number(entry.heal) || 0);
                if (threat > maxThreat) maxThreat = threat;
            }
            
            const key = String(actor.id);
            const existing = aggro[key] ?? { damage: 0, debuffs: 0, heal: 0, lastRound: 0, name: String(actor.name ?? "unknown") };
            aggro[key] = {
                damage: maxThreat + 1,
                debuffs: Number(existing.debuffs) || 0,
                heal: Number(existing.heal) || 0,
                lastRound: game.combat?.round || 0,
                name: String(actor.name ?? existing.name ?? "unknown")
            };
            await c.actor.update({ "system.status.aggro": aggro });
            count++;
        }
        notes.push(`<em>${esc(disc.name)}: aggro locked on ${count} enemies for ${duration} rounds.</em>`);
    } catch (e) {
        console.error("EQRMSS | Discipline aggro lock failed", e);
    }
}

async function applyDisciplineBuff(actor, disc, modifiers, duration, notes) {
    try {
        const status = actor.system?.status ?? {};
        const discBuffs = Array.isArray(status.disciplineBuffs) ? status.disciplineBuffs : [];
        
        for (const mod of modifiers) {
            discBuffs.push({
                source: disc.name,
                target: mod.target,
                value: mod.value,
                expiresRound: (game.combat?.round || 0) + duration
            });
        }
        
        await actor.update({ "system.status.disciplineBuffs": discBuffs });
        
        const modText = modifiers.map(m => `${m.target} ${m.value >= 0 ? "+" : ""}${m.value}`).join(", ");
        notes.push(`<em>${esc(disc.name)}: ${modText} for ${duration} rounds.</em>`);
    } catch (e) {
        console.error("EQRMSS | Discipline buff failed", e);
    }
}
