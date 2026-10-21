/**
 * EQRMSS Triggered-Effect Engine ("clickies")
 *
 * Armor, shields, and jewelry may carry a triggered effect, fired by player
 * activation (item sheet button / macro). Like procs, the payload resolves
 * through the shared damage pipeline "as if cast", minus mana cost and cast
 * time (instant unless the catalog entry says otherwise).
 */

import { getItemEffect } from "../data/item-effects/item-effect-loader.js";
import { applyEffectPayload } from "./damage-pipeline.js";
import { combatCard } from "../combat/chat-card.js";
import { breakInvisibility } from "../spells/invisibility.js";

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

/**
 * Convert a catalog castTime into milliseconds of delay.
 * Handles "N round(s)", "N sec(ond)s", "N min(ute)s" (1 round = 6 s).
 * Unparseable values fall back to one round so the begins-casting note
 * still lands and the effect still fires.
 */
function parseCastDelayMs(castTime) {
    const m = /(\d+(?:\.\d+)?)\s*(rounds?|secs?|seconds?|mins?|minutes?)/i.exec(String(castTime ?? ""));
    if (!m) return 6000;
    const n = Number(m[1]) || 0;
    const unit = m[2].toLowerCase();
    if (unit.startsWith("min")) return n * 60000;
    if (unit.startsWith("sec")) return n * 1000;
    return n * 6000; // rounds
}

/**
 * Clicky targeting (user ruling 2026-10-21): a clicky is a
 * targeted cast. The earlier rules — wearer for beneficial
 * clickies (2026-10-06) and canvas targets for offensive ones
 * (2026-10-09) — tested only payload type "damage", so DoT,
 * debuff and control clickies classified as "beneficial" and
 * landed on the wearer: Engulfing Darkness DoT'ing its own
 * wearer, a Complete Heal clicky healing the cleric instead
 * of the dying ally it was clicked for. Disposition is now
 * derived from the whole payload:
 *   hostile — any payload that harms or controls its
 *     recipient: requires canvas targets; NEVER falls back
 *     to the wearer.
 *   ally — heal / hot / protective payloads: canvas targets
 *     when set (the wearer's own token included), otherwise
 *     the wearer.
 *   self — buffs, regen, utility and the rest: the wearer
 *     (the 2026-10-06 ruling, preserved).
 */
const HOSTILE_PAYLOAD_TYPES = new Set([
    "damage", "dot", "debuff", "stun", "snare", "root", "fear",
    "mez", "charm", "mana-drain", "lifetap"
]);
const ALLY_PAYLOAD_TYPES = new Set(["heal", "hot", "damageshield", "absorb", "cure"]);

export function clickyDisposition(effect) {
    const types = (effect?.payload ?? []).map(p => String(p?.type ?? ""));
    if (types.some(t => HOSTILE_PAYLOAD_TYPES.has(t))) return "hostile";
    if (types.some(t => ALLY_PAYLOAD_TYPES.has(t))) return "ally";
    return "self";
}

export function resolveClickyRecipients({ effect, actor, targets }) {
    const disposition = clickyDisposition(effect);
    const canvasActors = (targets ?? []).map(t => t?.actor ?? t).filter(Boolean);
    if (disposition === "hostile") {
        // Targets are taken as set — deliberately targeting your
        // own token is your call; the defect was the NO-target
        // fallback to the wearer, never an explicit target.
        return { disposition, recipients: canvasActors, missingTarget: canvasActors.length === 0 };
    }
    if (disposition === "ally") {
        return { disposition, recipients: canvasActors.length ? canvasActors : [actor], missingTarget: false };
    }
    return { disposition, recipients: [actor], missingTarget: false };
}

/**
 * Player-facing clicky activation: resolves the item's triggered effect
 * against the clicky's targets (see clickyDisposition for who counts),
 * honors the catalog castTime, posts chat, and never costs
 * mana. No-op with a note when there is nothing to fire.
 * @param {object} args { item } — an owned item document
 * @returns {object} { fired, effect?, results?, reason?, delayed? }
 */
export async function activateClicky({ item }) {
    const itemName = item?.name ?? "item";
    const effectId = item?.system?.triggeredEffect ?? null;
    if (!effectId) {
        ui?.notifications?.info(`"${itemName}" has no triggered effect set.`);
        return { fired: false, reason: "no-triggered-effect" };
    }

    const effect = getItemEffect(effectId);
    if (!effect) {
        ui?.notifications?.warn(`Triggered effect "${effectId}" is not in the item-effects catalog.`);
        return { fired: false, reason: "unknown-effect", effectId };
    }
    if (effect.kind !== "triggered") {
        ui?.notifications?.warn(`Effect "${effectId}" is not a triggered effect (kind: ${effect.kind ?? "unknown"}).`);
        return { fired: false, reason: "not-a-triggered-effect", effectId };
    }

    const actor = item?.actor ?? null;
    if (!actor) {
        ui?.notifications?.warn(`"${itemName}" is not owned by an actor, so its clicky cannot be used.`);
        return { fired: false, reason: "no-owning-actor" };
    }

    // Limited charges (2026-10-13): if system.charges is a number, it's the
    // remaining uses. Undefined/null = unlimited. Zero = depleted.
    const charges = item?.system?.charges;
    if (typeof charges === "number" && charges <= 0) {
        ui?.notifications?.warn(`"${itemName}" has no charges remaining.`);
        return { fired: false, reason: "no-charges" };
    }

    // Target: a clicky is a targeted cast (2026-10-21 ruling —
    // see clickyDisposition above). Hostile clickies require
    // canvas targets and never fall back to the wearer; the
    // refusal happens before any charge is consumed.
    const { recipients, missingTarget } = resolveClickyRecipients({
        effect, actor, targets: [...(game?.user?.targets ?? [])]
    });
    if (missingTarget) {
        ui?.notifications?.warn(`"${itemName}" needs a target — target a token first.`);
        return { fired: false, reason: "no-target", effectId };
    }

    // Clickies cost 0 mana — never deduct anything.

    const decrementCharges = async () => {
        const updates = {};
        const ch = item?.system?.charges;
        if (typeof ch === "number" && ch > 0) {
            updates["system.charges"] = ch - 1;
        }
        if (String(effect.recastDelay ?? "").trim()) {
            updates["system.lastUsedAt"] = Date.now();
        }
        if (Object.keys(updates).length > 0) {
            await item.update(updates);
        }
    };

    const applyNow = async () => {
        const perTarget = [];
        for (const tgt of recipients) {
            const fired = await fireTriggeredEffect({ user: actor, item, target: tgt });
            perTarget.push({ target: tgt, fired });
        }
        postClickyResult({ actor, item, effect, perTarget });
        return perTarget;
    };

    const castTime = String(effect.castTime ?? "instant").trim().toLowerCase();
    if (!castTime || castTime === "instant") {
        await decrementCharges();
        const results = await applyNow();
        return { fired: true, effect, results };
    }

    // Non-instant cast: announce the casting, then fire after the delay.
    // Charges are consumed when casting starts, not when it fires.
    const delayMs = parseCastDelayMs(castTime);
    await decrementCharges();
    postClickyBeginsCasting({ actor, item, effect, castTime });
    setTimeout(() => {
        applyNow().catch(e => console.error("EQRMSS | delayed clicky fire failed", e));
    }, delayMs);
    return { fired: true, effect, delayed: true, delayMs, results: [] };
}

function postClickyBeginsCasting({ actor, item, effect, castTime }) {
    try {
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Clicky", `
                <h2>${esc(actor?.name ?? "?")} begins casting ${esc(effect.name ?? "effect")}</h2>
                <p><strong>Item:</strong> ${esc(item?.name ?? "?")} · <strong>Cast time:</strong> ${esc(castTime)}</p>`)
        });
    } catch (e) { console.error("EQRMSS | clicky begins-casting chat failed", e); }
}

function postClickyResult({ actor, item, effect, perTarget }) {
    try {
        const lines = perTarget.map(({ target, fired }) => {
            const tn = esc(target?.name ?? "?");
            if (!fired?.fired) return `<li>${tn}: <em>did not fire</em> (${esc(fired?.reason ?? "unknown")})</li>`;
            const notes = (fired.results ?? [])
                .flatMap(r => (r?.notes ?? []).map(n => `${r.type ?? "effect"}: ${n}`));
            return `<li>${tn}${notes.length ? ` — ${esc(notes.join("; "))}` : ""}</li>`;
        });
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Clicky", `
                <h2>${esc(actor?.name ?? "?")} uses ${esc(item?.name ?? "?")}: ${esc(effect.name ?? "effect")}</h2>
                <p><strong>Mana cost:</strong> 0</p>
                <ul>${lines.join("")}</ul>`)
        });
    } catch (e) { console.error("EQRMSS | clicky result chat failed", e); }
}

/**
 * Fire an item's triggered effect.
 * @param {object} args { user, item, target }
 *   target defaults to the user (self-buff clickies like Grim Aura).
 * @returns {object} { fired, effect?, results?, reason? }
 */
export async function fireTriggeredEffect({ user, item, target }) {
    // Invisibility (2026-10-07): activating a clicky breaks the
    // user's invisibility before the effect fires.
    await breakInvisibility(user, "clicky");
    const effectId = item?.system?.triggeredEffect ?? null;
    if (!effectId) return { fired: false, reason: "no-triggered-effect" };

    const effect = getItemEffect(effectId);
    if (!effect) return { fired: false, reason: "unknown-effect", effectId };
    if (effect.kind !== "triggered") return { fired: false, reason: "not-a-triggered-effect", effectId };

    const tgt = target ?? user;
    // Tick-regen clickies (the modulation rod line): a regen
    // payload with per-round pacing and a duration lands as a
    // timed regen entry instead of an instant burst.
    const timed = [];
    const instant = [];
    for (const e of effect.payload ?? []) {
        if (e?.type === "regen" && e?.per === "round" && Number(e?.duration) > 0) timed.push(e);
        else instant.push(e);
    }
    const results = await applyEffectPayload({
        payload: instant,
        caster: user,
        target: tgt,
        source: `triggered:${effect.id}`
    });
    for (const e of timed) {
        const amount = Number(e.amount ?? e.max ?? e.min) || 0;
        const rounds = Math.max(1, Math.ceil(Number(e.duration) / 6));
        if (!(amount > 0)) continue;
        const list = [...(Array.isArray(tgt.system?.status?.spellEffects) ? tgt.system.status.spellEffects : [])];
        list.push({
            kind: "regen", pool: e.pool ?? "mana", amount, roundsLeft: rounds,
            label: effect.name ?? item?.name ?? "item", source: `triggered:${effect.id}`
        });
        await tgt.update({ "system.status.spellEffects": list });
        results.push({
            type: "regen", pool: e.pool ?? "mana", final: 0,
            notes: [`timed: ${amount}/round for ${rounds} rounds`],
            source: `triggered:${effect.id}`
        });
    }

    console.log(`EQRMSS | Triggered effect fired: ${effect.name} (${user?.name ?? "?"})`, results);
    return { fired: true, effect, results };
}
