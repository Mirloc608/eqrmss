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
