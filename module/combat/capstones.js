/**
 * Era Capstones: Active abilities earned at level cap increases (65→125).
 * (2026-10-09, refresh tiers 2026-10-09, Phase 2 mechanics 2026-10-09)
 *
 * Each capstone is a hand-designed active ability with an EQ canon name.
 * They appear in the Disciplines tab.
 *
 * Refresh tiers (tabletop-appropriate, not minute-based):
 * - "combat": refreshes at end of combat
 * - "rest": refreshes at end of rest (short rest)
 * - "day": refreshes at end of day (long rest)
 *
 * Used capstones tracked in system.status.capstonesUsed = [capstoneId, ...]
 */

import { getAvailableCapstones } from "../data/loaders/capstone-loader.js";

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

/**
 * Check if a capstone is used (on cooldown) for an actor.
 */
export function isCapstoneUsed(actor, capstoneId) {
    const used = actor.system?.status?.capstonesUsed || [];
    return used.includes(capstoneId);
}

/**
 * Activate a capstone for an actor.
 * Returns { ok: boolean, message: string }
 */
export async function activateCapstone(actor, capstoneId, target = null) {
    const capstone = globalThis.game?.eqrmss?.capstones?.byId?.[capstoneId];
    if (!capstone) {
        return { ok: false, message: `Capstone not found: ${capstoneId}` };
    }

    // Check class
    const classId = actor.system?.origin?.classId?.toLowerCase();
    if (capstone.class !== classId && capstone.class !== "shared") {
        return { ok: false, message: `${capstone.name} is not available to ${classId}.` };
    }

    // Check level
    const actorLevel = Number(actor.system?.attributes?.level?.value) || 1;
    if (actorLevel < capstone.level) {
        return { ok: false, message: `${capstone.name} requires level ${capstone.level}.` };
    }

    // Check if already used
    if (isCapstoneUsed(actor, capstoneId)) {
        const refresh = capstone.refresh || "combat";
        const refreshText = refresh === "combat" ? "end of combat" : refresh === "rest" ? "end of rest" : "end of day";
        return { ok: false, message: `${capstone.name} has been used. Refreshes at ${refreshText}.` };
    }

    // Mark as used
    const used = [...(actor.system?.status?.capstonesUsed || [])];
    if (!used.includes(capstoneId)) {
        used.push(capstoneId);
    }
    await actor.update({ "system.status.capstonesUsed": used });

    // Execute mechanical effects (Phase 2)
    let mechNotes = [];
    try {
        const { executeCapstoneMechanics } = await import("./capstone-effects.js");
        mechNotes = await executeCapstoneMechanics(actor, capstone, target);
    } catch (e) {
        console.error(`EQRMSS | capstone mechanics failed for ${capstoneId}`, e);
        mechNotes = [`<em>Mechanical effect failed: ${esc(e.message)}</em>`];
    }

    // Post to chat
    const refresh = capstone.refresh || "combat";
    const refreshText = refresh === "combat" ? "End of Combat" : refresh === "rest" ? "End of Rest" : "End of Day";
    const mechHtml = mechNotes.length ? `<div class="capstone-mechanics">${mechNotes.join("<br>")}</div>` : "";
    const chatContent = `
        <div class="eqrmss-capstone">
            <h3>${esc(capstone.name)}</h3>
            <p><strong>${esc(actor.name)}</strong> invokes <strong>${esc(capstone.name)}</strong>!</p>
            <p><em>${esc(capstone.description)}</em></p>
            <p>Effect: ${esc(capstone.effect)}</p>
            ${mechHtml}
            <p>Refresh: ${refreshText}</p>
        </div>
    `;

    if (globalThis.ChatMessage) {
        await globalThis.ChatMessage.create({
            content: chatContent,
            speaker: globalThis.ChatMessage.getSpeaker({ actor }),
        });
    }

    return { ok: true, message: `${capstone.name} activated!` };
}

/**
 * Refresh capstones by tier.
 * @param {Actor} actor - The actor
 * @param {string} tier - "combat", "rest", or "day"
 *   - "combat": clears combat-tier only
 *   - "rest": clears combat + rest tiers
 *   - "day": clears all tiers
 */
export async function refreshCapstones(actor, tier) {
    const capstones = globalThis.game?.eqrmss?.capstones?.byId || {};
    const used = [...(actor.system?.status?.capstonesUsed || [])];

    const tiersToClear = tier === "day" ? ["combat", "rest", "day"] :
                         tier === "rest" ? ["combat", "rest"] :
                         ["combat"];

    const remaining = used.filter(id => {
        const c = capstones[id];
        if (!c) return false; // Remove stale IDs
        const refresh = c.refresh || "combat";
        return !tiersToClear.includes(refresh);
    });

    await actor.update({ "system.status.capstonesUsed": remaining });
    return { refreshed: used.length - remaining.length, remaining: remaining.length };
}

/**
 * Get capstones for display on the character sheet, with used status.
 */
export function getCapstonesForSheet(actor) {
    const available = getAvailableCapstones(actor);
    return available.map(c => ({
        ...c,
        onCooldown: isCapstoneUsed(actor, c.id),
        refresh: c.refresh || "combat",
    }));
}
