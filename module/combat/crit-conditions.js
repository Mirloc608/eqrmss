// ============================================================
// EQRMSS Critical Conditions — stun pool, bleed, death timer,
// next-swing bonus, action penalty, must-parry capture, Parry,
// first-aid stub, healing-magic hook.
//
// User rulings (2026-09-30):
// - STUN: "stunned", "stun-no-parry" and "down-or-out" rounds are all
//   "stuns". Stuns from multiple criticals are CUMULATIVE. The total
//   decreases by one each round, with the most severe type taking
//   effect first (down-or-out > stun-no-parry > stunned).
// - STUN EFFECTS: stunned = cannot take offensive action;
//   stun-no-parry = no offensive or defensive actions other than
//   base defense. (Plain stun CAN parry — that is the distinction.)
// - BLEED: ticks until stopped — death, heal spell, or first aid.
// - DEATH TIMER: ticks down each round; stabilized ONLY by a direct
//   healing magic spell (even a low-level one); at 0 the foe dies.
//   "Then dies" = death when the stated rounds expire; with no
//   stated rounds the death is immediate.
// - NEXT SWING: +N stored on the attacker's sheet, consumed on their
//   next attack roll.
// - AT -N: applies to ALL actions (tracked with its own duration).
// - PARRY: a Full Parry puts ALL of the combatant's OB into DB —
//   weapon, shield, or martial-arts parry (Monks, Beastlords).
//   Declaration timing and attack-forfeit enforcement are still
//   pending (non-offensive combat mechanics).
// - FIRST AID: stubbed — lands with non-combat actions per round.
// - UNCONSCIOUS (§6.4.1): concussion hits taken EXCEEDING total hits
//   → unconscious; no further action until back under the limit
//   (condition-based — does not tick down).
// - DYING (§3.8): concussion hits taken EXCEEDING total hits + CO stat
//   → dies after the race's roundsToSoulDeparture rounds
//   (Table 15.5.1, module/data/races/base-hits.json); dropping back
//   under the threshold clears the countdown.
//
// NOT yet ruled — parsed/stored but not mechanically enforced:
// - which table phrasings map to down-or-out (counter exists in pool)
// - penalty expiry when the text gives no duration (indefinite now)
// - whether "at -N" touches DB (rolls only, for now)
//
// State lives under system.status (persistent; never rebuilt by the
// actor prepare pipeline):
//   status.stun           { stunned, stunNoParry, downOrOut } (rounds)
//   status.bleed          { perRound }
//   status.deathTimer     number (rounds left)
//   status.actionPenalty  { value, rounds } (rounds 0 = indefinite)
//   status.mustParry      { rounds, penalty }
//   status.nextSwingBonus number
//   status.parrying       boolean (declared parry, cleared each round)
//   status.parryDB        number (the parrier's full OB)
//   status.unconscious    boolean (§6.4.1)
//   status.soulTimer      number (rounds left; §3.8 dying countdown)
//   status.soulTimerUnknown boolean (dying, race not in Table 15.5.1 —
//                         GM adjudicates; no invented countdown)
//   status.dead           boolean
// ============================================================

import { WEAPON_TYPE_TO_SKILL_ID } from "./attack-resolver.js";

function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Most severe first.
export const STUN_ORDER = ["downOrOut", "stunNoParry", "stunned"];
export const STUN_LABEL = {
    stunned: "stunned",
    stunNoParry: "stunned and unable to parry",
    downOrOut: "down or out"
};

const ROUNDS_RE = "r(?:ou)?nds?"; // round, rounds, rnd, rnds

// ------------------------------------------------------------
// Shared weapon OB (attack and parry use the same figure)
// ------------------------------------------------------------

export function computeWeaponOB(actor, weaponItem) {
    const sys = weaponItem?.system ?? {};
    const weaponType = sys.type;
    const skillId = WEAPON_TYPE_TO_SKILL_ID[weaponType];
    const skill = skillId
        ? actor?.items?.find?.(i => i.type === "skill" && i.system?.slug === skillId)
        : null;
    const skillBonus = Number(skill?.system?.bonus) || 0;
    const obMod = Number(sys.obMod) || 0;
    return { weaponType, skill, skillBonus, obMod, ob: skillBonus + obMod };
}

// ------------------------------------------------------------
// Text parsers (crit result -> structured condition)
// ------------------------------------------------------------

// "stunned for 2 rounds", "stunned 3 rnds", "stuns foe for 1 round",
// "stunned next round" (= 1). A number that belongs to an "unable to
// parry" clause is NOT plain stun — it is captured by the no-parry
// branch below.
export function parseStun(text) {
    const out = { stunned: 0, stunNoParry: 0 };
    if (!text) return out;
    const npRe = new RegExp(`unable to parry\\s+(?:for\\s+)?(?:next\\s+)?(?:(\\d+)\\s+)?(${ROUNDS_RE})`, "gi");
    let m;
    while ((m = npRe.exec(text))) out.stunNoParry += m[1] ? Number(m[1]) : 1;
    const stRe = new RegExp(`stun(?:ned|s)?(?:\\s+foe)?(?:\\s+for)?\\s+(\\d+)\\s+(${ROUNDS_RE})`, "gi");
    while ((m = stRe.exec(text))) {
        if (/unable to parry/i.test(m[0])) continue; // duration belongs to the no-parry clause
        out.stunned += Number(m[1]);
    }
    // Numberless "stunned next round" (= 1). The numbered branches above
    // consume digits, so these cannot double-count them.
    const bareRe = /stun(?:ned|s)?(?:\s+foe)?\s+next\s+round(?!\s*\d)/gi;
    while (bareRe.exec(text)) out.stunned += 1;
    return out;
}

// "bleeds at 1 hit per round", "takes +3 hits per round" -> hits/round.
export function parseBleed(text) {
    if (!text) return 0;
    let per = 0;
    let m;
    const re1 = /bleeds?\s+at\s+(\d+)\s+hits?\s+per\s+round/gi;
    const re2 = /takes?\s+\+?(\d+)\s+hits\s+per\s+round/gi;
    while ((m = re1.exec(text))) per += Number(m[1]);
    while ((m = re2.exec(text))) per += Number(m[1]);
    return per;
}

// Death timer, in rounds. Returns -1 for "then dies" with no stated
// rounds (immediate death), 0 for no death timer.
// "Then dies" reads as a timeline: the stated rounds before it are the
// countdown ("down for 6 rounds ... then dies" -> 6;
// "stunned 2 rounds, active 4 rounds at -30, then dies" -> 6).
export function parseDeathTimer(text) {
    if (!text) return 0;
    let m = text.match(/\b(?:kills?\s+foe|dies?|dead)\s+(?:in|after)\s+(\d+)\s+r(?:ou)?nds?/i);
    if (m) return Number(m[1]);
    m = text.match(/\bdrops?\s+on\s+round\s+(\d+)/i);
    if (m && /\bthen dies\b/i.test(text)) return Number(m[1]);
    if (/\bthen dies\b/i.test(text)) {
        const before = text.split(/\bthen dies\b/i)[0];
        const rounds = [...before.matchAll(new RegExp(`(\\d+)\\s+${ROUNDS_RE}`, "gi"))].map(x => Number(x[1]));
        if (rounds.length) return rounds.reduce((a, b) => a + b, 0);
        return -1; // "then dies", no countdown stated: immediate
    }
    return 0;
}

// "Add +10 to your next swing." -> bonus.
export function parseNextSwing(text) {
    if (!text) return 0;
    const m = text.match(/add\s+\+(\d+)\s+to\s+your\s+next\s+(?:swing|attack)/i);
    return m ? Number(m[1]) : 0;
}

// "at -25", "at -50 for 3 rounds", "operates at -50", "fights at -95".
// Must-parry clauses are stripped first (their "-20" stays descriptive
// on the must-parry record). Returns { value, rounds } — rounds 0 =
// indefinite (no duration stated).
export function parsePenalty(text) {
    const out = { value: 0, rounds: 0 };
    if (!text) return out;
    const stripped = text.replace(/must\s+parry[^.]*/gi, "");
    const re = new RegExp(`\\bat\\s+(-\\d+)(?:\\s+for\\s+(\\d+)\\s+${ROUNDS_RE})?`, "gi");
    let m;
    while ((m = re.exec(stripped))) {
        const v = Number(m[1]);
        if (v < out.value) {
            out.value = v;
            out.rounds = m[2] ? Number(m[2]) : 0;
        }
    }
    return out;
}

// "foe must parry next round", "... at -20" -> { rounds, penalty }.
export function parseMustParry(text) {
    const out = { rounds: 0, penalty: 0 };
    if (!text) return out;
    if (!/must\s+parry(?:\s+(?:the\s+following|next))?\s+round/i.test(text)) return out;
    out.rounds = 1;
    const p = text.match(/must\s+parry[^.]*?at\s+(-\d+)/i);
    if (p) out.penalty = Number(p[1]);
    return out;
}

// ------------------------------------------------------------
// Stun pool
// ------------------------------------------------------------

export function stunTotal(pool) {
    return (Number(pool?.stunned) || 0) + (Number(pool?.stunNoParry) || 0) + (Number(pool?.downOrOut) || 0);
}

// Most severe type with rounds remaining, or null.
export function activeStun(pool) {
    for (const k of STUN_ORDER) {
        const r = Number(pool?.[k]) || 0;
        if (r > 0) return { type: k, rounds: r };
    }
    return null;
}

function roundsWord(n) {
    return `${n} round${n === 1 ? "" : "s"}`;
}

// ------------------------------------------------------------
// Application (called from rollWeaponAttack after a crit lands)
// ------------------------------------------------------------

export async function applyCritConditions(targetActor, attackerActor, critText) {
    if (!critText) return "";
    const notes = [];
    const tName = targetActor?.name ?? "Target";
    const canApply = !!targetActor && (targetActor.isOwner || game.user?.isGM);

    const stun = parseStun(critText);
    const bleed = parseBleed(critText);
    const deathIn = parseDeathTimer(critText);
    const swing = parseNextSwing(critText);
    const pen = parsePenalty(critText);
    const mp = parseMustParry(critText);

    // Next-swing bonus is attacker-side.
    if (swing > 0 && attackerActor) {
        const aName = attackerActor.name;
        if (attackerActor.isOwner || game.user?.isGM) {
            const cur = Number(attackerActor.system?.status?.nextSwingBonus) || 0;
            await attackerActor.update({ "system.status.nextSwingBonus": cur + swing });
            notes.push(`${esc(aName)} gains +${swing} to their next swing.`);
        } else {
            notes.push(`+${swing} to ${esc(aName)}'s next swing — not applied, you don't control them.`);
        }
    }

    const denied = suffix => `${suffix} — not applied, you don't control ${esc(tName)}.`;

    if (stun.stunned > 0 || stun.stunNoParry > 0) {
        if (canApply) {
            const pool = { stunned: 0, stunNoParry: 0, downOrOut: 0, ...(targetActor.system?.status?.stun ?? {}) };
            pool.stunned += stun.stunned;
            pool.stunNoParry += stun.stunNoParry;
            await targetActor.update({ "system.status.stun": pool });
            const active = activeStun(pool);
            notes.push(`${esc(tName)} is ${STUN_LABEL[active.type]} (${roundsWord(active.rounds)}; ${stunTotal(pool)} total stun).`);
        } else {
            notes.push(denied(`${esc(tName)} is stunned (${stunTotal(stun)} rounds)`));
        }
    }

    if (bleed > 0) {
        if (canApply) {
            // Ruling needed for stacking: keep the worst rate (single bleeding state).
            const cur = Number(targetActor.system?.status?.bleed?.perRound) || 0;
            const rate = Math.max(cur, bleed);
            await targetActor.update({ "system.status.bleed": { perRound: rate } });
            notes.push(`${esc(tName)} bleeds at ${rate} hit${rate === 1 ? "" : "s"} per round.`);
        } else {
            notes.push(denied(`${esc(tName)} bleeds at ${bleed} per round`));
        }
    }

    if (deathIn !== 0) {
        if (canApply) {
            if (deathIn < 0) {
                await targetActor.update({ "system.status.dead": true });
                notes.push(`<strong>${esc(tName)}</strong> dies.`);
            } else {
                // Ruling needed for overlapping timers: keep the sooner death.
                const cur = Number(targetActor.system?.status?.deathTimer) || 0;
                const timer = cur > 0 ? Math.min(cur, deathIn) : deathIn;
                await targetActor.update({ "system.status.deathTimer": timer });
                notes.push(`${esc(tName)} dies in ${roundsWord(timer)} without healing magic.`);
            }
        } else {
            notes.push(denied(deathIn < 0 ? `${esc(tName)} dies` : `${esc(tName)} dies in ${roundsWord(deathIn)} without healing magic`));
        }
    }

    if (pen.value < 0) {
        if (canApply) {
            const cur = targetActor.system?.status?.actionPenalty ?? { value: 0, rounds: 0 };
            if (pen.value < (Number(cur.value) || 0)) {
                await targetActor.update({ "system.status.actionPenalty": { value: pen.value, rounds: pen.rounds } });
            }
            const eff = pen.value < (Number(cur.value) || 0) ? pen : cur;
            notes.push(`${esc(tName)} is at ${eff.value} to all actions${eff.rounds > 0 ? ` for ${roundsWord(eff.rounds)}` : ""}.`);
        } else {
            notes.push(denied(`${esc(tName)} is at ${pen.value} to all actions`));
        }
    }

    if (mp.rounds > 0) {
        if (canApply) {
            await targetActor.update({ "system.status.mustParry": { rounds: mp.rounds, penalty: mp.penalty } });
            notes.push(`${esc(tName)} must parry next round${mp.penalty ? ` at ${mp.penalty}` : ""}.`);
        } else {
            notes.push(denied(`${esc(tName)} must parry next round`));
        }
    }

    return notes.length ? `<p>${notes.join("<br>")}</p>` : "";
}

// Shared death cleanup — dead, everything cleared.
function deathCleanup() {
    return {
        "system.status.deathTimer": 0,
        "system.status.bleed": { perRound: 0 },
        "system.status.stun": { stunned: 0, stunNoParry: 0, downOrOut: 0 },
        "system.status.actionPenalty": { value: 0, rounds: 0 },
        "system.status.mustParry": { rounds: 0, penalty: 0 },
        "system.status.parrying": false,
        "system.status.parryDB": 0,
        "system.status.unconscious": false,
        "system.status.soulTimer": 0,
        "system.status.soulTimerUnknown": false,
        "system.status.dead": true
    };
}

// ------------------------------------------------------------
// Round tick (GM only, on combat round change)
// ------------------------------------------------------------

export async function tickConditions(combat) {
    if (!combat) return;
    const notes = [];
    const list = combat.combatants?.contents ?? [...(combat.combatants ?? [])];
    for (const c of list) {
        const actor = c.actor;
        if (!actor || actor.system?.status?.dead) continue;
        const st = actor.system?.status ?? {};
        const updates = {};

        // Death timer — at 0 the foe dies; only healing magic stabilizes
        // (detection lands with the spell subsystem).
        let dt = Number(st.deathTimer) || 0;
        if (dt > 0) {
            dt -= 1;
            if (dt <= 0) {
                Object.assign(updates, deathCleanup());
                notes.push(`<strong>${esc(actor.name)}</strong> dies.`);
                await actor.update(updates);
                continue;
            }
            updates["system.status.deathTimer"] = dt;
            notes.push(`${esc(actor.name)}: death in ${roundsWord(dt)} — stabilize with healing magic.`);
        }

        // Soul departure (§3.8) — dying countdown; dropping back under
        // the damage threshold clears it (re-checked after bleed below).
        let soul = Number(st.soulTimer) || 0;
        if (soul > 0) {
            soul -= 1;
            if (soul <= 0) {
                Object.assign(updates, deathCleanup());
                notes.push(`<strong>${esc(actor.name)}</strong> dies — soul departs.`);
                await actor.update(updates);
                continue;
            }
            updates["system.status.soulTimer"] = soul;
            notes.push(`${esc(actor.name)}: soul departs in ${roundsWord(soul)}.`);
        }

        // Bleed — hits until stopped (death, heal spell, first aid).
        const per = Number(st.bleed?.perRound) || 0;
        if (per > 0) {
            const cur = Number(actor.system?.hits?.value) || 0;
            updates["system.hits.value"] = cur + per;
            notes.push(`${esc(actor.name)} bleeds for ${per} (${cur + per} concussion hits).`);
        }

        // Stun pool — total decreases by one; most severe type first.
        const pool = { stunned: 0, stunNoParry: 0, downOrOut: 0, ...(st.stun ?? {}) };
        if (stunTotal(pool) > 0) {
            for (const k of STUN_ORDER) {
                if (pool[k] > 0) { pool[k] -= 1; break; }
            }
            updates["system.status.stun"] = pool;
            const active = activeStun(pool);
            notes.push(active
                ? `${esc(actor.name)}: ${STUN_LABEL[active.type]} (${roundsWord(active.rounds)} left).`
                : `${esc(actor.name)} recovers from stun.`);
        }

        // Action penalty — timed penalties tick down; untimed persist.
        const ap = st.actionPenalty ?? { value: 0, rounds: 0 };
        if ((Number(ap.value) || 0) < 0 && (Number(ap.rounds) || 0) > 0) {
            const left = Number(ap.rounds) - 1;
            updates["system.status.actionPenalty"] = { value: Number(ap.value), rounds: left };
            if (left <= 0) {
                updates["system.status.actionPenalty"] = { value: 0, rounds: 0 };
                notes.push(`${esc(actor.name)} recovers from their penalty.`);
            }
        }

        // Must parry — expires after the round.
        const mpr = Number(st.mustParry?.rounds) || 0;
        if (mpr > 0) {
            updates["system.status.mustParry"] = { rounds: mpr - 1, penalty: Number(st.mustParry?.penalty) || 0 };
        }

        // Declared parry lapses at the round change.
        if (st.parrying || (Number(st.parryDB) || 0) > 0) {
            updates["system.status.parrying"] = false;
            updates["system.status.parryDB"] = 0;
            notes.push(`${esc(actor.name)}'s parry lapses.`);
        }

        if (Object.keys(updates).length) await actor.update(updates);
        // Bleed (or anything else this tick) may have crossed a
        // concussion-hit threshold — unconsciousness / dying.
        if (!actor.system?.status?.dead) await checkHitThresholds(actor);
    }
    if (notes.length) {
        await ChatMessage.create({
            content: `<p><em>Condition tick — round ${combat.round}.</em></p><p>${notes.join("<br>")}</p>`
        });
    }
}

// ------------------------------------------------------------
// Concussion-hit thresholds — unconsciousness (§6.4.1) and the
// §3.8 dying countdown.
// - Damage EXCEEDING total hits → unconscious: no further action
//   until back under the limit (condition-based, does not tick).
// - Damage EXCEEDING total hits + CO stat → dying: the soul departs
//   after the race's roundsToSoulDeparture rounds (Table 15.5.1,
//   module/data/races/base-hits.json). Dropping back under the
//   threshold clears the countdown.
// Call after anything that changes system.hits.value: damage
// application, bleed ticks, hit restoration.
// ------------------------------------------------------------

let _baseHitsCache = null;
async function baseHitsTable() {
    if (!_baseHitsCache) {
        const resp = await fetch("systems/eqrmss/module/data/races/base-hits.json");
        _baseHitsCache = await resp.json();
    }
    return _baseHitsCache;
}

// Lenient race-key match ("Dark Elf" / "dark_elf" -> "dark-elf").
// Returns roundsToSoulDeparture, or null when the race has no Table
// 15.5.1 entry — the GM adjudicates; the number is never invented.
async function soulDepartureRounds(actor) {
    try {
        const races = (await baseHitsTable())?.races ?? {};
        const norm = s => String(s ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-");
        const candidates = [
            norm(actor.system?.fixed_info?.race),
            norm(actor.system?.fixed_info?.race_name)
        ].filter(Boolean);
        for (const want of candidates) {
            for (const [key, v] of Object.entries(races)) {
                if (norm(key) === want) return Number(v.roundsToSoulDeparture);
            }
        }
    } catch (e) {
        console.warn("EQRMSS | base-hits.json unavailable", e);
    }
    return null;
}

export async function checkHitThresholds(actor) {
    if (!actor || actor.system?.status?.dead) return;
    const max = Number(actor.system?.hits?.max) || 0;
    const value = Number(actor.system?.hits?.value) || 0;
    if (max <= 0) return; // no concussion-hit track — nothing to threshold against
    const st = actor.system?.status ?? {};
    const updates = {};
    const notes = [];

    // Unconscious — §6.4.1.
    if (value > max && !st.unconscious) {
        updates["system.status.unconscious"] = true;
        notes.push(`<strong>${esc(actor.name)}</strong> is knocked unconscious (${value} damage exceeds ${max} total hits).`);
    } else if (value <= max && st.unconscious) {
        updates["system.status.unconscious"] = false;
        notes.push(`<strong>${esc(actor.name)}</strong> regains consciousness.`);
    }

    // Dying — §3.8.
    const co = Number(actor.system?.stats?.CO?.total) || 0;
    const dying = value > max + co;
    const timerActive = (Number(st.soulTimer) || 0) > 0 || !!st.soulTimerUnknown;
    if (dying && !timerActive) {
        const rounds = await soulDepartureRounds(actor);
        if (rounds == null) {
            updates["system.status.soulTimerUnknown"] = true;
            const raceLabel = actor.system?.fixed_info?.race_name || actor.system?.fixed_info?.race || "unknown";
            notes.push(`<strong>${esc(actor.name)}</strong> is dying! Race "${esc(raceLabel)}" has no Table 15.5.1 entry — GM adjudicates rounds to soul departure.`);
        } else {
            updates["system.status.soulTimer"] = rounds;
            notes.push(`<strong>${esc(actor.name)}</strong> is dying — soul departs in ${roundsWord(rounds)} unless damage is brought under ${max + co}.`);
        }
    } else if (!dying && timerActive) {
        updates["system.status.soulTimer"] = 0;
        updates["system.status.soulTimerUnknown"] = false;
        notes.push(`<strong>${esc(actor.name)}</strong> is no longer dying.`);
    }

    if (Object.keys(updates).length) await actor.update(updates);
    if (notes.length) await ChatMessage.create({ content: `<p>${notes.join("<br>")}</p>` });
}

// ------------------------------------------------------------
// Next-swing bonus (attacker-side, consumed by rollWeaponAttack)
// ------------------------------------------------------------

export async function consumeNextSwingBonus(actor) {
    const b = Number(actor?.system?.status?.nextSwingBonus) || 0;
    if (b > 0 && actor) await actor.update({ "system.status.nextSwingBonus": 0 });
    return b;
}

// ------------------------------------------------------------
// Parry — ruled conversion (full OB -> DB); declaration timing
// and attack-forfeit enforcement still pending with the
// non-offensive combat mechanics.
// ------------------------------------------------------------

export async function declareParry(actor, weaponItem) {
    if (!actor) {
        ui.notifications?.warn("Declare Parry: no actor.");
        return;
    }
    if (!weaponItem) {
        ui.notifications?.warn("Declare Parry: choose the parrying weapon, shield, or martial-arts item.");
        return;
    }
    // Unconscious: no action at all (§6.4.1).
    if (actor.system?.status?.unconscious) {
        ui.notifications?.warn(`${actor.name} is unconscious and cannot parry.`);
        return;
    }
    // Stun-no-parry / down-or-out: no defensive actions but base defense.
    const st = activeStun(actor.system?.status?.stun);
    if (st && st.type !== "stunned") {
        ui.notifications?.warn(`${actor.name} is ${STUN_LABEL[st.type]} and cannot parry.`);
        return;
    }
    // Full Parry: ALL of the combatant's OB goes into DB.
    const { ob } = computeWeaponOB(actor, weaponItem);
    const updates = {
        "system.status.parrying": true,
        "system.status.parryDB": ob
    };
    const mp = actor.system?.status?.mustParry;
    if (mp && (Number(mp.rounds) || 0) > 0) {
        updates["system.status.mustParry"] = { rounds: 0, penalty: 0 };
    }
    await actor.update(updates);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><em>${esc(actor.name)} parries with ${esc(weaponItem.name)} — +${ob} DB. (Declaration timing and attack-forfeit pending.)</em></p>`
    });
}

// ------------------------------------------------------------
// Healing magic — stabilized death timer, stopped bleeding.
// TODO(healing): wire to the healing spell subsystem. Per ruling,
// ANY direct healing magic spell triggers this.
// ------------------------------------------------------------

export async function applyHealingSpell(targetActor) {
    if (!targetActor) return;
    const st = targetActor.system?.status ?? {};
    const hadBleed = (Number(st.bleed?.perRound) || 0) > 0;
    const hadTimer = (Number(st.deathTimer) || 0) > 0;
    if (!hadBleed && !hadTimer) return;
    if (!(targetActor.isOwner || game.user?.isGM)) {
        ui.notifications?.warn(`Healing not applied — you don't control ${targetActor.name}.`);
        return;
    }
    await targetActor.update({
        "system.status.bleed": { perRound: 0 },
        "system.status.deathTimer": 0
    });
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: `<p>${esc(targetActor.name)} receives healing magic — bleeding stops${hadTimer ? " and the death timer is stabilized" : ""}.</p>`
    });
    // Hit restoration (when the spell subsystem lands) may drop the
    // actor back under a concussion-hit threshold — re-check.
    await checkHitThresholds(targetActor);
}

// ------------------------------------------------------------
// First aid — STUB.
// TODO(first-aid): compress/bandage (stops 1–3/round) and tourniquet
// (4–10/round on a limb) mechanics land with the non-combat-actions-
// per-round subsystem. Stub records intent only.
// ------------------------------------------------------------

export async function declareFirstAid(actor, targetActor) {
    if (!actor) {
        ui.notifications?.warn("First aid: no actor.");
        return;
    }
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p><em>${esc(actor.name)} administers first aid to ${esc(targetActor?.name ?? "their patient")}. (First-aid mechanics pending — stub.)</em></p>`
    });
}
