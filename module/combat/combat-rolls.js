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
//   6. Damage applied to the target actor; weapon procs fire on crit;
//      critical conditions parsed and applied (stun pool, bleed,
//      death timer, next-swing bonus, must-parry) — see crit-conditions.js
//   7. Full breakdown posted to chat
// ============================================================

import {
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
import {
    applyCritConditions,
    checkHitThresholds,
    consumeNextSwingBonus,
    computeWeaponOB,
    activeStun,
    STUN_LABEL
} from "./crit-conditions.js";

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
// Offers a world-actor picker: picking an actor fills in its name/AT/DB,
// uses its derived AT/DB, and auto-applies damage (permission-checked,
// like a targeted token). Pure manual entry keeps the typed name/AT/DB
// and reports the damage for the GM to apply by hand.
async function promptTarget() {
    const DialogV2 = foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.prompt) {
        ui.notifications.warn("No token targeted — target a token or pick one below.");
        return null;
    }

    // DialogV2 subclass so that picking an actor live-fills the
    // name/AT/DB fields (codebase pattern: _onRender + addEventListener).
    // Defined here so `extends` never evaluates against a missing DialogV2.
    class TargetActorDialog extends DialogV2 {
        async _onRender(context, options) {
            await super._onRender(context, options);
            const sel = this.element.querySelector('select[name="actorId"]');
            if (!sel) return;
            const form = sel.closest("form") ?? this.element;
            sel.addEventListener("change", () => {
                const opt = sel.selectedOptions?.[0];
                if (!opt?.value) return; // "Manual entry" — keep the typed values
                const nameInput = form.querySelector('input[name="name"]');
                const atInput = form.querySelector('input[name="at"]');
                const dbInput = form.querySelector('input[name="db"]');
                if (nameInput && opt.dataset.actorName) nameInput.value = opt.dataset.actorName;
                if (atInput && opt.dataset.at) atInput.value = opt.dataset.at;
                if (dbInput && opt.dataset.db) dbInput.value = opt.dataset.db;
            });
        }
    }

    const actorOptions = (game.actors?.contents ?? [])
        .slice()
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
        .map(a => {
            const at = parseArmorType(a.system?.combat?.armorType);
            const db = Number(a.system?.combat?.totalDB) || 0;
            return `<option value="${esc(a.id)}" data-actor-name="${esc(a.name)}"`
                + ` data-at="${at ?? ""}" data-db="${db}">${esc(a.name)}</option>`;
        })
        .join("");
    try {
        const fd = await TargetActorDialog.prompt({
            window: { title: "Attack: target details" },
            content: `
                <div class="form-group">
                    <label>Target actor (auto-applies damage)</label>
                    <select name="actorId">
                        <option value="">— Manual entry —</option>
                        ${actorOptions}
                    </select>
                </div>
                <p class="hint">Picking an actor fills in its name/AT/DB and applies damage automatically. Leave on manual entry to type the values by hand.</p>
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

    // ---- Stun / unconscious: no offensive action ----
    const stunState = activeStun(actor.system?.status?.stun);
    const unconscious = !!actor.system?.status?.unconscious;
    if (stunState || unconscious) {
        const why = unconscious ? "unconscious" : STUN_LABEL[stunState.type];
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<h2>${esc(actor.name)} attacks with ${esc(weaponItem.name)}</h2>`
                + `<p><em>${esc(actor.name)} is ${why} and cannot take offensive action.</em></p>`
        });
        return;
    }

    // ---- OB: weapon skill bonus + weapon OB mod (shared with parry) ----
    const { skill, skillBonus, obMod, ob: baseOb } = computeWeaponOB(actor, weaponItem);

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

    // ---- Target parry: a declared parry puts ALL of the target's OB
    // into DB — unless they are stun-no-parry/down-or-out (base
    // defense only).
    let parryDB = 0;
    if (targetActor) {
        const tst = activeStun(targetActor.system?.status?.stun);
        if (!tst || tst.type === "stunned") parryDB = Number(targetActor.system?.status?.parryDB) || 0;
    }
    db += parryDB;

    // ---- Next-swing bonus (critical condition, consumed on use) ----
    // Placed after target determination so a cancelled prompt does not burn it.
    const swingBonus = await consumeNextSwingBonus(actor);
    // ---- Action penalty: "at -N" hits ALL actions ----
    const actionPenalty = Math.min(0, Number(actor.system?.status?.actionPenalty?.value) || 0);
    const ob = baseOb + swingBonus + actionPenalty;

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
        + ` + OB ${ob}${skill ? "" : " (no skill)"}${obMod ? ` (skill ${skillBonus}, weapon ${obMod >= 0 ? "+" : ""}${obMod})` : ""}${swingBonus ? ` (+${swingBonus} next swing)` : ""}${actionPenalty ? ` (${actionPenalty} all actions)` : ""}`
        + ` − DB ${db}${parryDB ? ` (+${parryDB} parry)` : ""} = <strong>${ar.total + ob - db}</strong>`
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
    let condNote = ""; // critical-condition notes (stun pool, bleed, death timer, next swing, must parry)
    const crit = parseCritCode(lookup.critCode);
    if (crit && !crit.unparseable) {
        const cr = await d100();
        const critResult = lookupCrit(tables.crits, crit.type, crit.severity, cr);
        if (!critResult.error) {
            critBonus = critBonusHits(critResult.text);
            critFired = true;
            // ---- Critical conditions (stun pool, bleed, death timer, next swing, must parry) ----
            condNote = await applyCritConditions(targetActor, actor, critResult.text);
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
        appliedNote = `<p><em>${totalDamage} concussion hit${totalDamage === 1 ? "" : "s"} applied to ${esc(targetName)}.</em></p>`;
        // Concussion-hit thresholds — unconsciousness (§6.4.1), dying (§3.8).
        await checkHitThresholds(targetActor);
    } else if (targetActor && totalDamage > 0) {
        appliedNote = `<p><em>Damage not applied — you don't control ${esc(targetName)}.</em></p>`;
    } else if (!targetActor && totalDamage > 0) {
        appliedNote = `<p><em>Damage not applied — no token targeted. Apply ${totalDamage} concussion hit${totalDamage === 1 ? "" : "s"} to ${esc(targetName)} manually (target the token before rolling to auto-apply).</em></p>`;
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
            ${appliedNote}${condNote}${procNote}`
    });
}
