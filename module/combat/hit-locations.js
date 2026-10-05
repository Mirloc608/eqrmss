// ============================================================
// Arms Companion §4.15 DAMAGE BY LOCATION (4.15.1) and RANDOM
// BODY HIT LOCATION (4.15.2), with the Strategic Targeting
// Critical Strike Table (12.2.1).
//
// Each body area has a Structural Rating: SR = (CO / 10) x BAM.
// Structural damage comes only from criticals, rolled on the
// Strategic Targeting Critical Strike Table at the crit's
// severity. SR does not replace concussion hits; hits resolve
// normally. An area whose structural damage reaches its SR is
// inactive (GM adjudicates the exact consequence).
//
// Modes (user ruling 2026-10-04, book-literal):
// - Random-location mode (attacker declares
//   system.status.useHitLocations): the hit location is rolled
//   BEFORE the strike, and criticals resolve on the Strategic
//   Targeting table INSTEAD of the directional crit tables.
// - Called shots (4.15.3): the location is the called area, and
//   the Strategic Targeting roll is ADDITIVE — the directional
//   crit resolves normally and the structural roll is added.
//
// Area tables: humanoid BAMs are book (20 locations, sides
// separate). The groin uses book Option 1 (Abdomen BAM 11,
// Groin BAM 1) because the 4.15.3 chart lists the Groin.
// Creature locations map onto the nearest anatomical BAM
// (house mapping, flagged in the table comments below).
// ============================================================

import { calledShotColumn } from "./strategic-targeting.js";

// key, display name, BAM (humanoid, book p.30; groin = book Option 1)
export const HUMANOID_AREAS = [
    { key: "head", name: "Head", bam: 4 },
    { key: "neck", name: "Neck", bam: 1 },
    { key: "torso", name: "Torso", bam: 15 },
    { key: "abdomen", name: "Abdomen", bam: 11 },
    { key: "groin", name: "Groin", bam: 1 },
    { key: "upperArmR", name: "Upper right arm", bam: 6 },
    { key: "upperArmL", name: "Upper left arm", bam: 6 },
    { key: "elbowR", name: "Right elbow", bam: 2 },
    { key: "elbowL", name: "Left elbow", bam: 2 },
    { key: "lowerArmR", name: "Lower right arm", bam: 4 },
    { key: "lowerArmL", name: "Lower left arm", bam: 4 },
    { key: "handR", name: "Right hand", bam: 2 },
    { key: "handL", name: "Left hand", bam: 2 },
    { key: "upperLegR", name: "Upper right leg", bam: 8 },
    { key: "upperLegL", name: "Upper left leg", bam: 8 },
    { key: "kneeR", name: "Right knee", bam: 2 },
    { key: "kneeL", name: "Left knee", bam: 2 },
    { key: "lowerLegR", name: "Lower right leg", bam: 5 },
    { key: "lowerLegL", name: "Lower left leg", bam: 5 },
    { key: "footR", name: "Right foot", bam: 2 },
    { key: "footL", name: "Left foot", bam: 2 }
];

// Creature areas (book chart names; BAM mapped to nearest anatomy:
// appendage = arm 6/4, legs = leg 8/5/2, tail = abdomen 12,
// beak/snout = head 4). Parenthetical numbers are the book's
// tentacle indices.
export const CREATURE_AREAS = [
    { key: "head", name: "Head", bam: 4 },
    { key: "neck", name: "Neck", bam: 1 },
    { key: "torso", name: "Torso", bam: 15 },
    { key: "abdomen", name: "Abdomen", bam: 12 },
    { key: "tail", name: "Tail", bam: 12 },
    { key: "appendageFR", name: "Front right appendage", bam: 6 },
    { key: "appendageFL", name: "Front left appendage", bam: 6 },
    { key: "appendageRR", name: "Rear right appendage", bam: 4 },
    { key: "appendageRL", name: "Rear left appendage", bam: 4 },
    { key: "upperLegFR", name: "Front right upper leg (1)", bam: 8 },
    { key: "upperLegFL", name: "Front left upper leg (2)", bam: 8 },
    { key: "upperLegRR", name: "Rear right upper leg (7)", bam: 8 },
    { key: "upperLegRL", name: "Rear left upper leg (8)", bam: 8 },
    { key: "lowerLegFR", name: "Front right upper leg (5)", bam: 5 },
    { key: "lowerLegFL", name: "Front left upper leg (6)", bam: 5 },
    { key: "lowerLegRR", name: "Rear right lower leg (3)", bam: 5 },
    { key: "lowerLegRL", name: "Rear left lower leg (4)", bam: 5 },
    { key: "kneeFR", name: "Front right knee", bam: 2 },
    { key: "kneeFL", name: "Front left knee", bam: 2 },
    { key: "kneeRR", name: "Rear right knee", bam: 2 },
    { key: "kneeRL", name: "Rear left knee", bam: 2 },
    { key: "beakSnout", name: "Beak/Snout", bam: 4 }
];

// Random Body Hit Location Chart (4.15.2), humanoid column.
const HUMANOID_CHART = [
    [1, 2, "head"], [3, 6, "neck"], [7, 11, "torso"], [12, 16, "abdomen"],
    [17, 19, "handR"], [20, 22, "handL"], [23, 29, "upperLegR"], [30, 36, "upperLegL"],
    [37, 38, "kneeR"], [39, 40, "kneeL"], [41, 45, "torso"], [46, 49, "abdomen"],
    [50, 51, "elbowR"], [52, 53, "elbowL"], [54, 58, "upperArmR"], [59, 63, "upperArmL"],
    [64, 65, "footR"], [66, 67, "footL"], [68, 74, "torso"], [75, 78, "groin"],
    [79, 82, "lowerArmR"], [83, 86, "lowerArmL"], [87, 92, "torso"],
    [93, 95, "lowerLegR"], [96, 98, "lowerLegL"], [99, 100, "head"]
];

// Random Body Hit Location Chart (4.15.2), animal/creature column.
const CREATURE_CHART = [
    [1, 6, "head"], [7, 11, "torso"], [12, 16, "abdomen"],
    [17, 19, "appendageFR"], [20, 22, "appendageFL"],
    [23, 29, "upperLegFR"], [30, 36, "upperLegFL"],
    [37, 38, "appendageRR"], [39, 40, "appendageRL"],
    [41, 45, "torso"], [46, 49, "tail"],
    [50, 51, "lowerLegRR"], [52, 53, "lowerLegRL"],
    [54, 58, "lowerLegFR"], [59, 63, "lowerLegFL"],
    [64, 65, "kneeRR"], [66, 67, "kneeRL"], [68, 74, "torso"],
    [75, 78, "neck"], [79, 82, "upperLegRR"], [83, 86, "upperLegRL"],
    [87, 92, "torso"], [93, 95, "kneeFR"], [96, 98, "kneeFL"],
    [99, 100, "beakSnout"]
];

const SIDED_KEYS = {
    upperArm: ["upperArmR", "upperArmL"], elbow: ["elbowR", "elbowL"],
    lowerArm: ["lowerArmR", "lowerArmL"], hand: ["handR", "handL"],
    upperLeg: ["upperLegR", "upperLegL"], knee: ["kneeR", "kneeL"],
    lowerLeg: ["lowerLegR", "lowerLegL"], foot: ["footR", "footL"]
};

// Called-shot area (non-humanoid list) -> structural BAM. House
// mapping onto nearest anatomy, as with the creature chart.
const NONHUMANOID_BAM = {
    pseudopods: 6, eyeStalks: 4, quadrupedalLegs: 8, fins: 4,
    tentacles: 6, wings: 6, antennae: 4, snout: 4, ear: 4, tail: 12
};

function areaListFor(targetActor) {
    return calledShotColumn(targetActor) === "nonhumanoid" ? CREATURE_AREAS : HUMANOID_AREAS;
}

/** The structural area definition { key, name, bam } for a defender. */
export function structuralAreaDef(targetActor, key) {
    const list = [...HUMANOID_AREAS, ...CREATURE_AREAS];
    const found = list.find(a => a.key === key);
    if (found) return found;
    const bam = NONHUMANOID_BAM[key];
    return bam != null ? { key, name: key, bam } : null;
}

/** Ordered structural areas for sheet display against this actor. */
export function structuralAreasFor(targetActor) {
    return areaListFor(targetActor);
}

/** Roll on the Random Body Hit Location Chart for a defender. */
export function rollHitLocation(targetActor, roll) {
    const chart = calledShotColumn(targetActor) === "nonhumanoid" ? CREATURE_CHART : HUMANOID_CHART;
    const r = Math.max(1, Math.min(100, Math.floor(Number(roll) || 1)));
    const key = chart.find(([lo, hi]) => r >= lo && r <= hi)?.[2] ?? "torso";
    const def = structuralAreaDef(targetActor, key) ?? { key, name: key, bam: 0 };
    return { ...def, roll: r, random: true };
}

/**
 * Structural location for a called shot. Side-less humanoid areas
 * take a side by coin flip (side01 < 0.5 = right).
 */
export function calledShotLocation(calledShot, targetActor, side01 = 0) {
    const areaId = calledShot?.areaId ?? "";
    if (calledShotColumn(targetActor) === "nonhumanoid") {
        return {
            key: areaId,
            name: calledShot?.areaName ?? areaId,
            bam: NONHUMANOID_BAM[areaId] ?? 4,
            random: false
        };
    }
    const sided = SIDED_KEYS[areaId];
    const key = sided ? (side01 < 0.5 ? sided[0] : sided[1]) : areaId;
    const def = structuralAreaDef(targetActor, key);
    return { ...(def ?? { key, name: calledShot?.areaName ?? areaId, bam: 0 }), random: false };
}

/** Constitution stat (0-100) for SR computation, or null when absent. */
export function constitutionFor(actor) {
    const co = actor?.system?.stats?.CO;
    if (co == null) return null;
    if (typeof co === "number") return co;
    const v = Number(co.temp ?? co.value ?? co.current);
    return Number.isFinite(v) && v > 0 ? v : null;
}

/** Structural Rating for an area: (CO / 10) x BAM, rounded. Null without CO. */
export function structuralRating(actor, bam) {
    const co = constitutionFor(actor);
    if (co == null || !(bam > 0)) return null;
    return Math.round((co / 10) * bam);
}

/** Current structural damage recorded on an actor for an area. */
export function structuralDamageOf(actor, key) {
    return Math.max(0, Number(actor?.system?.status?.structural?.[key]) || 0);
}

/**
 * Apply structural points to an area. Returns
 * { key, name, before, total, sr, inactive } (sr null when the
 * actor has no CO stat — GM adjudicates "inactive").
 */
export async function applyStructuralDamage(targetActor, loc, points) {
    if (!targetActor || !loc?.key || !(points > 0)) return null;
    const before = structuralDamageOf(targetActor, loc.key);
    const total = before + points;
    await targetActor.update({ [`system.status.structural.${loc.key}`]: total });
    const sr = structuralRating(targetActor, loc.bam);
    return { key: loc.key, name: loc.name, before, total, sr, inactive: sr != null && total >= sr };
}

/** d100 lookup on the Strategic Targeting Critical Strike Table (code "ST"). */
export function lookupStructuralCrit(critTables, severity, roll) {
    const table = (critTables ?? []).find(t => t.code === "ST");
    if (!table) return { error: "Strategic Targeting critical table not loaded." };
    const crit = (table.criticals ?? []).find(c => c.severity === severity && roll >= c.low && roll <= c.high);
    if (!crit) return { error: `No ${severity} result for ${roll} on the Strategic Targeting table.` };
    return { table: table.name, text: crit.result };
}

/** Structural points stated in an ST critical result ("48 Structural Points, ..."). */
export function structuralPointsOf(text) {
    const m = /(\d+)\s+Structural Points/i.exec(String(text ?? ""));
    return m ? Number(m[1]) : 0;
}
