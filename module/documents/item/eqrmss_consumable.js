// ============================================================
// EQRMSS Consumable Item
//
// EverQuest - Rolemaster Standard System
//
// Consumable specialization.
//
// Supports:
//  - Potions
//  - Food
//  - Drink
//  - Scrolls
//  - Wands
//  - Clicky effects
//  - Charges
//  - Duration effects
//  - Poisons
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSConsumable extends EQRMSSItem
{

    // ========================================================
    // PREPARATION
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureConsumableData();

        this._prepareCharges();

        this._prepareEffects();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureConsumableData()
    {

        this.system.consumable ??=
        {

            category:"potion",

            subtype:"healing",

            charges:1,

            maxCharges:1,

            consumeOnUse:true,

            cooldown:0,

            duration:

            {

                value:0,

                unit:"rounds"

            },

            activation:

            {

                type:"use",

                target:"self"

            },

            effects:[],

            requirements:

            {

                skill:null,

                level:0

            }

        };

    }

    // ========================================================
    // CHARGES
    // ========================================================

    _prepareCharges()
    {

        this.system.consumable.charges ??=
            1;

        this.system.consumable.maxCharges ??=
            this.system.consumable.charges;

    }

    getCharges()
    {

        return (

            this.system.consumable.charges
            ??
            0

        );

    }

    getMaxCharges()
    {

        return (

            this.system.consumable.maxCharges
            ??
            0

        );

    }

    hasCharges()
    {

        return (

            this.getCharges()
            >
            0

        );

    }

    consumeCharge()
    {

        if(
            !this.hasCharges()
        )
        {
            return false;
        }

        this.system.consumable.charges--;

        return true;

    }

    // ========================================================
    // EFFECTS
    // ========================================================

    _prepareEffects()
    {

        this.system.consumable.effects ??=
            [];

    }

    getEffects()
    {

        return (

            this.system.consumable.effects
            ??
            []

        );

    }

    addEffect(
        effect
    )
    {

        this.system.consumable.effects.push(
            effect
        );

    }

    // ========================================================
    // ACTIVATION
    // ========================================================

    canUse(
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
            !this.hasCharges()
        )
        {
            return false;
        }

        const req =
            this.system.consumable.requirements;

        if(
            actor.system.level
            <
            req.level
        )
        {
            return false;
        }

        return true;

    }

    async activate(
        actor
    )
    {

        if(
            !this.canUse(actor)
        )
        {
            return false;
        }

        const used =
            this.consumeCharge();

        if(
            !used
        )
        {
            return false;
        }

        Hooks.callAll(

            "eqrmssConsumeItem",

            actor,

            this

        );

        Hooks.callAll(

            "eqrmssApplyItemEffects",

            actor,

            this.getEffects()

        );

        return true;

    }

    // ========================================================
    // ITEM TYPES
    // ========================================================

    isPotion()
    {

        return (

            this.system.consumable.category
            ===
            "potion"

        );

    }

    isFood()
    {

        return (

            this.system.consumable.category
            ===
            "food"

        );

    }

    isDrink()
    {

        return (

            this.system.consumable.category
            ===
            "drink"

        );

    }

    isPoison()
    {

        return (

            this.system.consumable.category
            ===
            "poison"

        );

    }

    isScroll()
    {

        return (

            this.system.consumable.category
            ===
            "scroll"

        );

    }

    isClicky()
    {

        return (

            this.system.consumable.activation.type
            ===
            "click"

        );

    }

    // ========================================================
    // EFFECT SUMMARY
    // ========================================================

    getEffectSummary()
    {

        return {

            name:
                this.name,

            category:
                this.system.consumable.category,

            charges:
                this.getCharges(),

            effects:
                this.getEffects()

        };

    }

    // ========================================================
    // DISPLAY
    // ========================================================

    getConsumableSummary()
    {

        return {

            id:
                this.id,

            name:
                this.name,

            type:
                this.system.consumable.category,

            charges:
                this.getCharges(),

            effects:
                this.getEffects()

        };

    }

    // ========================================================
    // VALIDATION
    // ========================================================

    canEquip()
    {

        // Consumables are carried,
        // not equipped.

        return true;

    }

}