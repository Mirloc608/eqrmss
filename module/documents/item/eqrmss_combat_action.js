// ============================================================
// EQRMSS Combat Action Item Document
//
// Foundry VTT V13 / V14 Compatible
//
// Handles:
// - Combat abilities
// - Disciplines
// - Special attacks
// - Weapon requirements
// - Class restrictions
// - Skill requirements
// - Cooldowns
// - Endurance costs
// - Target rules
// - Effects metadata
//
// Inherits:
// EQRMSSItem
//
// Execution belongs to:
// CombatActionEngine
//
// ============================================================

import {
    EQRMSSItem
}
from "./eqrmss_item.js";

export class EQRMSSCombatAction extends EQRMSSItem {

    // ========================================================
    // PREPARE
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureCombatActionData();

        this._prepareCombatActionData();

    }

    // ========================================================
    // DATA SAFETY
    // ========================================================

    _ensureCombatActionData()
    {

        this.system.combat ??=
        {

            id:
                this.id
                ??
                null,

            category:
                "general",

            type:
                "attack",

            handler:
                null,

            discipline:
                false,

            instant:
                false,

            cooldown:
                0,

            enduranceCost:
                0,

            duration:
                0,

            requirements:
            {

                level:
                    1,

                classes:
                    [],

                weapons:
                    [],

                skills:
                    {}

            },

            target:
            {

                type:
                    "single",

                range:
                    1

            },

            effects:
                [],

            stance:
                null,

            aiScore:
                0,

            priority:
                0,

            tags:
                []

        };

    }

    // ========================================================
    // NORMALIZATION
    // ========================================================

    _prepareCombatActionData()
    {

        const combat =
            this.system.combat;

        combat.id ??=
            this.id;

        combat.category ??=
            "general";

        combat.type ??=
            "attack";

        combat.cooldown =
            Number(
                combat.cooldown ?? 0
            );

        combat.enduranceCost =
            Number(
                combat.enduranceCost ?? 0
            );

        combat.duration =
            Number(
                combat.duration ?? 0
            );

        combat.aiScore =
            Number(
                combat.aiScore ?? 0
            );

        combat.priority =
            Number(
                combat.priority ?? 0
            );

        combat.effects ??=
            [];

        combat.tags ??=
            [];

        combat.requirements ??=
        {

            level:1,

            classes:[],

            weapons:[],

            skills:{}

        };

        combat.target ??=
        {

            type:"single",

            range:1

        };

    }

    // ========================================================
    // IDENTIFICATION
    // ========================================================

    getActionId()
    {

        return this.system.combat?.id
            ??
            this.id;

    }

    getHandler()
    {

        return this.system.combat
            ?.handler
            ??
            null;

    }

    // ========================================================
    // CATEGORY
    // ========================================================

    getCategory()
    {

        return this.system.combat
            ?.category
            ??
            "general";

    }

    getActionType()
    {

        return this.system.combat
            ?.type
            ??
            "attack";

    }

    // ========================================================
    // FLAGS
    // ========================================================

    isDiscipline()
    {

        return Boolean(

            this.system.combat
            ?.discipline

        );

    }

    isInstant()
    {

        return Boolean(

            this.system.combat
            ?.instant

        );

    }

    // ========================================================
    // RESOURCE DATA
    // ========================================================

    getCooldown()
    {

        return Number(

            this.system.combat
            ?.cooldown
            ??
            0

        );

    }

    getEnduranceCost()
    {

        return Number(

            this.system.combat
            ?.enduranceCost
            ??
            0

        );

    }

    // ========================================================
    // REQUIREMENTS
    // ========================================================

    getRequirements()
    {

        return this.system.combat
            ?.requirements
            ??
            {};

    }

    getRequiredLevel()
    {

        return Number(

            this.getRequirements()
            ?.level
            ??
            1

        );

    }

    getRequiredClasses()
    {

        return this.getRequirements()
            ?.classes
            ??
            [];

    }

    getRequiredWeapons()
    {

        return this.getRequirements()
            ?.weapons
            ??
            [];

    }

    getRequiredSkills()
    {

        return this.getRequirements()
            ?.skills
            ??
            {};

    }

    // ========================================================
    // USE VALIDATION
    // ========================================================

    canUse(actor)
    {

        if(
            !actor
        )
            return false;

        const level =
            actor.system?.level
            ??
            actor.getLevel?.()
            ??
            1;

        if(
            level <
            this.getRequiredLevel()
        )
        {

            return false;

        }

        const requiredClasses =
            this.getRequiredClasses();

        if(
            requiredClasses.length
        )
        {

            const profession =
                actor.getProfession?.()
                ??
                actor.system?.class;

            if(
                !requiredClasses.includes(
                    profession
                )
            )
            {

                return false;

            }

        }

        return true;

    }

    // ========================================================
    // TARGETING
    // ========================================================

    getTargetData()
    {

        return this.system.combat
            ?.target
            ??
            {};

    }

    getTargetType()
    {

        return this.getTargetData()
            ?.type
            ??
            "single";

    }

    getRange()
    {

        return Number(

            this.getTargetData()
            ?.range
            ??
            1

        );

    }

    // ========================================================
    // STANCE SUPPORT
    // ========================================================

    getRequiredStance()
    {

        return this.system.combat
            ?.stance
            ??
            null;

    }

    requiresStance()
    {

        return Boolean(
            this.getRequiredStance()
        );

    }

    // ========================================================
    // EFFECTS
    // ========================================================

    getEffects()
    {

        return this.system.combat
            ?.effects
            ??
            [];

    }

    addEffect(effect)
    {

        this.system.combat.effects ??=
            [];

        this.system.combat.effects.push(
            effect
        );

    }

    // ========================================================
    // TAGS
    // ========================================================

    getTags()
    {

        return this.system.combat
            ?.tags
            ??
            [];

    }

    hasTag(tag)
    {

        return this.getTags()
            .includes(
                tag
            );

    }

    // ========================================================
    // VALIDATION
    // ========================================================

    validate(system={})
    {

        const errors =
            super.validate(system);

        const combat =
            system.combat
            ??
            {};

        if(
            !combat.handler
        )
        {

            errors.push(
                "Combat action missing handler"
            );

        }

        if(
            Number(
                combat.cooldown ?? 0
            )
            <
            0
        )
        {

            errors.push(
                "Cooldown cannot be negative"
            );

        }

        if(
            Number(
                combat.enduranceCost ?? 0
            )
            <
            0
        )
        {

            errors.push(
                "Endurance cost cannot be negative"
            );

        }

        if(
            !Array.isArray(
                combat.effects
            )
        )
        {

            errors.push(
                "Combat effects must be an array"
            );

        }

        return errors;

    }

}