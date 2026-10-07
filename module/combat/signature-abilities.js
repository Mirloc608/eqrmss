/**
 * Signature Abilities: Paladin Lay on Hands, Shadowknight Harm Touch
 * (2026-10-07)
 * 
 * Lay on Hands: Heals 15% of max HP + 10% per rank. Melee range. Once per combat. Free.
 * Harm Touch: Damage = (50 × rank) + (10 × level). Melee range. Disease-based RR at -20. Once per combat. Free.
 */

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function tokenDistanceFt(fromTok, toTok) {
    const canvas = globalThis.canvas;
    const size = Number(canvas?.dimensions?.size) || 0;
    const dist = Number(canvas?.dimensions?.distance) || 0;
    if (!(size > 0) || !(dist > 0)) return null;
    const a = fromTok?.center, b = toTok?.center;
    if (!a || !b) return null;
    return Math.hypot(b.x - a.x, b.y - a.y) / size * dist;
}

const MELEE_REACH_FT = 8;

function getSignatureRank(actor, abilityId) {
    return 1;
}

async function checkUsable(actor, target, abilityName) {
    if (actor.system?.status?.[`${abilityName}Used`]) {
        return { ok: false, reason: `${abilityName} has already been used this combat.` };
    }
    const attackerTok = actor.getActiveTokens?.()?.[0] ?? null;
    const targetTok = target?.getActiveTokens?.()?.[0] ?? null;
    if (attackerTok && targetTok) {
        const feet = tokenDistanceFt(attackerTok, targetTok);
        if (feet !== null && feet > MELEE_REACH_FT + 1e-6) {
            return { ok: false, reason: `${target.name} is ${Math.round(feet)} ft away — out of melee reach.` };
        }
    }
    return { ok: true };
}

export async function layOnHands(actor, target) {
    const name = "Lay on Hands";
    const check = await checkUsable(actor, target, "layOnHands");
    if (!check.ok) {
        ui?.notifications?.warn(check.reason);
        return { ok: false, reason: check.reason };
    }
    const rank = getSignatureRank(actor, "lay-on-hands");
    const percent = 15 + (rank - 1) * 10;
    const maxHp = Number(target.system?.hits?.max) || Number(target.system?.attributes?.hits?.max) || 0;
    const healAmount = Math.floor(maxHp * percent / 100);
    const hitsTaken = Number(target.system?.hits?.taken) || 0;
    const newTaken = Math.max(0, hitsTaken - healAmount);
    await target.update({ "system.hits.taken": newTaken });
    await actor.update({ "system.status.layOnHandsUsed": true });
    const actualHealed = hitsTaken - newTaken;
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<h2>${esc(name)}</h2><p><em>${esc(actor.name)} lays hands on ${esc(target.name)}, restoring ${actualHealed} hits (${percent}% of max).</em></p>`
    });
    return { ok: true, healed: actualHealed };
}

export async function harmTouch(actor, target) {
    const name = "Harm Touch";
    const check = await checkUsable(actor, target, "harmTouch");
    if (!check.ok) {
        ui?.notifications?.warn(check.reason);
        return { ok: false, reason: check.reason };
    }
    const rank = getSignatureRank(actor, "harm-touch");
    const level = Number(actor.system?.attributes?.level?.value) || 1;
    const damage = (50 * rank) + (10 * level);
    const currentTaken = Number(target.system?.hits?.taken) || 0;
    await target.update({ "system.hits.taken": currentTaken + damage });
    await actor.update({ "system.status.harmTouchUsed": true });
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<h2>${esc(name)}</h2><p><em>${esc(actor.name)} touches ${esc(target.name)} with unholy power, dealing ${damage} damage (Disease RR at -20).</em></p>`
    });
    return { ok: true, damage };
}

export async function resetSignatureAbilities(actor) {
    await actor.update({
        "system.status.layOnHandsUsed": false,
        "system.status.harmTouchUsed": false
    });
}
