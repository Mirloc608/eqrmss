// ============================================================
// EQRMSS Warder Buffs (2026-10-08)
//
// Beastlord "Spirit of X" and "X at the Moon" spells no longer summon;
// they buff the beastlord's active warder (or pet).
//
// Buff tiers (scaled by spell level):
// - Tier 1 (L8-L21):   +10% hits/OB/DB
// - Tier 2 (L30-L46):  +15% hits/OB/DB, +1 crit step
// - Tier 3 (L54-L70):  +20% hits/OB/DB, +2 crit steps
// - Tier 4 (L73-L93):  +25% hits/OB/DB, +3 crit steps, +1 attack
// - Tier 5 (L98-L125): +30% hits/OB/DB, +4 crit steps, +1 attack, attack upgrade
//
// Crit steps expand the pet's critical range in pet-combat.js.
// Bonus attacks grant additional attacks per round.
// Attack upgrade improves the pet's attack table.
// ============================================================

const MODULE_ID = "eqrmss";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

/**
 * Find the caster's active pet (warder).
 * @param {object} caster - Caster actor
 * @returns {object|null} Pet actor or null
 */
function findCasterPet(caster) {
    if (!caster) return null;
    const ownerId = caster.id;
    try {
        const pets = (globalThis.game?.actors ?? []).filter(a =>
            a?.type === "pet" &&
            (a?.system?.pet?.owner === ownerId || a?.getFlag(MODULE_ID, "ownerId") === ownerId)
        );
        return pets[0] ?? null;
    } catch { return null; }
}

/**
 * Apply a warder-buff effect to the caster's active pet.
 *
 * @param {object} caster - The beastlord (caster) actor
 * @param {object} eff - The warder-buff effect from spell data
 * @param {string} spellName - Name of the spell for messaging
 * @returns {Promise<string>} HTML note for the chat card
 */
export async function applyWarderBuff(caster, eff, spellName) {
    const pet = findCasterPet(caster);
    if (!pet) {
        return `<p><em>${esc(spellName)} fizzles — ${esc(caster?.name ?? "caster")} has no active warder to empower.</em></p>`;
    }

    const tier = Number(eff?.tier) || 1;
    const hitsPct = Number(eff?.hitsPct) || 0;
    const obPct = Number(eff?.obPct) || 0;
    const dbPct = Number(eff?.dbPct) || 0;
    const critSteps = Number(eff?.critSteps) || 0;
    const bonusAttacks = Number(eff?.bonusAttacks) || 0;
    const attackUpgrade = Boolean(eff?.attackUpgrade);

    const updates = {};
    const buffNotes = [];

    try {
        // Hits: increase max by percentage
        const currentMax = Number(pet.system?.hits?.max) || 0;
        if (hitsPct > 0 && currentMax > 0) {
            const bonus = Math.floor(currentMax * hitsPct / 100);
            const newMax = currentMax + bonus;
            updates["system.hits.max"] = newMax;
            // Heal the bonus amount too (warrior's vigor)
            const currentValue = Number(pet.system?.hits?.value) || 0;
            updates["system.hits.value"] = Math.min(currentValue + bonus, newMax);
            buffNotes.push(`+${bonus} hits`);
        }

        // OB: increase scaling.ob by percentage
        const currentOB = Number(pet.system?.pet?.scaling?.ob) || 0;
        if (obPct > 0 && currentOB > 0) {
            const bonus = Math.max(1, Math.floor(currentOB * obPct / 100));
            updates["system.pet.scaling.ob"] = currentOB + bonus;
            buffNotes.push(`+${bonus} OB`);
        }

        // DB: increase scaling.defense by percentage
        const currentDB = Number(pet.system?.pet?.scaling?.defense) || 0;
        if (dbPct > 0 && currentDB > 0) {
            const bonus = Math.max(1, Math.floor(currentDB * dbPct / 100));
            updates["system.pet.scaling.defense"] = currentDB + bonus;
            buffNotes.push(`+${bonus} DB`);
        }

        // Crit steps, bonus attacks, attack upgrade: store in system.pet.buffs
        // These are read by pet-combat.js during attacks.
        const existingBuffs = pet.system?.pet?.buffs ?? {};
        updates["system.pet.buffs"] = {
            ...existingBuffs,
            tier,
            critSteps: Math.max(Number(existingBuffs.critSteps) || 0, critSteps),
            bonusAttacks: Math.max(Number(existingBuffs.bonusAttacks) || 0, bonusAttacks),
            attackUpgrade: Boolean(existingBuffs.attackUpgrade) || attackUpgrade,
            source: spellName ?? "",
        };
        if (critSteps > 0) buffNotes.push(`crit range +${critSteps}`);
        if (bonusAttacks > 0) buffNotes.push(`+${bonusAttacks} attack`);
        if (attackUpgrade) buffNotes.push(`improved attacks`);

        await pet.update(updates);
    } catch (err) {
        console.warn("EQRMSS | applyWarderBuff failed:", err);
        return `<p><em>${esc(spellName)} failed to empower ${esc(pet.name)}.</em></p>`;
    }

    const buffText = buffNotes.length ? ` (${buffNotes.join(", ")})` : "";
    return `<p><em>${esc(caster.name)}'s ${esc(pet.name)} is empowered by ${esc(spellName)}${buffText}.</em></p>`;
}
