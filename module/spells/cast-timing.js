// ============================================================
// Cast Time & Range Enforcement (Option A/B GM toggle)
// ============================================================
// Cast time mode is a GM world setting ("eqrmss", "castTimeMode"):
//   "rounds"  — Option A: spells take ceil(castTime/6) rounds; mana
//               spent upfront, spell fires after the delay, damage
//               or stun while waiting interrupts (mana lost).
//   "instant" — Option B: spells fire immediately, but if the caster
//               took damage this round before casting, it fizzles.
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
    await actor.update({ "system.status.pendingCast": pending });
}

/** Clear a pending cast (fired or interrupted). */
export async function clearPendingCast(actor) {
    if (actor.system?.status?.pendingCast) {
        await actor.update({ "system.status.pendingCast": null });
    }
}

/**
 * Interrupt a pending cast (damage or stun while waiting).
 * Mana was already spent at declaration — it is lost.
 */
export async function interruptPendingCast(actor, reason) {
    const pending = actor.system?.status?.pendingCast;
    if (!pending) return false;
    await clearPendingCast(actor);
    const why = reason === "stun" ? "stunned" : "damaged";
    await globalThis.ChatMessage?.create({
        speaker: globalThis.ChatMessage.getSpeaker({ actor }),
        content: `<p><em>${actor.name}'s ${pending.spellName} is interrupted — ${why} while casting! (mana lost)</em></p>`
    });
    return true;
}
