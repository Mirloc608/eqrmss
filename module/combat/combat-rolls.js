// ============================================================
// EQRMSS Combat Rolls — Foundry wiring for Arms Law attack
// resolution (RMSS §6.2–6.4).
//
// rollWeaponAttack(actor, weaponItem):
//   1. OB = weapon skill bonus + weapon OB mod
//   2. Target = first targeted token's actor, else manual AT/DB prompt
//   3. Attack roll = high open-ended d100; fumble on the weapon's
//      unmodified fumble range → Weapon Fumble Table (§6.3)
//   4. Net = AR + OB − DB (cap 150) vs AT on the weapon's table (§6.4)
//   5. Crit → flat d100 on the crit table at the rolled severity (§6.4.2)
//   6. Damage applied to the target actor; weapon procs fire on crit
//   7. Full breakdown posted to chat
// ============================================================

import {
    WEAPON_TYPE_TO_SKILL_ID,
    WEAPON_TYPE_TO_FUMBLE_COLUMN,
    parseFumbleRange,
    inFumbleRange,
    lookupAttack,
    parseCritCode,
    lookupCrit,
    lookupFumble,
    parseArmorType,
    critBonusHits
} from "./attack-resolver.js";

async function d100() {
    return (await new Roll("1d100").evaluate()).total;
}

// High open-ended attack roll (§6.2): 96–100 → roll again and add.
async function openEndedAttackRoll() {
    const rolls = [];
    let total = 0;
    for (;;) {
        const r = await d100();
        rolls.push(r);
        total += r;
        if (r < 96 || r > 100) break;
    }
    return { rolls, total };
}

// Manual target entry when nothing is targeted.
// Offers a world-actor picker: picking an actor uses its derived AT/DB
// and auto-applies damage (permission-checked, like a targeted token).
// Pure manual entry keeps the typed name/AT/DB and reports the damage
// for the GM to apply by hand.
async function promptTarget() {
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.prompt) {
        ui.notifications.warn("No token targeted — target a token or pick one below.");
        return null;
    }
    const actorOptions = (game.actors?.contents ?? [])
        .slice()
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
        .map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)
        .join("");
    try {
        const fd = await DialogV2.prompt({
            window: { title: "Attack: target details" },
            content: `
                <div class="form-group">
                    <label>Target actor (auto-applies damage)</label>
                    <select name="actorId">
                        <option value="">— Manual entry —</option>
                        ${actorOptions}
                    </select>
                </div>
                <p class="hint">Picking an actor uses its AT/DB and applies damage automatically. Leave on manual entry to type the values by hand.</p>
                <div class="form-group">
                    <label>Target name</label>
                    <input type="text" name="name" value="Target">
                </div>
                <div class="form-group">
                    <label>Armor Type (AT 1&ndash;20)</label>
                    <input type="number" name="at" value="1" min="1" max="20">
                </div>
                <div class="form-group">
                    <label>Defensive Bonus (DB)</label>
                    <input type="number" name="db" value="0">
                </div>`,
            ok: { label: "Roll Attack" }
        });
        if (!fd) return null; // cancelled
        // DialogV2.prompt resolves with the form data — as a plain object
        // on this Foundry build (FormDataExtended on others). Read both ways.
        const val = k => (typeof fd.get === "function" ? fd.get(k) : fd[k]);
        const at = Math.max(1, Math.min(20, Number(val("at")) || 1));
        const actorId = val("actorId");
        const picked = actorId ? game.actors?.get(actorId) : null;
        return {
            name: String(val("name") || "Target"),
            at,
            db: Number(val("db")) || 0,
            actor: picked ?? null
        };
    } catch (e) {
        console.error("EQRMSS | Target prompt failed", e);
        return null;
    }
}

function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export async function rollWeaponAttack(actor, weaponItem) {
    const sys = weaponItem.system ?? {};
    const tableName = sys.attackTable;
    const weaponType = sys.type;

    if (!tableName) {
        ui.notifications.warn(`"${weaponItem.name}" has no attack table — set one on the weapon sheet.`);
        return;
    }
    const tables = game.eqrmss?.combatTables;
    if (!tables) {
        ui.notifications.error("Combat tables are not loaded.");
        return;
    }

    // ---- OB: weapon skill bonus + weapon OB mod ----
    const skillId = WEAPON_TYPE_TO_SKILL_ID[weaponType];
    const skill = skillId
        ? actor.items.find(i => i.type === "skill" && i.system?.slug === skillId)
        : null;
    const skillBonus = Number(skill?.system?.bonus) || 0;
    const obMod = Number(sys.obMod) || 0;
    const ob = skillBonus + obMod;

    // ---- Target: first targeted token, else manual ----
    let targetActor = null;
    let targetName = "Target";
    let at = null;
    let db = 0;
    const targeted = [...(game.user?.targets ?? [])][0];
    if (targeted?.actor) {
        targetActor = targeted.actor;
        targetName = targeted.name ?? targetActor.name;
        at = parseArmorType(targetActor.system?.combat?.armorType);
        db = Number(targetActor.system?.combat?.totalDB) || 0;
        if (at == null) {
            ui.notifications.warn(`Could not read AT from ${targetName} — enter it manually.`);
        }
    }
    if (at == null) {
        const manual = await promptTarget();
        if (!manual) return;
        if (manual.actor) {
            // World-actor pick: same handling as a targeted token —
            // derived AT/DB, damage auto-applies (permission-checked).
            targetActor = manual.actor;
            targetName = targetActor.name;
            const aat = parseArmorType(targetActor.system?.combat?.armorType);
            at = aat ?? manual.at;
            db = Number(targetActor.system?.combat?.totalDB) || 0;
        } else {
            targetName = manual.name;
            at = manual.at;
            db = manual.db;
        }
    }

    // ---- Attack roll (high open-ended) ----
    const ar = await openEndedAttackRoll();
    const firstDie = ar.rolls[0];

    // ---- Fumble check on the UNMODIFIED roll (§6.2–6.3) ----
    const fumbleRange = parseFumbleRange(sys.fumble_range);
    if (inFumbleRange(firstDie, fumbleRange)) {
        const fr = await d100();
        const fumbleCol = WEAPON_TYPE_TO_FUMBLE_COLUMN[weaponType] ?? "hand1";
        const fumble = lookupFumble(tables.fumble, fumbleCol, fr);
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `
                <h2>${esc(actor.name)} attacks with ${esc(weaponItem.name)}</h2>
                <p><strong>Attack roll:</strong> ${firstDie} — FUMBLE (range ${esc(sys.fumble_range)})</p>
                <p><strong>Fumble roll:</strong> ${fr} (${esc(fumbleCol)})</p>
                <p>${fumble.error ? esc(fumble.error) : esc(fumble.text)}</p>
                <p><em>No effect on ${esc(targetName)}.</em></p>`
        });
        return;
    }

    // ---- Net attack roll (§6.2): AR + OB − DB, cap 150 ----
    const net = ar.total + ob - db;
    const lookup = lookupAttack(tables.weapons, tableName, net, at);

    const arLine = `Attack roll ${ar.rolls.join(" + ")}${ar.rolls.length > 1 ? ` = ${ar.total}` : ""}`
        + ` + OB ${ob}${skill ? "" : " (no skill)"}${obMod ? ` (skill ${skillBonus}, weapon ${obMod >= 0 ? "+" : ""}${obMod})` : ""}`
        + ` − DB ${db} = <strong>${ar.total + ob - db}</strong>`
        + (net > 150 ? ` → treated as 150` : "");

    if (lookup.error && lookup.miss) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `
                <h2>${esc(actor.name)} attacks ${esc(targetName)} with ${esc(weaponItem.name)}</h2>
                <p>${arLine}</p>
                <p><strong>Miss</strong> — ${esc(lookup.error)}</p>`
        });
        return;
    }
    if (lookup.error) {
        ui.notifications.error(lookup.error);
        return;
    }

    // ---- Critical strike (§6.4.2) ----
    let critLine = "<em>No critical.</em>";
    let critBonus = 0;
    let critFired = false;
    const crit = parseCritCode(lookup.critCode);
    if (crit && !crit.unparseable) {
        const cr = await d100();
        const critResult = lookupCrit(tables.crits, crit.type, crit.severity, cr);
        if (!critResult.error) {
            critBonus = critBonusHits(critResult.text);
            critFired = true;
            critLine = `<strong>${esc(lookup.critCode)}</strong> → d100 ${cr} on the ${esc(critResult.table)} (${crit.severity}): ${esc(critResult.text)}`;
        } else {
            critLine = `<strong>${esc(lookup.critCode)}</strong> — ${esc(critResult.error)} (GM adjudicates)`;
        }
    } else if (crit?.unparseable) {
        critLine = `<strong>${esc(crit.raw)}</strong> — unusual result, GM adjudicates.`;
    }

    // ---- Damage ----
    const damageMod = Number(sys.damageMod) || 0;
    const tableDamage = lookup.damage ?? 0;
    const totalDamage = tableDamage + damageMod + critBonus;
    const dmgParts = [`table ${tableDamage}`];
    if (damageMod) dmgParts.push(`weapon ${damageMod >= 0 ? "+" : ""}${damageMod}`);
    if (critBonus) dmgParts.push(`crit +${critBonus}`);

    let appliedNote = "";
    if (targetActor && totalDamage > 0 && (targetActor.isOwner || game.user?.isGM)) {
        const cur = Number(targetActor.system?.hits?.value) || 0;
        await targetActor.update({ "system.hits.value": cur + totalDamage });
        appliedNote = `<p><em>${totalDamage} concussion hits applied to ${esc(targetName)}.</em></p>`;
    } else if (targetActor && totalDamage > 0) {
        appliedNote = `<p><em>Damage not applied — you don't control ${esc(targetName)}.</em></p>`;
    } else if (!targetActor && totalDamage > 0) {
        appliedNote = `<p><em>Damage not applied — no token targeted. Apply ${totalDamage} concussion hits to ${esc(targetName)} manually (target the token before rolling to auto-apply).</em></p>`;
    }

    // ---- Weapon proc on crit (already-ruled: procs fire onCrit) ----
    let procNote = "";
    if (critFired && sys.proc && game.eqrmss?.itemEffects?.fireProc) {
        try {
            await game.eqrmss.itemEffects.fireProc({ wielder: actor, weapon: weaponItem, target: targetActor, event: "onCrit" });
            procNote = `<p><em>Weapon proc fired.</em></p>`;
        } catch (e) {
            console.error("EQRMSS | Proc fire failed", e);
        }
    }

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
            <h2>${esc(actor.name)} attacks ${esc(targetName)} with ${esc(weaponItem.name)}</h2>
            <p>${arLine}</p>
            <p><strong>${esc(lookup.table)}</strong> vs AT ${at}: <strong>${totalDamage} hits</strong> (${dmgParts.map(esc).join(", ")})</p>
            <p>${critLine}</p>
            ${appliedNote}${procNote}`
    });
}
