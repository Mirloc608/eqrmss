// ============================================================
// EQRMSS Base Actor Document
//
// EverQuest - Rolemaster Standard System
//
// Foundry VTT V13 / V14 Compatible
//
// Central actor data pipeline.
//
// ============================================================

import {
    EquipmentStateEngine
}
from "../../utils/equipment/equipment-state-engine.js";

import {
    EffectEngine
}
from "../../utils/effects/effect-engine.js";

import {
    normalizeStatRecord
}
from "../../utils/actor/rmss-stats.js";

import {
    calculateArmorAndDefenses,
    calculateEncumbrance,
    calculateBaseMovementRate
}
from "../../data/stats/rmss-derived-values.js";

import { manaMaxFor } from "../../spells/spell-mapping.js";

export class EQRMSSActor extends Actor
{

    // ========================================================
    // PREPARE DATA
    // ========================================================

    prepareData()
    {

        super.prepareData();

        this._ensureSystemData();

    }

    // ========================================================
    // DERIVED DATA PIPELINE
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        if (!this.system)
        {
            return;
        }

        this._ensureSystemData();

        /*
        ========================================================
        Reset derived data every preparation cycle

        Prevents:
        - equipment stacking
        - effect stacking
        - duplicate modifiers
        ========================================================
        */

        this.system.derived =
        {

            stats:{},

            equipment:{},

            effects:[],

            skills:{},

            movement:
            {
                speed:30,
                modifiers:{}
            }

        };

        this._prepareBaseStats();

        this._prepareResources();

        this._prepareConcussionHits();

        this._prepareEquipment();

        this._prepareEffects();

        this._prepareSkills();

        this._prepareCombat();

        this._prepareMovement();

        this._prepareEncumbrance();

        this._prepareRMSSMovementRate();

    }

    // ========================================================
    // DEFAULT SYSTEM DATA
    // ========================================================

    _ensureSystemData()
    {

        this.system.attributes ??=
        {

            hp:
            {
                value:0,
                max:0
            },

            mana:
            {
                value:0,
                max:0
            },

            stamina:
            {
                value:0,
                max:0
            }

        };

        this.system.fixed_info ??=
        {

            race:null,

            race_name:"",

            profession:null,

            profession_name:"",

            realm:"none",

            deity:"",

            home_town:"",

            sex:""

        };

        this.system.stats ??=
        {};

        // Normalize wizard-era data into the canonical RMSS record schema.
        const origin = this.system.origin ?? {};
        if (origin.raceId && !this.system.fixed_info.race) {
            this.system.fixed_info.race = origin.raceId;
        }
        if (origin.raceName && !this.system.fixed_info.race_name) {
            this.system.fixed_info.race_name = origin.raceName;
        }
        if (origin.classId && !this.system.fixed_info.profession) {
            this.system.fixed_info.profession = origin.classId;
        }
        if (origin.className && !this.system.fixed_info.profession_name) {
            this.system.fixed_info.profession_name = origin.className;
        }
        if (origin.cityName && !this.system.fixed_info.home_town) {
            this.system.fixed_info.home_town = origin.cityName;
        }
        if (origin.deityName && !this.system.fixed_info.deity) {
            this.system.fixed_info.deity = origin.deityName;
        }
        if (this.system.gender && !this.system.fixed_info.sex) {
            this.system.fixed_info.sex = this.system.gender;
        }

        this.system.character ??= {};
        this.system.character.level ??= 1;
        this.system.character.experience ??= 0;
        this.system.character.developmentPoints ??= 0;
        this.system.character.spentDevelopmentPoints ??= 0;
        this.system.attributes.level ??= { value: this.system.character.level };
        if (typeof this.system.attributes.level !== "object") {
            this.system.attributes.level = { value: this.system.attributes.level };
        }
        this.system.attributes.level.value ??= this.system.character.level;

        const legacyStats = this.system.stats.stats ?? this.system.stats;
        if (!this.system.stats.stats && legacyStats && typeof legacyStats === "object") {
            const normalizedStats = normalizeStatRecord(legacyStats);
            for (const [statKey, rawValue] of Object.entries(normalizedStats)) {
                const value = Number(rawValue?.value ?? rawValue) || 0;
                normalizedStats[statKey] = {
                    ...(typeof rawValue === "object" ? rawValue : {}),
                    value,
                    total: Number(rawValue?.total ?? value),
                    basic_bonus: Number(rawValue?.basic_bonus ?? value),
                    racial_bonus: Number(rawValue?.racial_bonus ?? 0),
                    special_bonus: Number(rawValue?.special_bonus ?? 0)
                };
            }
            this.system.stats.stats = normalizedStats;
        }

        this.system.role_traits ??= {};
        this.system.background ??= {};
        this.system.resistance_rolls ??= {};
        this.system.money ??= {};
        this.system.encumbrance ??= {};
        this.system.status ??= {};
        this.system.movement ??= {};
        this.system.session ??= {};

        this.system.skills ??=
        {};

        this.system.combat ??=
        {};

        this.system.resources ??=
        {};

        this.system.derived ??=
        {};

        this.system.creationComplete ??=
        false;

    }

    // ========================================================
    // BASE STATS
    // ========================================================

    _prepareBaseStats()
    {

        this.system.derived.stats =

            foundry.utils.mergeObject(

                {},

                this.system.stats,

                {
                    inplace:false
                }

            );

    }

    // ========================================================
    // RESOURCE CALCULATIONS
    // ========================================================

    _prepareResources()
    {

        const attributes =
            this.system.attributes;

        this.system.derived.hp =

            attributes.hp?.value
            ??
            attributes.hp
            ??
            0;

        this.system.derived.mana =

            attributes.mana?.value
            ??
            attributes.mana
            ??
            0;

        // Mana pool (user ruling 2026-10-04): max = level x primary
        // casting stat bonus, class-aware (EQ flavor). The stored
        // pool lifts to the derived max — leveling tops the current
        // value up by the delta; the max never lowers automatically.
        const poolMax = manaMaxFor(this);
        this.system.derived.manaMax = poolMax;

        if (attributes.mana && typeof attributes.mana === "object" && poolMax > 0) {
            const storedMax = Number(attributes.mana.max) || 0;
            if (poolMax > storedMax) {
                attributes.mana.max = poolMax;
                attributes.mana.value = (Number(attributes.mana.value) || 0) + (poolMax - storedMax);
            }
        }

        this.system.derived.stamina =

            attributes.stamina?.value
            ??
            attributes.stamina
            ??
            0;

    }

    // ========================================================
    // CONCUSSION HITS — RMSS §3.8
    // ========================================================

    _prepareConcussionHits()
    {

        const hits =
            this.system.hits ??= {};

        const base =
            Number(hits.base) || 0;

        // Total Hits = BHPT + round(BHPT × CO bonus / 100).
        // Base and total are tracked separately; the total is
        // recalculated every preparation cycle (e.g. when CO changes).
        // Actors with no hit track keep a total of 0.
        hits.max =
            base + Math.round(base * this._constitutionBonus() / 100);

    }

    _constitutionBonus()
    {

        const co =
            this.system.stats?.CO;

        if (!co || typeof co !== "object") return 0;

        const stored =
            co.basic_bonus ?? co.basicBonus ?? 0;

        if (Number(stored) !== 0) return Number(stored);

        // No stored bonus: fall back to the temp-stat heuristic the
        // sheet uses. No temp stat at all means no bonus, not a
        // penalty conjured from a zero temp.
        if (co.temp == null) return 0;

        return Math.floor((Number(co.temp) - 50) / 5);

    }

    // ========================================================
    // EQUIPMENT PIPELINE
    // ========================================================

    _prepareEquipment()
    {

        try
        {

            const equipment =

                EquipmentStateEngine.calculate(
                    this
                );

            this.system.derived.equipment =
                equipment;

            this._applyEquipmentBonuses(
                equipment
            );

        }
        catch(err)
        {

            console.error(

                "EQRMSS | Equipment calculation failed",

                err

            );

        }

    }

    _applyEquipmentBonuses(
        equipment
    )
    {

        if (!equipment)
        {
            return;
        }

        // Track previously applied bonuses to avoid double-counting on
        // re-prepare. We store the deltas in derived (which resets each
        // prepare) and apply net changes to the system pools.
        const prev = this.system.derived._equipBonus ?? { hp: 0, mana: 0, stats: {} };
        const curr = {
            hp: Number(equipment.hp ?? 0),
            mana: Number(equipment.mana ?? 0),
            stats: equipment.stats ?? {}
        };

        // HP: adjust system.hits.max by the delta
        const hpDelta = curr.hp - (prev.hp ?? 0);
        if (hpDelta !== 0 && this.system.hits) {
            this.system.hits.max = (Number(this.system.hits.max) || 0) + hpDelta;
        }

        // Mana: adjust attributes.mana.max by the delta
        const manaDelta = curr.mana - (prev.mana ?? 0);
        if (manaDelta !== 0 && this.system.attributes?.mana) {
            this.system.attributes.mana.max = (Number(this.system.attributes.mana.max) || 0) + manaDelta;
        }

        // Stats: adjust system.stats.{code} by per-stat deltas
        if (this.system.stats) {
            const allKeys = new Set([...Object.keys(prev.stats ?? {}), ...Object.keys(curr.stats ?? {})]);
            for (const key of allKeys) {
                const oldVal = Number(prev.stats?.[key] ?? 0);
                const newVal = Number(curr.stats?.[key] ?? 0);
                const delta = newVal - oldVal;
                if (delta !== 0) {
                    const statObj = this.system.stats[key];
                    if (statObj && typeof statObj === "object") {
                        // RMSS stats are objects with temp/value; adjust the temp
                        if ("temp" in statObj) statObj.temp = (Number(statObj.temp) || 0) + delta;
                        else if ("value" in statObj) statObj.value = (Number(statObj.value) || 0) + delta;
                    } else {
                        this.system.stats[key] = (Number(statObj) || 0) + delta;
                    }
                }
            }
        }

        // Remember what we applied for next prepare
        this.system.derived._equipBonus = curr;

        // Keep the old derived fields for backward compat
        this.system.derived.hp = (this.system.derived.hp ?? 0) + curr.hp;
        this.system.derived.mana = (this.system.derived.mana ?? 0) + curr.mana;

    }

    // ========================================================
// EFFECT ENGINE PIPELINE
// ========================================================

_prepareEffects()
{

    try
    {

        const effects =

            EffectEngine.collect(
                this
            );

        this.system.derived.effects =
            effects;

        EffectEngine.apply(
            this,
            effects
        );

    }
    catch(err)
    {

        console.error(

            "EQRMSS | Effect processing failed",

            err

        );

    }

}

// ========================================================
// SKILL PIPELINE
// ========================================================

_prepareSkills()
{

    this.system.derived.skills ??=
        {};

    for (const item of this.items)
    {

        if (
            item.type !== "skill"
        )
        {
            continue;
        }

        const key =

            item.slug
            ??
            item.system?.slug
            ??
            item.name;

        let ranks = 0;

        let bonus = 0;

        /*
        ====================================================
        Support both legacy skill items and new skill docs
        ====================================================
        */

        if (
            typeof item.getRanks === "function"
        )
        {

            ranks =
                item.getRanks();

        }
        else
        {

            ranks =

                item.system?.ranks
                ??
                0;

        }

        if (
            typeof item.getSkillBonus === "function"
        )
        {

            bonus =

                item.getSkillBonus(
                    this
                );

        }
        else
        {

            bonus =

                item.system?.bonus
                ??
                0;

        }

        this.system.derived.skills[key] =
        {

            id:
                item.id,

            name:
                item.name,

            ranks,

            bonus

        };

    }

}

// ========================================================
// COMBAT PIPELINE
// ========================================================

_prepareCombat()
{

    const equipment =

        this.system.derived.equipment
        ??
        {};

    // NOTE: EQRMSSCharacter._prepareCombatAndDefenses() is dead code — the
    // subclass is never instantiated (CONFIG.Actor.documentClass is
    // EQRMSSActor for every actor type), so armor/DB derivation lives here.

    const prev =

        this.system.combat
        ??
        {};

    this.system.combat =

    {

        attackBonus:

            equipment.attackBonus
            ??
            0,

        defensiveBonus:

            equipment.defense
            ??
            0,

        armor:

            equipment.armor
            ??
            0,

        shield:

            equipment.shield
            ??
            0,

        // Preserve any stored defense components across prepares.
        adrenalDefense:

            Number(prev.adrenalDefense) || 0,

        otherDB:

            Number(prev.otherDB) || 0,

        formationLeft:

            prev.formationLeft ?? "",

        formationRight:

            prev.formationRight ?? "",

        armorDB:

            Number(prev.armorDB) || 0,

        penalties:

            prev.penalties
            ??
            {}

    };

    // Derive armor type, maneuver penalties, and total DB from equipped
    // gear every prepare — feeds the Combat tab and attack resolution.
    try
    {

        const metrics = calculateArmorAndDefenses(this);

        this.system.combat.armorType = metrics.armorType;
        this.system.combat.chartArmorType = metrics.chartArmorType ?? null;
        this.system.combat.chartDB = metrics.chartDB ?? null;
        this.system.combat.mmp = metrics.mmp;
        this.system.combat.penalties = metrics.penalties;
        this.system.combat.quicknessBonus = metrics.quicknessBonus;
        this.system.combat.shieldBonus = metrics.shieldBonus;
        this.system.combat.shieldMissileBonus = metrics.shieldMissileBonus ?? metrics.shieldBonus;
        this.system.combat.enhancedArmorDB = metrics.enhancedArmorDB ?? 0;
        this.system.combat.enhQuicknessPenalty = metrics.enhQuicknessPenalty ?? 0;
        this.system.combat.enhMissilePenalty = metrics.enhMissilePenalty ?? 0;
        this.system.combat.armorDBTotal = (metrics.armorDB ?? 0) + (metrics.enhancedArmorDB ?? 0);
        this.system.combat.adrenalSkillBonus = metrics.adrenalSkillBonus ?? 0;
        this.system.combat.adrenalBlockedByArmor = metrics.adrenalBlockedByArmor ?? false;
        this.system.combat.adrenalEffective = metrics.adrenalEffective ?? metrics.adrenalDefense ?? 0;
        this.system.combat.totalDB = metrics.totalDB;
        this.system.combat.totalMissileDB = metrics.totalMissileDB ?? metrics.totalDB;
        this.system.combat.formationDB = metrics.formationDB ?? 0;
        this.system.combat.formationMissileDB = metrics.formationMissileDB ?? 0;
        this.system.combat.mixedArmorDB = metrics.mixedArmorDB ?? 0;
        this.system.combat.helmetDF = metrics.helmetDF ?? 0;
        this.system.combat.stanceDB = metrics.stanceDB ?? 0;

    }
    catch (e)
    {

        console.error("EQRMSS | Combat derivation failed", e);

        this.system.combat.armorType ??= "No Armor";
        this.system.combat.totalDB ??= 0;
        this.system.combat.totalMissileDB ??= this.system.combat.totalDB;
        this.system.combat.shieldMissileBonus ??= this.system.combat.shieldBonus ?? 0;
        this.system.combat.adrenalEffective ??= this.system.combat.adrenalDefense ?? 0;

    }

}

// ========================================================
// MOVEMENT PIPELINE
// ========================================================

_prepareMovement()
{

    const movement =

        this.system.derived.movement;

    const transport =

        this.system.derived
            .equipment
            ?.transport;

    if (transport)
    {

        movement.speed =

            transport.speed
            ??
            movement.speed;

    }

}

// ========================================================
// RMSS §7.2.2 ENCUMBRANCE + §7.2.1 MOVEMENT RATE
// ========================================================
//
// NOTE: These run here on the base actor class because it is
// the document class actually instantiated for every actor
// type (see module/initialization/register-documents.js).
// EQRMSSCharacter is exported but never registered, so its
// own _prepare* methods never execute.

_prepareEncumbrance()
{

    const enc =

        calculateEncumbrance(this);

    this.system.encumbrance ??= {};

    this.system.encumbrance.bwa =
        enc.bwa;

    this.system.encumbrance.load =
        enc.load;

    this.system.encumbrance.chartPenalty =
        enc.chartPenalty;

    this.system.encumbrance.stBonus =
        enc.stBonus;

    this.system.encumbrance.penalty =
        enc.penalty;

    this.system.encumbrance.excessST =
        enc.excessST;

}

_prepareRMSSMovementRate()
{

    const move =

        calculateBaseMovementRate(this);

    this.system.movement ??= {};

    this.system.movement.quTotal =
        move.quTotal;

    this.system.movement.quBonus =
        move.quBonus;

    this.system.movement.chartBase =
        move.chartBase;

    this.system.movement.racialMod =
        move.racialMod;

    this.system.movement.armorPen =
        move.armorPen;

    this.system.movement.armorApplied =
        move.armorApplied;

    this.system.movement.strideMod =
        move.strideMod;

    this.system.movement.encPenalty =
        move.encPenalty;

    this.system.movement.baseRate =
        move.baseRate;

}

// ========================================================
// EQUIPMENT HELPERS
// ========================================================

getEquippedItems()
{

    return this.items.filter(

        item =>

            item.system?.equipped === true

    );

}

// ========================================================
// EFFECT HELPERS
// ========================================================

getActiveEffects()
{

    return (

        this.system.derived.effects
        ??
        []

    );

}

// ========================================================
// SKILL HELPERS
// ========================================================

getSkill(
    skill
)
{

    return (

        this.system.derived.skills
            ?.[skill]
        ??
        null

    );

}

// ========================================================
// EQUIPMENT SUMMARY
// ========================================================

getEquipmentSummary()
{

    return (

        this.system.derived.equipment
        ??
        {}

    );

}

// ========================================================
// CHARACTER CREATION PIPELINE
// ========================================================

async initializeCharacter(
    creationData = {}
)
{

    console.log(

        "EQRMSS | Starting Character Initialization",

        creationData

    );

    /*
    ========================================================
    Store creation selections
    ========================================================
    */

    if (creationData.race)
    {

        this.system.fixed_info.race =

            creationData.race;

    }

    if (creationData.raceName)
    {

        this.system.fixed_info.race_name =

            creationData.raceName;

    }

    if (creationData.profession)
    {

        this.system.fixed_info.profession =

            creationData.profession;

    }

    if (creationData.professionName)
    {

        this.system.fixed_info.profession_name =

            creationData.professionName;

    }

    if (creationData.realm)
    {

        this.system.fixed_info.realm =

            creationData.realm;

    }

    if (creationData.deity)
    {

        this.system.fixed_info.deity =

            creationData.deity;

    }

    if (creationData.home_town)
    {

        this.system.fixed_info.home_town =

            creationData.home_town;

    }

    if (creationData.sex)
    {

        this.system.fixed_info.sex =

            creationData.sex;

    }

    /*
    ========================================================
    Apply Race Data
    ========================================================
    */

    if (
        typeof this.applyRaceData === "function"
    )
    {

        await this.applyRaceData(

            creationData.race

        );

    }
    else
    {

        console.warn(

            "EQRMSS | applyRaceData() not implemented"

        );

    }

    /*
    ========================================================
    Apply Profession Data
    ========================================================
    */

    if (
        typeof this.applyProfessionData === "function"
    )
    {

        await this.applyProfessionData(

            creationData.profession

        );

    }
    else
    {

        console.warn(

            "EQRMSS | applyProfessionData() not implemented"

        );

    }

    // ========================================================
// CHARACTER CREATION PIPELINE CONTINUED
// ========================================================

    /*
    ========================================================
    Initialize Skills
    ========================================================
    */

    if (
        typeof this.initializeSkills === "function"
    )
    {

        await this.initializeSkills();

    }
    else
    {

        console.warn(

            "EQRMSS | initializeSkills() not implemented"

        );

    }

    /*
    ========================================================
    Initialize Spells
    ========================================================
    */

    if (
        typeof this.initializeSpells === "function"
    )
    {

        await this.initializeSpells();

    }
    else
    {

        console.warn(

            "EQRMSS | initializeSpells() not implemented"

        );

    }

    /*
    ========================================================
    Initialize Starting Equipment
    ========================================================
    */

    if (
        typeof this.initializeStartingEquipment === "function"
    )
    {

        await this.initializeStartingEquipment();

    }
    else
    {

        console.warn(

            "EQRMSS | initializeStartingEquipment() not implemented"

        );

    }

    /*
    ========================================================
    Finalize Character Creation
    ========================================================
    */

    this.system.creationComplete = true;

    await this.update({

        "system.creationComplete": true,

        "system.fixed_info": this.system.fixed_info

    });

    this.prepareData();

    console.log(

        "EQRMSS | Character Initialization Complete",

        this

    );

    return this;

}

// ========================================================
// DEFAULT CHARACTER HOOKS
//
// These are intentionally lightweight.
// Future class/race modules override these.
// ========================================================

async applyRaceData(
    raceId
)
{

    if (!raceId)
    {
        return;
    }

    console.log(

        "EQRMSS | Applying race",

        raceId

    );

}

async applyProfessionData(
    professionId
)
{

    if (!professionId)
    {
        return;
    }

    console.log(

        "EQRMSS | Applying profession",

        professionId

    );

}

async initializeSkills()
{

    console.log(

        "EQRMSS | Initializing starting skills"

    );

}

async initializeSpells()
{

    console.log(

        "EQRMSS | Initializing starting spells"

    );

}

async initializeStartingEquipment()
{

    console.log(

        "EQRMSS | Initializing starting equipment"

    );

}

}