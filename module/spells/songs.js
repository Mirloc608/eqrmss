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
import { applyStatusEffect } from "./status-wiring.js";

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
        const stat = String(eff.stat ?? "stat").toLowerCase();
        const scaled = scaleSongValue(stat, effectValue(eff));
        const v = scaled.value;
        const sign = v >= 0 ? "+" : "";
        if (scaled.target === "db") {
            return `${name} — Defense ${sign}${v}`;
        }
        if (scaled.target === "movement") {
            return `${name} — MOVEMENT ${sign}${v}`;
        }
        if (scaled.target === "statBonus") {
            const rmss = { str: "ST", sta: "CO", agi: "AG", dex: "QU", wis: "EM", int: "ME", cha: "PR" }[stat] ?? stat.toUpperCase();
            return `${name} — ${rmss} ${sign}${v} bonus`;
        }
        return `${name} — ${stat.toUpperCase()} ${sign}${v}`;
    }
    if (type === "damage") {
        // Use effectValue() (reads value.base/max/min) and scale EQ÷10 (2026-10-07 fix).
        const v = Math.round(effectValue(eff) / 10);
        return `${name} — ${v} ${String(eff?.element ?? "")} damage/round`.replace("  ", " ");
    }
    if (type === "regen" || type === "heal") {
        const v = Math.round((effectValue(eff) || Number(eff?.amount) || 0) / 10);
        return `${name} — heals ${v}/round`;
    }
    if (type === "cure") return `${name} — cures ${String(eff?.effect ?? eff?.stat ?? "condition")}`;
    if (type === "control") return `${name} — ${String(eff?.effect ?? "control")}`;
    if (type === "debuff") return `${name} — ${String(eff?.effect ?? eff?.stat ?? "debuff")}`;
    if (type === "utility") return `${name} — ${String(eff?.effect ?? eff?.stat ?? "effect")}`;
    if (type === "invisibility") return `${name} — invisibility`;
    if (type === "summon") return `${name} — summons ${String(eff?.effect ?? "ally")}`;
    return `${name} — ${type || "effect"}`;
}

/**
 * Scale EQ song values to EQRMSS (user ruling 2026-10-06):
 * - Stats (str/dex/etc): EQ value ÷ 10 → bonus. STR +37 → +4.
 * - Mana/HP: EQ value ÷ 10. 232/round → 23/round.
 * - AC: 1:1 to DB (not AT). AC +2 → DB +2.
 * - Movement: EQ value ÷ 10 → Base Move Rate. +65 → +6.
 */
/**
 * Sum active song modifiers for an actor (2026-10-06 wiring).
 * Reads system.status.spellEffects entries with source "song".
 * Returns { statBonuses: {str: 4}, db: 2, movement: 6, mana: 0, hits: 0 }.
 */
/**
 * Check stacking for a new buff (2026-10-07, Option A).
 * Per-stat highest wins across spells and songs.
 * Returns { action: "apply" } (no conflict),
 *         { action: "block", blockedBy: "Name" } (weaker than existing),
 *         { action: "replace", replaces: [...] } (stronger than existing).
 */
export function checkBuffStacking(target, scaledTarget, scaledStat, newValue, excludeId = null) {
    if (!target || !scaledTarget || !(newValue > 0)) return { action: "apply" };
    const fx = target?.system?.status?.spellEffects;
    if (!Array.isArray(fx)) return { action: "apply" };
    const statKey = String(scaledStat ?? "").toLowerCase();
    const conflicts = [];
    for (const e of fx) {
        if (e?.kind === "regen") continue;
        if (e?.source !== "spell" && e?.source !== "song") continue;
        // Skip entries from the same source (refresh, not conflict)
        if (excludeId) {
            const eid = e?.spellId ?? e?.songId ?? null;
            if (eid && eid === excludeId) continue;
        }
        if (e?.scaledTarget !== scaledTarget) continue;
        const eStat = String(e?.scaledStat ?? "").toLowerCase();
        if (statKey !== eStat) continue;
        const eVal = Number(e?.scaledValue) || 0;
        if (eVal > 0) conflicts.push({ entry: e, value: eVal, label: e?.label ?? e?.name ?? "buff" });
    }
    if (!conflicts.length) return { action: "apply" };
    conflicts.sort((a, b) => b.value - a.value);
    const strongest = conflicts[0];
    if (newValue <= strongest.value) {
        return { action: "block", blockedBy: strongest.label, blockedValue: strongest.value };
    } else {
        // Replace ENTIRE source(s), not just the stat (2026-10-07 ruling).
        // Collect songId/spellId from conflicts.
        const ids = [...new Set(conflicts.map(c => c.entry?.spellId ?? c.entry?.songId ?? null).filter(Boolean))];
        return { action: "replace", replaceIds: ids, replaces: conflicts.map(c => c.entry) };
    }
}

export function getSongModifiers(actor) {
    const out = { statBonuses: {}, db: 0, movement: 0, mana: 0, hits: 0, ob: 0, haste: 0, slow: 0 };
    const fx = actor?.system?.status?.spellEffects;
    if (!Array.isArray(fx)) return out;
    for (const e of fx) {
        if (e?.source !== "song") continue;
        const target = e?.scaledTarget;
        const val = Number(e?.scaledValue) || 0;
        if (!target || !val) continue;
        if (target === "statBonus" && e?.scaledStat) {
            const k = String(e.scaledStat).toLowerCase();
            out.statBonuses[k] = (out.statBonuses[k] || 0) + val;
        } else if (target === "db") out.db += val;
        else if (target === "ob") out.ob += val;
        else if (target === "haste") out.haste += val;
        else if (target === "slow") out.slow += val;
        else if (target === "movement") out.movement += val;
        else if (target === "mana") out.mana += val;
        else if (target === "hits" || target === "hp") out.hits += val;
    }
    return out;
}

/**
 * AC to Defense curve (2026-10-07): diminishing returns for high AC.
 * EQ high-level spells give hundreds of AC; 1:1 would be game-breaking.
 * Tiers: 1-10 → 1:1, 11-30 → 2:1, 31-70 → 4:1, 71-150 → 8:1, 151+ → 16:1.
 * Examples: AC 10 → DB 10, AC 30 → DB 20, AC 70 → DB 30, AC 150 → DB 40, AC 319 → DB 51.
 */
function acToDefense(ac) {
    if (ac <= 0) return 0;
    if (ac <= 10) return Math.round(ac);
    if (ac <= 30) return 10 + Math.round((ac - 10) / 2);
    if (ac <= 70) return 20 + Math.round((ac - 30) / 4);
    if (ac <= 150) return 30 + Math.round((ac - 70) / 8);
    return 40 + Math.round((ac - 150) / 16);
}

export function scaleSongValue(stat, eqValue) {
    const s = String(stat ?? "").toLowerCase();
    const v = Number(eqValue) || 0;
    if (s === "ac") return { target: "db", value: acToDefense(v) };
    if (s === "movement") return { target: "movement", value: Math.round(v / 10) };
    if (["hp", "hits", "mana"].includes(s)) return { target: s, value: Math.round(v / 10) };
    // Haste/Slow (2026-10-07): percentages, used as-is (no EQ÷10), min 1.
    // Mirrors spell-buff logic so song haste reaches out.haste (not statBonuses).
    if (s === "haste") return { target: "haste", stat: "haste", value: Math.max(1, Math.round(v)) };
    if (s === "slow") return { target: "slow", stat: "slow", value: Math.max(1, Math.round(v)) };
    // Default: stats → bonus at ÷10
    return { target: "statBonus", stat: s, value: Math.round(v / 10) };
}

function maintainedEntry(bard, songItem, label, eff, kind, extra = {}) {
    const stat = String(eff?.stat ?? "").toLowerCase();
    const eqVal = effectValue(eff);
    const scaled = stat ? scaleSongValue(stat, eqVal) : null;
    return {
        label: `${label} (song, maintained)`,
        source: "song", kind, maintained: true,
        casterId: bard?.id ?? "", songId: songIdOf(songItem), song: songItem?.name ?? "song",
        roundsLeft: durationRounds(eff?.duration) ?? 2,
        // Scaling (2026-10-06): raw EQ value + scaled EQRMSS value
        stat: stat || null,
        eqValue: eqVal,
        scaledTarget: scaled?.target ?? null,
        scaledStat: scaled?.stat ?? null,
        scaledValue: scaled?.value ?? 0,
        ...extra
    };
}

/**
 * Apply a song's effects at activation. Returns chat-note HTML.
 * Targets default to the bard alone (beneficial songs with no
 * targets hit the bard; the player targets allies first).
 */
/**
 * Classify song effects: beneficial (buff/heal/regen/cure) vs harmful
 * (damage/debuff/control). Returns "ally" if all beneficial, "opponent"
 * if any harmful, else "ally" (default to buffing).
 */
function songTargetMode(effects) {
    for (const eff of effects ?? []) {
        const t = String(eff?.type ?? "").toLowerCase();
        if (["damage", "debuff", "control", "fear", "root", "snare", "dot"].includes(t)) {
            return "opponent";
        }
    }
    return "ally";
}

/**
 * Find tokens in the song's range (2026-10-06): beneficial songs affect
 * all allies in range, harmful songs affect all opponents in range.
 * Uses the bard token's position and the song's range (feet).
 */
function songAutoTargets(bard, songItem, effects) {
    const mode = songTargetMode(effects);
    const bardToks = bard?.getActiveTokens?.() ?? [];
    const bardTok = bardToks[0];
    if (!bardTok) return [bard]; // No token: just the bard

    // Song range in feet (from item or catalog, default 30)
    const rangeFt = Number(songItem?.system?.range) || 30;
    const pxPerFt = canvas?.dimensions?.size / (canvas?.dimensions?.distance || 5) || 10;
    const rangePx = rangeFt * pxPerFt;

    const bx = bardTok.center?.x ?? bardTok.x;
    const by = bardTok.center?.y ?? bardTok.y;
    const bardDisp = bardTok.document?.disposition ?? bardTok.disposition ?? 1;
    // Owners of the bard (user IDs with ownership) — allies share ownership
    // (2026-10-06: user reported Harness characters owned by same player
    // weren't detected as allies via disposition alone).
    const bardOwners = new Set();
    try {
        const ownership = bard?.ownership ?? {};
        for (const [userId, level] of Object.entries(ownership)) {
            if (Number(level) >= 2) bardOwners.add(userId); // 2=limited, 3=owner
        }
    } catch { /* ignore */ }

    const out = [];
    for (const tok of canvas?.tokens?.placeables ?? []) {
        if (!tok?.actor) continue;
        const dx = (tok.center?.x ?? tok.x) - bx;
        const dy = (tok.center?.y ?? tok.y) - by;
        const distPx = Math.hypot(dx, dy);
        if (distPx > rangePx + 1) continue; // Outside range (+1px tolerance)

        const disp = tok.document?.disposition ?? tok.disposition ?? 0;
        // Allies: same token as bard, OR same disposition, OR shared ownership.
        // Explicitly hostile (disp -1) vs non-hostile bard → never ally,
        // even with shared GM ownership (2026-10-06 fix).
        let isAlly = tok.id === bardTok.id || disp === bardDisp;
        const explicitlyHostile = disp === -1 && bardDisp !== -1;
        if (!isAlly && !explicitlyHostile && bardOwners.size > 0) {
            try {
                const tokOwnership = tok.actor?.ownership ?? {};
                for (const [userId, level] of Object.entries(tokOwnership)) {
                    if (Number(level) >= 2 && bardOwners.has(userId)) {
                        isAlly = true;
                        break;
                    }
                }
            } catch { /* ignore */ }
        }
        // Opponents: hostile disposition, or (if bard is friendly) not allied
        const isOpponent = !isAlly && (disp === -1 || (bardDisp === 1 && disp !== 1));

        if (mode === "ally" && isAlly) out.push(tok.actor);
        else if (mode === "opponent" && isOpponent) out.push(tok.actor);
    }
    // Always include the bard for beneficial songs (even if token missing)
    if (mode === "ally" && !out.includes(bard)) out.push(bard);
    return out.length ? out : [bard];
}

export async function applySong(bard, songItem, targets = []) {
    const name = songItem?.name ?? "song";
    const effects = songEffectsOf(songItem);
    // Auto-target by range/disposition if no explicit targets (2026-10-06).
    // Manual targeting (user selected tokens) still overrides.
    const list = (targets?.length ? targets : songAutoTargets(bard, songItem, effects)).filter(Boolean);
    let notes = "";
    for (const target of list) {
        const tName = esc(target.name);
        if (!(target.isOwner || globalThis.game?.user?.isGM)) {
            notes += `<p><em>${tName} — song effects not applied (you don't control them).</em></p>`;
            continue;
        }
        // Pre-check buffs: all-or-nothing (2026-10-07). If ANY buff is blocked,
        // no buffs from this song apply to this target.
        let songBlocked = false;
        let blockReason = "";
        for (const eff of effects) {
            const type = String(eff?.type ?? "").toLowerCase();
            if (type === "damage" || type === "regen" || type === "heal") continue;
            // This is a buff (modifier) effect
            const entry = maintainedEntry(bard, songItem, effectLabel(name, eff), eff, type, { stat: eff?.stat ?? null, value: effectValue(eff) });
            const stack = checkBuffStacking(target, entry.scaledTarget, entry.scaledStat, entry.scaledValue, entry.songId);
            if (stack.action === "block") {
                songBlocked = true;
                blockReason = `${effectLabel(name, eff)} blocked by stronger ${stack.blockedBy}`;
                break;
            }
        }
        if (songBlocked) {
            notes += `<p><em>${tName}: ${esc(name)} blocked — ${esc(blockReason)} (entire song blocked).</em></p>`;
            continue;
        }
        for (const eff of effects) {
            const type = String(eff?.type ?? "").toLowerCase();
            const label = effectLabel(name, eff);
            if (type === "damage") {
                const dots = [...(Array.isArray(target.system?.status?.dots) ? target.system.status.dots : [])];
                // Scale EQ÷10 (2026-10-07 fix): was storing raw min/max from wrong fields.
                const scaledDmg = Math.round(effectValue(eff) / 10);
                dots.push({
                    name, element: String(eff?.element ?? ""),
                    min: scaledDmg, max: scaledDmg,
                    source: "song", maintained: true,
                    casterId: bard?.id ?? "", songId: songIdOf(songItem),
                    roundsLeft: durationRounds(eff?.duration) ?? 2
                });
                await target.update({ "system.status.dots": dots });
                notes += `<p><em>${tName}: ${esc(label)}.</em></p>`;
            } else if (type === "regen" || type === "heal") {
                const fx = [...(Array.isArray(target.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
                // Scale EQ÷10 and set pool (2026-10-07 fix): was storing raw amount,
                // and mana regen had no pool so the tick healed HP instead of mana.
                const regenStat = String(eff?.stat ?? "").toLowerCase();
                const regenScaled = scaleSongValue(regenStat || "hp", effectValue(eff) || Number(eff?.amount) || 0);
                fx.push(maintainedEntry(bard, songItem, label, eff, "regen", {
                    amount: regenScaled.value,
                    pool: regenScaled.target === "mana" ? "mana" : "hits"
                }));
                await target.update({ "system.status.spellEffects": fx });
                notes += `<p><em>${tName}: ${esc(label)}.</em></p>`;
            } else {
                const entry = maintainedEntry(bard, songItem, label, eff, type, { stat: eff?.stat ?? null, value: effectValue(eff) });
                const stack = checkBuffStacking(target, entry.scaledTarget, entry.scaledStat, entry.scaledValue, entry.songId);
                // Block handled by pre-check above; only replace applies here.
                let fx = [...(Array.isArray(target.system?.status?.spellEffects) ? target.system.status.spellEffects : [])];
                if (stack.action === "replace" && stack.replaceIds?.length) {
                    const idSet = new Set(stack.replaceIds);
                    fx = fx.filter(e => {
                        const eid = e?.spellId ?? e?.songId ?? null;
                        return !(eid && idSet.has(eid));
                    });
                    notes += `<p><em>${tName}: ${esc(label)} replaces entire buff source.</em></p>`;
                }
                fx.push(entry);
                await target.update({ "system.status.spellEffects": fx });
                // Hasted/slowed visual indicators (2026-10-07)
                const effRounds = entry.roundsLeft ?? 2;
                if (entry.scaledTarget === "haste" && entry.scaledValue > 0) {
                    await applyStatusEffect(target, "hasted", `${name} (Haste)`, effRounds, "icons/svg/lightning.svg", { source: "song" });
                } else if (entry.scaledTarget === "slow" && entry.scaledValue > 0) {
                    await applyStatusEffect(target, "slowed", `${name} (Slow)`, effRounds, "icons/svg/clock.svg", { source: "song" });
                }
                notes += `<p><em>${tName}: ${esc(label)}.</em></p>`;
            }
        }
    }
    return notes || `<p><em>${esc(name)} sounds — no targets.</em></p>`;
}

/**
 * Base twist size: 3 songs. AAs can extend via
 * system.status.twistBonus (user ruling 2026-10-06).
 */
export function maxTwistSize(bard) {
    return 3 + (Number(bard?.system?.status?.twistBonus) || 0);
}

/** The bard's song playlist: array of song item IDs, oldest first. */
export function songPlaylistOf(bard) {
    const pl = bard?.system?.status?.songPlaylist;
    return Array.isArray(pl) ? [...pl] : [];
}

/**
 * Toggle a song's active state from the bard sheet. Turning it
 * on applies the effects to the currently-targeted actors and
 * adds the song to the twist playlist (FIFO); turning it off
 * removes it from the playlist and lets the entries linger out
 * their recorded duration (the tick stops refreshing them).
 *
 * Twisting (user ruling 2026-10-06): the playlist holds at most
 * maxTwistSize() songs. Playing a new song when full bumps the
 * oldest song (its effects stop refreshing). Re-playing a song
 * already in the playlist moves it to the newest position.
 */
export async function toggleSong(bard, songItem, targets = []) {
    if (!bard || !songItem) return { ok: false };
    const songId = songIdOf(songItem);
    const nowActive = !!songItem.system?.active;
    let notes = "";

    if (!nowActive) {
        // Playing: manage the FIFO playlist.
        const max = maxTwistSize(bard);
        let playlist = songPlaylistOf(bard);
        // If already in the playlist, move to newest position.
        playlist = playlist.filter(id => id !== songId);
        // If full, bump the oldest. Bumped songs have their
        // effects removed immediately (unlike manual Stop, which
        // lets them linger) — otherwise re-playing the song
        // would stack duplicate entries.
        let bumpedName = "";
        while (playlist.length >= max && playlist.length > 0) {
            const oldestId = playlist.shift();
            const oldest = bard.items?.get?.(oldestId);
            if (oldest) {
                bumpedName = oldest.name;
                await oldest.update({ "system.active": false });
                // Clear the bumped song's maintained entries from all targets.
                // Entries carry songId; remove those matching the bumped song.
                for (const target of [bard, ...targets]) {
                    if (!target || !(target.isOwner || globalThis.game?.user?.isGM)) continue;
                    const fx = Array.isArray(target.system?.status?.spellEffects)
                        ? target.system.status.spellEffects.filter(e => e?.songId !== oldestId)
                        : [];
                    const dots = Array.isArray(target.system?.status?.dots)
                        ? target.system.status.dots.filter(d => d?.songId !== oldestId)
                        : [];
                    await target.update({
                        "system.status.spellEffects": fx,
                        "system.status.dots": dots
                    });
                }
            }
        }
        playlist.push(songId);
        await bard.update({ "system.status.songPlaylist": playlist });
        await songItem.update({ "system.active": true });
        if (bumpedName) {
            notes += `<p><em>${esc(bumpedName)} is bumped from the twist — ${esc(songItem.name)} takes its place.</em></p>`;
        }
        notes += await applySong(bard, songItem, targets);
    } else {
        // Stopping: remove from the playlist.
        const playlist = songPlaylistOf(bard).filter(id => id !== songId);
        await bard.update({ "system.status.songPlaylist": playlist });
        await songItem.update({ "system.active": false });
    }
    return { ok: true, active: !nowActive, notes };
}
