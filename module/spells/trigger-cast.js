// ============================================================
// EQRMSS Trigger-Cast (2026-10-08)
//
// Spells whose effects include { type: "utility", effect:
// "trigger-cast", name: "<sub-spell slug>", chance?, highestRank? }
// fire a sub-spell as part of the cast.
//
// Resolution:
// - Effects without a chance always fire.
// - Chance effects share one d100, partitioned cumulatively in listed
//   order (e.g. 88/12 -> 1-88 fires the first, 89-100 the second;
//   a lone 82 -> fires on 1-82, nothing on 83-100).
// - The sub-spell is looked up in the EQ catalog by slug (matched
//   against the spell _id infix; a trailing "-effect" is stripped as
//   a fallback). The casting parent itself is never a candidate.
// - Firing is a recursive castSpell in resolve-only mode: no ESF
//   gate, no mana, no cast-time delay — the parent cast already paid.
//   The parent's current targets carry over to the sub-spell.
// - Depth (max 3) and a seen-name set guard against cycles (e.g. a
//   spell triggering itself, or nested trigger-cast chains).
// - A trigger with no matching sub-spell data posts an honest note
//   instead of failing.
// ============================================================

const esc = (s) => globalThis.foundry?.utils?.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");

async function d100() {
    return (await new globalThis.Roll("1d100").evaluate()).total;
}

export function triggerEffectsOf(spellItem) {
    return (spellItem?.system?.effects ?? []).filter(e =>
        String(e?.type ?? "").toLowerCase() === "utility" &&
        String(e?.effect ?? "").toLowerCase() === "trigger-cast");
}

function slugCandidates(slug) {
    const s = String(slug ?? "").toLowerCase().trim();
    const out = [s];
    if (s.endsWith("-effect")) out.push(s.slice(0, -"-effect".length));
    return out;
}

/**
 * Find a catalog sub-spell for a trigger slug. The casting parent is
 * excluded from candidates (a self-trigger is a data gap, not a loop).
 */
export function findTriggerSpell(slug, { highestRank = false, excludeName = "" } = {}) {
    const byClass = globalThis.game?.eqrmss?.spells ?? {};
    const exclude = String(excludeName ?? "").toLowerCase();
    const matches = [];
    for (const cands of slugCandidates(slug)) {
        for (const list of Object.values(byClass)) {
            for (const s of list ?? []) {
                if (String(s?.name ?? "").toLowerCase() === exclude) continue;
                const id = String(s?._id ?? "");
                if (id.includes(`-${cands}-`)) matches.push(s);
            }
        }
        if (matches.length) break;
    }
    if (!matches.length) return null;
    if (highestRank) {
        matches.sort((a, b) => {
            const dl = (Number(b?.system?.level) || 0) - (Number(a?.system?.level) || 0);
            if (dl !== 0) return dl;
            return String(b?._id ?? "").localeCompare(String(a?._id ?? ""));
        });
    }
    return matches[0];
}

/**
 * Resolve which trigger-cast effects fire. Returns
 * [{ effect, roll }] — roll is the shared d100 for chance effects,
 * null for always-fire effects.
 */
export async function resolveTriggerRolls(spellItem) {
    const effs = triggerEffectsOf(spellItem);
    const always = [];
    const chanced = [];
    for (const e of effs) {
        const chance = Number(e?.chance);
        if (Number.isFinite(chance) && chance > 0) chanced.push(e);
        else always.push(e);
    }
    const fired = always.map(e => ({ effect: e, roll: null }));
    if (chanced.length) {
        const roll = await d100();
        let lo = 1;
        for (const e of chanced) {
            const hi = lo + Math.min(100, Number(e.chance)) - 1;
            if (roll >= lo && roll <= Math.min(hi, 100)) {
                fired.push({ effect: e, roll });
                break;
            }
            lo = hi + 1;
            if (lo > 100) break;
        }
        // Expose the roll even when nothing fired (for the chat note).
        if (!fired.some(f => f.roll !== null)) fired.push({ effect: null, roll });
    }
    return fired;
}

/**
 * Fire a spell's trigger-cast sub-spells after a successful cast.
 * Called from the castSpell wrapper; posts sub-cast cards via the
 * normal cast pipeline. Returns an HTML summary note.
 */
export async function fireTriggers(actor, spellItem, opts = {}) {
    const depth = Number(opts?.triggerDepth) || 0;
    if (depth >= 3) return "";
    const seen = Array.isArray(opts?.triggerSeen) ? opts.triggerSeen : [];
    const parentName = String(spellItem?.name ?? "");
    const fired = await resolveTriggerRolls(spellItem);
    const real = fired.filter(f => f.effect);
    if (!real.length) {
        const miss = fired.find(f => f.effect === null && f.roll !== null);
        if (miss) return `<p><em>Trigger roll ${miss.roll} — no sub-spell triggers.</em></p>`;
        return "";
    }
    const { castSpell } = await import("./cast-spell.js");
    const parentTargets = [...(globalThis.game?.user?.targets ?? [])]
        .map(t => t?.actor ?? t?.document?.actor)
        .filter(Boolean);
    let notes = "";
    for (const { effect: e, roll } of real) {
        const slug = String(e?.name ?? "");
        const sub = findTriggerSpell(slug, { highestRank: !!e?.highestRank, excludeName: parentName });
        const rollNote = roll !== null ? ` (trigger roll ${roll})` : "";
        if (!sub) {
            notes += `<p><em>Trigger "${esc(slug)}"${rollNote}: no sub-spell data — nothing happens.</em></p>`;
            continue;
        }
        const subName = String(sub?.name ?? "");
        if (seen.includes(subName)) {
            notes += `<p><em>Trigger ${esc(subName)}${rollNote}: already fired (cycle guard).</em></p>`;
            continue;
        }
        notes += `<p><em>Trigger ${esc(subName)}${rollNote}.</em></p>`;
        await castSpell(actor, sub, {
            ...opts,
            // Resolve-only: the parent cast already passed ESF, spent
            // mana, and paid cast time. Targets carry over.
            _delayedFire: true,
            _delayedTargets: parentTargets,
            _triggered: true,
            triggerDepth: depth + 1,
            triggerSeen: [...seen, parentName],
        });
    }
    return notes;
}
