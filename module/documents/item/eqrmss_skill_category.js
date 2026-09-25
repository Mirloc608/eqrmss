// ============================================================
// EQRMSS Skill Category Item Document
//
// Foundry VTT V13 / V14 Compatible
//
// Handles:
// - RMSS skill categories
// - Skill grouping
// - Profession modifiers
// - Category statistics
// - Training package hooks
// - Skill organization
//
// Inherits:
// EQRMSSItem
//
// ============================================================

import {
    EQRMSSItem
}
from "./eqrmss_item.js";

export class EQRMSSSkillCategory extends EQRMSSItem {

    // ============================================================
    // PREPARE
    // ============================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureCategoryData();

        this._prepareCategoryData();

    }

    // ============================================================
    // DATA SAFETY
    // ============================================================

    _ensureCategoryData()
    {

        this.system.skillCategory ??=
        {

            description:"",

            groupType:"general",

            skills:
            [],

            linkedStats:
            [],

            professionCosts:
            {},

            bonuses:
            {

                training:0,

                specialization:0

            },

            restrictions:
            {

                races:[],

                classes:[]

            },

            tags:[]

        };

    }

    // ============================================================
    // DERIVED DATA
    // ============================================================

    _prepareCategoryData()
    {

        const category =
            this.system.skillCategory;

        category.skills ??=
            [];

        category.linkedStats ??=
            [];

        category.professionCosts ??=
            {};

        category.tags ??=
            [];

    }

    // ============================================================
    // CATEGORY INFORMATION
    // ============================================================

    getCategoryType()
    {

        return this.system.skillCategory
            ?.groupType
            ??
            "general";

    }

    getDescription()
    {

        return this.system.skillCategory
            ?.description
            ??
            "";

    }

    // ============================================================
    // LINKED SKILLS
    // ============================================================

    getSkills()
    {

        return this.system.skillCategory
            ?.skills
            ??
            [];

    }

    addSkill(skillId)
    {

        const skills =
            this.system.skillCategory.skills;

        if(
            !skills.includes(skillId)
        )
        {

            skills.push(skillId);

        }

    }

    removeSkill(skillId)
    {

        this.system.skillCategory.skills =
            this.system.skillCategory.skills
            .filter(
                id =>
                    id !== skillId
            );

    }

    containsSkill(skillId)
    {

        return this.getSkills()
            .includes(skillId);

    }

    // ============================================================
    // STAT LINKING
    // ============================================================

    getLinkedStats()
    {

        return this.system.skillCategory
            ?.linkedStats
            ??
            [];

    }

    hasLinkedStat(stat)
    {

        return this.getLinkedStats()
            .includes(stat);

    }

    // ============================================================
    // PROFESSION COSTS
    // ============================================================

    getProfessionCost(profession)
    {

        return Number(

            this.system.skillCategory
            ?.professionCosts
            ?.[profession]
            ??
            0

        );

    }

    setProfessionCost(
        profession,
        cost
    )
    {

        this.system.skillCategory
            .professionCosts[profession] =
                Number(cost);

    }

    getProfessionCosts()
    {

        return this.system.skillCategory
            ?.professionCosts
            ??
            {};

    }

    // ============================================================
    // CATEGORY BONUSES
    // ============================================================

    getTrainingBonus()
    {

        return Number(

            this.system.skillCategory
            ?.bonuses
            ?.training
            ??
            0

        );

    }

    getSpecializationBonus()
    {

        return Number(

            this.system.skillCategory
            ?.bonuses
            ?.specialization
            ??
            0

        );

    }

    // ============================================================
    // CATEGORY TYPES
    // ============================================================

    isWeaponCategory()
    {

        return this.hasTag(
            "weapon"
        );

    }

    isCombatCategory()
    {

        return this.hasTag(
            "combat"
        );

    }

    isMagicCategory()
    {

        return this.hasTag(
            "magic"
        );

    }

    isLanguageCategory()
    {

        return this.hasTag(
            "language"
        );

    }

    isPerformanceCategory()
    {

        return this.hasTag(
            "performance"
        );

    }

    // ============================================================
    // TAGS
    // ============================================================

    hasTag(tag)
    {

        return (

            this.system.skillCategory
            ?.tags
            ??
            []

        )
        .includes(tag);

    }

    // ============================================================
    // RESTRICTIONS
    // ============================================================

    canBeUsedBy(actor)
    {

        const restrictions =
            this.system.skillCategory
            ?.restrictions
            ??
            {};

        const race =
            actor.system.fixed_info
            ?.race;

        const profession =
            actor.system.fixed_info
            ?.profession;

        if(
            restrictions.races.length &&
            !restrictions.races.includes(
                race
            )
        )
        {

            return false;

        }

        if(
            restrictions.classes.length &&
            !restrictions.classes.includes(
                profession
            )
        )
        {

            return false;

        }

        return true;

    }

    // ============================================================
    // TRAINING PACKAGE SUPPORT
    // ============================================================

    applyTrainingPackageBonus(
        bonus
    )
    {

        this.system.skillCategory
            .bonuses.training +=
                Number(bonus);

    }

    // ============================================================
    // VALIDATION
    // ============================================================

    validate(system={})
    {

        const errors =
            super.validate(system);

        const category =
            system.skillCategory ?? {};

        if(
            !category.groupType
        )
        {

            errors.push(
                "Skill category missing group type"
            );

        }

        if(
            !Array.isArray(
                category.skills
            )
        )
        {

            errors.push(
                "Skill category skills must be an array"
            );

        }

        if(
            !Array.isArray(
                category.linkedStats
            )
        )
        {

            errors.push(
                "Skill category linked stats must be an array"
            );

        }

        return errors;

    }

}