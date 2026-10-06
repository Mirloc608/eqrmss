// ============================================================
// Arms Companion §4.15.3 STRATEGIC TARGETING (called shots).
//
// The Strategic Targeting skill carries a -20 basic modifier
// that is never removed by skill ranks. Each body area has its
// own modifier from the STRATEGIC TARGETING CHART (by the
// target's body type); the attacker's skill bonus may only
// offset the area modifier, never turn it positive. Defensive
// bonuses specific to the area (a helmet's Head DF, a gorget's
// neck DF) add to the defense against that area.
//
// Damage by Location (§4.15.1 structural ratings) and random
// hit location (§4.15.2) are not modeled here.
// ============================================================

import { isWorn } from "../utils/equipment/equipment-utils.js";
import { apacStageOfAT } from "../data/stats/rmss-derived-values.js";

export const CALLED_SHOT_AREAS = [
    { id: "head", name: "Head" },
    { id: "neck", name: "Neck" },
    { id: "torso", name: "Torso" },
    { id: "abdomen", name: "Abdomen" },
    { id: "upperArm", name: "Upper Arm" },
    { id: "elbow", name: "Elbow" },
    { id: "lowerArm", name: "Lower Arm" },
    { id: "hand", name: "Hand" },
    { id: "upperLeg", name: "Upper Leg" },
    { id: "knee", name: "Knee" },
    { id: "lowerLeg", name: "Lower Leg" },
    { id: "foot", name: "Foot" },
    { id: "groin", name: "Groin" }
];

const CHART_ROWS = {
    Human: [-75, -100, -20, -30, -40, -120, -60, -120, -30, -90, -40, -80, -100],
    Elf: [-75, -90, -20, -20, -50, -150, -70, -150, -35, -110, -50, -100, -110],
    Dwarf: [-70, -150, -20, -40, -35, -110, -50, -110, -35, -95, -45, -80, -120],
    Halfling: [-70, -120, -30, -40, -45, -130, -65, -130, -40, -100, -50, -90, -125],
    Orc: [-65, -90, -20, -20, -45, -125, -65, -125, -35, -95, -40, -85, -90],
    Troll: [-50, -75, -15, -15, -30, -100, -45, -100, -20, -75, -25, -65, -75]
};

export const CALLED_SHOT_CHART = Object.fromEntries(
    Object.entries(CHART_ROWS).map(([col, mods]) => [
        col,
        Object.fromEntries(CALLED_SHOT_AREAS.map((a, i) => [a.id, mods[i]]))
    ])
);

// Recommended area modifiers for non-humanoid creatures (§4.15.3).
export const NONHUMANOID_AREAS = [
    { id: "pseudopods", name: "Pseudopods", mod: -150 },
    { id: "eyeStalks", name: "Eye Stalks", mod: -90 },
    { id: "quadrupedalLegs", name: "Quadrupedal Legs", mod: -80 },
    { id: "fins", name: "Fins", mod: -60 },
    { id: "tentacles", name: "Tentacles", mod: -50 },
    { id: "wings", name: "Wings", mod: -80 },
    { id: "antennae", name: "Antennae", mod: -110 },
    { id: "snout", name: "Snout", mod: -90 },
    { id: "ear", name: "Ear", mod: -100 },
    { id: "tail", name: "Tail", mod: -70 }
];

function raceIdOf(actor) {
    const s = actor?.system ?? {};
    return s.fixed_info?.race ?? s.details?.race ?? s.details?.raceId ?? actor?.flags?.eqrmss?.raceId ?? "";
}

function creatureTypeOf(actor) {
    const s = actor?.system ?? {};
    return s.details?.creatureType ?? actor?.flags?.eqrmss?.creatureType ?? null;
}

/** Chart column for a defender ("Human", "Elf", ..., or "nonhumanoid"). */
export function calledShotColumn(targetActor) {
    const creatureType = creatureTypeOf(targetActor);
    if (creatureType && creatureType !== "sentient") return "nonhumanoid";
    const race = String(raceIdOf(targetActor) ?? "").toLowerCase();
    if (race.includes("elf")) return "Elf";
    if (race.includes("dwarf")) return "Dwarf";
    if (race.includes("halfling") || race.includes("gnome")) return "Halfling";
    if (race.includes("ogre") || race.includes("troll")) return "Troll";
    if (race.includes("orc")) return "Orc";
    return "Human";
}

/** Areas offered against a defender: [{ id, name, mod }]. */
export function calledShotAreas(targetActor) {
    const column = calledShotColumn(targetActor);
    if (column === "nonhumanoid") return NONHUMANOID_AREAS;
    return CALLED_SHOT_AREAS.map(a => ({ ...a, mod: CALLED_SHOT_CHART[column][a.id] }));
}

/**
 * Defensive bonus specific to a body area, from worn head gear:
 * Head DF protects the head, neck-marked DF (gorget, aventail)
 * protects the neck. As with Body DF, the bonus applies at full
 * value only when the piece's armor type differs from the worn
 * AT's type; flagged pieces apply half even when types match.
 */
export function areaDBFor(targetActor, areaId) {
    if (!targetActor || (areaId !== "head" && areaId !== "neck")) return 0;
    const items = [...(targetActor.items?.contents ?? targetActor.items ?? [])];
    const atText = String(targetActor.system?.combat?.armorType ?? "");
    const atNum = Number((/(\d+)/.exec(atText) ?? [])[1]) || 0;
    const baseStage = apacStageOfAT(atNum || null);
    let total = 0;
    for (const piece of items) {
        if (piece?.type !== "armor" || !isWorn(piece)) continue;
        if (piece.system?.armorLocation !== "head") continue;
        const neckOnly = piece.system?.dfNeckOnly === true;
        if (areaId === "neck" && !neckOnly) continue;
        if (areaId === "head" && neckOnly) continue;
        const df = Number(piece.system?.dfHead) || 0;
        if (!df) continue;
        const pieceStage = apacStageOfAT(piece.system?.at);
        if (pieceStage !== baseStage) total += df;
        else if (piece.system?.dfHalfSameType === true) total += Math.floor(df / 2);
    }
    return total;
}

/** The attacker's Strategic Targeting skill bonus, or null without the skill. */
export function strategicTargetingSkill(actor) {
    const items = [...(actor?.items?.contents ?? actor?.items ?? [])];
    const skill = items.find(i => i?.type === "skill" && i.system?.slug === "strategicTargeting");
    if (!skill) return null;
    return Number(skill.system?.bonus) || 0;
}

/**
 * §4.15.3 modifier for a called shot: the -20 basic modifier is
 * never removed; the skill bonus only offsets the area modifier
 * (and cannot make it positive); the area's own DB defends it.
 */
export function calledShotModifier(areaMod, skillBonus, areaDB) {
    return -20 + Math.min(0, (Number(areaMod) || 0) + (Number(skillBonus) || 0)) - (Number(areaDB) || 0);
}

/**
 * Ask the attacker for a called-shot area. Resolves to
 * { areaId, areaName, modifier } for a called shot, {} for no
 * called shot, or null when cancelled. Without DialogV2 the
 * attack proceeds with no called shot.
 */
export async function promptCalledShot(attacker, targetActor, targetName, skillBonus) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.prompt) return {};
    const areas = calledShotAreas(targetActor);
    const options = areas.map(a => {
        const areaDB = areaDBFor(targetActor, a.id);
        const mod = calledShotModifier(a.mod, skillBonus, areaDB);
        return `<option value="${a.id}">${a.name} (${mod})</option>`;
    }).join("");
    try {
        const fd = await DialogV2.prompt({
            window: { title: `Strategic Targeting vs ${targetName}` },
            content: `
                <div class="form-group">
                    <label>Called shot (§4.15.3; skill ${skillBonus >= 0 ? "+" : ""}${skillBonus} offsets the area modifier only)</label>
                    <select name="area">
                        <option value="">No called shot</option>
                        ${options}
                    </select>
                </div>`,
            ok: { label: "Attack" }
        });
        if (!fd) {
            console.log("EQRMSS DEBUG | promptCalledShot: fd is null/undefined, returning null");
            return null;
        }
        const val = typeof fd.get === "function" ? fd.get("area") : fd.area;
        console.log("EQRMSS DEBUG | promptCalledShot: val =", JSON.stringify(val), "fd type:", typeof fd, "has get:", typeof fd?.get);
        if (!val) {
            console.log("EQRMSS DEBUG | promptCalledShot: empty val, returning {}");
            return {};
        }
        const area = areas.find(a => a.id === val);
        console.log("EQRMSS DEBUG | promptCalledShot: area found =", JSON.stringify(area?.id), "areas count:", areas.length);
        if (!area) {
            console.log("EQRMSS DEBUG | promptCalledShot: area not found for val", JSON.stringify(val));
            return {};
        }
        return {
            areaId: area.id,
            areaName: area.name,
            modifier: calledShotModifier(area.mod, skillBonus, areaDBFor(targetActor, area.id))
        };
    } catch (e) {
        console.error("EQRMSS | Called-shot prompt failed", e);
        return null;
    }
}
