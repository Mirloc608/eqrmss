// ============================================================
// EQRMSS Skill Item
//
// EverQuest - Rolemaster Standard System
//
// Skill definition document.
//
// Supports:
//  - Skill categories
//  - Development point costs
//  - Stat bonuses
//  - Proficiency ranks
//  - Equipment modifiers
//  - Class/race modifiers
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSSkill extends EQRMSSItem
{

    // ========================================================
    // DATA PREPARATION
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureSkillData();

        this._prepareCosts();

        this._prepareModifiers();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureSkillData()
    {

        this.system.skill ??=
        {

            category:null,

            group:null,

            governingStats:
            [],

            description:"",

            ranks:0,

            maxRanks:0,

            bonus:0,

            developmentCost:
            {

                default:1,

                profession:{}

            },

            training:
            {

                available:true

            },

            modifiers:
            {

                race:{},

                class:{},

                equipment:{}

            }

        };

    }

    // ========================================================
    // CATEGORY
    // ========================================================

    getCategory()
    {

        return (

            this.system.skill.category
            ??
            null

        );

    }

    setCategory(
        category
    )
    {

        this.system.skill.category =
            category;

    }

    getGroup()
    {

        return (

            this.system.skill.group
            ??
            null

        );

    }

    // ========================================================
    // GOVERNING STATS
    // ========================================================

    getGoverningStats()
    {

        return (

            this.system.skill.governingStats
            ??
            []

        );

    }

    addGoverningStat(
        stat
    )
    {

        this.system.skill.governingStats ??=
            [];

        if(
            !this.system.skill.governingStats.includes(stat)
        )
        {

            this.system.skill.governingStats.push(
                stat
            );

        }

    }

    // ========================================================
    // RANKS
    // ========================================================

    getRanks()
    {

        return (

            this.system.skill.ranks
            ??
            0

        );

    }

    getMaxRanks()
    {

        return (

            this.system.skill.maxRanks
            ??
            0

        );

    }

    addRank()
    {

        if(
            this.getRanks()
            >=
            this.getMaxRanks()
        )
        {
            return false;
        }

        this.system.skill.ranks++;

        return true;

    }

    // ========================================================
    // DEVELOPMENT COSTS
    // ========================================================

    _prepareCosts()
    {

        this.system.skill.developmentCost ??=
        {

            default:1,

            profession:{}

        };

    }

    getDevelopmentCost(
        profession=null
    )
    {

        if(
            profession
            &&
            this.system.skill
                .developmentCost
                .profession
                ?.[profession]
        )
        {

            return this.system.skill
                .developmentCost
                .profession[profession];

        }

        return (

            this.system.skill
                .developmentCost
                .default
            ??
            1

        );

    }

    setProfessionCost(
        profession,
        cost
    )
    {

        this.system.skill
            .developmentCost
            .profession ??=
            {};

        this.system.skill
            .developmentCost
            .profession[profession] =
            cost;

    }

    // ========================================================
    // MODIFIERS
    // ========================================================

    _prepareModifiers()
    {

        this.system.skill.modifiers ??=
        {

            race:{},

            class:{},

            equipment:{}

        };

    }

    getRaceModifier(
        race
    )
    {

        return (

            this.system.skill
                .modifiers
                .race
                ?.[race]
            ??
            0

        );

    }

    getClassModifier(
        cls
    )
    {

        return (

            this.system.skill
                .modifiers
                .class
                ?.[cls]
            ??
            0

        );

    }

    getEquipmentModifier()
    {

        return (

            this.system.skill
                .modifiers
                .equipment
            ??
            0

        );

    }

    addEquipmentModifier(
        value
    )
    {

        this.system.skill
            .modifiers
            .equipment +=
            value;

    }

    // ========================================================
    // FINAL BONUS
    // ========================================================

    getSkillBonus(
        actor
    )
    {

        let bonus =
            this.system.skill.bonus
            ??
            0;

        if(
            actor
        )
        {

            const race =
                actor.system.race;

            const classes =
                actor.system.classes
                ??
                [];

            bonus +=
                this.getRaceModifier(
                    race
                );

            for(
                const cls of classes
            )
            {

                bonus +=
                    this.getClassModifier(
                        cls
                    );

            }

        }

        bonus +=
            this.getEquipmentModifier();

        return bonus;

    }

    // ========================================================
    // TRAINING
    // ========================================================

    canTrain()
    {

        return (

            this.system.skill
                .training
                .available
            !==
            false

        );

    }

    // ========================================================
    // SUMMARY
    // ========================================================

    getSkillSummary()
    {

        return {

            id:
                this.id,

            name:
                this.name,

            category:
                this.getCategory(),

            ranks:
                this.getRanks(),

            bonus:
                this.system.skill.bonus

        };

    }

}