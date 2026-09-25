// ============================================================================
// EQRMSS Actor Sheet — Progression Helper
// ============================================================================
//
// Responsibilities:
// - Handle level-up logic
// - Sync actor progression with progression tables
// - Apply rewards (skills, spells, items, stats, etc.)
// - Provide next-level preview
// - Keep logic out of the main sheet class
//
// ============================================================================

export class EQRMSSActorProgressionHelper {

    constructor(sheet) {
        this.sheet  = sheet;
        this.actor  = sheet.actor;
        this.system = sheet.actor.system;
    }

    // =========================================================================
    // LEVEL UP
    // =========================================================================
    async levelUp() {

        const profession = this.system.fixed_info?.profession_name;
        const level      = Number(this.system.level ?? 1);

        if (!profession || !game.eqrmss?.progressionManager) {
            ui.notifications.warn("Progression Manager not available.");
            return;
        }

        const pm = game.eqrmss.progressionManager;

        // ------------------------------------------------------------
        // Get next-level rewards
        // ------------------------------------------------------------
        const rewards = pm.getLevelRewards(profession, level + 1);
        if (!rewards) {
            ui.notifications.warn(`No progression data for level ${level + 1}.`);
            return;
        }

        // ------------------------------------------------------------
        // Apply rewards
        // ------------------------------------------------------------
        await this._applyRewards(rewards);

        // ------------------------------------------------------------
        // Increment level
        // ------------------------------------------------------------
        await this.actor.update({ "system.level": level + 1 });

        ui.notifications.info(`Leveled up to ${level + 1}!`);
    }

    // =========================================================================
    // SYNC PROGRESSION
    // =========================================================================
    async syncProgression() {

        const profession = this.system.fixed_info?.profession_name;
        const level      = Number(this.system.level ?? 1);

        if (!profession || !game.eqrmss?.progressionManager) {
            ui.notifications.warn("Progression Manager not available.");
            return;
        }

        const pm = game.eqrmss.progressionManager;

        const rewards = pm.getLevelRewards(profession, level);
        if (!rewards) {
            ui.notifications.warn(`No progression data for level ${level}.`);
            return;
        }

        await this._applyRewards(rewards);

        ui.notifications.info(`Progression synced for level ${level}.`);
    }

    // =========================================================================
    // APPLY REWARDS
    // =========================================================================
    async _applyRewards(rewards) {

        const createItems = [];
        const updateItems = [];

        // ------------------------------------------------------------
        // Skills
        // ------------------------------------------------------------
        if (rewards.skills) {
            for (const skillData of rewards.skills) {

                const existing = this.actor.items.find(i =>
                    i.type === "skill" &&
                    i.name === skillData.name
                );

                if (existing) {
                    updateItems.push({
                        _id: existing.id,
                        "system.ranks": Number(existing.system.ranks ?? 0) + (skillData.ranks ?? 0)
                    });
                }
                else {
                    createItems.push({
                        name: skillData.name,
                        type: "skill",
                        system: {
                            ranks: skillData.ranks ?? 0,
                            new_rank: 0
                        }
                    });
                }
            }
        }

        // ------------------------------------------------------------
        // Spells
        // ------------------------------------------------------------
        if (rewards.spells) {
            for (const spellData of rewards.spells) {

                const existing = this.actor.items.find(i =>
                    i.type === "spell" &&
                    i.name === spellData.name
                );

                if (!existing) {
                    createItems.push({
                        name: spellData.name,
                        type: "spell",
                        system: {
                            rank: spellData.rank ?? 0,
                            favorite: false,
                            memorized: false
                        }
                    });
                }
            }
        }

        // ------------------------------------------------------------
        // Items
        // ------------------------------------------------------------
        if (rewards.items) {
            for (const itemData of rewards.items) {
                createItems.push(itemData);
            }
        }

        // ------------------------------------------------------------
        // Stats
        // ------------------------------------------------------------
        if (rewards.stats) {
            const statUpdates = {};

            for (const [statKey, delta] of Object.entries(rewards.stats)) {
                const current = Number(this.system.stats?.stats?.[statKey]?.value ?? 0);
                statUpdates[`system.stats.stats.${statKey}.value`] = current + delta;
            }

            await this.actor.update(statUpdates);
        }

        // ------------------------------------------------------------
        // Apply item updates
        // ------------------------------------------------------------
        if (updateItems.length > 0) {
            await this.actor.updateEmbeddedDocuments("Item", updateItems);
        }

        // ------------------------------------------------------------
        // Create new items
        // ------------------------------------------------------------
        if (createItems.length > 0) {
            await this.actor.createEmbeddedDocuments("Item", createItems);
        }
    }

    // =========================================================================
    // NEXT LEVEL PREVIEW
    // =========================================================================
    getNextLevelPreview() {

        const profession = this.system.fixed_info?.profession_name;
        const level      = Number(this.system.level ?? 1);

        if (!profession || !game.eqrmss?.progressionManager) return null;

        const pm = game.eqrmss.progressionManager;

        return pm.getLevelRewards(profession, level + 1) ?? null;
    }
}
