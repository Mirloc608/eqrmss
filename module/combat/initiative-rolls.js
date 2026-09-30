// ============================================================
// EQRMSS Combat Initiative — Foundry wiring (RMSS §6.1).
//
// rollInitiative(actor):
//   1. Derives what the actor knows: QU/ST stats, readied weapon
//      (ready / hands / pole arm / length), two readied weapons,
//      readied shield, encumbered, wounded over 50%.
//   2. Prompts for the situational: surprised, charging, % movement
//      expended. (Declared actions — no defaults invented.)
//   3. Pairwise checks (stronger combatant, longer weapon) run
//      against the first targeted token's actor; skipped with a
//      note when nothing is targeted.
//   4. Round = the active combat's round when the actor is in one,
//      else 1 (pole-arm row depends on it).
//   5. Posts the full breakdown to chat. When the actor has a
//      combatant in the active combat, sets the tracker initiative
//      to the total — Foundry sorts highest-first, matching §6.1.
//   6. Two readied weapons → the second-attack total is reported
//      for the GM's second pass. (Haste has no system state yet.)
//
// Also exposed as game.eqrmss.combat.rollInitiative for GM macros,
// e.g. game.eqrmss.combat.rollInitiative(canvas.tokens.controlled[0]?.actor)
// ============================================================

import { computeInitiative } from "./initiative.js";

function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function itemListOf(actor) {
    const raw = actor?.items;
    return Array.isArray(raw) ? raw : [...(raw?.contents ?? [])];
}

function statVal(actor, key) {
    const s = actor?.system?.stats?.[key];
    return Number(s?.temp ?? s?.total ?? 50) || 50;
}

function isReadied(item) {
    return item?.system?.equipped === true || item?.system?.location === "equipped";
}

function readiedWeapons(actor) {
    return itemListOf(actor).filter(i => i?.type === "weapon" && isReadied(i));
}

// Situational factors the actor cannot know: surprised, charging,
// and % of movement expended this round.
async function promptSituational() {
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.prompt) {
        return { surprised: false, charging: false, movementPct: 0 };
    }
    try {
        const fd = await DialogV2.prompt({
            window: { title: "Initiative: situation (§6.1)" },
            content: `
                <div class="form-group">
                    <label>Surprised (−40)</label>
                    <input type="checkbox" name="surprised">
                </div>
                <div class="form-group">
                    <label>Charging</label>
                    <input type="checkbox" name="charging">
                </div>
                <div class="form-group">
                    <label>Movement expended (%)</label>
                    <input type="number" name="movementPct" value="0" min="0" max="100">
                </div>`,
            ok: { label: "Compute Initiative" }
        });
        if (!fd) return null; // cancelled
        // This Foundry build resolves prompt with a plain object;
        // other builds give FormDataExtended. Read both ways.
        const val = k => (typeof fd.get === "function" ? fd.get(k) : fd[k]);
        const on = v => v === "on" || v === true;
        return {
            surprised: on(val("surprised")),
            charging: on(val("charging")),
            movementPct: Math.max(0, Math.min(100, Number(val("movementPct")) || 0))
        };
    } catch (e) {
        console.error("EQRMSS | Initiative prompt failed", e);
        return { surprised: false, charging: false, movementPct: 0 };
    }
}

export async function rollInitiative(actor) {
    if (!actor) {
        ui.notifications?.warn("No actor to compute initiative for.");
        return;
    }
    const sys = actor.system ?? {};
    const items = itemListOf(actor);

    // ---- Derived from the actor ----
    const qu = statVal(actor, "QU");
    const st = statVal(actor, "ST");

    const weapons = readiedWeapons(actor);
    const primary = weapons[0];
    const wsys = primary?.system ?? {};
    const wtype = String(wsys.type ?? "");
    const shield = items.some(i => i?.type === "shield" && isReadied(i));

    const encumbered = Number(sys.encumbrance?.penalty) < 0;
    const hitsMax = Number(sys.hits?.max) || 0;
    const woundedOverHalf = hitsMax > 0 && (Number(sys.hits?.value) || 0) > hitsMax / 2;

    // ---- Situational (declared) ----
    const sit = await promptSituational();
    if (!sit) return; // cancelled

    // ---- Pairwise opponent: first targeted token ----
    let opponent = null;
    let opponentName = null;
    const targeted = [...(game.user?.targets ?? [])][0];
    if (targeted?.actor && targeted.actor.id !== actor.id) {
        const oWeapons = readiedWeapons(targeted.actor);
        const owLen = oWeapons[0]?.system?.length;
        opponent = {
            strength: statVal(targeted.actor, "ST"),
            weaponLength: owLen == null ? null : Number(owLen),
            charging: false // opponent's actions are unknown — GM adjudicates
        };
        opponentName = targeted.name ?? targeted.actor?.name ?? "opponent";
    }

    // ---- Round: active combat's round when the actor is in it ----
    let round = 1;
    let combatant = null;
    const combat = game.combat;
    if (combat) {
        const token = actor.getActiveTokens?.()[0];
        combatant = token
            ? combat.getCombatantByToken(token.id)
            : combat.combatants.find(c => c.actorId === actor.id);
        if (combatant) round = Math.max(1, Number(combat.round) || 1);
    }

    const input = {
        quickness: qu,
        strength: st,
        weaponReady: !!primary,
        hands: wtype === "two-handed" ? 2 : 1,
        isPolearm: wtype === "polearm",
        round,
        weaponLength: wsys.length == null ? null : Number(wsys.length),
        twoWeapon: weapons.length > 1,
        shield,
        surprised: sit.surprised,
        encumbered,
        woundedOverHalf,
        movementPct: sit.movementPct,
        charging: sit.charging,
        opponent
    };
    const { total, breakdown } = computeInitiative(input);

    // Second melee attack (two weapons): same table, totaled after
    // all first attacks — reported for the GM's second pass.
    const secondAttack = weapons.length > 1 ? computeInitiative(input).total : null;

    // ---- Chat ----
    const lines = breakdown
        .map(b => `&nbsp;&nbsp;${esc(b.label)}: ${b.mod > 0 ? "+" : ""}${b.mod}`)
        .join("<br>");
    const notes = [];
    if (!opponent) notes.push("No opponent targeted — stronger-combatant and longer-weapon checks skipped.");
    if (!primary) notes.push("No weapon readied — no weapon-ready bonus.");
    if (combatant) notes.push(`Round ${round} of the active combat.`);

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
            <h2>${esc(actor.name)} — Initiative (RMSS §6.1)</h2>
            <p>${lines}<br><strong>Total: ${total}</strong> — highest acts first.</p>
            ${secondAttack != null ? `<p><strong>Second attack (two weapons): ${secondAttack}</strong> — resolved after all first attacks.</p>` : ""}
            ${notes.length ? `<p><em>${notes.map(esc).join("<br>")}</em></p>` : ""}
            ${combatant ? `<p>Combat-tracker initiative set to ${total}.</p>` : `<p><em>No active combat — tracker not updated.</em></p>`}`
    });

    // ---- Combat tracker (highest-first sort matches §6.1) ----
    if (combatant) {
        await combatant.setInitiative(total);
    }

    return total;
}
