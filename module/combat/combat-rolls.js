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
import { isWorn } from "../utils/equipment/equipment-utils.js";
import { strategicTargetingSkill, promptCalledShot } from "./strategic-targeting.js";

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
async function promptTarget(missileAttack = false, attackerActor = null) {
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
            const db = targetDefense(a, missileAttack, attackerActor).db;
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

const MISSILE_WEAPON_TYPES = new Set(["missile", "thrown"]);
const WEAPON_AS_SHIELD_TYPES = new Set(["one-handed-edged", "one-handed-crushing", "two-handed", "polearm"]);
const ONE_HANDED_WEAPON_TYPES = new Set(["one-handed-edged", "one-handed-crushing"]);

function isMissileAttack(weaponType) {
    return MISSILE_WEAPON_TYPES.has(weaponType);
}

// Arms Law §5.2.11 RANGE: OB modification by distance, printed on each
// missile attack table (8.5.x) and stored as `rangeBands` on those
// tables in weapon-tables.json ([{ upTo (feet), obMod }], ascending).
// §5.2.12 RELOADING: OB penalty by preparation rounds spent before the
// shot (chart result is the penalty; null = firing not allowed).
const RELOAD_PENALTIES = {
    "Short Bow": { 0: 10, 1: 0, 2: 0, 3: 0 },
    "Composite Bow": { 0: 20, 1: 0, 2: 0, 3: 0 },
    "Long Bow": { 0: 30, 1: 0, 2: 0, 3: 0 },
    "Sling": { 0: 10, 1: 0, 2: 0, 3: 0 },
    "Light Crossbow": { 0: null, 1: 20, 2: 0, 3: 0 },
    "Heavy Crossbow": { 0: null, 1: 30, 2: 10, 3: 0 }
};

function rangeBandsFor(tables, tableName) {
    const list = tables?.weapons;
    const entry = Array.isArray(list) ? list.find(t => t?.name === tableName) : list?.[tableName];
    const bands = entry?.rangeBands;
    return Array.isArray(bands) && bands.length ? bands : null;
}

function bandLabel(bands, i) {
    const lo = i === 0 ? 1 : (Number(bands[i - 1].upTo) || 0) + 1;
    const mod = Number(bands[i].obMod) || 0;
    return `${lo}'–${bands[i].upTo}' (${mod >= 0 ? "+" : ""}${mod})`;
}

// Ammunition: a missile weapon fires a tagged stack from the actor's
// inventory (item sheet -> Ammunition). Stacks are ordinary items with
// system.ammoType set and system.quantity as the count; each shot
// consumes one. A missile weapon with no matching ammunition cannot
// be fired. Thrown weapons are themselves the projectile — no count.
const AMMO_TYPE_BY_TEMPLATE = {
    composite_bow: "arrow",
    long_bow: "arrow",
    short_bow: "arrow",
    crossbow_heavy: "bolt",
    crossbow_light: "bolt",
    sling: "stone",
    blowpipe: "dart"
};
const AMMO_TYPE_LABEL = { arrow: "arrows", bolt: "bolts", stone: "stones", dart: "darts" };

function ammoTypeFor(weaponItem, weaponType) {
    if (weaponType !== "missile") return null;
    return AMMO_TYPE_BY_TEMPLATE[weaponItem?.system?.weaponTemplate] ?? "arrow";
}

function ammoStacksFor(actor, ammoType) {
    const items = actor?.items?.contents ?? actor?.items ?? [];
    // Only equipped ammunition is at hand — arrows in the pack do not
    // show up and cannot be fired.
    return [...items].filter(i => i?.system?.ammoType === ammoType && isWorn(i) && (Number(i.system?.quantity) || 0) > 0);
}

// Missile shot prompt: range band + preparation rounds for this shot.
// Returns { rangeMod, reloadPenalty, bandIndex, prepRounds } or null
// on cancel. Without DialogV2 (headless callers), the unmodified band
// and one preparation round are used.
async function promptMissileShot(bands, reloadChart, weaponName, ammoStacks = []) {
    const defaultBand = Math.max(0, bands.findIndex(b => (Number(b.obMod) || 0) === 0));
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.prompt) {
        return { rangeMod: Number(bands[defaultBand].obMod) || 0, bandIndex: defaultBand, prepRounds: 1, reloadPenalty: reloadChart ? (reloadChart[1] ?? 0) : 0, ammoItem: ammoStacks[0] ?? null };
    }
    const bandOptions = bands.map((b, i) => `<option value="${i}"${i === defaultBand ? " selected" : ""}>${esc(bandLabel(bands, i))}</option>`).join("");
    const prepOptions = reloadChart
        ? [0, 1, 2, 3].map(r => {
            const p = reloadChart[r];
            const note = p == null ? "cannot fire" : (p > 0 ? `OB −${p}` : "no penalty");
            return `<option value="${r}"${r === 1 ? " selected" : ""}>${r} round${r === 1 ? "" : "s"} (${note})</option>`;
        }).join("")
        : "";
    const ammoOptions = ammoStacks.length
        ? ammoStacks.map(i => `<option value="${esc(i.id ?? i._id ?? "")}">${esc(i.name)} × ${Number(i.system?.quantity) || 0}</option>`).join("")
        : "";
    try {
        const fd = await DialogV2.prompt({
            window: { title: `Missile Attack: ${weaponName}` },
            content: `
                <div class="form-group">
                    <label>Range to target</label>
                    <select name="band">${bandOptions}</select>
                </div>
                ${reloadChart ? `<div class="form-group">
                    <label>Preparation rounds spent (reloading, §5.2.12)</label>
                    <select name="prep">${prepOptions}</select>
                </div>` : ""}
                ${ammoStacks.length ? `<div class="form-group">
                    <label>Ammunition</label>
                    <select name="ammo">${ammoOptions}</select>
                </div>` : ""}`,
            ok: { label: "Fire" }
        });
        if (!fd) return null;
        const val = k => (typeof fd.get === "function" ? fd.get(k) : fd[k]);
        const bandIndex = Math.max(0, Math.min(bands.length - 1, Number(val("band")) || 0));
        const prepRounds = reloadChart ? Math.max(0, Math.min(3, Number(val("prep")) || 0)) : 1;
        const ammoId = val("ammo");
        const ammoItem = ammoStacks.find(i => (i.id ?? i._id ?? "") === ammoId) ?? ammoStacks[0] ?? null;
        return {
            rangeMod: Number(bands[bandIndex].obMod) || 0,
            bandIndex,
            prepRounds,
            reloadPenalty: reloadChart ? reloadChart[prepRounds] : 0,
            ammoItem
        };
    } catch (e) {
        console.error("EQRMSS | Missile prompt failed", e);
        return null;
    }
}

function actorKey(actor) {
    return actor?.uuid ?? actor?.id ?? actor?._id ?? actor?.name ?? "";
}

// A weapon's length in feet from its baked template length
// ("2.5-3" -> 3). Unknown length conveys no CQC penalty.
function weaponLengthFeet(weaponItem) {
    const raw = weaponItem?.system?.length;
    if (raw == null || raw === "") return null;
    const nums = String(raw).match(/[\d.]+/g)?.map(Number).filter(Number.isFinite) ?? [];
    return nums.length ? Math.max(...nums) : null;
}

function currentShieldRoundKey() {
    const combat = game.combat;
    return combat?.id ? `${combat.id}:${Number(combat.round) || 0}` : "no-combat";
}

// Arms Law §4.2: a shield bonus may only be used against one opponent's
// attack(s) per round. The defender's derived DB carries the shield
// component; resolution subtracts it when that opponent is not the one
// the shield is currently assigned to. The assignment is recorded on
// the defender's status and lapses at the round tick.
function targetDefense(targetActor, missileAttack, attackerActor) {
    if (!targetActor) return { db: 0, shieldDB: 0, shieldBlocked: false, shieldOpponentName: "", needsShieldAssignment: false };
    // An unconscious defender has no derived DB at all (user ruling
    // 2026-10-02) — the whole derivation is negated, not just Adrenal.
    if (targetActor.system?.status?.unconscious) {
        return { db: 0, shieldDB: 0, shieldBlocked: false, shieldOpponentName: "", needsShieldAssignment: false };
    }

    const combat = targetActor.system?.combat ?? {};
    const missileDB = Number(combat.totalMissileDB);
    const rawDB = missileAttack && Number.isFinite(missileDB)
        ? (missileDB || 0)
        : (Number(combat.totalDB) || 0);
    const shieldDB = missileAttack
        ? (Number(combat.shieldMissileBonus ?? combat.shieldBonus) || 0)
        : (Number(combat.shieldBonus) || 0);
    if (!shieldDB) {
        return { db: rawDB, shieldDB: 0, shieldBlocked: false, shieldOpponentName: "", needsShieldAssignment: false };
    }

    const status = targetActor.system?.status ?? {};
    const roundKey = currentShieldRoundKey();
    const assignedId = status.shieldOpponentRoundKey === roundKey ? (status.shieldOpponentId ?? "") : "";
    const assignedName = status.shieldOpponentRoundKey === roundKey ? (status.shieldOpponentName ?? "") : "";
    const attackerId = actorKey(attackerActor);

    if (!assignedId) {
        return { db: rawDB, shieldDB, shieldBlocked: false, shieldOpponentName: "", needsShieldAssignment: !!attackerId };
    }
    if (attackerId && assignedId === attackerId) {
        return { db: rawDB, shieldDB, shieldBlocked: false, shieldOpponentName: assignedName, needsShieldAssignment: false };
    }
    return {
        db: rawDB - shieldDB,
        shieldDB: 0,
        shieldBlocked: true,
        shieldOpponentName: assignedName,
        needsShieldAssignment: false
    };
}

async function recordShieldAssignment(targetActor, attackerActor, defense) {
    if (!targetActor || !attackerActor || !defense?.needsShieldAssignment || !defense.shieldDB) return false;
    if (!(targetActor.isOwner || game.user?.isGM)) return false;
    const attackerId = actorKey(attackerActor);
    if (!attackerId) return false;
    await targetActor.update({
        "system.status.shieldOpponentId": attackerId,
        "system.status.shieldOpponentName": attackerActor.name ?? "",
        "system.status.shieldOpponentRoundKey": currentShieldRoundKey()
    });
    return true;
}

// Arms Law §4.3/§4.4.8: a declared weapon parry adds its allocated OB
// to DB against melee attacks only, and only against the ONE foe the
// defender attacks (§4.3) — designated at declaration and (re)set by
// the defender's own attack. A full-OB parry also gains the weapon's
// +5 shield bonus. Two-handed weapons use at most 50% of OB to parry
// one-handed weapons; pole arms use at most 50% against non-pole
// arms. Stun-no-parry/down-or-out suppresses the parry DB.
function targetParryDB(targetActor, attackerWeaponType, missileAttack, attacker = null) {
    if (!targetActor || missileAttack) return 0;
    if (targetActor.system?.status?.unconscious) return 0; // no DB while unconscious
    const tst = activeStun(targetActor.system?.status?.stun);
    if (tst && tst.type !== "stunned") return 0;
    const status = targetActor.system?.status ?? {};
    let allocated = Number(status.parryDB) || 0;
    if (allocated <= 0) return 0;
    // Foe-specific (§4.3): no foe recorded yet, or this attacker is
    // not the foe, means the parry does not apply to this attack.
    const foeId = status.parryTargetId ?? "";
    if (!foeId || !attacker || attacker.id !== foeId) return 0;
    const maxOb = Number(status.parryMaxOB) || allocated;
    const parryWeaponType = status.parryWeaponType ?? "";
    if (parryWeaponType === "two-handed" && ONE_HANDED_WEAPON_TYPES.has(attackerWeaponType)) {
        allocated = Math.min(allocated, Math.floor(maxOb / 2));
    }
    if (parryWeaponType === "polearm" && attackerWeaponType !== "polearm") {
        allocated = Math.min(allocated, Math.floor(maxOb / 2));
    }
    if (allocated >= maxOb && WEAPON_AS_SHIELD_TYPES.has(parryWeaponType)) allocated += 5;
    return allocated;
}

// Arms Law §4.3 ("Parrying Missile Fire"): a declared missile parry
// adds its allocated OB to DB against missile/thrown attacks only,
// and is consumed by the first such attack. Requires shield/terrain
// at declaration (checked there); stun-no-parry/down-or-out and
// unconsciousness suppress it like any parry.
function targetMissileParryDB(targetActor, missileAttack) {
    if (!targetActor || !missileAttack) return 0;
    if (targetActor.system?.status?.unconscious) return 0;
    const tst = activeStun(targetActor.system?.status?.stun);
    if (tst && tst.type !== "stunned") return 0;
    return Math.max(0, Number(targetActor.system?.status?.missileParryDB) || 0);
}

export async function rollWeaponAttack(actor, weaponItem) {
    const sys = weaponItem.system ?? {};
    // Weapons granted before their template carried an attack table
    // have none baked into the item; resolve it through the composer
    // from the stored template id so legacy items roll without a
    // manual weapon-sheet recompose.
    let tableName = sys.attackTable ?? null;
    if (!tableName && sys.weaponTemplate && game.eqrmss?.weapons?.compose) {
        try {
            tableName = game.eqrmss.weapons.compose(
                sys.weaponTemplate,
                sys.material ?? "steel",
                sys.condition ?? "normal"
            )?.attackTable ?? null;
        } catch (e) { /* unknown template — fall through to the warning */ }
    }
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

    // ---- Attacker's own parry split (§4.3): OB allocated to DB with
    // this weapon is not available to its attack. A full-OB parry still
    // attacks at +0 OB with that weapon. Parrying with a different
    // weapon blocks an attack with this one.
    const attackerStatus = actor.system?.status ?? {};
    let attackerParryAllocation = 0;
    if (attackerStatus.parrying) {
        const parryWeaponId = attackerStatus.parryWeaponId ?? "";
        const attackWeaponId = weaponItem.id ?? weaponItem._id ?? "";
        if (parryWeaponId && attackWeaponId && parryWeaponId !== attackWeaponId) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<h2>${esc(actor.name)} attacks with ${esc(weaponItem.name)}</h2>`
                    + `<p><em>${esc(actor.name)} declared parry with ${esc(attackerStatus.parryWeaponName || "another weapon")} this round; attack with that weapon at its remaining OB instead.</em></p>`
            });
            return;
        }
        attackerParryAllocation = Math.max(0, Math.min(Number(attackerStatus.parryDB) || 0, Math.max(0, baseOb)));
    }
    // Missile parry (§4.3) draws on the same weapon's OB budget: OB
    // shifted to missile DB is not available to this weapon's attack.
    let attackerMissileParryAllocation = 0;
    {
        const mpWeaponId = attackerStatus.missileParryWeaponId ?? "";
        const attackWeaponId = weaponItem.id ?? weaponItem._id ?? "";
        if (mpWeaponId && attackWeaponId && mpWeaponId === attackWeaponId) {
            attackerMissileParryAllocation = Math.max(0, Math.min(Number(attackerStatus.missileParryDB) || 0, Math.max(0, baseOb)));
        }
    }
    const missileAttack = isMissileAttack(weaponType);

    // ---- Target: first targeted token, else manual ----
    let targetActor = null;
    let targetName = "Target";
    let at = null;
    let db = 0;
    let shieldDefense = { db: 0, shieldDB: 0, shieldBlocked: false, shieldOpponentName: "", needsShieldAssignment: false };
    const targeted = [...(game.user?.targets ?? [])][0];
    if (targeted?.actor) {
        targetActor = targeted.actor;
        targetName = targeted.name ?? targetActor.name;
        at = parseArmorType(targetActor.system?.combat?.armorType);
        shieldDefense = targetDefense(targetActor, missileAttack, actor);
        db = shieldDefense.db;
        if (at == null) {
            ui.notifications.warn(`Could not read AT from ${targetName} — enter it manually.`);
        }
    }
    if (at == null) {
        const manual = await promptTarget(missileAttack, actor);
        if (!manual) return;
        if (manual.actor) {
            // World-actor pick: same handling as a targeted token —
            // derived AT/DB, damage auto-applies (permission-checked).
            targetActor = manual.actor;
            targetName = targetActor.name;
            const aat = parseArmorType(targetActor.system?.combat?.armorType);
            at = aat ?? manual.at;
            shieldDefense = targetDefense(targetActor, missileAttack, actor);
            db = shieldDefense.db;
        } else {
            targetName = manual.name;
            at = manual.at;
            db = manual.db;
        }
    }

    // ---- Target parry: the defender's allocated OB adds to DB
    // against melee attacks, unless they are stun-no-parry/down-or-out
    // (base defense only). Weapon parries do not apply vs missiles.
    // Close Quarters Combat (§4.7) pair state, resolved before the
    // defender's parry and Quickness DB are applied below.
    const attackerId = actor.id ?? actor._id ?? "";
    const defenderId = targetActor ? (targetActor.id ?? targetActor._id ?? "") : "";
    const closingOnTarget = !!defenderId && !!attackerStatus.cqcTargetId && attackerStatus.cqcTargetId === defenderId;
    const closedOnByTarget = !!defenderId && !!targetActor.system?.status?.cqcTargetId && targetActor.system.status.cqcTargetId === attackerId;
    let cqcQuLoss = 0;
    let cqcLengthPenalty = 0;

    const parryDB = targetParryDB(targetActor, weaponType, missileAttack, actor);
    db += parryDB;
    // §4.3 foe-specific parry: note when the defender's declared parry
    // does not cover this attacker (different foe, or none established).
    const foeStatus = targetActor?.system?.status ?? {};
    const defenderStun = targetActor ? activeStun(targetActor.system?.status?.stun) : null;
    const parryHeldNote = (!missileAttack && targetActor && parryDB <= 0 && (Number(foeStatus.parryDB) || 0) > 0
        && !targetActor.system?.status?.unconscious && !(defenderStun && defenderStun.type !== "stunned"))
        ? (foeStatus.parryTargetName ? ` (parry held vs ${foeStatus.parryTargetName})` : " (parry foe not yet established)")
        : "";
    // Missile parry (§4.3): applies vs missile/thrown only, one attack.
    const missileParryDB = targetMissileParryDB(targetActor, missileAttack);
    db += missileParryDB;
    const targetUnconscious = !!targetActor?.system?.status?.unconscious;

    // ---- Close Quarters Combat (Arms Companion §4.7): the closer
    // is within a foot of their foe. The foe cannot parry the
    // closer and loses half their Quickness DB against them; the
    // closer gains +30 OB. A combatant who has been closed on
    // strikes back at -50/-100 OB with a weapon over 2/3 feet,
    // and the closer's own Quickness DB is given up while engaged.
    let cqcParryNote = "";
    if (closingOnTarget && parryDB > 0) {
        cqcParryNote = " (cannot parry — close quarters)";
    }
    const effectiveParryDB = closingOnTarget ? 0 : parryDB;
    if (closingOnTarget && !targetUnconscious && targetActor) {
        const quDB = Math.max(0, Number(targetActor.system?.combat?.quicknessBonus) || 0);
        cqcQuLoss = Math.floor(quDB / 2);
    } else if (!targetUnconscious && targetActor?.system?.status?.cqcTargetId) {
        cqcQuLoss = Math.max(0, Number(targetActor.system?.combat?.quicknessBonus) || 0);
    }
    if (closingOnTarget) db -= parryDB;
    db = Math.max(0, db - cqcQuLoss);
    // The closed-on combatant's own long weapon is useless in close:
    // -100 OB over 3 feet, -50 over 2 feet (their attack back).
    if (closedOnByTarget && !missileAttack) {
        const len = weaponLengthFeet(weaponItem);
        if (len != null && len > 3) cqcLengthPenalty = 100;
        else if (len != null && len > 2) cqcLengthPenalty = 50;
    }

    // ---- Missile shot: range band (§5.2.11) and reloading (§5.2.12).
    // Prompted after target determination; cancelling aborts the shot
    // without consuming anything. Crossbows cannot fire with zero
    // preparation rounds.
    let rangeMod = 0;
    let reloadPenalty = 0;
    let ammoNote = "";
    if (missileAttack) {
        const bands = rangeBandsFor(tables, tableName);
        const reloadChart = weaponType === "missile" ? (RELOAD_PENALTIES[tableName] ?? null) : null;
        if (bands) {
            const ammoType = ammoTypeFor(weaponItem, weaponType);
            const ammoStacks = ammoType ? ammoStacksFor(actor, ammoType) : [];
            if (ammoType && ammoStacks.length === 0) {
                ui.notifications.warn(`${actor.name} has no ${AMMO_TYPE_LABEL[ammoType] ?? "ammunition"} for ${weaponItem.name} — shot not fired.`);
                return;
            }
            const shot = await promptMissileShot(bands, reloadChart, weaponItem.name, ammoStacks);
            if (!shot) return;
            if (reloadChart && shot.reloadPenalty == null) {
                ui.notifications.warn(`${weaponItem.name} cannot be fired without at least 1 round of preparation (reloading, §5.2.12).`);
                return;
            }
            rangeMod = shot.rangeMod;
            reloadPenalty = shot.reloadPenalty ?? 0;
            if (shot.ammoItem) {
                const left = Math.max(0, (Number(shot.ammoItem.system?.quantity) || 0) - 1);
                await shot.ammoItem.update({ "system.quantity": left });
                ammoNote = `<p><em>${esc(shot.ammoItem.name)} fired — ${left} remaining.</em></p>`;
            }
        }
    }

    // ---- Strategic Targeting (§4.15.3): attackers with the skill
    // may call a shot at a body area. Prompted before the swing
    // bonus is consumed so cancelling does not burn it.
    let calledShot = null;
    let calledShotMod = 0;
    {
        const stSkill = strategicTargetingSkill(actor);
        if (stSkill != null) {
            const pick = await promptCalledShot(actor, targetActor, targetName, stSkill);
            if (pick == null) return;
            if (pick.areaId) {
                calledShot = pick;
                calledShotMod = pick.modifier || 0;
                // §4.7: the closer gains +30 to Strategic Targeting.
                if (closingOnTarget) calledShotMod += 30;
            }
        }
    }

    // ---- Next-swing bonus (critical condition, consumed on use) ----
    // Placed after target determination so a cancelled prompt does not burn it.
    const swingBonus = await consumeNextSwingBonus(actor);
    // ---- Action penalty: "at -N" hits ALL actions ----
    const actionPenalty = Math.min(0, Number(actor.system?.status?.actionPenalty?.value) || 0);
    const ob = baseOb - attackerParryAllocation - attackerMissileParryAllocation + swingBonus + actionPenalty + rangeMod - reloadPenalty + calledShotMod + (closingOnTarget ? 30 : 0) - cqcLengthPenalty;

    // The attack is committed once target selection succeeds: mark the
    // round so a parry split cannot be declared retroactively.
    await actor.update({ "system.status.attackedThisRound": true });
    // §4.3: a parrying combatant's foe is the foe they attack — record
    // this attack's target so their parry DB applies against them.
    if (attackerStatus.parrying && targetActor) {
        await actor.update({
            "system.status.parryTargetId": targetActor.id ?? "",
            "system.status.parryTargetName": targetActor.name ?? ""
        });
    }
    await recordShieldAssignment(targetActor, actor, shieldDefense);

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
                <p><em>No effect on ${esc(targetName)}.</em></p>${ammoNote}`
        });
        return;
    }

    // ---- Net attack roll (§6.2): AR + OB − DB, cap 150 ----
    // Claw Law (AL&CL 11.1): the net roll also cannot exceed the attack
    // table's maximum-result threshold for the weapon's attack size.
    const net = ar.total + ob - db;
    const attackSize = sys.attackSize ?? null;
    const lookup = lookupAttack(tables.weapons, tableName, net, at, attackSize);

    // A declared missile parry is spent by this one missile attack.
    if (missileParryDB > 0 && targetActor) {
        await targetActor.update({
            "system.status.missileParryDB": 0,
            "system.status.missileParryWeaponId": "",
            "system.status.missileParryWeaponName": "",
            "system.status.missileParrySource": ""
        });
    }

    const SIZE_LABEL = { T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge" };
    const shieldNote = shieldDefense.shieldBlocked
        ? ` (shield omitted — used vs ${esc(shieldDefense.shieldOpponentName || "another opponent")})`
        : (shieldDefense.shieldDB ? ` (+${shieldDefense.shieldDB} shield)` : "");
    const arLine = `Attack roll ${ar.rolls.join(" + ")}${ar.rolls.length > 1 ? ` = ${ar.total}` : ""}`
        + ` + OB ${ob}${skill ? "" : " (no skill)"}${obMod ? ` (skill ${skillBonus}, weapon ${obMod >= 0 ? "+" : ""}${obMod})` : ""}${attackerParryAllocation ? ` (-${attackerParryAllocation} parry)` : ""}${attackerMissileParryAllocation ? ` (-${attackerMissileParryAllocation} missile parry)` : ""}${swingBonus ? ` (+${swingBonus} next swing)` : ""}${actionPenalty ? ` (${actionPenalty} all actions)` : ""}${rangeMod ? ` (${rangeMod >= 0 ? "+" : ""}${rangeMod} range)` : ""}${reloadPenalty ? ` (-${reloadPenalty} reloading)` : ""}${calledShot ? ` (${calledShotMod} called: ${esc(calledShot.areaName)})` : ""}${closingOnTarget ? ` (+30 close quarters)` : ""}${cqcLengthPenalty ? ` (-${cqcLengthPenalty} close quarters: weapon too long)` : ""}`
        + ` − DB ${db}${shieldNote}${effectiveParryDB ? ` (+${effectiveParryDB} parry)` : ""}${parryHeldNote}${cqcParryNote}${cqcQuLoss ? ` (-${cqcQuLoss} Qu DB — close quarters)` : ""}${missileParryDB ? ` (+${missileParryDB} missile parry)` : ""}${targetUnconscious ? " (unconscious — no DB)" : ""} = <strong>${ar.total + ob - db}</strong>`
        + (lookup.capped ? ` → treated as ${lookup.cap}${lookup.attackSize && SIZE_LABEL[lookup.attackSize] ? ` (${SIZE_LABEL[lookup.attackSize]} attack max)` : ""}` : "");

    if (lookup.error && lookup.miss) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `
                <h2>${esc(actor.name)} attacks ${esc(targetName)} with ${esc(weaponItem.name)}</h2>
                <p>${arLine}</p>
                <p><strong>Miss</strong> — ${esc(lookup.error)}</p>${ammoNote}`
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
    // Resolve one critical strike: roll d100 on the mapped table, accumulate
    // bonus hits and conditions. Returns the chat fragment.
    async function resolveOneCrit(type, severity) {
        const cr = await d100();
        const critResult = lookupCrit(tables.crits, type, severity, cr);
        if (critResult.error) return `<strong>${esc(lookup.critCode)}</strong> — ${esc(critResult.error)} (GM adjudicates)`;
        critBonus += critBonusHits(critResult.text);
        critFired = true;
        // ---- Critical conditions (stun pool, bleed, death timer, next swing, must parry) ----
        condNote += await applyCritConditions(targetActor, actor, critResult.text);
        return `<strong>${esc(lookup.critCode)}</strong> → d100 ${cr} on the ${esc(critResult.table)} (${severity}): ${esc(critResult.text)}`;
    }
    if (crit && !crit.unparseable) {
        if (crit.severity === "F") {
            // Claw Law F-severity (AL&CL 11.1): two critical strikes, rolled
            // separately and applied cumulatively, per the attack table's rule.
            const rule = lookup.fSeverityRule;
            if (Array.isArray(rule) && rule.length) {
                const parts = [];
                for (const r of rule) parts.push(await resolveOneCrit(r.type, r.severity));
                critLine = parts.join("<br>");
            } else {
                critLine = `<strong>${esc(crit.raw)}</strong> — F-severity: no table rule transcribed, GM adjudicates.`;
            }
        } else {
            // Single-letter codes carry severity only; the type is indicated
            // on the attack table itself (AL&CL 11.1).
            const type = crit.type ?? lookup.impliedCritType ?? null;
            critLine = type
                ? await resolveOneCrit(type, crit.severity)
                : `<strong>${esc(crit.raw)}</strong> — unusual result, GM adjudicates.`;
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
            ${appliedNote}${condNote}${procNote}${ammoNote}`
    });
}
