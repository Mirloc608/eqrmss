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
    if (!target) return;
    if (typeof target?.update === "function") {
        await target.update({ [path]: value });
    } else if (target?.system) {
        const parts = path.replace(/^system\./, "").split(".");
        let obj = target.system;
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
    // Port of spell-buff scaling (2026-10-07): EQ÷10, min 1, AC via curve.
    // Mirrors scaleSongValue() in songs.js + atk/haste/slow special cases.
    let scaledTarget = null, scaledStat = null, scaledValue = 0, label = "";
    const rmssStat = { str: "ST", sta: "CO", agi: "AG", dex: "QU", wis: "EM", int: "ME", cha: "PR" };
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
    } else {
        return { type: "buff", final: 0, notes: [`unsupported buff stat: ${stat}`], source, applied: false };
    }
    const fx = target?.system?.status?.spellEffects;
    if (Array.isArray(fx)) {
        for (const e of fx) {
            if (e?.scaledTarget !== scaledTarget) continue;
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
            if (m) return m[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            return "Clicky Buff";
        })(), label, kind: "buff", source: "spell",
        spellId: source ?? "clicky", scaledTarget, scaledStat, scaledValue, roundsLeft: duration,
    });
    await target.update({ "system.status.spellEffects": list });
    // Hasted/slowed visual indicators (2026-10-07)
    if (scaledTarget === "haste" && scaledValue > 0) {
        try {
            const { applyStatusEffect } = await import("../spells/status-wiring.js");
            await applyStatusEffect(target, "hasted", `${label} (Clicky)`, duration, "icons/svg/lightning.svg", { source });
        } catch (e) { /* ignore */ }
    } else if (scaledTarget === "slow" && scaledValue > 0) {
        try {
            const { applyStatusEffect } = await import("../spells/status-wiring.js");
            await applyStatusEffect(target, "slowed", `${label} (Clicky)`, duration, "icons/svg/clock.svg", { source });
        } catch (e) { /* ignore */ }
    }
    return { type: "buff", final: scaledValue, notes: [`${label} for ${duration} rounds`], source, applied: true };
}

/** "heal" — restore concussion hits taken (system.hits.value), floored at 0. */
async function applyHeal({ effect, target, source }) {
    const miss = requireTarget(target, "heal", source);
    if (miss) return miss;
    const rolled = rollRange(effect.min ?? 0, effect.max ?? 0);
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
        else if (effect.type === "stun") results.push(await applyStun({ effect, target, source }));
        else if (effect.type === "debuff") results.push(await applyDebuff({ effect, target, source }));
        else if (effect.type === "dot") results.push(await applyDot({ effect, target, source }));
        else if (effect.type === "hot") results.push(await applyHot({ effect, target, source }));
        else if (effect.type === "root") results.push(await applyRoot({ effect, target, source }));
        else if (effect.type === "snare") results.push(await applySnare({ effect, target, source }));
        else if (effect.type === "fear") results.push(await applyFear({ effect, target, source }));
        else if (effect.type === "mez") results.push(await applyMez({ effect, target, source }));
        else if (effect.type === "summon") results.push(await applySummon({ effect, caster, target, source }));
        else if (effect.type === "utility") results.push(await applyUtility({ effect, source, target, caster }));
        else results.push({ type: effect.type ?? "unknown", final: 0, notes: ["unknown payload type"], source });
    }
    return results;
}
