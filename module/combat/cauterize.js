// ============================================================
// Arms Companion §4.5 CAUTERIZING WOUNDS.
//
// Burning a wound with a hot substance (or acid) seals it and
// stops the bleeding — at a cost in hits and, often, a heat
// critical. Maneuver difficulty is set by the bleeding rate.
// Resolution (user ruling 2026-10-04): standard RMSS static
// maneuver — open-ended d100 + bonus + difficulty modifier;
// success on a total of 100+; an unmodified 01-05 fumbles.
//
// Outcomes by First Aid skill use:
//   Skilled:   success — stops all bleeding, 1d5 hits
//              failure — stops all bleeding, 1d10 hits + A heat crit
//              fumble  — stops half the bleeding, 3d10 hits + C heat crit
//   Unskilled: success — stops all bleeding, 1d10 hits + A heat crit
//              failure — stops half the bleeding, 2d10 hits + B heat crit
//              fumble  — 4d10 hits + D heat crit (bleeding unchanged)
// Untrained attempts use -10 instead of the usual -25.
// Heat criticals roll flat d100 on the Heat critical table
// and resolve like any other crit (conditions applied to the
// patient). Self-cauterizing applies -20 (the SD roll itself
// is GM-adjudicated). One wound at a time: this system tracks
// a single bleed rate per actor.
// ============================================================

import { checkHitThresholds, applyCritConditions, adjudicateCritText } from "./crit-conditions.js";
import { lookupCrit, critBonusHits } from "./attack-resolver.js";

function esc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const CAUTERIZE_DIFFICULTIES = [
    { maxBleed: 2, name: "Medium", mod: 0 },
    { maxBleed: 3, name: "Hard", mod: -10 },
    { maxBleed: 4, name: "Very Hard", mod: -20 },
    { maxBleed: 5, name: "Extremely Hard", mod: -30 },
    { maxBleed: 6, name: "Sheer Folly", mod: -50 },
    { maxBleed: 7, name: "Absurd", mod: -70 },
    { maxBleed: 8, name: "Insane", mod: -90 },
    { maxBleed: 9, name: "Phenomenal", mod: -110 },
    { maxBleed: 10, name: "Virtually Impossible", mod: -130 }
];

/** Difficulty row for a bleed rate, or null when Impossible (> 10). */
export function cauterizeDifficulty(bleedPerRound) {
    const bleed = Number(bleedPerRound) || 0;
    return CAUTERIZE_DIFFICULTIES.find(d => bleed <= d.maxBleed) ?? null;
}

export const CAUTERIZE_OUTCOMES = {
    skilled: {
        success: { stop: "all", hitsDice: "1d5", heatCrit: null },
        failure: { stop: "all", hitsDice: "1d10", heatCrit: "A" },
        fumble: { stop: "half", hitsDice: "3d10", heatCrit: "C" }
    },
    unskilled: {
        success: { stop: "all", hitsDice: "1d10", heatCrit: "A" },
        failure: { stop: "half", hitsDice: "2d10", heatCrit: "B" },
        fumble: { stop: "none", hitsDice: "4d10", heatCrit: "D" }
    }
};

export function cauterizeTier(firstDie, total) {
    if (firstDie >= 1 && firstDie <= 5) return "fumble";
    return total >= 100 ? "success" : "failure";
}

/** The patient's First Aid skill bonus, or null if they lack the skill item. */
export function firstAidBonusOf(actor) {
    const items = [...(actor?.items?.contents ?? actor?.items ?? [])];
    const skill = items.find(i => i?.type === "skill" && i.system?.slug === "firstAid");
    return skill ? Math.max(0, Number(skill.system?.bonus) || 0) : null;
}

export function cauterizedBleed(currentBleed, stop) {
    if (stop === "all") return 0;
    if (stop === "half") return Math.floor((Number(currentBleed) || 0) / 2);
    return Number(currentBleed) || 0;
}

async function openEndedRoll() {
    const rolls = [];
    let total = 0;
    for (;;) {
        const r = await new Roll("1d100").evaluate();
        const die = r.dice?.[0]?.results?.[0]?.result ?? r.total;
        rolls.push(die);
        total += die;
        if (die < 96) break;
    }
    return { rolls, total };
}

async function promptCauterize(patient, bleed, difficulty, skillBonus) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    const fallback = { bonus: skillBonus ?? -10, skilled: skillBonus != null, self: false };
    if (!DialogV2?.prompt) return fallback;
    try {
        const result = await DialogV2.prompt({
            window: { title: "Cauterize Wound" },
            content: `
                <div class="form-group">
                    <label>First Aid bonus</label>
                    <input type="number" name="bonus" value="${fallback.bonus}" step="1">
                </div>
                <div class="form-group">
                    <label><input type="checkbox" name="skilled" ${fallback.skilled ? "checked" : ""}> Using the First Aid skill</label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" name="self"> Cauterizing their own wound (-20; SD roll is GM-adjudicated)</label>
                </div>
                <p class="hint">${esc(patient.name)} bleeds ${bleed} per round — a ${esc(difficulty.name)} maneuver (${difficulty.mod >= 0 ? "+" : ""}${difficulty.mod}). Success on 100+; 01-05 fumbles.</p>`,
            ok: {
                label: "Cauterize",
                callback: (event, button, dialog) => {
                    const form = dialog?.element ?? button?.form;
                    const bonusInput = form?.querySelector?.('input[name="bonus"]');
                    const skilledInput = form?.querySelector?.('input[name="skilled"]');
                    const selfInput = form?.querySelector?.('input[name="self"]');
                    return JSON.stringify({
                        bonus: Number(bonusInput?.value ?? fallback.bonus) || 0,
                        skilled: !!skilledInput?.checked,
                        self: !!selfInput?.checked
                    });
                }
            }
        });
        if (result == null) return null;
        return JSON.parse(result);
    } catch (e) {
        console.warn("EQRMSS | Cauterize prompt failed.", e);
        return fallback;
    }
}

/**
 * Cauterize the patient's bleeding wound (Arms Companion §4.5).
 * @param {Actor} patient the bleeding actor
 */
export async function cauterizeWound(patient) {
    if (!patient) {
        ui.notifications?.warn("Cauterize: no patient.");
        return;
    }
    const bleed = Math.max(0, Number(patient.system?.status?.bleed?.perRound) || 0);
    if (!bleed) {
        ui.notifications?.warn(`${patient.name} is not bleeding.`);
        return;
    }
    const difficulty = cauterizeDifficulty(bleed);
    if (!difficulty) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: patient }),
            content: `<p><strong>${esc(patient.name)}</strong> bleeds ${bleed} per round — cauterizing that is an <strong>Impossible</strong> maneuver (§4.5). The bleeding must be reduced first.</p>`
        });
        return;
    }
    const plan = await promptCauterize(patient, bleed, difficulty, firstAidBonusOf(patient));
    if (!plan) return; // cancelled
    const modifier = plan.bonus + difficulty.mod + (plan.self ? -20 : 0);
    const roll = await openEndedRoll();
    const total = roll.total + modifier;
    const tier = cauterizeTier(roll.rolls[0], total);
    const outcome = CAUTERIZE_OUTCOMES[plan.skilled ? "skilled" : "unskilled"][tier];
    const hitRoll = await new Roll(outcome.hitsDice).evaluate();
    const newBleed = cauterizedBleed(bleed, outcome.stop);

    await patient.update({
        "system.status.bleed": { perRound: newBleed },
        "system.hits.value": Math.max(0, (Number(patient.system?.hits?.value) || 0) + hitRoll.total)
    });
    await checkHitThresholds(patient);

    // Heat critical: flat d100 on the Heat table, resolved against the
    // patient's worn gear; shorthand effects land on the patient.
    let heatLine = "";
    if (outcome.heatCrit) {
        const cr = await new Roll("1d100").evaluate();
        const crits = game.eqrmss?.combatTables?.crits;
        const critResult = crits
            ? lookupCrit(crits, "H", outcome.heatCrit, cr.total)
            : { error: "Heat crit table is not loaded." };
        if (critResult.error) {
            heatLine = `<p><em>Plus a ${outcome.heatCrit} heat critical — GM adjudication (${esc(critResult.error)})</em></p>`;
        } else {
            const adjudicated = adjudicateCritText(critResult.text, patient);
            const bonusHits = critBonusHits(adjudicated.text);
            if (bonusHits > 0) {
                await patient.update({
                    "system.hits.value": Math.max(0, (Number(patient.system?.hits?.value) || 0) + bonusHits)
                });
                await checkHitThresholds(patient);
            }
            const condNotes = await applyCritConditions(patient, null, adjudicated.text);
            heatLine = `<p><strong>${outcome.heatCrit} heat critical</strong> → d100 ${cr.total} on the ${esc(critResult.table)}: ${esc(critResult.text)}`
                + (adjudicated.note ? `<br><em>Conditional crit: ${esc(adjudicated.note)} — matching branch applied.</em>` : "")
                + (bonusHits > 0 ? `<br><em>The critical adds +${bonusHits} hits.</em>` : "")
                + `</p>${condNotes}`;
        }
    }

    const tierLabel = { success: "Success", failure: "Failure", fumble: "FUMBLE" }[tier];
    const bleedLine = outcome.stop === "all"
        ? "The bleeding stops completely."
        : outcome.stop === "half"
            ? `The bleeding slows to ${newBleed} per round.`
            : "The bleeding continues unchecked.";
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: patient }),
        content: `
            <h2>Cauterizing ${esc(patient.name)}'s wound (§4.5)</h2>
            <p><strong>Maneuver:</strong> ${esc(difficulty.name)} (${difficulty.mod}) · Roll ${roll.rolls.join(" + ")} ${modifier >= 0 ? "+" : "−"} ${Math.abs(modifier)} = ${total} — <strong>${tierLabel}</strong></p>
            <p><strong>Burn damage:</strong> ${hitRoll.total} hits (${outcome.hitsDice}). ${bleedLine}</p>
            ${heatLine}`
    });
}
