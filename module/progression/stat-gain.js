/**
 * Stat gain rolls — RMSS §5.3 step A (Table 15.1.2).
 *
 * Implementation for xp-engine.js applyLevelUp(), which dynamically
 * imports rollStatGains() / formatStatGainSummary() from this module.
 * (This file was committed empty in 4e46f841, so PC level-up stat
 * gains silently no-oped until this implementation, 2026-10-20.)
 *
 * Every stat with potential > temporary rolls a non-open-ended d100
 * on Table 15.1.2 (data: module/data/stats/rmss-stat-gain.js):
 *   - the table cell is added to the temporary value, capped at the
 *     potential;
 *   - a roll of 01–04 is overstress ("*" in the book): per the user's
 *     table image (2026-10-16), the temporary value DECREASES by twice
 *     the roll (floor 1). The NPC build sim applies the same rule.
 *
 * Gains are applied to the actor here — before xp-engine computes
 * Development Points from the new temporary values — and the per-stat
 * results are returned for the level-up summary / chat card.
 */

import { statGainFor } from "../data/stats/rmss-stat-gain.js";

// All ten stats roll (Table 15.1.2) — same key set/order as the NPC
// build engine's NPC_STAT_KEYS. Actor entries live at
// system.stats.stats.<KEY> = { temp, potential, racial_bonus, ... }.
const STAT_KEYS = ["ST", "AG", "SD", "CO", "ME", "RE", "IN", "PR", "QU", "EM"];

const d100 = () => 1 + Math.floor(Math.random() * 100);

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]
));

/**
 * Roll Table 15.1.2 for every stat below its potential and apply the
 * results to the actor.
 * @param {Actor} actor
 * @returns {Promise<Array>} one entry per stat: { stat, rolled, roll,
 *   diff, gain, overstressed, oldTemp, newTemp, change }
 */
export async function rollStatGains(actor) {
    const stats = actor?.system?.stats?.stats ?? {};
    const results = [];
    const updates = {};
    for (const key of STAT_KEYS) {
        const entry = stats[key];
        if (!entry) continue;
        const temp = Number(entry.temp ?? entry.total ?? entry.value ?? 0);
        const potential = Number(entry.potential ?? temp);
        const diff = potential - temp;
        if (!(diff > 0)) {
            results.push({
                stat: key, rolled: false, roll: 0, diff, gain: 0,
                overstressed: false, oldTemp: temp, newTemp: temp, change: 0
            });
            continue;
        }
        const roll = d100();
        const { gain, overstressed } = statGainFor(roll, diff);
        let newTemp = temp;
        if (overstressed) {
            // Table 15.1.2 overstress (user's table image, 2026-10-16):
            // the temporary value decreases by twice the roll.
            newTemp = Math.max(1, temp - 2 * roll);
        } else if (gain > 0) {
            newTemp = Math.min(potential, temp + gain);
        }
        results.push({
            stat: key, rolled: true, roll, diff, gain,
            overstressed, oldTemp: temp, newTemp, change: newTemp - temp
        });
        if (newTemp !== temp) {
            updates[`system.stats.stats.${key}.temp`] = newTemp;
            // Preserve the creation invariant total = temp + bonuses.
            const racial = Number(entry.racial_bonus ?? 0);
            const special = Number(entry.special_bonus ?? 0);
            updates[`system.stats.stats.${key}.total`] = newTemp + racial + special;
        }
    }
    if (actor && Object.keys(updates).length) {
        await actor.update(updates);
    }
    return results;
}

/**
 * HTML for the level-up chat card (xp-engine wraps it in the header).
 * @param {Array} gains - the array returned by rollStatGains()
 * @returns {string}
 */
export function formatStatGainSummary(gains) {
    const rows = (Array.isArray(gains) ? gains : []).filter(g => g.rolled);
    if (!rows.length) {
        return `<p><em>No stat gain rolls — every stat is already at its potential.</em></p>`;
    }
    const lines = rows.map(g => {
        if (g.overstressed) {
            return `<li><strong>${esc(g.stat)}</strong>: rolled ${g.roll} — <strong>overstressed!</strong> Temporary ${g.oldTemp} → ${g.newTemp} (${g.change})</li>`;
        }
        if (g.change > 0) {
            return `<li><strong>${esc(g.stat)}</strong>: rolled ${g.roll} (difference ${g.diff}) → +${g.change} (Temporary ${g.oldTemp} → ${g.newTemp})</li>`;
        }
        return `<li><strong>${esc(g.stat)}</strong>: rolled ${g.roll} (difference ${g.diff}) → no change (Temporary ${g.oldTemp})</li>`;
    });
    return `<ul>${lines.join("")}</ul>`;
}
