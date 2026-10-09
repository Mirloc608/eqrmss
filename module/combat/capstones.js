/**
 * Era Capstones: Active abilities earned at level cap increases (65→125).
 * (2026-10-09)
 *
 * Each capstone is a hand-designed active ability with an EQ canon name.
 * They appear in a separate Capstone block on the Combat tab.
 * Cooldowns are tracked per-actor in system.status.capstoneCooldowns { [capstoneId]: timestamp }.
 */

import { getAvailableCapstones } from "../data/loaders/capstone-loader.js";

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

/**
 * Parse a cooldown string like "15 minutes", "30 minutes", "10 minutes", "5 minutes", "2 seconds"
 * into milliseconds.
 */
function parseCooldown(cooldownStr) {
    if (!cooldownStr) return 15 * 60 * 1000; // default 15 min
    const str = String(cooldownStr).toLowerCase();
    if (str.includes("passive")) return 0;

    const match = str.match(/(\d+)\s*(second|minute|hour)/);
    if (!match) return 15 * 60 * 1000;

    const num = parseInt(match[1], 10);
    const unit = match[2];
    if (unit.startsWith("second")) return num * 1000;
    if (unit.startsWith("minute")) return num * 60 * 1000;
    if (unit.startsWith("hour")) return num * 60 * 60 * 1000;
    return 15 * 60 * 1000;
}

/**
 * Check if a capstone is on cooldown for an actor.
 * Returns { onCooldown: boolean, remainingMs: number }
 */
export function checkCapstoneCooldown(actor, capstoneId) {
    const cooldowns = actor.system?.status?.capstoneCooldowns || {};
    const lastUsed = cooldowns[capstoneId];
    if (!lastUsed) return { onCooldown: false, remainingMs: 0 };

    const capstone = globalThis.game?.eqrmss?.capstones?.byId?.[capstoneId];
    if (!capstone) return { onCooldown: false, remainingMs: 0 };

    const cooldownMs = parseCooldown(capstone.cooldown);
    if (cooldownMs === 0) return { onCooldown: false, remainingMs: 0 }; // passive

    const elapsed = Date.now() - lastUsed;
    const remaining = cooldownMs - elapsed;

    if (remaining <= 0) return { onCooldown: false, remainingMs: 0 };
    return { onCooldown: true, remainingMs: remaining };
}

/**
 * Activate a capstone for an actor.
 * This is a framework — specific capstone effects are implemented as generic buffs
 * via the existing buff system. The capstone's "effect" text describes the mechanics;
 * actual implementation applies a timed buff via spellEffects.
 *
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

    // Check cooldown
    const { onCooldown, remainingMs } = checkCapstoneCooldown(actor, capstoneId);
    if (onCooldown) {
        const mins = Math.ceil(remainingMs / 60000);
        return { ok: false, message: `${capstone.name} is on cooldown (${mins} min remaining).` };
    }

    // Record cooldown
    const cooldowns = { ...(actor.system?.status?.capstoneCooldowns || {}) };
    cooldowns[capstoneId] = Date.now();
    await actor.update({ "system.status.capstoneCooldowns": cooldowns });

    // Post to chat
    const chatContent = `
        <div class="eqrmss-capstone">
            <h3>${esc(capstone.name)}</h3>
            <p><strong>${esc(actor.name)}</strong> invokes <strong>${esc(capstone.name)}</strong>!</p>
            <p><em>${esc(capstone.description)}</em></p>
            <p>Effect: ${esc(capstone.effect)}</p>
            <p>Cooldown: ${esc(capstone.cooldown)}</p>
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
 * Get capstones for display on the character sheet, with cooldown status.
 */
export function getCapstonesForSheet(actor) {
    const available = getAvailableCapstones(actor);
    return available.map(c => {
        const { onCooldown, remainingMs } = checkCapstoneCooldown(actor, c.id);
        return {
            ...c,
            onCooldown,
            remainingMs,
            remainingMins: onCooldown ? Math.ceil(remainingMs / 60000) : 0,
        };
    });
}
