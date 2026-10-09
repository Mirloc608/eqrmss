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
 * Player-facing clicky activation: resolves the item's triggered effect
 * against the current targets (or the owning actor when nothing is
 * targeted), honors the catalog castTime, posts chat, and never costs
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

    // Target: wearer for beneficial clickies (ruling 2026-10-06), but
    // offensive clickies (damage payload) target the current canvas
    // targets instead (2026-10-09: Seawater Blast hit the wearer).
    const isOffensive = Array.isArray(effect?.payload) &&
        effect.payload.some(p => p?.type === "damage");
    let recipients = [actor];
    if (isOffensive) {
        const canvasTargets = [...(game?.user?.targets ?? [])]
            .map(t => t?.actor)
            .filter(a => a && a?.id !== actor?.id);
        if (canvasTargets.length > 0) recipients = canvasTargets;
    }

    // Clickies cost 0 mana — never deduct anything.

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
        const results = await applyNow();
        return { fired: true, effect, results };
    }

    // Non-instant cast: announce the casting, then fire after the delay.
    const delayMs = parseCastDelayMs(castTime);
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
