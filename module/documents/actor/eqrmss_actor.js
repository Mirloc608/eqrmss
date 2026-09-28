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

        this._prepareEquipment();

        this._prepareEffects();

        this._prepareSkills();

        this._prepareCombat();

        this._prepareMovement();

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

        this.system.derived.stamina =

            attributes.stamina?.value
            ??
            attributes.stamina
            ??
            0;

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

        this.system.derived.hp +=

            equipment.hp
            ??
            0;

        this.system.derived.mana +=

            equipment.mana
            ??
            0;

        this.system.derived.stats =

            foundry.utils.mergeObject(

                this.system.derived.stats,

                equipment.stats
                ??
                {},

                {
                    inplace:false
                }

            );

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
            0

    };

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