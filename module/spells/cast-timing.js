// ============================================================
// Cast Time & Range Enforcement (Option A/B GM toggle)
// ============================================================
// Cast time mode is a GM world setting ("eqrmss", "castTimeMode"):
//   "rounds"  — Option A: spells take ceil(castTime/6) rounds; mana
//               spent upfront, spell fires after the delay. Damage
//               while waiting forces a Channeling roll to keep
//               casting (user ruling 2026-11-06); critical hits and
//               stuns interrupt outright (mana lost).
//   "instant" — Option B: spells fire immediately, but if the caster
//               took damage this round before casting, they must pass
//               a Channeling save (+25, AAs can add) or it fizzles.
//   "off"     — Option C: no cast-time enforcement (range still enforced).
//
// Range is always enforced when tokens are measurable: the target
// must be within spell range × worn range factor.

export function getCastTimeMode() {
    try {
        return globalThis.game?.settings?.get("eqrmss", "castTimeMode") ?? "rounds";
    } catch (e) {
        return "rounds";
    }
}

/** Effective cast time in seconds (EQ base × worn factor). */
export function effectiveCastTime(spellItem, castFactor = 1) {
    const base = Number(spellItem?.system?.castTime);
    if (!Number.isFinite(base) || base <= 0) return 0;
    const f = Number(castFactor);
    return base * (Number.isFinite(f) && f > 0 ? f : 1);
}

/** Rounds of delay: ceil(castTime / 6). 0-1 rounds = immediate. */
export function waitRoundsFor(spellItem, castFactor = 1) {
    const secs = effectiveCastTime(spellItem, castFactor);
    if (secs <= 0) return 0;
    return Math.ceil(secs / 6);
}

/** Effective range in feet (EQ base × worn factor). */
export function effectiveRange(spellItem, rangeFactor = 1) {
    const base = Number(spellItem?.system?.range);
    if (!Number.isFinite(base) || base < 0) return Infinity;
    const f = Number(rangeFactor);
    return base * (Number.isFinite(f) && f > 0 ? f : 1);
}

/**
 * Pixel-math distance in feet between two tokens (same deterministic
 * math as the ball-spell sweep — no grid-API dependence).
 * Returns null when the canvas/tokens are unavailable.
 */
function tokenDistanceFt(fromTok, toTok) {
    const canvas = globalThis.canvas;
    const size = Number(canvas?.dimensions?.size) || 0;
    const dist = Number(canvas?.dimensions?.distance) || 0;
    if (!(size > 0) || !(dist > 0)) return null;
    const a = fromTok?.center, b = toTok?.center;
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y) / size * dist;
}

/**
 * Range check: every target must be within effective range of the caster.
 * Returns {ok:true} or {ok:false, reason, detail}.
 * Skips the check when tokens can't be measured (theater of mind).
 * Self-targeted and touch-range (0) spells: touch requires adjacency (5ft).
 */
export function checkRange(actor, spellItem, targetActors, rangeFactor = 1) {
    const range = effectiveRange(spellItem, rangeFactor);
    if (!Number.isFinite(range)) return { ok: true };
    if (!targetActors?.length) return { ok: true };

    const casterTok = actor.getActiveTokens?.()?.[0] ?? null;
    if (!casterTok) return { ok: true }; // no token: can't measure

    const maxRange = range <= 0 ? 5 : range; // touch = adjacent
    for (const target of targetActors) {
        if (!target || target.id === actor.id) continue; // self always in range
        const targetTok = target.getActiveTokens?.()?.[0] ?? null;
        if (!targetTok) continue; // can't measure: allow
        const feet = tokenDistanceFt(casterTok, targetTok);
        if (feet === null) continue;
        if (feet > maxRange + 1e-6) {
            return {
                ok: false,
                reason: "range",
                detail: `${target.name} is ${Math.round(feet)} ft away (range ${Math.round(maxRange)} ft).`
            };
        }
    }
    return { ok: true };
}

/**
 * Store a pending delayed cast on the actor.
 * waitRounds = full rounds to wait before firing.
 */
export async function storePendingCast(actor, spellItem, targetIds, opts, waitRounds) {
    const pending = {
        spellItemId: spellItem.id ?? spellItem._id,
        spellName: spellItem.name ?? "spell",
        targetIds: targetIds ?? [],
        // Serializable opts subset (avoid functions/actors)
        opts: {
            rangeFeet: opts.rangeFeet,
            cover: opts.cover,
            staticTarget: opts.staticTarget,
            willing: opts.willing,
            rrMod: opts.rrMod,
            centerId: opts.centerId
        },
        roundsLeft: waitRounds,
        totalRounds: waitRounds
    };
    // Unlinked tokens (2026-10-09): store on the base actor so the
    // tick sweep (which iterates game.actors) can find it.
    const baseActor = actor?.isToken
        ? (globalThis.game?.actors?.get(actor?.token?.actorId) ?? actor)
        : actor;
    await baseActor.update({ "system.status.pendingCast": pending });
}

/** Clear a pending cast (fired or interrupted). */
export async function clearPendingCast(actor) {
    const baseActor = actor?.isToken
        ? (globalThis.game?.actors?.get(actor?.token?.actorId) ?? actor)
        : actor;
    if (baseActor.system?.status?.pendingCast) {
        await baseActor.update({ "system.status.pendingCast": null });
    }
}

/**
 * Channeling concentration (user ruling 2026-11-06). Damage taken
 * while casting no longer interrupts automatically: the caster
 * rolls d100 against their effective Channeling — the skill total
 * plus worn Channeling mods — read directly as the percent chance
 * to cast through the hit. The total is clamped to 95: nobody is
 * ever uninterruptible. Critical hits and stuns bypass the roll
 * (automatic interrupts). This is what the channeling-mod worn
 * family (e.g. Shoulderwraps of the Pure) feeds.
 *
 * effectiveChannelingChance is the pure math, exported for tests.
 */
export function effectiveChannelingChance(skill, wornMod, bonus = 0) {
    const total = (Number(skill) || 0) + (Number(wornMod) || 0) + (Number(bonus) || 0);
    return Math.max(0, Math.min(95, Math.floor(total)));
}

/** The caster's Channeling skill total (0 when unreadable). */
async function channelingSkillOf(actor) {
    try {
        const { resolveActorSkillProfile } = await import("../utils/skills/index.js");
        const profile = resolveActorSkillProfile(actor, "skill-channeling");
        return Number(profile?.totalBonus) || 0;
    } catch (e) {
        return 0; // registry not ready / no skill item: unskilled
    }
}

/** Highest worn Channeling mod on the caster (def stacking: highest). */
async function wornChannelingModOf(actor) {
    try {
        const { getItemEffect } = await import("../data/item-effects/item-effect-loader.js");
        const { dedupHighestRank } = await import("../item-effects/worn-engine.js");
        const { isWorn } = await import("../utils/equipment/equipment-utils.js");
        const worn = (actor?.items ?? []).filter(i => isWorn(i) && i.system?.wornEffect);
        if (!worn.length) return 0;
        const resolved = worn.map(item => ({ item, effect: getItemEffect(item.system.wornEffect) }));
        const { kept } = dedupHighestRank(resolved);
        let mod = 0;
        for (const { effect } of kept) {
            if (!effect || effect.kind !== "worn") continue;
            for (const p of effect.payload ?? []) {
                if (p?.type === "modifier" && String(p.modifier ?? "").toLowerCase() === "channeling") {
                    mod = Math.max(mod, Number(p.value) || 0);
                }
            }
        }
        return mod;
    } catch (e) {
        return 0;
    }
}

/**
 * AA/capstone "fizzle-save" modifiers on the caster (flat points).
 * Read from spellEffects entries in the same modifier shape the
 * capstone no-interrupt check uses; AA passives that stamp
 * source "aa" entries plug straight in. Feeds the Option B save.
 */
export function fizzleSaveBonus(actor) {
    let bonus = 0;
    try {
        const effects = actor?.system?.status?.spellEffects || [];
        for (const e of effects) {
            if (e.source !== "aa" && e.source !== "capstone") continue;
            for (const m of (e.modifiers || [])) {
                if (m.target === "fizzle-save") bonus += Number(m.value) || 0;
            }
            if (e.scaledTarget === "fizzle-save") bonus += Number(e.scaledValue) || 0;
        }
    } catch (e) { /* non-fatal */ }
    return bonus;
}

/**
 * Roll the Channeling save for a caster. `bonus` adds flat points
 * (Option B's +25 rides here). Returns the full breakdown so the
 * caller can narrate the roll.
 */
export async function rollChannelingSave(actor, { bonus = 0 } = {}) {
    const skill = await channelingSkillOf(actor);
    const wornMod = await wornChannelingModOf(actor);
    const chance = effectiveChannelingChance(skill, wornMod, bonus);
    const roll = Math.ceil(Math.random() * 100);
    return { roll, chance, skill, wornMod, bonus: Number(bonus) || 0, success: roll <= chance };
}

/**
 * Interrupt a pending cast (damage, crit or stun while waiting).
 * Mana was already spent at declaration — it is lost.
 *
 * Damage rolls the Channeling save first: a pass keeps the cast
 * alive (user ruling 2026-11-06). Crits (routed here by
 * applyCritConditions) and stuns interrupt outright. Capstone
 * no-interrupt still trumps everything.
 */
export async function interruptPendingCast(actor, reason) {
    const pending = actor.system?.status?.pendingCast;
    if (!pending) return false;
    // Era Capstones (2026-10-09): no-interrupt prevents interruption.
    try {
        const effects = actor.system?.status?.spellEffects || [];
        for (const e of effects) {
            if (e.source !== "capstone") continue;
            for (const m of (e.modifiers || [])) {
                if (m.target === "no-interrupt") {
                    return false; // Not interrupted
                }
            }
        }
    } catch (e) { /* non-fatal */ }
    if (reason === "damage") {
        const save = await rollChannelingSave(actor);
        if (save.success) {
            await globalThis.ChatMessage?.create({
                speaker: globalThis.ChatMessage.getSpeaker({ actor }),
                content: `<p><em>${actor.name} channels through the hit (${save.roll} vs ${save.chance}% Channeling) — ${pending.spellName} continues!</em></p>`
            });
            return false; // Not interrupted: cast survives
        }
        await clearPendingCast(actor);
        await globalThis.ChatMessage?.create({
            speaker: globalThis.ChatMessage.getSpeaker({ actor }),
            content: `<p><em>${actor.name}'s ${pending.spellName} is interrupted — concentration lost when damaged (${save.roll} vs ${save.chance}% Channeling)! (mana lost)</em></p>`
        });
        return true;
    }
    await clearPendingCast(actor);
    const why = reason === "stun" ? "stunned"
        : reason === "crit" ? "struck by a critical hit"
        : "damaged";
    await globalThis.ChatMessage?.create({
        speaker: globalThis.ChatMessage.getSpeaker({ actor }),
        content: `<p><em>${actor.name}'s ${pending.spellName} is interrupted — ${why} while casting! (mana lost)</em></p>`
    });
    return true;
}
