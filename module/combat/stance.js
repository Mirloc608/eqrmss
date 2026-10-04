// ============================================================
// Arms Companion §4.16 STANCE-BASED effects (stance skills and
// their OB/DB/critical effects). The STANCE INITIATIVE CHART's
// attack-time sequencing is NOT used — initiative remains the
// RMSS §6.1 deterministic total.
//
// A combatant declares one stance (status.stance). The stance
// skills (offensiveStance / movementStance / defensiveStance
// skill items) grant a per-rank bonus whose size depends on
// the profession type: +3/rank for Non-Spell Users, +2 for
// Semi Spell Users, +1 for Pure/Hybrid/Arcane users; beyond
// 20 ranks the rate falls to +1 / +0.5 / +0 per rank.
// ============================================================

// EQ class -> RMSS profession type for stance rank rates.
export const STANCE_CLASS_TYPE = {
    warrior: "non", rogue: "non", monk: "non", berserker: "non",
    paladin: "semi", shadowknight: "semi", ranger: "semi", bard: "semi", beastlord: "semi",
    magician: "pure", wizard: "pure", enchanter: "pure", necromancer: "pure",
    cleric: "pure", druid: "pure", shaman: "pure"
};

export const STANCES = [
    { id: "", name: "No Stance" },
    { id: "offensive", name: "Offensive Stance" },
    { id: "movement", name: "Movement Stance" },
    { id: "defensive", name: "Defensive Stance" }
];

const RATE = { non: 3, semi: 2, pure: 1 };
const RATE_AFTER_20 = { non: 1, semi: 0.5, pure: 0 };

export function stanceClassTypeOf(actor) {
    const system = actor?.system ?? {};
    const classId = String(system.fixed_info?.profession ?? system.details?.classId ?? system.details?.class ?? "").toLowerCase();
    return STANCE_CLASS_TYPE[classId] ?? "semi";
}

export function stanceSkillItem(actor, slug) {
    const items = [...(actor?.items?.contents ?? actor?.items ?? [])];
    return items.find(i => i?.type === "skill" && i.system?.slug === slug) ?? null;
}

export function stanceRanks(actor, stance) {
    const slug = stance === "offensive" ? "offensiveStance"
        : stance === "movement" ? "movementStance"
        : stance === "defensive" ? "defensiveStance"
        : null;
    if (!slug) return 0;
    return Math.max(0, Math.floor(Number(stanceSkillItem(actor, slug)?.system?.ranks) || 0));
}

/** Per-rank stance bonus at the given rank count and profession type. */
export function stanceRankBonus(ranks, classType) {
    const r = Math.max(0, Math.floor(Number(ranks) || 0));
    const under = Math.min(r, 20);
    const over = Math.max(0, r - 20);
    return Math.floor(under * (RATE[classType] ?? 2) + over * (RATE_AFTER_20[classType] ?? 0.5));
}

export function actorStance(actor) {
    const stance = String(actor?.system?.status?.stance ?? "");
    return ["offensive", "movement", "defensive"].includes(stance) ? stance : "";
}

/** OB modifier from the declared stance (+5 base plus rank bonus). */
export function stanceOBBonus(actor) {
    const stance = actorStance(actor);
    if (stance !== "offensive" && stance !== "movement") return 0;
    return 5 + stanceRankBonus(stanceRanks(actor, stance), stanceClassTypeOf(actor));
}

/** DB modifier from Defensive Stance (+10 plus rank bonus; "frontal" — no facing is modeled). */
export function stanceDBBonus(actor) {
    if (actorStance(actor) !== "defensive") return 0;
    return 10 + stanceRankBonus(stanceRanks(actor, "defensive"), stanceClassTypeOf(actor));
}

// Max critical a Defensive Stance attacker may deliver, by ranks
// in Defensive Stance: 0 none, 1-5 A, 6-10 B, 11-15 C, 16-20 D,
// 21-30 E, 31-40 F, 41-50 G, 51-60 H, 61-70 I, 71+ no limit.
const CAP_BANDS = [
    { maxRanks: 0, severity: null },
    { maxRanks: 5, severity: "A" },
    { maxRanks: 10, severity: "B" },
    { maxRanks: 15, severity: "C" },
    { maxRanks: 20, severity: "D" },
    { maxRanks: 30, severity: "E" },
    { maxRanks: 40, severity: "F" },
    { maxRanks: 50, severity: "G" },
    { maxRanks: 60, severity: "H" },
    { maxRanks: 70, severity: "I" }
];

export function defensiveCritCap(ranks) {
    const r = Math.max(0, Math.floor(Number(ranks) || 0));
    for (const band of CAP_BANDS) {
        if (r <= band.maxRanks) return band.severity;
    }
    return "I+";
}

const SEVERITY_ORDER = ["A", "B", "C", "D", "E", "F"];

/**
 * Apply the Defensive Stance crit cap to a rolled severity.
 * Returns the severity to deliver (possibly lowered), or null
 * when no critical may be delivered at all.
 */
export function capCritSeverity(severity, cap) {
    if (cap == null) return null;
    if (cap === "I+") return severity;
    const rolled = SEVERITY_ORDER.indexOf(String(severity ?? "").toUpperCase());
    const allowed = SEVERITY_ORDER.indexOf(cap);
    if (rolled < 0 || allowed < 0) return severity;
    return SEVERITY_ORDER[Math.min(rolled, allowed)];
}
