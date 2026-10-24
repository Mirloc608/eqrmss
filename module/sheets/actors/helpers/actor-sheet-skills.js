// ============================================================================
// EQRMSS Actor Sheet — Skills Helper
// ============================================================================
//
// Responsibilities:
// - Bind skill UI interactions
// - Toggle favorite flag
// - Cycle new ranks (0–3)
// - Support category bonus recalculation (optional future expansion)
// - Keep logic out of the main sheet class
//
// ============================================================================

import { rmssRankBonus } from "../../../data/skills/rmss-rank-bonus.js";

// ---------------------------------------------------------------------------
// DP cost of staged ranks. RMSS cost strings are "a/b": the first rank
// staged in a pass costs a, each further rank costs b; a single "a" (or
// "a/*") costs a per rank. Same convention as the creation wizard's
// development passes. Costs come from the skill catalog entry — the
// figure the Skills tab shows in its Cost column.
// ---------------------------------------------------------------------------
function stagedRankStepCost(costStr, stepIndex) {
    const parts = String(costStr ?? "").split("/").map(s => s.trim());
    const first = Number.parseInt(parts[0], 10);
    if (!Number.isFinite(first)) return null;
    if (stepIndex <= 0) return first;
    const rest = parts.length > 1 ? Number.parseInt(parts[1], 10) : NaN;
    return Number.isFinite(rest) ? rest : first;
}

// Signed DP delta for moving staged ranks from -> to: positive = charge,
// negative = refund. The 3->0 cycle wrap refunds every staged step.
function stagedRankCostDelta(costStr, from, to) {
    if (to === from) return 0;
    let total = 0;
    if (to > from) {
        for (let i = from; i < to; i++) {
            const c = stagedRankStepCost(costStr, i);
            if (c === null) return null;
            total += c;
        }
        return total;
    }
    for (let i = to; i < from; i++) {
        const c = stagedRankStepCost(costStr, i);
        if (c === null) return null;
        total += c;
    }
    return -total;
}

function catalogCostFor(skillId) {
    const entry = globalThis.CONFIG?.EQRMSS?.skills?.[skillId];
    return entry?.system?.cost ?? entry?.cost ?? null;
}

export class EQRMSSActorSkillsHelper {

    constructor(sheet) {
        this.sheet  = sheet;
        this.actor  = sheet.actor;
        this.system = sheet.actor.system;
    }

    // =========================================================================
    // ACTIVATE SKILL INTERACTIONS
    // =========================================================================
    activate() {

        const html = this.sheet.element;
        if (!html) return;

        // ------------------------------------------------------------
        // Toggle favorite skill
        // ------------------------------------------------------------
        html.querySelectorAll(".skill-favorite-toggle").forEach(btn => {
            btn.addEventListener("click", ev => {
                const id = ev.currentTarget.dataset.itemId;
                const item = this.actor.items.get(id);
                if (!item) return;

                const newState = !item.system.favorite;
                item.update({ "system.favorite": newState });
            });
        });

        // ------------------------------------------------------------
        // Cycle new ranks (0 → 1 → 2 → 3 → 0)
        // ------------------------------------------------------------
        html.querySelectorAll(".skill-newrank-toggle").forEach(btn => {
            btn.addEventListener("click", async ev => {
                const id = ev.currentTarget.dataset.itemId;
                const item = this.actor.items.get(id);
                if (!item) return;

                const current = Number(item.system.new_rank ?? 0);
                const maxRanks = Number(item.system.max_ranks ?? 0);
                let next = (current + 1) % 4;
                // Enforce rank cap (2026-10-14): racial/class-capped skills cannot exceed max
                if (maxRanks > 0 && next > maxRanks) {
                    ui.notifications.warn(`This skill is capped at ${maxRanks} rank(s).`);
                    return;
                }
                // Tradeskill point pool (2026-10-16): dedicated pool, 5 granted per level.
                // Spending a rank deducts from pool; un-spending refunds. Unspent carries over.
                const TRADESKILL_IDS = new Set(["skill-fletching","skill-jewelcrafting","skill-smithing","skill-tailoring","skill-tinkering","skill-alchemy","skill-poison-making","skill-research"]);
                const skillId = String(item.system.skillId ?? "");
                if (TRADESKILL_IDS.has(skillId) && next !== current) {
                    const pool = Number(this.actor.system?.tradeskillPoints ?? 0);
                    const delta = next - current;
                    // Handle 3->0 wrap (refunds 3)
                    const actualDelta = (current === 3 && next === 0) ? -3 : delta;
                    if (actualDelta > 0 && pool < actualDelta) {
                        ui.notifications.warn(`Not enough tradeskill points (${pool} available).`);
                        return;
                    }
                    await this.actor.update({
                        "system.tradeskillPoints": pool - actualDelta
                    });
                } else if (next !== current) {
                    // Development Points (2026-10-22): staging a rank on a
                    // regular skill charges DP at the catalog cost;
                    // un-staging refunds. Pool is the accumulating
                    // system.character.developmentPoints granted per level.
                    const costStr = catalogCostFor(skillId);
                    const delta = stagedRankCostDelta(costStr, current, next);
                    if (delta === null) {
                        ui.notifications.warn(`No DP cost configured for ${item.name}; cannot buy ranks.`);
                        return;
                    }
                    const pool = Number(this.actor.system?.character?.developmentPoints ?? 0);
                    if (delta > 0 && pool < delta) {
                        ui.notifications.warn(`Not enough development points (need ${delta}, have ${pool}).`);
                        return;
                    }
                    if (delta !== 0) {
                        await this.actor.update({
                            "system.character.developmentPoints": pool - delta
                        });
                    }
                }

                // Ruling B (2026-10-24): purchases commit to system.ranks
                // immediately — new_rank only tracks this level's buys for
                // the 3-per-level cap and cycle-down refunds.
                const rankDelta = (current === 3 && next === 0) ? -3 : next - current;
                const newRanks = Math.max(0, Number(item.system.ranks ?? 0) + rankDelta);
                const newRankBonus = rmssRankBonus(newRanks);
                await item.update({
                    "system.new_rank": next,
                    "system.ranks": newRanks,
                    // Keep the wizard-stamped bonus block in sync with ranks.
                    "system.rankBonus": newRankBonus,
                    "system.bonus": newRankBonus
                        + Number(item.system.statBonus ?? 0)
                        + Number(item.system.profBonus ?? 0)
                        + Number(item.system.specialBonus ?? 0)
                });
            });
        });

        // ------------------------------------------------------------
        // Tradeskill specialization (2026-10-16, EQ canon)
        // One general tradeskill may be specialized to raise cap 200 -> 300
        // ------------------------------------------------------------
        html.querySelectorAll(".skill-specialize").forEach(btn => {
            btn.addEventListener("click", async ev => {
                const skillId = ev.currentTarget.dataset.skillId;
                const skillName = ev.currentTarget.dataset.skillName ?? skillId;
                if (!skillId) return;
                const current = String(this.actor.system?.tradeskillSpecialization ?? "");
                if (current && current !== skillId) {
                    const confirmed = await Dialog.confirm({
                        title: "Change Specialization",
                        content: `<p>Replace your current tradeskill specialization with <strong>${skillName}</strong>?</p><p>Only one tradeskill may be specialized.</p>`
                    });
                    if (!confirmed) return;
                }
                await this.actor.update({ "system.tradeskillSpecialization": skillId });
                ui.notifications.info(`Specialized in ${skillName} (cap 300).`);
            });
        });

        html.querySelectorAll(".skill-unspecialize").forEach(btn => {
            btn.addEventListener("click", async ev => {
                await this.actor.update({ "system.tradeskillSpecialization": "" });
                ui.notifications.info("Tradeskill specialization removed.");
            });
        });

        // ------------------------------------------------------------
        // Edit skill
        // ------------------------------------------------------------
        html.querySelectorAll(".skill-edit").forEach(btn => {
            btn.addEventListener("click", ev => {
                const id = ev.currentTarget.dataset.itemId;
                const item = this.actor.items.get(id);
                if (item) item.sheet.render(true);
            });
        });

        // ------------------------------------------------------------
        // Develop skill (2026-10-11): create skill Item from catalog
        // ------------------------------------------------------------
        html.querySelectorAll(".skill-develop").forEach(btn => {
            btn.addEventListener("click", async ev => {
                const skillId = ev.currentTarget.dataset.skillId;
                const skillName = ev.currentTarget.dataset.skillName;
                // Capture dataset values NOW: ev.currentTarget is only valid
                // during event dispatch — after the awaits below it is null,
                // and reading .dataset then throws (this killed skill creation
                // after the DP charge had already been applied).
                const maxRanks = ev.currentTarget.dataset.maxRanks ? Number(ev.currentTarget.dataset.maxRanks) : null;
                if (!skillId) return;
                
                // Get skill data from catalog
                const catalogSkill = globalThis.CONFIG?.EQRMSS?.skills?.[skillId];
                if (!catalogSkill) {
                    ui.notifications.warn(`Skill data not found: ${skillName}`);
                    return;
                }
                
                // Tradeskill point pool (2026-10-16): developing a tradeskill costs
                // 1 point from the dedicated pool.
                const TRADESKILL_IDS_DEV = new Set(["skill-fletching","skill-jewelcrafting","skill-smithing","skill-tailoring","skill-tinkering","skill-alchemy","skill-poison-making","skill-research"]);
                if (TRADESKILL_IDS_DEV.has(String(skillId ?? ""))) {
                    const pool = Number(this.actor.system?.tradeskillPoints ?? 0);
                    if (pool < 1) {
                        ui.notifications.warn(`Not enough tradeskill points (${pool} available).`);
                        return;
                    }
                    await this.actor.update({ "system.tradeskillPoints": pool - 1 });
                } else {
                    // Development Points (2026-10-22): developing a regular
                    // skill stages its first rank (new_rank: 1 below), so it
                    // charges the first-rank DP cost — mirroring the
                    // tradeskill pool charge above and the rank toggle.
                    const firstCost = stagedRankStepCost(catalogSkill?.system?.cost ?? catalogSkill?.cost, 0);
                    if (firstCost === null) {
                        ui.notifications.warn(`No DP cost configured for ${skillName}; cannot develop.`);
                        return;
                    }
                    const pool = Number(this.actor.system?.character?.developmentPoints ?? 0);
                    if (pool < firstCost) {
                        ui.notifications.warn(`Not enough development points (need ${firstCost}, have ${pool}).`);
                        return;
                    }
                    await this.actor.update({ "system.character.developmentPoints": pool - firstCost });
                }
                
                // Create skill Item on actor (maxRanks captured at handler top —
                // ev.currentTarget is null by the time the awaits above return)
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: catalogSkill.name,
                    type: "skill",
                    system: {
                        skillId: catalogSkill.id,
                        category: catalogSkill.system?.category ?? catalogSkill.category ?? "",
                        description: catalogSkill.system?.description ?? catalogSkill.description ?? "",
                        // Ruling B (2026-10-24): the first rank commits to
                        // system.ranks immediately; new_rank counts this
                        // level's buys for the cap/refund bookkeeping.
                        ranks: 1,
                        new_rank: 1,
                        // Bonus block in the wizard's shape, so the skill
                        // rolls correctly from the moment it is developed.
                        rankBonus: rmssRankBonus(1),
                        statBonus: 0,
                        profBonus: 0,
                        specialBonus: 0,
                        bonus: rmssRankBonus(1),
                        ...(maxRanks ? { max_ranks: maxRanks } : {})
                    }
                }]);
            });
        });

        // ------------------------------------------------------------
        // Delete skill
        // ------------------------------------------------------------
        html.querySelectorAll(".skill-delete").forEach(btn => {
            btn.addEventListener("click", ev => {
                const id = ev.currentTarget.dataset.itemId;
                if (id) this.actor.deleteEmbeddedDocuments("Item", [id]);
            });
        });
    }

    // =========================================================================
    // BUILD SKILL CONTEXT (optional future expansion)
    // =========================================================================
    buildSkillsContext() {

        const items = this.actor.items.contents;

        const skills = items.filter(i => i.type === "skill");
        const categories = items.filter(i => i.type === "skillcategory");

        return {
            skills,
            categories,
            favorites: skills.filter(s => s.system.favorite)
        };
    }

    // =========================================================================
    // RECALCULATE SKILL TOTAL (optional future expansion)
    // =========================================================================
    recalcSkill(skillItem, categoryItem) {

        const ranks   = Number(skillItem.system.ranks ?? 0);
        // Table 15.2.2: bonus is a function of total ranks. Since ruling B
        // (2026-10-24) purchases commit to ranks immediately, so ranks
        // already includes this level's buys — new_rank is only a counter
        // and must NOT be added again here.
        const rankBonus = rmssRankBonus(ranks);

        const catBonus = Number(categoryItem?.system?.category_bonus ?? 0);
        const itemBonus = Number(skillItem.system.item_bonus ?? 0);
        const specialBonus = Number(skillItem.system.special_bonus ?? 0);

        const total = rankBonus + catBonus + itemBonus + specialBonus;

        return total;
    }
}
