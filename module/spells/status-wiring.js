// ============================================================
// STATUS WIRING (2026-10-07). Shared helpers for wiring EQ
// mechanics to Foundry's native ActiveEffect status system.
// ============================================================

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/**
 * Apply a Foundry status effect to a target via ActiveEffect.
 * @param {Actor} target - the actor gaining the status
 * @param {string} statusId - Foundry status ID (e.g., "flying", "frightened")
 * @param {string} name - display name for the effect
 * @param {number} rounds - duration in combat rounds
 * @param {string} img - icon path
 * @param {object} flags - extra flags.eqrmss entries
 * @returns {Promise<boolean>} true if applied
 */
export async function applyStatusEffect(target, statusId, name, rounds = 10, img = "icons/svg/aura.svg", flags = {}) {
    if (!target) return false;
    const canTouch = target.isOwner || globalThis.game?.user?.isGM;
    if (!canTouch) return false;
    const r = Math.max(1, Math.round(Number(rounds) || 10));
    try {
        // Idempotent (2026-10-08): remove existing effects with the same
        // statusId before creating the new one. Prevents duplicate
        // "X (Haste)" ActiveEffects when songs/spells re-apply each round.
        const existing = [...(target.effects?.contents ?? target.effects ?? [])];
        const toDelete = existing
            .filter(e => {
                const statuses = e.statuses ?? e.system?.statuses ?? [];
                return [...statuses].includes(statusId);
            })
            .map(e => e.id ?? e._id)
            .filter(Boolean);
        if (toDelete.length) {
            await target.deleteEmbeddedDocuments("ActiveEffect", toDelete);
        }
        await target.createEmbeddedDocuments("ActiveEffect", [{
            name: `${name}`,
            img,
            statuses: [statusId],
            duration: { rounds: r },
            flags: {
                eqrmss: {
                    category: "status",
                    ...flags
                }
            }
        }]);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Remove a Foundry status effect from a target.
 * @param {Actor} target - the actor losing the status
 * @param {string} statusId - Foundry status ID to remove
 * @returns {Promise<boolean>} true if removed
 */
export async function removeStatusEffect(target, statusId) {
    if (!target) return false;
    const canTouch = target.isOwner || globalThis.game?.user?.isGM;
    if (!canTouch) return false;
    try {
        const effects = [...(target.effects?.contents ?? target.effects ?? [])];
        const toDelete = effects
            .filter(e => {
                const statuses = e.statuses ?? e.system?.statuses ?? [];
                return [...statuses].includes(statusId);
            })
            .map(e => e.id ?? e._id)
            .filter(Boolean);
        if (toDelete.length) {
            await target.deleteEmbeddedDocuments("ActiveEffect", toDelete);
            return true;
        }
    } catch (e) { /* ignore */ }
    return false;
}

/**
 * Check if a target has a Foundry status effect.
 * @param {Actor} target - the actor to check
 * @param {string} statusId - Foundry status ID
 * @returns {boolean}
 */
export function hasStatusEffect(target, statusId) {
    if (!target) return false;
    try {
        const effects = [...(target.effects?.contents ?? target.effects ?? [])];
        return effects.some(e => {
            const statuses = e.statuses ?? e.system?.statuses ?? [];
            return [...statuses].includes(statusId);
        });
    } catch (e) {
        return false;
    }
}

/**
 * Haste/Slow mutual exclusion (user ruling 2026-10-12).
 * Slow and haste do not stack across spells, procs/clickies, and songs:
 * - Applying slow dispels existing haste from those sources completely.
 * - Applying haste while the target is slowed by those sources bounces
 *   (no effect).
 * Worn effects are exempt both ways — they neither trigger nor suffer
 * dispel/bounce, and worn haste/slow coexist with everything.
 *
 * @param {Actor} target - the buff target
 * @param {"haste"|"slow"} newKind - what's being applied
 * @param {string} origin - "spell", "song", "proc:<id>", "triggered:<id>",
 *   "clicky...", or "worn:<id>"
 * @returns {"apply"|"bounce"|"dispel"}
 */
export function hasteSlowExclusion(target, newKind, origin) {
    if (String(origin ?? "").startsWith("worn:")) return "apply";
    const fx = target?.system?.status?.spellEffects;
    if (!Array.isArray(fx)) return "apply";
    const opposite = newKind === "slow" ? "haste" : "slow";
    const hasOpposite = fx.some(e => {
        if (e?.scaledTarget !== opposite) return false;
        const sid = String(e?.spellId ?? e?.songId ?? "");
        if (sid.startsWith("worn:")) return false;
        if (e?.source === "worn") return false;
        return true;
    });
    if (!hasOpposite) return "apply";
    return newKind === "slow" ? "dispel" : "bounce";
}

/**
 * Dispel haste (user ruling 2026-10-12): remove all non-worn haste
 * spellEffects entries. The "hasted" marker is removed only if no haste
 * of any kind remains (worn haste keeps its marker).
 * @param {Actor} target - the actor losing haste
 * @returns {Promise<boolean>} true if anything was dispelled
 */
export async function dispelHaste(target) {
    if (!target) return false;
    const fx = target?.system?.status?.spellEffects;
    let removed = false;
    if (Array.isArray(fx)) {
        const kept = fx.filter(e => {
            if (e?.scaledTarget !== "haste") return true;
            const sid = String(e?.spellId ?? e?.songId ?? "");
            if (sid.startsWith("worn:") || e?.source === "worn") return true;
            removed = true;
            return false;
        });
        if (removed) await target.update({ "system.status.spellEffects": kept });
    }
    if (removed) {
        const stillHasted = (target?.system?.status?.spellEffects ?? [])
            .some(e => e?.scaledTarget === "haste");
        if (!stillHasted) await removeStatusEffect(target, "hasted");
    }
    return removed;
}

/**
 * Resolve to the base actor for unlinked tokens (2026-10-12).
 * Synthetic token actors don't persist to the base actor, so buffs
 * applied to them are invisible to ticks and sheet displays sweeping
 * game.actors. Returns the base actor if resolvable, else the input.
 * @param {Actor} target - the actor (possibly synthetic)
 * @returns {Actor} the base actor
 */
export function baseActorOf(target) {
    const baseId = target?.token?.actorId;
    if (baseId) {
        return globalThis.game?.actors?.get(baseId) ?? target;
    }
    return target;
}

/**
 * Sync tracker-based conditions to Foundry token markers.
 * Called each tick in tickConditions().
 * - Any stun pool component > 0 → `stunned`
 * - system.status.prone.rounds > 0 → `prone`
 * - system.status.bleed.perRound > 0 → `bleeding` (custom icon, not in core)
 */
export async function syncTrackerStatuses(actor) {
    if (!actor) return;
    const canTouch = actor.isOwner || globalThis.game?.user?.isGM;
    if (!canTouch) return;
    const sys = actor.system ?? {};

    // Stun: any component of the stun pool > 0
    const stun = sys.status?.stun ?? {};
    const stunned = (Number(stun.stunned) || 0) + (Number(stun.stunNoParry) || 0) + (Number(stun.downOrOut) || 0) > 0;
    await syncOne(actor, "stunned", stunned);

    // Prone
    const prone = (Number(sys.status?.prone?.rounds) || 0) > 0;
    await syncOne(actor, "prone", prone);

    // Bleeding (custom status, not in Foundry core)
    const bleeding = (Number(sys.status?.bleed?.perRound) || 0) > 0;
    if (bleeding && !hasStatusEffect(actor, "bleeding")) {
        await applyStatusEffect(actor, "bleeding", "Bleeding", 99, "icons/svg/blood.svg", { source: "tracker" });
    } else if (!bleeding && hasStatusEffect(actor, "bleeding")) {
        await removeStatusEffect(actor, "bleeding");
    }
}

/** Sync a single core status to a boolean condition. */
async function syncOne(actor, statusId, shouldHave) {
    const has = hasStatusEffect(actor, statusId);
    if (shouldHave && !has) {
        try {
            await actor.toggleStatusEffect(statusId, { active: true });
        } catch (e) {
            await applyStatusEffect(actor, statusId, statusId, 99, "icons/svg/aura.svg", { source: "tracker" });
        }
    } else if (!shouldHave && has) {
        try {
            await actor.toggleStatusEffect(statusId, { active: false });
        } catch (e) {
            await removeStatusEffect(actor, statusId);
        }
    }
}
