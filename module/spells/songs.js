// ============================================================
// BARD SONGS (Stage 5). Songs are not spells: no mana cost, no
// ESF gate. Activation applies the song's effects to the
// targeted actors (beneficial songs usually target allies);
// while the song stays active on the bard, the round tick
// refreshes the maintained entries and pulses the damage and
// regen entries (module/combat/crit-conditions.js).
//
// Effect model (honest limits, flagged): song "modifier"
// effects record the EQ stat/delta as text (EQ-scale numbers
// like STR +37 have no RMSS scale home, so they do not wire
// into derived stats); damage effects become DoTs that tick
// each round; heal effects become per-round regen entries;
// controls/debuffs/utility/cures become timed spell effects.
// EQ durations are seconds; 1 round = 6 s (standing ruling).
// ============================================================

import { durationRounds } from "./base-spell.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

/** The song's typed effects: item payload first (the finalizer
 *  preserves them since Stage 5), then the loaded song catalog
 *  by name for older song items. */
export function songEffectsOf(songItem) {
    const own = songItem?.system?.effects;
    if (Array.isArray(own) && own.length) return own;
    const name = String(songItem?.name ?? "").toLowerCase();
    const byClass = globalThis.game?.eqrmss?.data?.songs?.songsByClass?.bard ?? [];
    const hit = byClass.find(s => String(s?.name ?? "").toLowerCase() === name);
    if (Array.isArray(hit?.effects) && hit.effects.length) return hit.effects;
    const flat = globalThis.CONFIG?.EQRMSS?.songs ?? [];
    const hit2 = flat.find(s => String(s?.name ?? "").toLowerCase() === name);
    return Array.isArray(hit2?.effects) ? hit2.effects : [];
}

function songIdOf(songItem) { return songItem?.id ?? songItem?._id ?? ""; }

function effectValue(eff) {
    const v = eff?.value;
    if (v != null && typeof v === "object") return Number(v.base ?? v.max ?? v.min) || 0;
    return Number(v ?? eff?.amount) || 0;
}

function effectLabel(name, eff) {
    const type = String(eff?.type ?? "").toLowerCase();
    if (type === "modifier") {
        const val = effectValue(eff);
        return `${name} — ${String(eff.stat ?? "stat").toUpperCase()} ${val >= 0 ? "+" : ""}${val}`;
    }
    if (type === "damage") {
        const lo = Number(eff?.min ?? eff?.amount) || 0;
        const hi = Number(eff?.max ?? eff?.amount ?? lo) || lo;
        return `${name} — ${lo}${hi !== lo ? `-${hi}` : ""} ${String(eff?.element ?? "")} damage/round`.replace("  ", " ");
    }
    if (type === "regen" || type === "heal") {
        return `${name} — heals ${effectValue(eff) || Number(eff?.amount) || 0}/round`;
    }
    if (type === "cure") return `${name} — cures ${String(eff?.effect ?? eff?.stat ?? "condition")}`;
    if (type === "control") return `${name} — ${String(eff?.effect ?? "control")}`;
    if (type === "debuff") return `${name} — ${String(eff?.effect ?? eff?.stat ?? "debuff")}`;
    if (type === "utility") return `${name} — ${String(eff?.effect ?? eff?.stat ?? "effect")}`;
    if (type === "invisibility") return `${name} — invisibility`;
    if (type === "summon") return `${name} — summons ${String(eff?.effect ?? "ally")}`;
    return `${name} — ${type || "effect"}`;
}

function maintainedEntry(bard, songItem, label, eff, kind, extra = {}) {
    return {
        label: `${label} (song, maintained)`,
        source: "song", kind, maintained: true,
        casterId: bard?.id ?? "", songId: songIdOf(songItem), song: songItem?.name ?? "song",
        roundsLeft: durationRounds(eff?.duration) ?? 2,
        ...extra
    };
}

/**
 * Apply a song's effects at activation. Returns chat-note HTML.
 * Targets default to the bard alone (beneficial songs with no
 * targets hit the bard; the player targets allies first).
 */
export async function applySong(bard, songItem, targets = []) {
    const name = songItem?.name ?? "song";
    const effects = songEffectsOf(songItem);
    const list = (targets?.length ? targets : [bard]).filter(Boolean);
    let notes = "";
    for (const target of list) {
        const tName = esc(target.name);
        if (!(target.isOwner || globalThis.game?.user?.isGM)) {
            notes += `<p><em>${tName} — song effects not applied (you don't control them).</em></p>`;
            continue;
        }
        for (const eff of effects) {
            const type = String(eff?.type ?? "").toLowerCase();
            const label = effectLabel(name, eff);
            if (type === "damage") {
                const dots = [...(Array.isArray(target.system?.status?.dots) ? target.system.status.dots : [])];
                dots.push({
                    name, element: String(eff?.element ?? ""),
                    min: Number(eff?.min ?? eff?.amount) || 0, max: Number(eff?.max ?? eff?.amount) || 0,
                    source: "song", maintained: true,
                    casterId: bard?.id ?? "", songId: songIdOf(songItem),
                    roundsLeft: durationRounds(eff?.duration) ?? 2
                });
                await target.update({ "system.status.dots": dots });
                notes += `<p><em>${tName}: ${esc(label)}.</em></p>`;
            } else if (type === "regen" || type === "heal") {
                const fx = [...(Array.isArray(target.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
                fx.push(maintainedEntry(bard, songItem, label, eff, "regen", { amount: effectValue(eff) || Number(eff?.amount) || 0 }));
                await target.update({ "system.status.spellEffects": fx });
                notes += `<p><em>${tName}: ${esc(label)}.</em></p>`;
            } else {
                const fx = [...(Array.isArray(target.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
                fx.push(maintainedEntry(bard, songItem, label, eff, type, { stat: eff?.stat ?? null, value: effectValue(eff) }));
                await target.update({ "system.status.spellEffects": fx });
                notes += `<p><em>${tName}: ${esc(label)}.</em></p>`;
            }
        }
    }
    return notes || `<p><em>${esc(name)} sounds — no targets.</em></p>`;
}

/**
 * Toggle a song's active state from the bard sheet. Turning it
 * on applies the effects to the currently-targeted actors;
 * turning it off lets the entries linger out their recorded
 * duration (the tick stops refreshing them).
 */
export async function toggleSong(bard, songItem, targets = []) {
    if (!bard || !songItem) return { ok: false };
    const nowActive = !!songItem.system?.active;
    await songItem.update({ "system.active": !nowActive });
    let notes = "";
    if (!nowActive) {
        notes = await applySong(bard, songItem, targets);
    }
    return { ok: true, active: !nowActive, notes };
}
