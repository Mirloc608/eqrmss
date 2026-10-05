// ============================================================
// CAST SPELL (Stage 2): the cast path from an actor's spell
// item. Resource is EQ mana (attributes.mana, EQ manaCost;
// ruling 2026-10-04). Directed (bolt) spells run through the
// weapon-attack engine — the spell is presented as a synthetic
// weapon carrying the derived attack table and the caster's
// Directed Spells skill bonus as its OB modifier.
// Heal spells restore hits and trigger the healing-magic hook
// (bleed stopped, death timer cleared).
// ============================================================

import { combatCard } from "../combat/chat-card.js";
import { classifySpell, directedSpellsBonus } from "./spell-mapping.js";
import { rollWeaponAttack } from "../combat/combat-rolls.js";
import { applyHealingSpell, checkHitThresholds } from "../combat/crit-conditions.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

function targetedActor() {
    const t = [...(globalThis.game?.user?.targets ?? [])][0];
    return t?.actor ?? null;
}

/**
 * Cast a spell from an actor's spell item. Returns a small
 * summary object; posts chat for every outcome.
 */
export async function castSpell(actor, spellItem) {
    if (!actor || !spellItem) return { ok: false, reason: "missing" };
    const name = spellItem.name ?? "spell";
    const cls = classifySpell(spellItem);
    const cost = Math.max(0, Number(spellItem.system?.manaCost) || 0);
    const pool = actor.system?.attributes?.mana ?? { value: 0, max: 0 };
    const before = Number(pool.value) || 0;
    if (cost > before) {
        ui.notifications?.warn(`${actor.name} cannot cast ${name}: needs ${cost} mana, has ${before}.`);
        return { ok: false, reason: "mana" };
    }
    const spendMana = async () => {
        if (cost > 0) await actor.update({ "system.attributes.mana.value": before - cost });
    };
    const manaNote = cost > 0 ? ` Mana ${before} → ${before - cost}.` : "";

    if (cls.kind === "bolt") {
        await spendMana();
        const synthetic = {
            _id: spellItem.id ?? spellItem._id ?? "cast-spell",
            id: spellItem.id ?? spellItem._id ?? "cast-spell",
            name,
            type: "weapon",
            system: {
                type: "spell",
                attackTable: cls.attackTable,
                obMod: directedSpellsBonus(actor),
                damageMod: 0,
                criticalType: cls.critType ?? "",
                location: "equipped",
                equipped: true
            }
        };
        await rollWeaponAttack(actor, synthetic, { forcedCritType: cls.critType });
        return { ok: true, kind: "bolt", attackTable: cls.attackTable };
    }

    if (cls.kind === "heal") {
        await spendMana();
        const target = targetedActor() ?? actor;
        const canTouch = target.isOwner || game.user?.isGM;
        let healLine = "";
        if (canTouch) {
            // Per ruling, ANY direct healing magic stops bleeding and
            // clears the death timer; then hits are restored.
            await applyHealingSpell(target);
            const cur = Number(target.system?.hits?.value) || 0;
            const restored = Math.min(cls.amount, cur);
            await target.update({ "system.hits.value": cur - restored });
            await checkHitThresholds(target);
            healLine = `<p><em>${esc(target.name)} recovers ${restored} hits (${cur} → ${cur - restored}).</em></p>`;
        } else {
            healLine = `<p><em>Healing not applied — you don't control ${esc(target.name)}.</em></p>`;
        }
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Spellcasting", `
                <h2>${esc(actor.name)} casts ${esc(name)} on ${esc(target.name)}</h2>
                ${healLine}<p><em>${manaNote.trim()}</em></p>`)
        });
        return { ok: true, kind: "heal", amount: cls.amount };
    }

    // Announced cast (buff/utilities and later-stage tracks land
    // their mechanics in later stages; the mana economy is live).
    await spendMana();
    const note = cls.kind === "later" ? esc(cls.reason) : "no mechanical payload";
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: combatCard("Spellcasting", `
            <h2>${esc(actor.name)} casts ${esc(name)}</h2>
            <p><em>Cast announced — ${note}.${manaNote}</em></p>`)
    });
    return { ok: true, kind: cls.kind };
}
