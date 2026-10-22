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
                }

                await item.update({ "system.new_rank": next });
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
                }
                
                // Create skill Item on actor (maxRanks from visibility cap, if any)
                const maxRanks = ev.currentTarget.dataset.maxRanks ? Number(ev.currentTarget.dataset.maxRanks) : null;
                await this.actor.createEmbeddedDocuments("Item", [{
                    name: catalogSkill.name,
                    type: "skill",
                    system: {
                        skillId: catalogSkill.id,
                        category: catalogSkill.system?.category ?? catalogSkill.category ?? "",
                        description: catalogSkill.system?.description ?? catalogSkill.description ?? "",
                        ranks: 0,
                        new_rank: 1,
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
        const newRank = Number(skillItem.system.new_rank ?? 0);
        // Table 15.2.2: bonus is a function of TOTAL ranks (existing + new).
        const rankBonus = rmssRankBonus(ranks + newRank);

        const catBonus = Number(categoryItem?.system?.category_bonus ?? 0);
        const itemBonus = Number(skillItem.system.item_bonus ?? 0);
        const specialBonus = Number(skillItem.system.special_bonus ?? 0);

        const total = rankBonus + catBonus + itemBonus + specialBonus;

        return total;
    }
}
