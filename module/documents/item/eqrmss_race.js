// ============================================================
// EQRMSS Race Item
//
// Foundry VTT V13 / V14 Compatible
//
// Handles:
// - Racial stat bonuses
// - Racial skills
// - Skill costs
// - Languages
// - Traits
// - Resistances
// - Movement
// - Racial abilities
//
// ============================================================

import {
    EQRMSSItem
}
from "./eqrmss_item.js";

export class EQRMSSRace extends EQRMSSItem {

    // ============================================================
    // DERIVED DATA
    // ============================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._prepareRaceData();

    }

    // ============================================================
    // DEFAULT DATA
    // ============================================================

    _prepareRaceData()
    {

        this.system.stat_bonuses ??=
        {};

        this.system.skill_costs ??=
        {};

        this.system.skill_category_links ??=
        {};

        this.system.traits ??=
        [];

        this.system.abilities ??=
        [];

        this.system.languages ??=
        [];

        this.system.resistances ??=
        {

            heat:0,

            cold:0,

            disease:0,

            poison:0,

            magic:0

        };

        this.system.movement ??=
        {

            speed:30,

            swim:0,

            climb:0

        };

        this.system.size ??=
            "medium";

        this.system.age ??=
        {

            adulthood:18,

            lifespan:80

        };

        this.system.restrictions ??=
        {

            classes:[],

            professions:[]

        };

    }

    // ============================================================
    // STAT BONUSES
    // ============================================================

    getStatBonus(stat)
    {

        return Number(

            this.system.stat_bonuses?.[stat]
            ??
            0

        );

    }

    getAllStatBonuses()
    {

        return foundry.utils.deepClone(

            this.system.stat_bonuses
            ??
            {}

        );

    }

    // ============================================================
    // SKILL SUPPORT
    // ============================================================

    getSkillCost(skill)
    {

        return Number(

            this.system.skill_costs?.[skill]
            ??
            0

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

    hasSkillModifier(skill)
    {

        return (

            this.system.skill_costs?.[skill]
            !==
            undefined

        );

    }

    // ============================================================
    // LANGUAGE SUPPORT
    // ============================================================

    getLanguages()
    {

        return (

            this.system.languages
            ??
            []

        );

    }

    knowsLanguage(language)
    {

        return (

            this.getLanguages()
            .includes(language)

        );

    }

    // ============================================================
    // TRAITS
    // ============================================================

    getTraits()
    {

        return (

            this.system.traits
            ??
            []

        );

    }

    hasTrait(trait)
    {

        return (

            this.getTraits()
            .includes(trait)

        );

    }

    // ============================================================
    // RACIAL ABILITIES
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
    // RESISTANCES
    // ============================================================

    getResistanceBonus(type)
    {

        return Number(

            this.system.resistances?.[type]
            ??
            0

        );

    }

    // ============================================================
    // MOVEMENT
    // ============================================================

    getMovementSpeed()
    {

        return Number(

            this.system.movement?.speed
            ??
            30

        );

    }

    // ============================================================
    // VALIDATION
    // ============================================================

    validate(system={})
    {

        const errors =
            super.validate(system);

        const stats =
            system.stat_bonuses
            ??
            {};

        for(
            const stat of Object.keys(stats)
        )
        {

            if(
                CONFIG.EQRMSS?.validStats &&
                !CONFIG.EQRMSS.validStats.includes(stat)
            )
            {

                errors.push(
                    `Invalid racial stat bonus: ${stat}`
                );

            }

        }

        if(
            !Array.isArray(
                system.languages
                ??
                []
            )
        )
        {

            errors.push(
                "Race languages must be an array"
            );

        }

        if(
            !Array.isArray(
                system.traits
                ??
                []
            )
        )
        {

            errors.push(
                "Race traits must be an array"
            );

        }

        if(
            Number(
                system.movement?.speed
                ??
                0
            )
            <=
            0
        )
        {

            errors.push(
                "Race movement speed must be greater than zero"
            );

        }

        return errors;

    }

}