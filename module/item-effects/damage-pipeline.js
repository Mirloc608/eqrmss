/**
 * EQRMSS Shared Effect-Resolution Pipeline
 *
 * The single choke point for item-effect payloads (proc, worn, triggered).
 * Future spellcasting resolves through this same pipeline, which is what
 * makes a proc behave "as if the player were casting" without duplicating
 * spell logic or wiring into the spell catalog.
 *
 * Per damage payload, in order:
 *   1. immunity   -> damage negated
 *   2. weakness   -> damage multiplied
 *   3. resistance -> damage reduced
 *   4. apply      -> remainder added to the target's concussion hits taken
 *
 * Target modifiers are read from conventional optional paths on
 * target.system; anything absent is neutral:
 *   system.immunities  -> ["cold", ...]
 *   system.weaknesses  -> { cold: 2, ... }   (damage multiplier)
 *   system.resistances -> { cold: 10, ... }  (flat reduction, PLACEHOLDER)
 *
 * PLACEHOLDER: the resistance formula is pending the user's ruling on RMSS
 * resistance-roll mechanics. It currently subtracts flat; replace
 * applyResistance() when the RR rule lands.
 */

function rollRange(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function getTargetModifiers(target, element) {
    const sys = target?.system ?? {};
    const immunities = sys.immunities ?? [];
    const weaknesses = sys.weaknesses ?? {};
    const resistances = sys.resistances ?? {};
    return {
        immune: Array.isArray(immunities) && immunities.includes(element),
        weaknessMult: weaknesses[element] ?? 1,
        resist: resistances[element] ?? 0
    };
}

function applyResistance(rolled, resist) {
    // PLACEHOLDER — see header note.
    return Math.max(0, rolled - resist);
}

async function persistValue(target, path, value) {
    if (typeof target?.update === "function") {
        await target.update({ [path]: value });
    } else if (target?.system) {
        const parts = path.replace(/^system\./, "").split(".");
        let obj = target.system;
        for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
        obj[parts[parts.length - 1]] = value;
    }
}

async function applyDamage({ effect, target, source }) {
    const notes = [];
    const rolled = rollRange(effect.min ?? 0, effect.max ?? 0);
    const { immune, weaknessMult, resist } = getTargetModifiers(target, effect.element);

    let final = rolled;
    if (immune) {
        final = 0;
        notes.push(`immune to ${effect.element}`);
    } else {
        if (weaknessMult !== 1) {
            final = Math.round(final * weaknessMult);
            notes.push(`weakness x${weaknessMult} ${effect.element}`);
        }
        if (resist) {
            const before = final;
            final = applyResistance(final, resist);
            notes.push(`resisted ${before - final} ${effect.element}`);
        }
    }

    const taken = (target?.system?.hits?.value ?? 0) + final;
    await persistValue(target, "system.hits.value", taken);

    return { type: "damage", element: effect.element, rolled, final, notes, source };
}

async function applyRegen({ effect, target, source }) {
    const pool = effect.pool ?? "mana";
    const attr = target?.system?.attributes?.[pool];
    if (!attr) return { type: "regen", pool, final: 0, notes: [`no ${pool} pool on target`], source };
    const before = attr.value ?? 0;
    const next = Math.min(attr.max ?? Infinity, before + (effect.amount ?? 0));
    await persistValue(target, `system.attributes.${pool}.value`, next);
    return { type: "regen", pool, final: next - before, notes: [], source };
}

async function applyBuff({ effect, source }) {
    return { type: "buff", final: 0, notes: ["buff payloads not yet defined"], source, applied: false };
}

/**
 * Resolve one payload array against a target.
 * @param {object} args { payload, caster, target, source }
 *   caster: the actor the effect is "as if cast by" (wielder / wearer / user)
 *   target: the actor receiving the effect
 *   source: "proc:<id>" | "worn:<id>" | "triggered:<id>" for logging
 */
export async function applyEffectPayload({ payload, caster, target, source }) {
    const results = [];
    for (const effect of payload ?? []) {
        if (effect.type === "damage") results.push(await applyDamage({ effect, caster, target, source }));
        else if (effect.type === "regen") results.push(await applyRegen({ effect, caster, target, source }));
        else if (effect.type === "buff") results.push(await applyBuff({ effect, source }));
        else results.push({ type: effect.type ?? "unknown", final: 0, notes: ["unknown payload type"], source });
    }
    return results;
}
