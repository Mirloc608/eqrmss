// ============================================================
// DISPEL (2026-10-07). EQ Cancel Magic / dispel mechanics.
//
// Cancel Magic removes magical buffs from the target. Higher-level
// dispels remove more effects.
//
// Spell data shapes:
//   { type: "utility", effect: "dispel", amount: <n> }           — Cancel Magic (n=1), Recant Magic (n=9)
//   { type: "utility", effect: "dispel-magic", amount: <n> }     — variant
//   { type: "utility", effect: "cancel-magic", rank: <n> }       — variant
//   { type: "utility", effect: "dispel-beneficial", amount: <n>} — Nature's Entropy (beneficial only)
//   { type: "utility", effect: "dispel-detrimental", amount: <n>}— Pure Spirit (detrimental only)
//
// What counts as "magical" (removable):
//   - system.status.spellEffects with source "spell", "song",
//     "triggered:*", "proc:*" (NOT "worn:*" — those are from
//     equipped items, not cast magic)
//   - system.status.dots (damage over time — detrimental)
//   - system.status.damageShield, absorb, illusion, levitate,
//     seeInvisible, infravision, ultravision (beneficial trackers)
//   - ActiveEffects: hasted, slowed, invisible, flying, etc.
//
// Worn effects are NOT dispellable (they come from gear).
//
// Removal order: most recently applied first (LIFO).
// ============================================================

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/**
 * Determine if a spellEffects entry is beneficial or detrimental.
 * @param {object} e - spellEffects entry
 * @returns {"beneficial"|"detrimental"|"neutral"}
 */
function effectAlignment(e) {
    const kind = String(e?.kind ?? "").toLowerCase();
    if (kind === "regen") return "beneficial";
    if (kind === "buff") {
        const val = Number(e?.scaledValue ?? e?.amount ?? 0);
        if (val > 0) return "beneficial";
        if (val < 0) return "detrimental";
        // Zero-value buffs (e.g., haste/slow markers) — check the target
        const target = String(e?.scaledTarget ?? e?.stat ?? "").toLowerCase();
        if (target === "slow") return "detrimental";
        return "beneficial";
    }
    return "neutral";
}

/**
 * Check if a spellEffects entry is from cast magic (dispellable)
 * vs worn gear (not dispellable).
 */
function isDispellableSource(e) {
    const src = String(e?.source ?? "");
    if (src === "spell" || src === "song") return true;
    if (src.startsWith("triggered:") || src.startsWith("proc:")) return true;
    // "worn:" and anything else — not dispellable
    return false;
}

/**
 * Apply a dispel to the target, removing up to `count` magical effects.
 *
 * @param {Actor} caster - the actor casting the dispel
 * @param {Actor} target - the actor being dispelled
 * @param {object} opts - { count = 1, mode = "all"|"beneficial"|"detrimental", sourceName = "Cancel Magic" }
 * @returns {Promise<string>} HTML chat note
 */
export async function applyDispel(caster, target, { count = 1, mode = "all", sourceName = "Cancel Magic" } = {}) {
    if (!target) return `<p><em>Dispel not applied — no target.</em></p>`;
    const canTouch = target.isOwner || globalThis.game?.user?.isGM;
    if (!canTouch) return `<p><em>Dispel not applied — you don't control ${esc(target.name)}.</em></p>`;

    const removed = [];
    let remaining = Math.max(1, Number(count) || 1);

    const wantBeneficial = mode === "all" || mode === "beneficial";
    const wantDetrimental = mode === "all" || mode === "detrimental";

    // --- 1. Timed spellEffects (LIFO — most recent first) ---
    try {
        const effects = Array.isArray(target.system?.status?.spellEffects)
            ? [...target.system.status.spellEffects] : [];
        const kept = [];
        // Iterate in reverse (most recent first)
        for (let i = effects.length - 1; i >= 0; i--) {
            const e = effects[i];
            if (remaining <= 0 || !isDispellableSource(e)) {
                kept.unshift(e);
                continue;
            }
            const align = effectAlignment(e);
            const matches = (align === "beneficial" && wantBeneficial)
                || (align === "detrimental" && wantDetrimental)
                || (align === "neutral" && mode === "all");
            if (!matches) {
                kept.unshift(e);
                continue;
            }
            removed.push(e?.label || e?.song || e?.spell || "magical effect");
            remaining--;
            // Don't add to kept — it's removed
        }
        if (removed.length > 0 || kept.length !== effects.length) {
            await target.update({ "system.status.spellEffects": kept });
        }
    } catch (err) { /* ignore */ }

    // --- 2. Damage-over-time (detrimental) ---
    if (remaining > 0 && wantDetrimental) {
        try {
            const dots = Array.isArray(target.system?.status?.dots)
                ? [...target.system.status.dots] : [];
            const kept = [];
            for (let i = dots.length - 1; i >= 0; i--) {
                const d = dots[i];
                if (remaining <= 0) { kept.unshift(d); continue; }
                // Only dispel magical DoTs (not bleed)
                const src = String(d?.source ?? "");
                if (src === "spell" || src === "song" || src.startsWith("triggered:")) {
                    removed.push(d?.name || "damage over time");
                    remaining--;
                } else {
                    kept.unshift(d);
                }
            }
            if (kept.length !== dots.length) {
                await target.update({ "system.status.dots": kept });
            }
        } catch (err) { /* ignore */ }
    }

    // --- 3. Beneficial status trackers ---
    if (remaining > 0 && wantBeneficial) {
        const trackers = [
            ["system.status.damageShield", "damage shield"],
            ["system.status.absorb", "absorb shield"],
            ["system.status.illusion", "illusion"],
            ["system.status.levitate", "levitation"],
            ["system.status.seeInvisible", "see invisible"],
            ["system.status.infravision", "infravision"],
            ["system.status.ultravision", "ultravision"],
        ];
        for (const [path, label] of trackers) {
            if (remaining <= 0) break;
            try {
                const val = path.split(".").reduce((o, k) => o?.[k], target.system);
                if (val && typeof val === "object") {
                    removed.push(val?.source ? `${label} (${val.source})` : label);
                    await target.update({ [path]: null });
                    remaining--;
                }
            } catch (err) { /* ignore */ }
        }
    }

    // --- 4. ActiveEffects (haste, slow, invis, flying, etc.) ---
    if (remaining > 0) {
        try {
            const { hasStatusEffect, removeStatusEffect } = await import("./status-wiring.js");
            const statuses = [
                { id: "hasted", label: "haste", beneficial: true },
                { id: "slowed", label: "slow", beneficial: false },
                { id: "invisible", label: "invisibility", beneficial: true },
                { id: "flying", label: "levitation", beneficial: true },
                { id: "stunned", label: "stun", beneficial: false },
            ];
            for (const s of statuses) {
                if (remaining <= 0) break;
                const isBen = s.beneficial;
                if ((isBen && !wantBeneficial) || (!isBen && !wantDetrimental)) continue;
                if (hasStatusEffect(target, s.id)) {
                    await removeStatusEffect(target, s.id);
                    removed.push(s.label);
                    remaining--;
                }
            }
        } catch (err) { /* ignore */ }
    }

    // --- Build the chat note ---
    if (removed.length === 0) {
        return `<p><em>${esc(target.name)} has no dispellable magic (${esc(sourceName)}).</em></p>`;
    }
    const lines = removed.map(r => `${esc(target.name)}'s ${esc(r)} is dispelled.`);
    return `<p><em>${lines.join("<br>")} (${esc(sourceName)})</em></p>`;
}
