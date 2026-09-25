// ============================================================
// EQRMSS Spell Item
//
// EverQuest - Rolemaster Standard System
//
// Spell definition document.
//
// Supports:
//  - Spell realms
//  - Spell schools
//  - Mana cost
//  - Casting skill
//  - Resist checks
//  - Duration
//  - Targets
//  - Effects
//  - Class restrictions
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSSpell extends EQRMSSItem
{

    // ========================================================
    // DATA PREPARATION
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureSpellData();

        this._prepareCasting();

        this._prepareEffects();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureSpellData()
    {

        this.system.spell ??=
        {

            level:1,

            realm:"arcane",

            school:"evocation",

            type:"spell",

            manaCost:10,

            castingTime:1,

            range:0,

            target:"single",

            duration:

            {

                value:0,

                unit:"rounds"

            },

            resist:

            {

                enabled:false,

                type:"none",

                modifier:0

            },

            components:

            {

                verbal:true,

                somatic:true,

                material:false

            },

            castingSkill:"spell_casting",

            classes:
            [],

            effects:
            []

        };

    }

    // ========================================================
    // BASIC DATA
    // ========================================================

    getLevel()
    {

        return (

            this.system.spell.level
            ??
            1

        );

    }

    getRealm()
    {

        return (

            this.system.spell.realm
            ??
            "arcane"

        );

    }

    getSchool()
    {

        return (

            this.system.spell.school
            ??
            "general"

        );

    }

    getSpellType()
    {

        return (

            this.system.spell.type
            ??
            "spell"

        );

    }

    // ========================================================
    // COST
    // ========================================================

    getManaCost()
    {

        return (

            this.system.spell.manaCost
            ??
            0

        );

    }

    setManaCost(
        value
    )
    {

        this.system.spell.manaCost =
            value;

    }

    // ========================================================
    // CASTING
    // ========================================================

    _prepareCasting()
    {

        this.system.spell.castingSkill ??=
            "spell_casting";

    }

    getCastingSkill()
    {

        return (

            this.system.spell.castingSkill
            ??
            "spell_casting"

        );

    }

    getCastingTime()
    {

        return (

            this.system.spell.castingTime
            ??
            1

        );

    }

    // ========================================================
    // TARGETING
    // ========================================================

    getTargetType()
    {

        return (

            this.system.spell.target
            ??
            "single"

        );

    }

    getRange()
    {

        return (

            this.system.spell.range
            ??
            0

        );

    }

    // ========================================================
    // DURATION
    // ========================================================

    getDuration()
    {

        return (

            this.system.spell.duration
            ??
            {}

        );

    }

    isInstant()
    {

        return (

            this.system.spell.duration.value
            ===
            0

        );

    }

    // ========================================================
    // RESIST SYSTEM
    // ========================================================

    usesResistance()
    {

        return (

            this.system.spell
                .resist
                .enabled
            ===
            true

        );

    }

    getResistanceType()
    {

        return (

            this.system.spell
                .resist
                .type
            ??
            "none"

        );

    }

    getResistanceModifier()
    {

        return (

            this.system.spell
                .resist
                .modifier
            ??
            0

        );

    }

    // ========================================================
    // CLASS RESTRICTIONS
    // ========================================================

    getClasses()
    {

        return (

            this.system.spell.classes
            ??
            []

        );

    }

    canCastByClass(
        className
    )
    {

        if(
            !this.getClasses().length
        )
        {
            return true;
        }

        return this.getClasses()
            .includes(
                className
            );

    }

    // ========================================================
    // EFFECTS
    // ========================================================

    _prepareEffects()
    {

        this.system.spell.effects ??=
            [];

    }

    getEffects()
    {

        return (

            this.system.spell.effects
            ??
            []

        );

    }

    addEffect(
        effect
    )
    {

        this.system.spell.effects.push(
            effect
        );

    }

    // ========================================================
    // CAST VALIDATION
    // ========================================================

    canCast(
        actor
    )
    {

        if(
            !actor
        )
        {
            return false;
        }

        if(
            actor.system.level
            <
            this.getLevel()
        )
        {
            return false;
        }

        return true;

    }

    // ========================================================
    // CAST DATA PACKAGE
    // ========================================================

    getCastData()
    {

        return {

            spellId:
                this.id,

            name:
                this.name,

            level:
                this.getLevel(),

            realm:
                this.getRealm(),

            school:
                this.getSchool(),

            mana:
                this.getManaCost(),

            castingSkill:
                this.getCastingSkill(),

            target:
                this.getTargetType(),

            range:
                this.getRange(),

            duration:
                this.getDuration(),

            resist:
                this.system.spell.resist,

            effects:
                this.getEffects()

        };

    }

    // ========================================================
    // SUMMARY
    // ========================================================

    getSpellSummary()
    {

        return {

            id:
                this.id,

            name:
                this.name,

            level:
                this.getLevel(),

            realm:
                this.getRealm(),

            school:
                this.getSchool(),

            mana:
                this.getManaCost()

        };

    }

}