// ============================================================
// EQRMSS Character Actor
//
// EverQuest - Rolemaster Standard System
//
// Player character document.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import { EQRMSSActor } from "./eqrmss_actor.js";
import { RMSSDerivedValueEngine, calculateArmorAndDefenses } from "/systems/eqrmss/module/data/stats/rmss-derived-values.js";

export class EQRMSSCharacter extends EQRMSSActor
{

    // ========================================================
    // PREPARATION
    // ========================================================

    prepareDerivedData()
    {
        super.prepareDerivedData();

        this._ensureCharacterData();

        this._prepareExperience();

        this._prepareRace();

        this._prepareClass();

        this._prepareDevelopmentPoints();

        this._prepareProgression();

        this._prepareCombatAndDefenses();
    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureCharacterData()
    {
        this.system.character ??=
        {
            race: null,
            classes: [],
            level: 1,
            experience: 0,
            nextLevelXP: 1000,
            developmentPoints: 0,
            spentDevelopmentPoints: 0,
            trainingPackages: [],
            deity: null,
            languages: [],
            spellLists: [],
            songs: []
        };

        this.system.combat ??=
        {
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
    }

    // ========================================================
    // COMBAT & DEFENSES INTEGRATION
    // ========================================================

    _prepareCombatAndDefenses()
    {
        const stats = {};
        if (this.system.stats) {
            for (const [key, val] of Object.entries(this.system.stats)) {
                stats[key] = val.total ?? val.temp ?? 50;
            }
        }
    
        const shortKeyMap = { ST: "St", AG: "Ag", CO: "Co", ME: "Me", RE: "Re", SD: "SD", EM: "Em", IN: "In", PR: "Pr", QU: "Qu" };
        const engineStatsMap = {};
        for (const [k, v] of Object.entries(stats)) {
            const mappedKey = shortKeyMap[k.toUpperCase()] ?? k;
            engineStatsMap[mappedKey] = v;
        }

        const engine = new RMSSDerivedValueEngine();
        this.system.derived = engine.compute(engineStatsMap);

        const combatMetrics = calculateArmorAndDefenses(this);
    
        this.system.combat.armorType = combatMetrics.armorType;
        this.system.combat.mmp = combatMetrics.mmp;
        this.system.combat.penalties = combatMetrics.penalties;
        this.system.combat.quicknessBonus = combatMetrics.quicknessBonus;
        this.system.combat.adrenalDefense = combatMetrics.adrenalDefense;
        this.system.combat.shieldBonus = combatMetrics.shieldBonus;
        this.system.combat.otherDB = combatMetrics.otherDB;
        this.system.combat.armorDB = combatMetrics.armorDB;
        this.system.combat.totalDB = combatMetrics.totalDB;
        this.system.combat.magic = combatMetrics.magic ?? "";
    }

    // ========================================================
    // EXPERIENCE
    // ========================================================

    _prepareExperience()
    {
        this.system.character.level ??= 1;
        this.system.character.experience ??= 0;
    }

    getLevel() { return this.system.character.level ?? 1; }
    getExperience() { return this.system.character.experience ?? 0; }
    addExperience(amount) { this.system.character.experience += amount; }

    // ========================================================
    // RACE & CLASS STUBS
    // ========================================================

    _prepareRace() { this.system.character.race ??= null; }
    getRace() { return this.system.character.race ?? null; }
    setRace(race) { this.system.character.race = race; }

    _prepareClass() { this.system.character.classes ??= []; }
    getClasses() { return this.system.character.classes ?? []; }
    hasClass(className) { return this.getClasses().includes(className); }
    addClass(className) {
        if (!this.hasClass(className)) {
            this.system.character.classes.push(className);
        }
    }

    // ========================================================
    // DEVELOPMENT POINTS
    // ========================================================

    _prepareDevelopmentPoints()
    {
        this.system.character.developmentPoints ??= 0;
        this.system.character.spentDevelopmentPoints ??= 0;
    }

    getDevelopmentPoints() { return this.system.character.developmentPoints ?? 0; }
    getAvailableDevelopmentPoints() { return this.system.character.developmentPoints - this.system.character.spentDevelopmentPoints; }
    spendDevelopmentPoints(amount) {
        if (amount > this.getAvailableDevelopmentPoints()) return false;
        this.system.character.spentDevelopmentPoints += amount;
        return true;
    }

    calculateLevelDP()
    {
        let points = 0;
        for (const cls of this.getClasses()) {
            const classData = CONFIG.EQRMSS?.data?.classIndex?.[cls];
            if (classData) points += classData.developmentPoints ?? 0;
        }
        return points;
    }

    awardLevelDevelopmentPoints()
    {
        const amount = this.calculateLevelDP();
        this.system.character.developmentPoints += amount;
        return amount;
    }

    getTrainingPackages() { return this.system.character.trainingPackages ?? []; }
    addTrainingPackage(pkg) { this.system.character.trainingPackages.push(pkg); }

    getSpellLists() { return this.system.character.spellLists ?? []; }
    knowsSpell(spell) { return this.getSpellLists().includes(spell); }
    learnSpell(spell) {
        if (!this.knowsSpell(spell)) this.system.character.spellLists.push(spell);
    }

    getSongs() { return this.system.character.songs ?? []; }
    knowsSong(song) { return this.getSongs().includes(song); }
    learnSong(song) {
        if (!this.knowsSong(song)) this.system.character.songs.push(song);
    }

    getDeity() { return this.system.character.deity ?? null; }
    setDeity(deity) { this.system.character.deity = deity; }

    _prepareProgression()
    {
        this.system.progression ??= { lastLevelUp: 0, pendingTraining: false };
    }

    getCharacterSummary()
    {
        return {
            name: this.name,
            race: this.getRace(),
            classes: this.getClasses(),
            level: this.getLevel(),
            experience: this.getExperience(),
            developmentPoints: this.getAvailableDevelopmentPoints()
        };
    }
}