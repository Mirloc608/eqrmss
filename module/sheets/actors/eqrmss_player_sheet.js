// ============================================================
// EQRMSS Player Actor Sheet - Full Class & Context Implementation
// ============================================================

import EQRMSSActorSheet from "./eqrmss_actor_sheet.js";
import { progressionManager } from "../../progression/progression-manager.js";

// Skill Engine Imports
import {
    getSkillRegistry,
    resolveActorSkillProfile,
    resolveActorSkillCost,
    getSkillCheckEngine,
    getSkillAdvancementEngine
} from "../../utils/skills/index.js";

export default class EQRMSSPlayerSheet extends EQRMSSActorSheet {

    // ------------------------------------------------------------
    // Default Options
    // ------------------------------------------------------------
    static DEFAULT_OPTIONS = {
        classes: ["eqrmss", "sheet", "actor", "player"],
        position: {
            width: 1000,
            height: 850
        },
        window: {
            title: "EQRMSS Character Sheet"
        },
        actions: {
            levelUp: EQRMSSPlayerSheet.prototype.levelUp,
            rollResistance: EQRMSSPlayerSheet.prototype.rollResistance,
            rollStat: EQRMSSPlayerSheet.prototype.rollStat
        }
    };

    // ------------------------------------------------------------
    // Sheet Parts (includes new Skill Engine tab)
    // ------------------------------------------------------------
    static PARTS = {
        header: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-header.html"
        },
        tabs: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-tabs.html"
        },
        main: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-main.html"
        },
        skills: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-skills.html"
        },
        skillsEngine: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-skills-engine.html"
        },
        status: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-status.html"
        },
        equipment: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-equipment.html"
        },
        spells: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-spells.html"
        },
        logs: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-logs.html"
        }
    };

    // ------------------------------------------------------------
    // Context Preparation
    // ------------------------------------------------------------
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document;
        const system = actor.system ?? {};

        // ------------------------------------------------------------
        // Combat Context
        // ------------------------------------------------------------
        const combat = system.combat ?? {
            armorType: "No Armor",
            mmp: 0,
            penalties: { quickness: 0, action: 0, weight: 0, missile: 0 },
            quicknessBonus: 0,
            adrenalDefense: 0,
            shieldBonus: 0,
            otherDB: 0,
            armorDB: 0,
            totalDB: 0,
            magic: ""
        };

        // ------------------------------------------------------------
        // Progression Context
        // ------------------------------------------------------------
        const level = system.attributes?.level?.value ?? 1;
        const profession = system.fixed_info?.profession ?? system.origin?.classId ?? null;

        const progressionData = {
            level,
            profession,
            maxLevel: 60,
            currentRewards: {},
            nextRewards: {}
        };

        if (profession) {
            progressionData.maxLevel = progressionManager.getClassProgression(profession)?.maxLevel ?? 60;
            progressionData.currentRewards = progressionManager.getLevelRewards(profession, level) ?? {};
            progressionData.nextRewards = progressionManager.getLevelRewards(profession, level + 1) ?? {};
        }

        // ------------------------------------------------------------
        // Stat Formatting
        // ------------------------------------------------------------
        const statNameMap = {
            "ST": "Strength (ST)",
            "AG": "Agility (AG)",
            "CO": "Constitution (CO)",
            "ME": "Memory (ME)",
            "RE": "Reasoning (RE)",
            "SD": "Self Discipline (SD)",
            "QU": "Quickness (QU)",
            "EM": "Empathy (EM)",
            "IN": "Intuition (IN)",
            "PR": "Presence (PR)"
        };

        const nameToKeyMap = {
            "Strength": "ST", "Agility": "AG", "Constitution": "CO",
            "Memory": "ME", "Reasoning": "RE", "Self Discipline": "SD",
            "Quickness": "QU", "Empathy": "EM", "Intuition": "IN", "Presence": "PR"
        };

        const classData = progressionManager.getClassProgression?.(profession) || {};
        let primeReqs = (classData.primeRequisites || classData.stats?.primeRequisites || classData.primeStats || [])
            .map(name => nameToKeyMap[name] || name);

        if (primeReqs.length === 0 && profession) {
            const lowerProf = profession.toLowerCase();
            if (lowerProf.includes("shadowknight")) primeReqs = ["ST", "CO"];
            else if (lowerProf.includes("bard")) primeReqs = ["ME", "PR"];
        }

        const rawStats = system.stats || {};
        const formattedStats = {};

        for (const [key, statData] of Object.entries(rawStats)) {
            if (key === "stats") continue;

            const data = (typeof statData === "object" && statData !== null) ? statData : {};
            const tempVal = data.temp ?? 0;

            let isDeficient = primeReqs.includes(key) && tempVal < 90;

            formattedStats[key] = {
                label: statNameMap[key] || key,
                temp: tempVal,
                pot: data.potential ?? data.pot ?? 0,
                basicBonus: data.basic_bonus ?? data.basicBonus ?? 0,
                racial: data.racial_bonus ?? data.racial ?? 0,
                special: data.special_bonus ?? data.special ?? 0,
                total: data.total ?? 0,
                isDeficient
            };
        }

        // ------------------------------------------------------------
        // Legacy RMSS Skill Preparation
        // ------------------------------------------------------------
        if (typeof actor._prepareSkills === "function") {
            actor._prepareSkills();
        }

        // ------------------------------------------------------------
        // Derived Context
        // ------------------------------------------------------------
        const derived = {
            stats: formattedStats,
            skills: actor.system?.derived?.skills || system.skills || {},
            categories: system.categories || [],
            initiative: system.attributes?.initiative?.value || 0,
            proficiency: system.attributes?.proficiency?.value || 0,
            resistance: system.resistance || {},
            wealth: system.wealth || {}
        };

        // ------------------------------------------------------------
        // Skill Engine View Models
        // ------------------------------------------------------------
        const registry = getSkillRegistry();
        const skillModels = [];

        for (const [id, skill] of registry.skillsById.entries()) {
            const profile = resolveActorSkillProfile(actor, id);
            const cost = resolveActorSkillCost(actor, id);

            skillModels.push({
                id,
                name: skill.name,
                category: skill.category,
                statShort: skill.primary_stat_short ?? skill.primary_stat ?? "St",
                ranks: profile.totalRanks,
                costPerRank: cost,
                totalBonus: profile.totalBonus
            });
        }

        // Attach Skill Engine data
        context.skillsEngine = skillModels;

        return {
            ...context,
            actor,
            system: {
                ...system,
                combat
            },
            derived,
            playerskill: actor.system?.derived?.skills || system.skills || {},
            progression: {
                ...(context.progression ?? {}),
                ...progressionData
            }
        };
    }

    // ------------------------------------------------------------
    // Render + Tab Activation
    // ------------------------------------------------------------
    async _onRender(context, options) {
        await super._onRender(context, options);

        const html = this.element;

        const tabButtons = html.querySelectorAll(".sheet-tabs [data-tab], .sheet-tabs .item");
        const tabContents = html.querySelectorAll(".sheet-body > section[data-tab], .sheet-body > div[data-tab], .tab");

        let activeTabName = this._lastActiveTab || "main";

        tabButtons.forEach(btn => {
            btn.classList.toggle("active", btn.dataset.tab === activeTabName);
        });

        tabContents.forEach(content => {
            const isMatch = content.dataset.tab === activeTabName;
            content.classList.toggle("active", isMatch);
            content.style.display = isMatch ? "grid" : "none";
        });

        tabButtons.forEach(btn => {
            if (btn.dataset.tabBound) return;
            btn.dataset.tabBound = "true";

            btn.addEventListener("click", event => {
                event.preventDefault();
                const targetTab = btn.dataset.tab;
                if (!targetTab) return;

                this._lastActiveTab = targetTab;

                tabButtons.forEach(b => {
                    b.classList.toggle("active", b.dataset.tab === targetTab);
                });

                tabContents.forEach(c => {
                    const isMatch = c.dataset.tab === targetTab;
                    c.classList.toggle("active", isMatch);
                    c.style.display = isMatch ? "grid" : "none";
                });
            });
        });

        // ------------------------------------------------------------
        // Skill Engine Event Binding
        // ------------------------------------------------------------
        html.find(".skill-roll").click(ev => {
            const skillId = ev.currentTarget.dataset.skillId;
            this._onSkillRoll(skillId);
        });

        html.find(".skill-advance").click(ev => {
            const skillId = ev.currentTarget.dataset.skillId;
            this._onSkillAdvance(skillId);
        });
    }

    // ------------------------------------------------------------
    // Legacy RMSS Skill Tab Activation
    // ------------------------------------------------------------
    _forceSkillsTabActive() {
        setTimeout(() => {
            const html = this.element;
            if (!html) return;
            
            const tabButtons = html.querySelectorAll(".sheet-tabs [data-tab], .sheet-tabs .item");
            tabButtons.forEach(btn => {
                btn.classList.toggle("active", btn.dataset.tab === "skills");
            });

            const tabContents = html.querySelectorAll(".sheet-body > section[data-tab], .sheet-body > div[data-tab], .tab");
            tabContents.forEach(content => {
                const isSkills = content.dataset.tab === "skills";
                content.classList.toggle("active", isSkills);
                content.style.display = isSkills ? "grid" : "none";
            });
        }, 20);
    }

    // ------------------------------------------------------------
    // Level Up
    // ------------------------------------------------------------
    async levelUp() {
        const actor = this.document;
        if (!actor) return;

        const currentLevel = actor.system?.attributes?.level?.value ?? 1;
        const nextLevel = currentLevel + 1;

        if (nextLevel > 60) {
            ui.notifications.warn("EQRMSS | Maximum level reached");
            return;
        }

        await progressionManager.processLevelUp(actor, nextLevel);
        await actor.update({ "system.attributes.level.value": nextLevel });

        ui.notifications.info(`${actor.name} advanced to level ${nextLevel}!`);
        await this.render();
    }

    // ------------------------------------------------------------
    // Resistance Roll
    // ------------------------------------------------------------
    async rollResistance(event, target) {
        event.preventDefault();

        const resistType = target.dataset.resist;
        const actor = this.document;
        const resistValue = actor.system?.resistance?.[resistType] ?? 0;

        let roll = new Roll(`1d100 + ${resistValue}`);
        await roll.evaluate();

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Resistance Roll (${resistType.toUpperCase()})`
        });
    }

    // ------------------------------------------------------------
    // Stat Roll
    // ------------------------------------------------------------
    async rollStat(event, target) {
        event.preventDefault();

        const statKey = target.dataset.stat;
        const statLabel = target.dataset.label || statKey;
        const actor = this.document;
        const statTotal = actor.system?.stats?.[statKey]?.total ?? 0;

        let roll = new Roll(`1d100 + ${statTotal}`);
        await roll.evaluate();

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Statistic Roll: ${statLabel}`
        });
    }

    // ------------------------------------------------------------
    // Skill Engine: Roll Skill Check
    // ------------------------------------------------------------
    async _onSkillRoll(skillId) {
        const engine = getSkillCheckEngine();

        const difficulty = { target: 75, label: "Standard" };

        const result = await engine.rollSkillCheck(this.actor, skillId, difficulty);

        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: `
                <h2>${result.profile.skill.name}</h2>
                <p><strong>Roll:</strong> ${result.roll.total}</p>
                <p><strong>Total:</strong> ${result.total}</p>
                <p><strong>Success:</strong> ${result.success}</p>
                <p><strong>Degree:</strong> ${result.degree}</p>
            `
        });
    }

    // ------------------------------------------------------------
    // Skill Engine: Buy Ranks
    // ------------------------------------------------------------
    async _onSkillAdvance(skillId) {
        const engine = getSkillAdvancementEngine();

        try {
            const result = engine.buySkillRanks(this.actor, skillId, { ranks: 1 });

            ui.notifications.info(
                `${this.actor.name} gained +1 rank in ${result.skillId}. Remaining DP: ${result.remainingDp}`
            );

            await this.actor.update({ "system.skills": this.actor.system.skills });
        } catch (err) {
            ui.notifications.error(err.message);
        }
    }
}
