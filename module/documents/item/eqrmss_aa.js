// ============================================================
// EQRMSS Alternate Advancement Item Document
//
// Foundry VTT V13 / V14 Compatible
//
// Handles:
// - EverQuest AA abilities
// - AA ranks
// - AA point costs
// - Passive modifiers
// - Activated abilities
// - Prerequisites
// - Class restrictions
// - Level requirements
// - Cooldowns
//
// Inherits:
// EQRMSSItem
//
// ============================================================

import {
    EQRMSSItem
}
from "./eqrmss_item.js";

export class EQRMSSAA extends EQRMSSItem {

    // ============================================================
    // PREPARE
    // ============================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureAAData();

        this._prepareAAData();

    }

    // ============================================================
    // DATA SAFETY
    // ============================================================

    _ensureAAData()
    {

        this.system.aa ??=
        {

            category:"general",

            expansion:null,

            rank:
            {

                current:1,

                max:1

            },

            cost:
            {

                base:1,

                perRank:1

            },

            type:"passive",

            activation:
            {

                action:null,

                cooldown:0,

                duration:0

            },

            requirements:
            {

                level:1,

                classes:[],

                prerequisites:[]

            },

            effects:[],

            tags:[]

        };

    }

    // ============================================================
    // PREPARE AA DATA
    // ============================================================

    _prepareAAData()
    {

        const aa =
            this.system.aa;

        aa.rank ??=
        {

            current:1,

            max:1

        };

        aa.cost ??=
        {

            base:1,

            perRank:1

        };

        aa.effects ??=
            [];

        aa.tags ??=
            [];

        aa.requirements ??=
        {

            level:1,

            classes:[],

            prerequisites:[]

        };

    }

    // ============================================================
    // AA INFORMATION
    // ============================================================

    getCategory()
    {

        return this.system.aa
            ?.category
            ??
            "general";

    }

    getExpansion()
    {

        return this.system.aa
            ?.expansion
            ??
            null;

    }

    // ============================================================
    // RANK SYSTEM
    // ============================================================

    getRank()
    {

        return Number(

            this.system.aa
            ?.rank
            ?.current
            ??
            1

        );

    }

    getMaxRank()
    {

        return Number(

            this.system.aa
            ?.rank
            ?.max
            ??
            1

        );

    }

    isMaxRank()
    {

        return (
            this.getRank()
            >=
            this.getMaxRank()
        );

    }

    getNextRankCost()
    {

        const cost =
            this.system.aa?.cost;

        return Number(

            cost.base
            +
            (
                (
                    this.getRank()
                    -
                    1
                )
                *
                cost.perRank
            )

        );

    }

    // ============================================================
    // AA TYPES
    // ============================================================

    isPassive()
    {

        return (
            this.system.aa?.type
            ===
            "passive"
        );

    }

    isActivated()
    {

        return (
            this.system.aa?.type
            ===
            "activated"
        );

    }

    isToggle()
    {

        return (
            this.system.aa?.type
            ===
            "toggle"
        );

    }

    // ============================================================
    // ACTIVATION
    // ============================================================

    getCooldown()
    {

        return Number(

            this.system.aa
            ?.activation
            ?.cooldown
            ??
            0

        );

    }

    getDuration()
    {

        return Number(

            this.system.aa
            ?.activation
            ?.duration
            ??
            0

        );

    }

    getAction()
    {

        return this.system.aa
            ?.activation
            ?.action
            ??
            null;

    }

    // ============================================================
    // REQUIREMENTS
    // ============================================================

    getRequiredLevel()
    {

        return Number(

            this.system.aa
            ?.requirements
            ?.level
            ??
            1

        );

    }

    getRequiredClasses()
    {

        return this.system.aa
            ?.requirements
            ?.classes
            ??
            [];

    }

    getPrerequisites()
    {

        return this.system.aa
            ?.requirements
            ?.prerequisites
            ??
            [];

    }

    canUse(actor)
    {

        if(
            actor.getLevel()
            <
            this.getRequiredLevel()
        )
            return false;

        const classes =
            this.getRequiredClasses();

        if(
            classes.length
            &&
            !classes.includes(
                actor.getProfession()
            )
        )
        {

            return false;

        }

        return true;

    }

    // ============================================================
    // EFFECTS
    // ============================================================

    getEffects()
    {

        return this.system.aa
            ?.effects
            ??
            [];

    }

    hasEffect(type)
    {

        return this.getEffects()
            .some(
                effect =>
                    effect.type === type
            );

    }

    // ============================================================
    // TAGS
    // ============================================================

    hasTag(tag)
    {

        return this.system.aa
            ?.tags
            ?.includes(tag)
            ??
            false;

    }

    // ============================================================
    // VALIDATION
    // ============================================================

    validate(system={})
    {

        const errors =
            super.validate(system);

        const aa =
            system.aa ?? {};

        if(
            !aa.category
        )
        {

            errors.push(
                "AA missing category"
            );

        }

        if(
            Number(
                aa.rank?.max ?? 0
            )
            <=0
        )
        {

            errors.push(
                "AA max rank invalid"
            );

        }

        if(
            Number(
                aa.cost?.base ?? 0
            )
            <0
        )
        {

            errors.push(
                "AA cost cannot be negative"
            );

        }

        return errors;

    }

}