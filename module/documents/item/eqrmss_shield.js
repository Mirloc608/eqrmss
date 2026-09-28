// ============================================================
// EQRMSS Shield Item
//
// EverQuest - Rolemaster Standard System
//
// Shield specialization.
//
// Supports:
//  - Defensive Bonus
//  - Shield skill
//  - Block chance
//  - Shield bash
//  - Off-hand rules
//  - Magical shield effects
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSShield extends EQRMSSItem
{

    // ========================================================
    // DATA PREPARATION
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureShieldData();

        this._prepareDefense();

        this._prepareBash();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureShieldData()
    {

        this.system.shield ??=
        {

            size:"medium",

            skill:"shield",

            defensiveBonus:10,

            blockChance:10,

            weight:5,

            hands:1,

            bash:

            {

                enabled:false,

                damage:1,

                type:"crush"

            },

            enchantmentBonus:0,

            magical:false,

            effects:[]

        };

    }

    // ========================================================
    // DEFENSE
    // ========================================================

    _prepareDefense()
    {

        this.system.shield.defensiveBonus ??=
            0;

        this.system.shield.blockChance ??=
            0;

    }

    getDefensiveBonus()
    {

        return (

            this.system.shield.defensiveBonus
            ??
            0

        );

    }

    getDB()
    {

        return this.getDefensiveBonus();

    }

    getBlockChance()
    {

        return (

            this.system.shield.blockChance
            ??
            0

        );

    }

    // ========================================================
    // SHIELD SKILL
    // ========================================================

    getSkill()
    {

        return (

            this.system.shield.skill
            ??
            "shield"

        );

    }

    setSkill(
        skill
    )
    {

        this.system.shield.skill =
            skill;

    }

    // ========================================================
    // SIZE
    // ========================================================

    getSize()
    {

        return (

            this.system.shield.size
            ??
            "medium"

        );

    }

    isSmall()
    {

        return this.getSize()
            ===
            "small";

    }

    isMedium()
    {

        return this.getSize()
            ===
            "medium";

    }

    isLarge()
    {

        return this.getSize()
            ===
            "large";

    }

    // ========================================================
    // BASH
    // ========================================================

    _prepareBash()
    {

        this.system.shield.bash ??=
        {

            enabled:false,

            damage:1,

            type:"crush"

        };

    }

    canBash()
    {

        return (

            this.system.shield.bash.enabled
            ===
            true

        );

    }

    getBashDamage()
    {

        return (

            this.system.shield.bash.damage
            ??
            0

        );

    }

    getBashType()
    {

        return (

            this.system.shield.bash.type
            ??
            "crush"

        );

    }

    getBashAttackData()
    {

        return {

            name:
                `${this.name} Bash`,

            damage:
                this.getBashDamage(),

            damageType:
                this.getBashType()

        };

    }

    // ========================================================
    // MAGIC
    // ========================================================

    isMagical()
    {

        return (

            this.system.shield.magical
            ===
            true

        );

    }

    getEnchantmentBonus()
    {

        return (

            this.system.shield.enchantmentBonus
            ??
            0

        );

    }

    // ========================================================
    // EFFECTS
    // ========================================================

    addShieldEffect(
        effect
    )
    {

        this.system.shield.effects ??=
            [];

        this.system.shield.effects.push(
            effect
        );

    }

    getShieldEffects()
    {

        return (

            this.system.shield.effects
            ??
            []

        );

    }

    // ========================================================
    // SUMMARY
    // ========================================================

    getDefenseData()
    {

        return {

            shieldId:
                this.id,

            name:
                this.name,

            size:
                this.getSize(),

            DB:
                this.getDB(),

            block:
                this.getBlockChance(),

            skill:
                this.getSkill(),

            enchantment:
                this.getEnchantmentBonus()

        };

    }

    // ========================================================
    // EQUIP VALIDATION
    // ========================================================

    canEquip(
        actor
    )
    {

        if(
            !super.canEquip(actor)
        )
        {
            return false;
        }

        return true;

    }

}