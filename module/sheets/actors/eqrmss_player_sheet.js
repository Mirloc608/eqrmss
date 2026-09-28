// ============================================================
// EQRMSS Player Actor Sheet - Full Class & Context Implementation
// ============================================================

import EQRMSSActorSheet from "./eqrmss_actor_sheet.js";
import { progressionManager } from "../../progression/progression-manager.js";
import { EQRMSSExpansionManager } from "../../expansions/expansion-manager.js";
import { EQRMSSAAAdvancement } from "../../aa/aa-advancement.js";

export default class EQRMSSPlayerSheet extends EQRMSSActorSheet {

    // ------------------------------------------------------------
    // Default Options
    // ------------------------------------------------------------
    static DEFAULT_OPTIONS = {
        classes: ["eqrmss", "sheet", "actor", "player"],
        position: {
            width: 800,
            height: 850
        },
        window: {
            title: "EQRMSS Character Sheet"
        },
        actions: {
            levelUp: EQRMSSPlayerSheet.prototype.levelUp,
            rollResistance: EQRMSSPlayerSheet.prototype.rollResistance,
            rollStat: EQRMSSPlayerSheet.prototype.rollStat,
            purchaseAA: EQRMSSPlayerSheet.prototype.purchaseAA,
            grantAAPoints: EQRMSSPlayerSheet.prototype.grantAAPoints
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
        status: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-status.html"
        },
        equipment: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-equipment.html"
        },
        spells: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-spells.html"
        },
        aa: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-aa.html"
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

            const storedBonus = data.basic_bonus ?? data.basicBonus ?? 0;
            const basicBonus = storedBonus !== 0 ? storedBonus : Math.floor((tempVal - 50) / 5);
            formattedStats[key] = {
                label: statNameMap[key] || key,
                temp: tempVal,
                pot: data.potential ?? data.pot ?? 0,
                basicBonus,
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
        const getBonus = (k) => {
            // Try exact, uppercase, and title-case keys
            const variants = [k, k.toUpperCase(), k.charAt(0).toUpperCase() + k.slice(1).toLowerCase()];
            for (const v of variants) {
                if (formattedStats[v]?.basicBonus) return formattedStats[v].basicBonus;
            }
            // Fallback: search case-insensitively
            const found = Object.entries(formattedStats).find(([key]) => key.toUpperCase() === k.toUpperCase());
            return found ? found[1].basicBonus ?? 0 : 0;
        };

        const manualRes = system.resistance || {};
        const calcResistance = {
            essence: 3 * getBonus("EM") + (manualRes.essence ?? 0),
            channeling: 3 * getBonus("IN") + (manualRes.channeling ?? 0),
            mentalism: 3 * getBonus("PR") + (manualRes.mentalism ?? 0),
            poison: 3 * getBonus("CO") + (manualRes.poison ?? 0),
            disease: 3 * getBonus("CO") + (manualRes.disease ?? 0)
        };
        const derived = {
            stats: formattedStats,
            skills: actor.system?.derived?.skills || system.skills || {},
            categories: system.categories || [],
            initiative: system.attributes?.initiative?.value || 0,
            proficiency: system.attributes?.proficiency?.value || 0,
            resistance: calcResistance,
            wealth: system.wealth || {}
        };

        // ------------------------------------------------------------
        // Status & Hits Calculations (RMSS formulas)
        // ------------------------------------------------------------
        const coBonus = getBonus("CO");
        const sdBonus = getBonus("SD");
        const quBonus = getBonus("QU");

        // Concussion Hits = 10 + (2 × Co bonus) + SD bonus + prof/skill/special
        const hitsMax = 10 + (2 * coBonus) + sdBonus;

        // Exhaustion Points = 40 + (3 × Co bonus)
        const exhaustionMax = 40 + (3 * coBonus);

        // Base Movement Rate = 50 + (3 × Qu bonus)
        // (Stride modification and weight penalty need height/weight data)
        const baseMoveRate = 50 + (3 * quBonus);

        const statusData = {
            hits: {
                max: hitsMax,
                value: system.hits?.value ?? 0,
                stun: system.hits?.stun ?? 0,
                bleeding: system.hits?.bleeding ?? 0
            },
            exhaustion: {
                max: exhaustionMax,
                value: system.exhaustion?.value ?? exhaustionMax
            },
            encumbrance: {
                bwa: system.encumbrance?.bwa ?? "—",
                moveRate: baseMoveRate
            }
        };

        // ------------------------------------------------------------
        // Skill Engine View Models
        // ------------------------------------------------------------
        const skillModels = [];
        const jsonSkills = CONFIG.EQRMSS?.skills || {};

        for (const [id, s] of Object.entries(jsonSkills)) {
            const sys = s.system || {};
            const actorSkill = system.skills?.[id] || {};
            const ranks = actorSkill.ranks ?? sys.ranks ?? 0;
            const statBonus = sys.statBonus ?? 0;
            const rankBonus = (sys.rankBonus ?? 0) + ranks * 5;
            const totalBonus = rankBonus + statBonus + (sys.profBonus ?? 0) + (sys.specialBonus ?? 0);

            skillModels.push({
                id,
                name: s.name,
                category: sys.category || "",
                statShort: (sys.statsString || "").split("/")[0] || "—",
                ranks,
                costPerRank: sys.cost || "—",
                totalBonus
            });
        }

        skillModels.sort((a, b) => a.name.localeCompare(b.name));

        // ------------------------------------------------------------
        // AA Advancement Context
        // ------------------------------------------------------------
        const aaState = EQRMSSAAAdvancement.getAAState(actor);
        const aaContext = {
            points: aaState.points,
            spent: aaState.spent,
            isGM: game?.user?.isGM ?? false,
            purchased: EQRMSSAAAdvancement.getPurchasedAAs(actor),
            available: []
        };
        try {
            aaContext.available = EQRMSSAAAdvancement.getAvailableAAs(actor);
        } catch (err) {
            console.warn("EQRMSS | AA context build failed", err);
        }

        return {
            ...context,
            actor,
            system: {
                ...system,
                combat,
                hits: statusData.hits,
                exhaustion: statusData.exhaustion,
                encumbrance: statusData.encumbrance
            },
            derived,
            skills: skillModels,

            playerskill: actor.system?.derived?.skills || system.skills || {},
            progression: {
                ...(context.progression ?? {}),
                ...progressionData
            },
            aa: aaContext
        };
    }

    // ------------------------------------------------------------
    // Render + Skill Engine Bindings
    // (Tab switching is handled by EQRMSSActorTabsHelper via super._onRender)
    // ------------------------------------------------------------
    async _onRender(context, options) {
        await super._onRender(context, options);

        const html = this.element;

        // ------------------------------------------------------------
        // Skill Engine Event Binding
        // ------------------------------------------------------------
        html.querySelectorAll(".skill-roll").forEach(el => el.addEventListener("click", ev => {
            const skillId = ev.currentTarget.dataset.skillId;
            this._onSkillRoll(skillId);
        }));

        html.querySelectorAll(".skill-advance").forEach(el => el.addEventListener("click", ev => {
            const skillId = ev.currentTarget.dataset.skillId;
            this._onSkillAdvance(skillId);
        }));
    }

    // ------------------------------------------------------------
    // Level Up
    // ------------------------------------------------------------
    async levelUp() {
        const actor = this.document;
        if (!actor) return;

        const currentLevel = actor.system?.attributes?.level?.value ?? 1;
        const nextLevel = currentLevel + 1;

        const levelCap = EQRMSSExpansionManager.getLevelCap();

        if (nextLevel > levelCap) {
            ui.notifications.warn(
                `EQRMSS | Maximum level reached (${levelCap}, ${EQRMSSExpansionManager.getActiveExpansionName()})`
            );
            return;
        }

        await progressionManager.processLevelUp(actor, nextLevel);
        await actor.update({ "system.attributes.level.value": nextLevel });

        ui.notifications.info(`${actor.name} advanced to level ${nextLevel}!`);
        await this.render();
    }

    // ------------------------------------------------------------
    // AA Advancement
    // ------------------------------------------------------------
    async purchaseAA(event, target) {
        event.preventDefault();
        const actor = this.document;
        if (!actor) return;

        const aaId = target?.dataset?.aaId;
        if (!aaId) return;

        await EQRMSSAAAdvancement.purchaseRank(actor, aaId);
        await this.render();
    }

    async grantAAPoints(event, target) {
        event.preventDefault();
        const actor = this.document;
        if (!actor) return;

        if (!game?.user?.isGM) {
            ui.notifications.warn("EQRMSS | Only the GM can grant AA points.");
            return;
        }

        const input = this.element?.querySelector?.('[name="aaGrantAmount"]');
        const amount = Math.floor(Number(input?.value));

        const result = await EQRMSSAAAdvancement.grantPoints(actor, amount, {
            reason: "GM grant"
        });

        if (!result.ok) {
            ui.notifications.warn(`EQRMSS | ${result.reason}`);
            return;
        }

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
        const skillData = CONFIG.EQRMSS?.skills?.[skillId];
        if (!skillData) {
            ui.notifications.error(`Unknown skill: ${skillId}`);
            return;
        }
        const sys = skillData.system || {};
        const actorSkill = this.actor.system.skills?.[skillId] || {};
        const ranks = actorSkill.ranks ?? sys.ranks ?? 0;
        const totalBonus = ranks * 5 + (sys.statBonus ?? 0) + (sys.profBonus ?? 0) + (sys.specialBonus ?? 0);

        const roll = await new Roll("1d100").evaluate();
        const total = roll.total + totalBonus;
        const target = 75;
        const success = total >= target;

        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: `
                <h2>${skillData.name}</h2>
                <p><strong>Roll:</strong> ${roll.total} + ${totalBonus} = ${total}</p>
                <p><strong>Target:</strong> ${target}</p>
                <p><strong>Success:</strong> ${success ? "Yes" : "No"}</p>
            `
        });
    }


    // ------------------------------------------------------------
    // Skill Engine: Buy Ranks
    // ------------------------------------------------------------
    async _onSkillAdvance(skillId) {
        const skillData = CONFIG.EQRMSS?.skills?.[skillId];
        if (!skillData) {
            ui.notifications.error(`Unknown skill: ${skillId}`);
            return;
        }
        // Parse cost "2/5" -> use first number as DP per rank (simplified)
        const costStr = skillData.system?.cost || "1";
        const costPerRank = parseInt(costStr.split("/")[0]) || 1;

        const currentDp = this.actor.system.developmentPoints ?? this.actor.system.dp ?? 0;
        if (currentDp < costPerRank) {
            ui.notifications.error(`Not enough development points (need ${costPerRank}, have ${currentDp})`);
            return;
        }

        const actorSkills = foundry.utils.duplicate(this.actor.system.skills || {});
        actorSkills[skillId] = actorSkills[skillId] || {};
        actorSkills[skillId].ranks = (actorSkills[skillId].ranks ?? 0) + 1;

        await this.actor.update({
            "system.skills": actorSkills,
            "system.developmentPoints": currentDp - costPerRank
        });

        ui.notifications.info(`${this.actor.name} gained +1 rank in ${skillData.name}. Remaining DP: ${currentDp - costPerRank}`);
    }
}
