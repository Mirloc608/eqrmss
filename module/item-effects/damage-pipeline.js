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
 *
 * Supported payload types (Phase 3 — damage pipeline):
 *   "damage"    -> immunity/weakness/resistance gate, then concussion hits
 *   "regen"     -> restore a pool (default mana), capped at max
 *   "buff"      -> stub (applied:false); payload shape not yet defined
 *   "heal"      -> restore hits (system.hits.value), floored at 0
 *   "mana-drain"-> reduce system.attributes.mana.value, floored at 0
 *   "stun"      -> system.status.stun.stunned += rounds
 *   "mez"       -> system.status.stun.downOrOut += rounds (spell-engine pattern)
 *   "debuff"    -> worst-wins system.status.actionPenalty { value, rounds }
 *                  + timed system.status.spellEffects label entry
 *   "dot"       -> system.status.dots entry { name, element, min, max,
 *                  roundsLeft } — the exact shape tickConditions ticks
 *   "hot"       -> timed regen entry in system.status.spellEffects
 *                  { kind: "regen", pool: "hits", amount, roundsLeft } —
 *                  tickConditions heals non-mana regen pools each round
 *   "root"      -> system.status.rooted { rounds } + timed spellEffects entry
 *                  (no immobilization field exists yet; GM adjudicates)
 *   "snare"     -> system.movement.snarePenalty { value } + timed entry
 *   "fear"      -> system.status.fear { rounds } + timed spellEffects entry
 *                  (no fear pool exists yet; GM adjudicates)
 *   "summon"    -> chat note + GM prompt; never half-spawned
 *   "utility"   -> payload note text logged to result notes; no mechanics
 */

function rollRange(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}

function getTargetModifiers(target, element) {
    const sys = target?.system ?? {};
    const immunities = sys.immunities ?? [];
    const weaknesses = sys.weaknesses ?? {};
    const resistances = sys.resistances ?? {};
    // Sum resist buffs from spellEffects (2026-10-07): entries with
    // scaledTarget "resist-fire" etc. contribute to flat damage reduction.
    let buffResist = 0;
    const fx = sys.status?.spellEffects;
    if (Array.isArray(fx) && element) {
        const key = `resist-${String(element).toLowerCase()}`;
        for (const e of fx) {
            if (String(e?.scaledTarget ?? "").toLowerCase() === key) {
                buffResist += Number(e?.scaledValue) || 0;
            }
        }
    }
    return {
        immune: Array.isArray(immunities) && immunities.includes(element),
        weaknessMult: weaknesses[element] ?? 1,
        resist: (resistances[element] ?? 0) + buffResist
    };
}

function applyResistance(rolled, resist) {
    // PLACEHOLDER — see header note.
    return Math.max(0, rolled - resist);
}

async function persistValue(target, path, value) {
    if (!target) return;
    // Unlinked tokens (2026-10-09): persist to the base actor so
    // status effects are visible to ticks and hooks sweeping game.actors.
    const baseTarget = target?.isToken
        ? (globalThis.game?.actors?.get(target?.token?.actorId) ?? target)
        : target;
    if (typeof baseTarget?.update === "function") {
        await baseTarget.update({ [path]: value });
    } else if (baseTarget?.system) {
        const parts = path.replace(/^system\./, "").split(".");
        let obj = baseTarget.system;
        for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]] ??= {};
        obj[parts[parts.length - 1]] = value;
    }
}

/** Defensive null-target guard: returns a note-only result, or null when usable. */
function requireTarget(target, type, source) {
    if (!target) return { type, rolled: 0, final: 0, notes: ["no target"], source };
    return null;
}

/**
 * Resolve the number of rounds for a timed payload. Precedence:
 *   effect.rounds (number) -> effect.duration (number or "N rounds")
 *   -> min/max roll -> fallback.
 */
function payloadRounds(effect, fallback = 1) {
    const r = Number(effect?.rounds);
    if (Number.isFinite(r) && r >= 0) return Math.floor(r);
    const m = String(effect?.duration ?? "").match(/(\d+)/);
    if (m) return Number(m[1]);
    if (effect?.min != null || effect?.max != null) return rollRange(effect.min ?? 0, effect.max ?? 0);
    return fallback;
}

/** Append one entry to a system.status list (dots / spellEffects). */
async function pushStatusList(target, key, entry) {
    const list = [...(Array.isArray(target?.system?.status?.[key]) ? target.system.status[key] : [])];
    list.push(entry);
    await persistValue(target, `system.status.${key}`, list);
}

/** Read-modify-write the stun pool; fn receives the merged pool to mutate. */
async function withStunPool(target, fn) {
    const pool = { stunned: 0, stunNoParry: 0, downOrOut: 0, ...(target?.system?.status?.stun ?? {}) };
    fn(pool);
    await persistValue(target, "system.status.stun", pool);
    return pool;
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

    // Absorb hook (2026-10-09): item-effect damage (procs, worn,
    // triggered) counts as spell damage for spell-only absorbs.
    if (final > 0 && target) {
        const ab = target?.system?.status?.absorb;
        const abAmount = Number(ab?.amount) || 0;
        // Pipeline damage is always spell-like (proc/worn/triggered),
        // so spell-only absorbs apply; all-damage absorbs apply too.
        if (abAmount > 0) {
            const absorbed = Math.min(final, abAmount);
            const abLeft = abAmount - absorbed;
            final -= absorbed;
            const abName = String(ab?.source ?? "absorb");
            if (abLeft > 0) {
                await persistValue(target, "system.status.absorb.amount", abLeft);
                notes.push(`${abName} absorbs ${absorbed} damage (${abLeft} remaining)`);
            } else {
                await persistValue(target, "system.status.absorb", null);
                notes.push(`${abName} absorbs ${absorbed} damage and is depleted`);
            }
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

// AC to Defense curve (mirrors songs.js acToDefense, 2026-10-07).
function clickyAcToDefense(ac) {
    if (ac <= 0) return 0;
    if (ac <= 10) return Math.round(ac);
    if (ac <= 30) return 10 + Math.round((ac - 10) / 2);
    if (ac <= 70) return 20 + Math.round((ac - 30) / 4);
    if (ac <= 150) return 30 + Math.round((ac - 70) / 8);
    return 40 + Math.round((ac - 150) / 16);
}

async function applyBuff({ effect, target, source, caster }) {
    // Support both "stat" and legacy "effect" field names
    const stat = String(effect?.stat ?? effect?.effect ?? "").toLowerCase();
    const rawValue = Number(effect?.amount) || 0;
    if (!(rawValue > 0) || !target) {
        return { type: "buff", final: 0, notes: ["invalid buff payload"], source, applied: false };
    }
    // Unlinked tokens (2026-10-09): resolve to base actor for spellEffects,
    // matching the absorb (266d1f38) and pending-cast (e0359c44) fixes.
    const baseTarget = target?.isToken
        ? (globalThis.game?.actors?.get(target?.token?.actorId) ?? target)
        : target;
    // Port of spell-buff scaling (2026-10-07): EQ÷10, min 1, AC via curve.
    // Mirrors scaleSongValue() in songs.js + atk/haste/slow special cases.
    let scaledTarget = null, scaledStat = null, scaledValue = 0, label = "";
    const rmssStat = { str: "ST", sta: "CO", agi: "AG", dex: "QU", wis: "EM", int: "ME", cha: "PR",
        // RMSS abbreviations (lowercase) — Dragoste uses these directly (2026-10-09).
        st: "ST", co: "CO", ag: "AG", qu: "QU", em: "EM", me: "ME", pr: "PR" };
    if (stat === "atk") {
        scaledTarget = "ob"; scaledStat = "ob";
        scaledValue = Math.max(1, Math.round(rawValue / 10));
        label = `Attack +${scaledValue}`;
    } else if (stat === "haste") {
        scaledTarget = "haste"; scaledStat = "haste";
        scaledValue = Math.max(1, Math.round(rawValue));
        label = `Haste +${scaledValue}%`;
    } else if (stat === "slow") {
        scaledTarget = "slow"; scaledStat = "slow";
        scaledValue = Math.max(1, Math.round(rawValue));
        label = `Slow +${scaledValue}%`;
    } else if (stat === "ac" || stat === "armor") {
        scaledTarget = "db"; scaledStat = null;
        scaledValue = Math.max(1, clickyAcToDefense(rawValue));
        label = `Defense +${scaledValue}`;
    } else if (stat === "movement" || stat === "run-speed" || stat === "runspeed") {
        scaledTarget = "movement"; scaledStat = null;
        scaledValue = Math.max(1, Math.round(rawValue / 10));
        label = `Movement +${scaledValue}`;
    } else if (stat === "hp" || stat === "hp-max" || stat === "hits") {
        scaledTarget = "hits"; scaledStat = null;
        scaledValue = Math.max(1, Math.round(rawValue / 10));
        label = `Max HP +${scaledValue}`;
    } else if (stat === "mana") {
        scaledTarget = "mana"; scaledStat = null;
        scaledValue = Math.max(1, Math.round(rawValue / 10));
        label = `Max Mana +${scaledValue}`;
    } else if (rmssStat[stat]) {
        scaledTarget = "statBonus"; scaledStat = stat;
        scaledValue = Math.max(1, Math.round(rawValue / 10));
        label = `${rmssStat[stat]} +${scaledValue}`;
    } else if (stat.startsWith("resist-")) {
        // Resist buffs (2026-10-07): EQ÷10, min 1. Feed into getTargetModifiers
        // via spellEffects entries with scaledTarget "resist-<element>".
        const elem = stat.slice(7);
        scaledTarget = `resist-${elem}`; scaledStat = null;
        scaledValue = Math.max(1, Math.round(rawValue / 10));
        const elemLabel = elem.charAt(0).toUpperCase() + elem.slice(1);
        label = `Resist ${elemLabel} +${scaledValue}`;
    } else {
        return { type: "buff", final: 0, notes: [`unsupported buff stat: ${stat}`], source, applied: false };
    }
    const fx = baseTarget?.system?.status?.spellEffects;
    if (Array.isArray(fx)) {
        for (const e of fx) {
            if (e?.scaledTarget !== scaledTarget) continue;
            // For stat buffs, also match the specific stat (2026-10-09): AG/PR/ST/QU are different stats.
            if (scaledTarget === "statBonus" && e?.scaledStat !== scaledStat) continue;
            const eVal = Number(e?.scaledValue) || 0;
            if (eVal >= scaledValue) {
                return { type: "buff", final: 0, notes: [`${label} blocked by stronger ${e?.label ?? "existing buff"}`], source, applied: false };
            }
        }
    }
    const duration = Number(effect?.duration ?? effect?.["duration-rounds"]) || 10;
    const list = [...(Array.isArray(fx) ? fx : [])];
    list.push({
        name: (() => {
          if (effect?.name) return effect.name;
            const m = String(source ?? "").match(/^(?:triggered|worn|proc):(.+)$/);
            if (m) {
                // Strip "clicky-" prefix from effect IDs (2026-10-09):
                // "clicky-form-of-defense-5" -> "Form Of Defense 5", not
                // "Clicky Form Of Defense 5".
                let slug = m[1].replace(/^clicky-/, '');
                return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }
            return "Clicky Buff";
        })(), label, kind: "buff", source: "spell",
        spellId: source ?? "clicky", scaledTarget, scaledStat, scaledValue, roundsLeft: duration,
        // Slow is harmful — show in Debuffs (2026-10-09).
        ...(scaledTarget === "slow" ? { category: "debuff" } : {}),
    });
    await baseTarget.update({ "system.status.spellEffects": list });
    // Hasted/slowed visual indicators (2026-10-07)
    if (scaledTarget === "haste" && scaledValue > 0) {
        try {
            const { applyStatusEffect } = await import("../spells/status-wiring.js");
            await applyStatusEffect(baseTarget, "hasted", `${label} (Clicky)`, duration, "icons/svg/lightning.svg", { source });
        } catch (e) { /* ignore */ }
    } else if (scaledTarget === "slow" && scaledValue > 0) {
        try {
            const { applyStatusEffect } = await import("../spells/status-wiring.js");
            await applyStatusEffect(baseTarget, "slowed", `${label} (Clicky)`, duration, "icons/svg/downgrade.svg", { source, category: "debuff" });
        } catch (e) { /* ignore */ }
    }
    return { type: "buff", final: scaledValue, notes: [`${label} for ${duration} rounds`], source, applied: true };
}

/**
 * "damageshield" — damage shield (2026-10-07). Melee attackers take flat
 * damage when they hit the shielded defender. Highest wins (EQ rule):
 * a weaker DS does not replace a stronger one.
 * Stored at system.status.damageShield = { amount, roundsLeft, source }.
 */
async function applyDamageShield({ effect, target, source }) {
    const miss = requireTarget(target, "damageshield", source);
    if (miss) return miss;
    const amount = Math.max(1, Math.round(Number(effect?.amount) || 0));
    if (!(amount > 0)) {
        return { type: "damageshield", final: 0, notes: ["invalid damage shield payload"], source, applied: false };
    }
    const duration = payloadRounds(effect, 10);
    const existing = target?.system?.status?.damageShield;
    const existingAmount = Number(existing?.amount) || 0;
    // Highest wins: do not replace a stronger shield.
    if (existingAmount >= amount) {
        return { type: "damageshield", final: existingAmount, notes: [`damage shield blocked by stronger existing shield (${existingAmount})`], source, applied: false };
    }
    const dispName = String(source ?? "").split(":").pop().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Damage Shield";
    await persistValue(target, "system.status.damageShield", {
        amount,
        roundsLeft: duration,
        source: dispName
    });
    return { type: "damageshield", final: amount, notes: [`${amount}-point damage shield for ${duration} rounds (${dispName})`], source, applied: true };
}

/**
 * "absorb" — rune/absorb pool (2026-10-07). Absorbs incoming damage before
 * it hits HP. Highest wins (EQ rule). Supports min/max ranges or flat amount.
 * Stored at system.status.absorb = { amount, roundsLeft, source }.
 */
async function applyAbsorb({ effect, target, source }) {
    const miss = requireTarget(target, "absorb", source);
    if (miss) return miss;
    let amount = 0;
    if (effect?.min != null || effect?.max != null) {
        amount = rollRange(Number(effect.min) || 0, Number(effect.max) || 0);
    } else {
        amount = Math.max(1, Math.round(Number(effect?.amount) || 0));
    }
    if (!(amount > 0)) {
        return { type: "absorb", final: 0, notes: ["invalid absorb payload"], source, applied: false };
    }
    const duration = payloadRounds(effect, 10);
    const existing = target?.system?.status?.absorb;
    const existingAmount = Number(existing?.amount) || 0;
    // Highest wins: do not replace a stronger absorb pool.
    if (existingAmount >= amount) {
        return { type: "absorb", final: existingAmount, notes: [`absorb blocked by stronger existing pool (${existingAmount})`], source, applied: false };
    }
    const dispName = String(source ?? "").split(":").pop().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Absorb";
    await persistValue(target, "system.status.absorb", {
        amount,
        roundsLeft: duration,
        source: dispName,
        spellOnly: !!effect?.spellOnly
    });
    const scopeNote = effect?.spellOnly ? " (spell damage only)" : "";
    return { type: "absorb", final: amount, notes: [`absorbs ${amount} damage for ${duration} rounds${scopeNote} (${dispName})`], source, applied: true };
}

/**
 * "vampiric" — Vampiric Embrace (2026-10-08). Melee lifetap proc buff:
 * successful melee hits have a chance to drain life, healing the attacker.
 * Re-casting refreshes. Clickies target the wearer (ruling 2026-10-06).
 * Stored at system.status.vampiric = { procChance, amount, percent,
 * roundsLeft, source }. Duration is level-scaled per EQ (17 rounds @L7 →
 * 75 @L65); the wearer's level is passed and the payload duration acts
 * as a cap.
 * NOTE: procChance is not in the source data (EQ only says "a chance");
 * it remains a mechanical placeholder (see module/spells/vampiric.js),
 * flagged for EQ canon review. amount (12) is real EQ data.
 */
async function applyVampiric({ effect, target, source }) {
    const miss = requireTarget(target, "vampiric", source);
    if (miss) return miss;
    const { applyVampiric: applyVamp } = await import("../spells/vampiric.js");
    const duration = payloadRounds(effect, 75);
    const wearerLevel = Number(target?.system?.attributes?.level?.value) || 1;
    const dispName = String(source ?? "").split(":").pop().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Vampiric Embrace";
    const note = await applyVamp(target, {
        procChance: effect?.procChance,
        amount: effect?.amount,
        percent: effect?.percent,
        rounds: duration,
        casterLevel: wearerLevel,
        sourceName: dispName
    });
    return { type: "vampiric", final: 1, notes: [note], source, applied: true };
}

/**
 * "illusion" — racial appearance illusion (2026-10-07). Grants the APPEARANCE
 * of another race only: no stat benefits/penalties. The `race` field stores
 * the illusory race id (e.g. "dark-elf", "skeleton") for the future faction
 * system to consult. Replaces any existing illusion.
 * Stored at system.status.illusion = { race, displayName, roundsLeft, source }.
 * Spell effects use `form` instead of `race`; both are accepted (2026-10-07).
 */
export async function applyIllusion({ effect, target, source }) {
    const miss = requireTarget(target, "illusion", source);
    if (miss) return miss;
    const race = String(effect?.race ?? effect?.form ?? "").trim().toLowerCase();
    const pretty = (s) => String(s ?? "").split("-").map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(" ");
    const displayName = String(effect?.displayName || (race ? pretty(race) : "") || "unknown form");
    if (!race) {
        return { type: "illusion", final: 0, notes: ["invalid illusion payload"], source, applied: false };
    }
    const duration = payloadRounds(effect, 360);
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Illusion";
    await persistValue(target, "system.status.illusion", {
        race,
        displayName,
        roundsLeft: duration,
        source: dispName
    });
    return { type: "illusion", final: 1, notes: [`takes the form of ${displayName} for ${duration} rounds (${dispName})`], source, applied: true };
}

/**
 * "see-invisible" — EQ See Invisible (2026-10-07). The bearer can sense
 * invisible creatures, bypassing all invisibility types (general/undead/
 * animals). Checked by canSenseTarget() in module/spells/invisibility.js.
 * Stored at system.status.seeInvisible = { roundsLeft, source }.
 */
export async function applySeeInvisible({ effect, target, source }) {
    const miss = requireTarget(target, "see-invisible", source);
    if (miss) return miss;
    const duration = payloadRounds(effect, 270);
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "See Invisible";
    await persistValue(target, "system.status.seeInvisible", {
        roundsLeft: duration,
        source: dispName
    });
    return { type: "see-invisible", final: 1, notes: [`can see invisible for ${duration} rounds (${dispName})`], source, applied: true };
}

/**
 * "infravision" — EQ Infravision (2026-10-07). Heat-based night vision;
 * see in darkness (lesser than ultravision). Stored at
 * system.status.infravision = { roundsLeft, source }. Foundry token-vision
 * integration (sight range/mode) is future work; the status is the
 * mechanical record.
 */
export async function applyInfravision({ effect, target, source }) {
    const miss = requireTarget(target, "infravision", source);
    if (miss) return miss;
    const duration = payloadRounds(effect, 270);
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Infravision";
    await persistValue(target, "system.status.infravision", {
        roundsLeft: duration,
        source: dispName
    });
    return { type: "infravision", final: 1, notes: [`infravision for ${duration} rounds (${dispName})`], source, applied: true };
}

/**
 * "ultravision" — EQ Ultravision (2026-10-07). See in darkness as if
 * daylight; superior to infravision. Stored at
 * system.status.ultravision = { roundsLeft, source }. Foundry token-vision
 * integration (sight range/mode) is future work; the status is the
 * mechanical record.
 */
export async function applyUltravision({ effect, target, source }) {
    const miss = requireTarget(target, "ultravision", source);
    if (miss) return miss;
    const duration = payloadRounds(effect, 360);
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Ultravision";
    await persistValue(target, "system.status.ultravision", {
        roundsLeft: duration,
        source: dispName
    });
    return { type: "ultravision", final: 1, notes: [`ultravision for ${duration} rounds (${dispName})`], source, applied: true };
}

/**
 * "telescope" — EQ Telescope (2026-10-08). +55% magnification: the bearer
 * sees farther for the duration. Stored at
 * system.status.telescope = { magnification, roundsLeft, source }.
 * Foundry token-vision range integration is future work; the status is the
 * mechanical record (same as the vision payloads).
 * Payload shape: { type: "telescope", magnification: <pct>, duration: <rounds> }
 */
export async function applyTelescope({ effect, target, source }) {
    const miss = requireTarget(target, "telescope", source);
    if (miss) return miss;
    const duration = payloadRounds(effect, 3);
    const magnification = Number(effect?.magnification) || 55;
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Telescope";
    await persistValue(target, "system.status.telescope", {
        magnification,
        roundsLeft: duration,
        source: dispName
    });
    return { type: "telescope", final: 1, notes: [`+${magnification}% magnification for ${duration} rounds (${dispName})`], source, applied: true };
}

/**
 * "levitate" — EQ Levitate (2026-10-07). Grants the `flying` status;
 * the Bearer <redacted> passes through difficult or otherwise impossible
 * terrain as normal ground (user ruling). Delegates to
 * module/spells/levitate.js via dynamic import (avoids cycles).
 * Payload shape: { type: "levitate", duration: <rounds> }
 */
export async function applyLevitatePayload({ effect, target, source }) {
    const miss = requireTarget(target, "levitate", source);
    if (miss) return miss;
    const duration = payloadRounds(effect, 205);
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Levitate";
    try {
        const { applyLevitate } = await import("../spells/levitate.js");
        const note = await applyLevitate(target, dispName, duration);
        const applied = !/not applied|failed/i.test(note);
        return { type: "levitate", final: applied ? 1 : 0, notes: [note.replace(/<[^>]+>/g, "")], source, applied };
    } catch (e) {
        return { type: "levitate", final: 0, notes: [`levitate failed: ${e?.message ?? e}`], source, applied: false };
    }
}

/**
 * "shrink" — EQ Shrink (2026-10-08). Reduces the target's physical
 * size (token scale); restored on expiry. Delegates to
 * module/spells/shrink.js via dynamic import (avoids cycles).
 * Payload shape: { type: "shrink", percent: <n>|amount: <n>, duration: <rounds>, target: "pet"|undefined }
 * (amount may be negative in spell data — the magnitude is used).
 * target: "pet" (2026-10-09) redirects to the caster's active pet
 * (Tiny Companion) instead of the clicky wearer.
 */
export async function applyShrinkPayload({ effect, target, source, caster }) {
    let finalTarget = target;
    // Tiny Companion: shrink the caster's pet, not the caster
    if (effect?.target === "pet") {
        try {
            const { findCasterPet } = await import("../spells/pets/summon-pet.js");
            finalTarget = findCasterPet(caster ?? target);
        } catch { finalTarget = null; }
        if (!finalTarget) {
            return { type: "shrink", final: 0, notes: ["no active pet to shrink"], source, applied: false };
        }
    }
    const miss = requireTarget(finalTarget, "shrink", source);
    if (miss) return miss;
    const duration = payloadRounds(effect, 270);
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Shrink";
    try {
        const { applyShrink } = await import("../spells/shrink.js");
        const note = await applyShrink(finalTarget, {
            scalePct: effect?.amount ?? effect?.percent ?? 34,
            rounds: duration, sourceName: dispName
        });
        const applied = !/not applied|failed/i.test(note);
        return { type: "shrink", final: applied ? 1 : 0, notes: [note.replace(/<[^>]+>/g, "")], source, applied };
    } catch (e) {
        return { type: "shrink", final: 0, notes: [`shrink failed: ${e?.message ?? e}`], source, applied: false };
    }
}
/**
 * "teleport" — EQ teleport mechanics for clickies.
 * Delegates to module/spells/teleport.js via dynamic import (avoids cycles).
 * Payload shape: { type: "teleport", effect: "<teleport-kind>", destination: "<dest-id>" }
 */
async function applyTeleportPayload({ effect, caster, target, source }) {
    try {
        const { applyTeleport } = await import("../spells/teleport.js");
        const note = await applyTeleport({ effect, caster: caster ?? target, target, spellName: source ?? "Teleport" });
        // Strip <p><em> tags for the notes array
        const text = String(note).replace(/<[^>]+>/g, "").trim();
        return { type: "teleport", final: 1, notes: [text], source, applied: true };
    } catch (err) {
        console.error("eqrmss teleport payload failed:", err);
        return { type: "teleport", final: 0, notes: [`teleport failed: ${err?.message ?? "unknown error"}`], source, applied: false };
    }
}

/**
 * "summon-item" — EQ summoned item mechanics for clickies.
 * Delegates to module/spells/summon.js via dynamic import (avoids cycles).
 * Payload shape: { type: "summon-item", item: "<item-id>", quantity: N }
 */
async function applySummonItem({ effect, caster, target, source }) {
    try {
        const { summonItem } = await import("../spells/summon.js");
        const note = await summonItem({
            caster: target ?? caster,
            itemId: effect.item,
            quantity: effect.quantity,
            intoBag: effect.intoBag,
            spellName: source ?? "Summon Item",
        });
        // Strip HTML tags for the notes array
        const text = String(note).replace(/<[^>]+>/g, "").trim();
        return { type: "summon-item", final: 1, notes: [text], source, applied: true };
    } catch (err) {
        console.error("eqrmss summon-item payload failed:", err);
        return { type: "summon-item", final: 0, notes: [`summon-item failed: ${err?.message ?? "unknown error"}`], source, applied: false };
    }
}

/** "heal" — restore concussion hits taken (system.hits.value), floored at 0. */
async function applyHeal({ effect, target, source }) {
    const miss = requireTarget(target, "heal", source);
    if (miss) return miss;
    let rolled = rollRange(effect.min ?? 0, effect.max ?? 0);
    // Era Capstones (2026-10-09): check for heal-bonus-pct on the caster.
    // Spire of Divinity: +X% healing.
    try {
        // Source may be an actor or have caster info
        const caster = source?.actor || globalThis.game?.actors?.get(source?.casterId);
        if (caster) {
            const effects = caster.system?.status?.spellEffects || [];
            let bonusPct = 0;
            for (const e of effects) {
                if (e.source !== "capstone") continue;
                for (const m of (e.modifiers || [])) {
                    if (m.target === "heal-bonus-pct") {
                        bonusPct += Number(m.value) || 0;
                    }
                }
            }
            if (bonusPct > 0) {
                rolled = Math.round(rolled * (1 + bonusPct / 100));
            }
        }
    } catch (e) { /* non-fatal */ }
    const cur = Number(target.system?.hits?.value) || 0;
    const next = Math.max(0, cur - rolled);
    await persistValue(target, "system.hits.value", next);
    const final = cur - next;
    const notes = final < rolled ? [`capped at full health (${final} of ${rolled} applied)`] : [];
    return { type: "heal", rolled, final, notes, source };
}

/** "mana-drain" — reduce the target's mana pool, floored at 0. */
async function applyManaDrain({ effect, target, source }) {
    const miss = requireTarget(target, "mana-drain", source);
    if (miss) return miss;
    const attr = target.system?.attributes?.mana;
    if (!attr) return { type: "mana-drain", rolled: 0, final: 0, notes: ["no mana pool on target"], source };
    const rolled = rollRange(effect.min ?? 0, effect.max ?? 0);
    const cur = Number(attr.value) || 0;
    const next = Math.max(0, cur - rolled);
    await persistValue(target, "system.attributes.mana.value", next);
    return { type: "mana-drain", rolled, final: cur - next, notes: [], source };
}

/**
 * "manaregen" — timed mana/HP regen as a spellEffects entry (2026-10-08).
 * Unlike "regen" (instant restore), this creates a per-round tick entry that
 * tickConditions processes: { kind: "regen", pool: "mana"|"hits", amount }.
 * Used by Clarity (+9 mana/round) and Aura of Battle (+2 HP/round).
 */
async function applyManaRegen({ effect, target, source }) {
    const miss = requireTarget(target, "manaregen", source);
    if (miss) return miss;
    // Unlinked tokens (2026-10-09): resolve to base actor for spellEffects.
    const baseTarget = target?.isToken
        ? (globalThis.game?.actors?.get(target?.token?.actorId) ?? target)
        : target;
    const amount = Number(effect?.amount) || 0;
    const pool = String(effect?.pool ?? "mana").toLowerCase();
    if (!(amount > 0)) {
        return { type: "manaregen", final: 0, notes: ["invalid manaregen payload"], source, applied: false };
    }
    const duration = Number(effect?.duration ?? effect?.["duration-rounds"]) || 10;
    const fx = baseTarget?.system?.status?.spellEffects;
    const list = [...(Array.isArray(fx) ? fx : [])];
    // Refresh existing entry from the same source instead of stacking.
    const srcKey = source ?? "clicky";
    const existingIdx = list.findIndex(e => e?.kind === "regen" && e?.pool === pool && String(e?.source ?? "") === String(srcKey));
    const entry = {
        name: effect?.name ?? (() => {
            const m = String(source ?? "").match(/^(?:triggered|worn|proc):(.+)$/);
            if (m) return m[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            return "Clicky Regen";
        })(),
        label: pool === "mana" ? `Mana +${amount}/round` : `HP +${amount}/round`,
        kind: "regen", pool, amount, source: srcKey, roundsLeft: duration,
    };
    if (existingIdx >= 0) list[existingIdx] = entry;
    else list.push(entry);
    await baseTarget.update({ "system.status.spellEffects": list });
    return { type: "manaregen", final: amount, notes: [`${entry.label} for ${duration} rounds`], source, applied: true };
}

/**
 * "cure" — remove disease/poison DoTs from the target (2026-10-08).
 * Removes entries in system.status.dots whose element matches the
 * payload's condition ("disease", "poison"). Used by Cure Disease etc.
 */
async function applyCure({ effect, target, source }) {
    const miss = requireTarget(target, "cure", source);
    if (miss) return miss;
    const condition = String(effect?.condition ?? "").toLowerCase();
    if (!condition) {
        return { type: "cure", final: 0, notes: ["invalid cure payload (no condition)"], source, applied: false };
    }
    const dots = Array.isArray(target?.system?.status?.dots) ? target.system.status.dots : [];
    const remaining = dots.filter(d => String(d?.element ?? "").toLowerCase() !== condition);
    const removed = dots.length - remaining.length;
    if (removed > 0) {
        await target.update({ "system.status.dots": remaining });
    }
    const notes = removed > 0
        ? [`cured ${removed} ${condition} effect(s)`]
        : [`no ${condition} effects to cure`];
    return { type: "cure", final: removed, notes, source, applied: removed > 0 };
}

/** "stun" — add rounds to system.status.stun.stunned (spell-engine path). */
async function applyStun({ effect, target, source }) {
    const miss = requireTarget(target, "stun", source);
    if (miss) return miss;
    const rounds = payloadRounds(effect);
    const pool = await withStunPool(target, p => { p.stunned += rounds; });
    return { type: "stun", rolled: rounds, final: pool.stunned, notes: [`stunned for ${rounds} rounds`], source };
}

/**
 * "debuff" — payload carries { effect, value } and optional rounds/duration.
 * The timed-modifier pattern the codebase has is system.status.actionPenalty
 * { value, rounds } (negative = penalty to all actions; rounds 0 = indefinite;
 * ticks down in tickConditions). Worst (most negative) wins, matching how
 * crit-conditions applies penalties. A descriptive timed spellEffects entry
 * records it for the GM, mirroring applyBaseSpellEffect's debuff branch.
 */
async function applyDebuff({ effect, target, source }) {
    const miss = requireTarget(target, "debuff", source);
    if (miss) return miss;
    const magnitude = Math.abs(Number(effect?.value ?? effect?.amount ?? 0));
    const rounds = payloadRounds(effect, 0);
    const name = String(effect?.effect ?? effect?.stat ?? "debuff");
    const pen = -magnitude;
    const cur = target.system?.status?.actionPenalty ?? { value: 0, rounds: 0 };
    if (pen < (Number(cur.value) || 0)) {
        await persistValue(target, "system.status.actionPenalty", { value: pen, rounds });
    }
    await pushStatusList(target, "spellEffects", {
        label: `${name} (${pen} to all actions)`,
        roundsLeft: rounds > 0 ? rounds : null,
        source
    });
    const notes = [`${name}: ${pen} to all actions${rounds > 0 ? ` for ${rounds} rounds` : " (indefinite)"}`];
    return { type: "debuff", rolled: magnitude, final: pen, notes, source };
}

/**
 * "dot" — add a damage-over-time entry to system.status.dots in the exact
 * shape the spell engine's tickConditions expects:
 * { name, element, min, max, roundsLeft } (source for attribution).
 */
async function applyDot({ effect, target, source }) {
    const miss = requireTarget(target, "dot", source);
    if (miss) return miss;
    const rounds = payloadRounds(effect);
    const rolled = rollRange(effect.min ?? 0, effect.max ?? 0);
    await pushStatusList(target, "dots", {
        name: effect.name ?? source ?? "item effect",
        element: String(effect.element ?? ""),
        min: Number(effect.min ?? rolled) || 0,
        max: Number(effect.max ?? rolled) || 0,
        roundsLeft: rounds,
        source
    });
    return { type: "dot", rolled, final: rolled, notes: [`${rolled} hits/round for ${rounds} rounds`], source };
}

/**
 * "hot" — heal-over-time, mirroring the dot pattern for healing: a timed
 * regen entry in system.status.spellEffects. tickConditions heals
 * non-mana regen pools each round (hits clamped at 0 taken). A re-fired
 * hot from the same source refreshes the entry instead of stacking.
 */
async function applyHot({ effect, target, source }) {
    const miss = requireTarget(target, "hot", source);
    if (miss) return miss;
    const rounds = payloadRounds(effect);
    const rolled = rollRange(effect.min ?? 0, effect.max ?? 0);
    const list = [...(Array.isArray(target?.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
    const fresh = list.filter(e => !(e?.kind === "regen" && e?.pool === "hits" && e?.source === source));
    fresh.push({
        kind: "regen", pool: "hits", amount: rolled,
        roundsLeft: rounds,
        label: effect.name ?? source ?? "heal over time",
        source
    });
    await persistValue(target, "system.status.spellEffects", fresh);
    return { type: "hot", rolled, final: rolled, notes: [`${rolled} hits/round for ${rounds} rounds`], source };
}

/**
 * "root" — immobilize for N rounds. The codebase has no immobilization
 * field, so this uses a status flag (system.status.rooted { rounds }) plus
 * a timed spellEffects entry the GM can see counting down.
 */
async function applyRoot({ effect, target, source }) {
    const miss = requireTarget(target, "root", source);
    if (miss) return miss;
    const rounds = payloadRounds(effect);
    await persistValue(target, "system.status.rooted", { rounds });
    await pushStatusList(target, "spellEffects", { label: `rooted (${rounds} rounds)`, roundsLeft: rounds, source });
    return {
        type: "root", rolled: rounds, final: rounds,
        notes: ["immobilized — movement rate set to 0 while rooted"], source
    };
}

/**
 * "snare" — movement penalty { value }. Movement lives at system.movement
 * (baseRate is derived each prepare and does not consume penalties yet),
 * so the penalty is recorded on that object plus a timed spellEffects
 * entry; the note flags the pending engine hook.
 */
async function applySnare({ effect, target, source }) {
    const miss = requireTarget(target, "snare", source);
    if (miss) return miss;
    const value = Math.abs(Number(effect?.value ?? effect?.amount ?? 0));
    const rounds = payloadRounds(effect, 0);
    await persistValue(target, "system.movement.snarePenalty", value);
    await pushStatusList(target, "spellEffects", {
        label: `snared (−${value} move)`,
        roundsLeft: rounds > 0 ? rounds : null,
        source,
        category: "debuff",
        snareValue: value
    });
    const notes = [`−${value} movement${rounds > 0 ? ` for ${rounds} rounds` : " (indefinite)"} — recorded on system.movement.snarePenalty; the §7.2.1 prepare does not consume it yet`];
    return { type: "snare", rolled: value, final: value, notes, source };
}

/**
 * "fear" — fear rounds (same pattern as stun). The engine has no fear pool,
 * so this uses a status flag (system.status.fear { rounds }) plus a timed
 * spellEffects entry; behavior is GM-adjudicated.
 */
async function applyFear({ effect, target, source }) {
    const miss = requireTarget(target, "fear", source);
    if (miss) return miss;
    // Era Capstones (2026-10-09): check for fear immunity from capstone buffs.
    try {
        const effects = target.system?.status?.spellEffects || [];
        for (const e of effects) {
            if (e.source !== "capstone") continue;
            for (const m of (e.modifiers || [])) {
                if (m.target === "fear-immunity") {
                    return `<p><em>${target.name} is immune to fear (${e.label || "capstone"}).</em></p>`;
                }
            }
        }
    } catch (e) { /* non-fatal */ }
    const rounds = payloadRounds(effect);
    await persistValue(target, "system.status.fear", { rounds });
    await pushStatusList(target, "spellEffects", { label: `feared (${rounds} rounds)`, roundsLeft: rounds, source });
    // Frightened visual (2026-10-07): Foundry core status.
    try {
        const { applyStatusEffect } = await import("../spells/status-wiring.js");
        await applyStatusEffect(target, "frightened", "Feared", rounds, "icons/svg/terror.svg", { source });
    } catch (e) { /* ignore */ }
    return {
        type: "fear", rolled: rounds, final: rounds,
        notes: ["feared — cannot make offensive attacks while feared"], source
    };
}

/** "mez" — mesmerize: the spell-engine pattern is down-or-out in the stun pool. */
async function applyMez({ effect, target, source }) {
    const miss = requireTarget(target, "mez", source);
    if (miss) return miss;
    // Era Capstones (2026-10-09): check for mez immunity from capstone buffs.
    try {
        const effects = target.system?.status?.spellEffects || [];
        for (const e of effects) {
            if (e.source !== "capstone") continue;
            for (const m of (e.modifiers || [])) {
                if (m.target === "mez-immunity") {
                    return { type: "mez", rolled: 0, final: 0, notes: [`${target.name} is immune to mez (${e.label || "capstone"}).`], source };
                }
            }
        }
    } catch (e) { /* non-fatal */ }
    const rounds = payloadRounds(effect);
    const pool = await withStunPool(target, p => { p.downOrOut += rounds; });
    // Stunned visual (2026-10-07, user ruling): mez = conscious but unable to act.
    try {
        const { applyStatusEffect } = await import("../spells/status-wiring.js");
        await applyStatusEffect(target, "stunned", "Mesmerized", rounds, "icons/svg/stunned.svg", { source });
    } catch (e) { /* ignore */ }
    return { type: "mez", rolled: rounds, final: pool.downOrOut, notes: [`mesmerized (down or out) for ${rounds} rounds`], source };
}

/**
 * "summon" — never half-implemented: post a chat note + GM prompt with the
 * creature name and duration. Safe to run headless (no ChatMessage global)
 * and in Foundry (whispers the GM when the global exists).
 */
async function applySummon({ effect, caster, target, source }) {
    const name = String(effect?.name ?? effect?.creature ?? "creature");
    const rounds = payloadRounds(effect);
    const who = caster?.name ?? "An effect";
    const msg = `${who} summons ${name} for ${rounds} rounds — GM: place the token and resolve manually.`;
    const notes = [msg];
    if (typeof ChatMessage !== "undefined") {
        try {
            const gmIds = (typeof game !== "undefined" && game?.users)
                ? [...game.users].filter(u => u.isGM).map(u => u.id)
                : [];
            await ChatMessage.create({
                content: `<p><em>${msg}</em></p>`,
                ...(gmIds.length ? { whisper: gmIds } : {})
            });
            notes.push("GM whisper posted");
        } catch (e) {
            notes.push("chat post failed — GM resolves manually");
        }
    } else {
        notes.push("no chat available — GM resolves manually");
    }
    return { type: "summon", rolled: rounds, final: 0, notes, source };
}

/**
 * "utility" — log the payload's note text to the result notes; no mechanics.
 * Invisibility utilities (2026-10-07) are wired to Foundry's native
 * `invisible` status instead of being chat-only.
 */
async function applyUtility({ effect, source, target, caster }) {
    // Invisibility clickies -> Foundry `invisible` status.
    const srcId = String(source ?? "").split(":").pop().toLowerCase();
    const note = String(effect?.note ?? "").toLowerCase();
    const isInvis = srcId.includes("invisib") || srcId.includes("gather-shadow")
        || srcId.includes("fade")
        || (note.includes("invisib") && !note.includes("see invis"));
    if (isInvis && target) {
        let itype = "general";
        if (srcId.includes("animal") || note.includes("animal")) itype = "animals";
        else if (srcId.includes("undead") || note.includes("undead")) itype = "undead";
        // Clicky durations: Gather Shadows / Invisibility ~20 min = 200 rounds.
        // Dynamic import: damage-pipeline is standalone (no static imports).
        const { applyInvisibility } = await import("../spells/invisibility.js");
        // Derive a display name from the effect ID (e.g., "clicky-gather-shadows" -> "Gather Shadows").
        const rawId = String(source ?? "").split(":").pop().replace(/^clicky-/, "");
        const dispName = effect?.name ?? (rawId.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Invisibility");
        const html = await applyInvisibility(target, dispName, itype, 200);
        // Strip HTML tags for the notes array (pipeline notes are plain text).
        const text = html.replace(/<[^>]*>/g, "").trim();
        return { type: "utility", rolled: 0, final: 0, notes: [text || "invisibility applied"], source };
    }
    return {
        type: "utility", rolled: 0, final: 0,
        notes: [String(effect?.note ?? effect?.text ?? "utility effect (no mechanical effect)")],
        source
    };
}

/**
 * "memblur" — EQ Memory Blur (2026-10-07). The target has a chance to
 * forget the caster (removed from the target's aggro record).
 * Delegates to module/spells/memblur.js via dynamic import (avoids cycles).
 * Payload shape: { type: "memblur", chance: <0-100> }
 */
export async function applyMemblurPayload({ effect, caster, target, source }) {
    const miss = requireTarget(target, "memblur", source);
    if (miss) return miss;
    const chance = Number(effect?.chance) || 100;
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Memory Blur";
    try {
        const { applyMemblur } = await import("../spells/memblur.js");
        const note = await applyMemblur(caster, target, chance, dispName);
        const applied = !/not applied|resists/i.test(note);
        return { type: "memblur", final: applied ? 1 : 0, notes: [note.replace(/<[^>]+>/g, "")], source, applied };
    } catch (e) {
        return { type: "memblur", final: 0, notes: [`memblur failed: ${e?.message ?? e}`], source, applied: false };
    }
}

/**
 * "pacify" — EQ Pacify/Soothe (2026-10-07). Lowers the target's
 * aggressiveness: halves existing aggro and blocks new aggro while
 * active. Delegates to module/spells/pacify.js via dynamic import.
 * Payload shape: { type: "pacify", rounds: <n>, levelCap: <n> }
 */
export async function applyPacifyPayload({ effect, caster, target, source }) {
    const miss = requireTarget(target, "pacify", source);
    if (miss) return miss;
    const rounds = Number(effect?.rounds) || 7;
    const levelCap = Number(effect?.levelCap) || 55;
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Pacify";
    try {
        const { applyPacify } = await import("../spells/pacify.js");
        const note = await applyPacify(caster, target, { rounds, levelCap, sourceName: dispName });
        const applied = !/too powerful|not applied/i.test(note);
        return { type: "pacify", final: applied ? 1 : 0, notes: [note.replace(/<[^>]+>/g, "")], source, applied };
    } catch (e) {
        return { type: "pacify", final: 0, notes: [`pacify failed: ${e?.message ?? e}`], source, applied: false };
    }
}

/**
 * Faction (2026-10-07): Alliance-style effects improve the caster's
 * standing with the target's faction. Effect shape:
 *   { type: "faction", amount: <n> }  (default +100)
 * The target's faction comes from target.system.npc.faction.
 */
export async function applyFactionPayload({ effect, caster, target, source }) {
    const miss = requireTarget(target, "faction", source);
    if (miss) return miss;
    const amount = Number(effect?.amount) || 100;
    const factionId = target?.system?.npc?.faction ?? null;
    if (!factionId)
        return { type: "faction", final: 0, notes: ["target has no faction"], source, applied: false };
    try {
        const { modifyFaction } = await import("../utils/faction/faction.js");
        const note = await modifyFaction(caster, factionId, amount);
        return { type: "faction", final: 1, notes: [note.replace(/<[^>]+>/g, "")], source, applied: true };
    } catch (e) {
        return { type: "faction", final: 0, notes: [`faction failed: ${e?.message ?? e}`], source, applied: false };
    }
}

/**
 * "dispel" — EQ Cancel Magic / dispel (2026-10-07). Removes magical
 * buffs/debuffs from the target. Delegates to module/spells/dispel.js
 * via dynamic import.
 * Payload shape: { type: "dispel", count: <n>, mode: "all"|"beneficial"|"detrimental" }
 */
export async function applyDispelPayload({ effect, caster, target, source }) {
    const miss = requireTarget(target, "dispel", source);
    if (miss) return miss;
    const count = Number(effect?.count) || 1;
    const mode = String(effect?.mode ?? "all").toLowerCase();
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Cancel Magic";
    try {
        const { applyDispel } = await import("../spells/dispel.js");
        const note = await applyDispel(caster, target, { count, mode, sourceName: dispName });
        const applied = !/no dispellable/i.test(note);
        return { type: "dispel", final: applied ? 1 : 0, notes: [note.replace(/<[^>]+>/g, "")], source, applied };
    } catch (e) {
        return { type: "dispel", final: 0, notes: [`dispel failed: ${e?.message ?? e}`], source, applied: false };
    }
}

/**
 * "feign" — EQ Feign Death (2026-10-07). The user falls prone and
 * appears dead; wiped from every actor's aggro record. Delegates to
 * module/spells/feign-death.js via dynamic import.
 * Payload shape: { type: "feign", chance: <0-100> }
 */
export async function applyFeignDeathPayload({ effect, caster, target, source }) {
    // Feign Death is always self-targeted: the user feigns.
    const user = caster ?? target;
    if (!user) return { type: "feign", final: 0, notes: ["feign death failed: no actor"], source, applied: false };
    const chance = Number(effect?.chance) || 95;
    const dispName = String(source ?? "").split(":").pop().trim().replace(/^clicky-/, "").split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Feign Death";
    try {
        const { applyFeignDeath } = await import("../spells/feign-death.js");
        const note = await applyFeignDeath(user, { chance, sourceName: dispName });
        const applied = !/not applied|fails/i.test(note);
        return { type: "feign", final: applied ? 1 : 0, notes: [note.replace(/<[^>]+>/g, "")], source, applied };
    } catch (e) {
        return { type: "feign", final: 0, notes: [`feign death failed: ${e?.message ?? e}`], source, applied: false };
    }
}

/**
 * "identify" — EQ Identify (2026-10-08). Reveals magical information about
 * the item the target is holding. Delegates to module/spells/identify.js
 * via dynamic import.
 * Payload shape: { type: "identify" }
 */
export async function applyIdentifyPayload({ effect, caster, target, source }) {
    const miss = requireTarget(target, "identify", source);
    if (miss) return miss;
    try {
        const { applyIdentify } = await import("../spells/identify.js");
        const note = await applyIdentify(caster, target, { sourceName: "Identify" });
        return { type: "identify", final: 1, notes: [note.replace(/<[^>]+>/g, " ")], source, applied: true };
    } catch (e) {
        return { type: "identify", final: 0, notes: [`identify failed: ${e?.message ?? e}`], source, applied: false };
    }
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
        else if (effect.type === "buff") results.push(await applyBuff({ effect, target, source, caster }));
        else if (effect.type === "heal") results.push(await applyHeal({ effect, target, source }));
        else if (effect.type === "mana-drain") results.push(await applyManaDrain({ effect, target, source }));
        else if (effect.type === "manaregen") results.push(await applyManaRegen({ effect, target, source }));
        else if (effect.type === "cure") results.push(await applyCure({ effect, target, source }));
        else if (effect.type === "stun") results.push(await applyStun({ effect, target, source }));
        else if (effect.type === "debuff") results.push(await applyDebuff({ effect, target, source }));
        else if (effect.type === "dot") results.push(await applyDot({ effect, target, source }));
        else if (effect.type === "hot") results.push(await applyHot({ effect, target, source }));
        else if (effect.type === "root") results.push(await applyRoot({ effect, target, source }));
        else if (effect.type === "snare") results.push(await applySnare({ effect, target, source }));
        else if (effect.type === "fear") results.push(await applyFear({ effect, target, source }));
        else if (effect.type === "mez") results.push(await applyMez({ effect, target, source }));
        else if (effect.type === "summon") results.push(await applySummon({ effect, caster, target, source }));
        else if (effect.type === "damageshield") results.push(await applyDamageShield({ effect, target, source }));
        else if (effect.type === "absorb") results.push(await applyAbsorb({ effect, target, source }));
        else if (effect.type === "illusion") results.push(await applyIllusion({ effect, target, source }));
        else if (effect.type === "see-invisible") results.push(await applySeeInvisible({ effect, target, source }));
        else if (effect.type === "infravision") results.push(await applyInfravision({ effect, target, source }));
        else if (effect.type === "ultravision") results.push(await applyUltravision({ effect, target, source }));
        else if (effect.type === "telescope") results.push(await applyTelescope({ effect, target, source }));
        else if (effect.type === "levitate") results.push(await applyLevitatePayload({ effect, target, source }));
        else if (effect.type === "teleport") results.push(await applyTeleportPayload({ effect, caster, target, source }));
        else if (effect.type === "summon-item") results.push(await applySummonItem({ effect, caster, target, source }));
        else if (effect.type === "memblur") results.push(await applyMemblurPayload({ effect, caster, target, source }));
        else if (effect.type === "pacify") results.push(await applyPacifyPayload({ effect, caster, target, source }));
        else if (effect.type === "faction") results.push(await applyFactionPayload({ effect, caster, target, source }));
        else if (effect.type === "dispel") results.push(await applyDispelPayload({ effect, caster, target, source }));
        else if (effect.type === "feign") results.push(await applyFeignDeathPayload({ effect, caster, target, source }));
        else if (effect.type === "vampiric") results.push(await applyVampiric({ effect, target, source }));
        else if (effect.type === "identify") results.push(await applyIdentifyPayload({ effect, caster, target, source }));
        else if (effect.type === "shrink") results.push(await applyShrinkPayload({ effect, target, source, caster }));
        else if (effect.type === "utility") results.push(await applyUtility({ effect, source, target, caster }));
        else results.push({ type: effect.type ?? "unknown", final: 0, notes: ["unknown payload type"], source });
    }
    return results;
}
