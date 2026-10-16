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
            btn.addEventListener("click", ev => {
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
                // Tradeskill points-per-level (2026-10-16, EQ canon): limit tradeskill
                // ranks purchased per character level to 5 (matches EQ alchemy rule).
                const TRADESKILL_IDS = new Set(["skill-baking","skill-brewing","skill-fletching","skill-jewelcrafting","skill-pottery","skill-smithing","skill-tailoring","skill-tinkering","skill-alchemy","skill-poison-making","skill-research"]);
                const skillId = String(item.system.skillId ?? "");
                if (TRADESKILL_IDS.has(skillId) && next > current) {
                    const level = Number(this.actor.system?.attributes?.level?.value ?? 1);
                    const spentLevel = Number(this.actor.system?.tradeskillPointsLevel ?? 0);
                    let spent = Number(this.actor.system?.tradeskillPointsSpent ?? 0);
                    if (spentLevel !== level) spent = 0;
                    const MAX_TRADESKILL_PER_LEVEL = 5;
                    // Count current new_rank across all tradeskills (excluding this item's old value)
                    let totalNew = 0;
                    for (const s of this.actor.items.contents) {
                        if (s.type !== "skill") continue;
                        if (!TRADESKILL_IDS.has(String(s.system?.skillId ?? ""))) continue;
                        if (s.id === id) continue;
                        totalNew += Number(s.system?.new_rank ?? 0);
                    }
                    if (totalNew + next > MAX_TRADESKILL_PER_LEVEL) {
                        ui.notifications.warn(`Tradeskill ranks limited to ${MAX_TRADESKILL_PER_LEVEL} per level.`);
                        return;
                    }
                    // Update spent counter
                    this.actor.update({
                        "system.tradeskillPointsSpent": totalNew + next,
                        "system.tradeskillPointsLevel": level
                    });
                }

                item.update({ "system.new_rank": next });
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
