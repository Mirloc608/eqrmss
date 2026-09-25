// ============================================================
// EQRMSS Class / Profession Item
//
// Foundry VTT V13 / V14 Compatible
//
// Handles:
// - RMSS profession data
// - Development Points
// - Skill costs
// - Skill categories
// - Spell access
// - Combat actions
// - Equipment restrictions
// - Class abilities
// - Progression metadata
//
// ============================================================

import {
    EQRMSSItem
}
from "./eqrmss_item.js";

export class EQRMSSClass extends EQRMSSItem {

    // ============================================================
    // DERIVED DATA
    // ============================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._prepareClassData();

    }

    // ============================================================
    // DEFAULT DATA
    // ============================================================

    _prepareClassData()
    {

        this.system.stat_bonuses ??=
        {};

        this.system.primary_stats ??=
        [];

        this.system.secondary_stats ??=
        [];

        this.system.skill_costs ??=
        {};

        this.system.skill_category_links ??=
        {};

        this.system.dp_modifiers ??=
        {

            base:0,

            per_level:0,

            multiplier:1,

            skills:{}

        };

        this.system.spells ??=
        {

            available:false,

            realms:[],

            lists:[]

        };

        this.system.combat_actions ??=
        [];

        this.system.abilities ??=
        [];

        this.system.training_packages ??=
        [];

        this.system.equipment_restrictions ??=
        {

            weapons:[],

            armor:[],

            shields:[]

        };

        this.system.progression ??=
        {

            levels:{},

            milestones:[]

        };

    }

    // ============================================================
    // PROFESSION INFO
    // ============================================================

    getProfessionName()
    {

        return this.name;

    }

    getPrimaryStats()
    {

        return (

            this.system.primary_stats
            ??
            []

        );

    }

    getSecondaryStats()
    {

        return (

            this.system.secondary_stats
            ??
            []

        );

    }

    // ============================================================
    // DEVELOPMENT POINTS
    // ============================================================

    getDPModifier()
    {

        return (

            this.system.dp_modifiers
            ??
            {}

        );

    }

    getBaseDevelopmentPoints()
    {

        return Number(

            this.system.dp_modifiers?.base
            ??
            0

        );

    }

    getLevelDevelopmentPoints()
    {

        return Number(

            this.system.dp_modifiers?.per_level
            ??
            0

        );

    }

    getSkillDPModifier(skill)
    {

        return Number(

            this.system.dp_modifiers
            ?.skills
            ?.[skill]
            ??
            0

        );

    }

    calculateDevelopmentPoints(level=1)
    {

        const base =
            this.getBaseDevelopmentPoints();

        const perLevel =
            this.getLevelDevelopmentPoints();

        const multiplier =
            Number(
                this.system.dp_modifiers?.multiplier
                ??
                1
            );

        return Math.floor(

            (
                base +
                (
                    perLevel *
                    Math.max(
                        level - 1,
                        0
                    )
                )

            )
            *
            multiplier

        );

    }

    // ============================================================
    // SKILL COSTS
    // ============================================================

    getSkillCost(skill)
    {

        return Number(

            this.system.skill_costs?.[skill]
            ??
            0

        );

    }

    hasSkill(skill)
    {

        return (

            this.system.skill_costs?.[skill]
            !==
            undefined

        );

    }

    getSkillCategory(skill)
    {

        return (

            this.system.skill_category_links?.[skill]
            ??
            null

        );

    }

    // ============================================================
    // SPELL SYSTEM
    // ============================================================

    canCastSpells()
    {

        return Boolean(

            this.system.spells?.available

        );

    }

    getSpellRealms()
    {

        return (

            this.system.spells?.realms
            ??
            []

        );

    }

    getSpellLists()
    {

        return (

            this.system.spells?.lists
            ??
            []

        );

    }

    hasSpellList(list)
    {

        return (

            this.getSpellLists()
            .includes(list)

        );

    }

    // ============================================================
    // COMBAT ACTIONS
    // ============================================================

    getCombatActions()
    {

        return (

            this.system.combat_actions
            ??
            []

        );

    }

    hasCombatAction(id)
    {

        return (

            this.getCombatActions()
            .includes(id)

        );

    }

    // ============================================================
    // CLASS ABILITIES
    // ============================================================

    getAbilities()
    {

        return (

            this.system.abilities
            ??
            []

        );

    }

    hasAbility(id)
    {

        return (

            this.getAbilities()
            .some(
                a =>
                a.id === id ||
                a === id
            )

        );

    }

    // ============================================================
    // EQUIPMENT RESTRICTIONS
    // ============================================================

    canUseWeapon(type)
    {

        const allowed =
            this.system.equipment_restrictions
            ?.weapons
            ??
            [];

        return (

            allowed.length === 0 ||
            allowed.includes(type)

        );

    }

    canWearArmor(type)
    {

        const allowed =
            this.system.equipment_restrictions
            ?.armor
            ??
            [];

        return (

            allowed.length === 0 ||
            allowed.includes(type)

        );

    }

    canUseShield(type)
    {

        const allowed =
            this.system.equipment_restrictions
            ?.shields
            ??
            [];

        return (

            allowed.length === 0 ||
            allowed.includes(type)

        );

    }

    // ============================================================
    // TRAINING PACKAGES
    // ============================================================

    getTrainingPackages()
    {

        return (

            this.system.training_packages
            ??
            []

        );

    }

    hasTrainingPackage(id)
    {

        return (

            this.getTrainingPackages()
            .includes(id)

        );

    }

    // ============================================================
    // PROGRESSION
    // ============================================================

    getLevelProgression(level)
    {

        return (

            this.system.progression
            ?.levels
            ?.[level]
            ??
            null

        );

    }

    // ============================================================
    // VALIDATION
    // ============================================================

    validate(system={})
    {

        const errors =
            super.validate(system);

        if(
            !Array.isArray(
                system.primary_stats
                ??
                []
            )
        )
        {

            errors.push(
                "Class primary_stats must be an array"
            );

        }

        if(
            Number(
                system.dp_modifiers?.multiplier
                ??
                1
            )
            <=
            0
        )
        {

            errors.push(
                "DP multiplier must be greater than zero"
            );

        }

        if(
            system.spells?.available &&
            (
                !Array.isArray(
                    system.spells.realms
                    ??
                    []
                )
            )
        )
        {

            errors.push(
                "Spell realms must be an array"
            );

        }

        return errors;

    }

}