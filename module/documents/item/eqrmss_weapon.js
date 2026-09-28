// ============================================================
// EQRMSS Weapon Item
//
// EverQuest - Rolemaster Standard System
//
// Weapon specialization.
//
// Supports:
//  - Melee weapons
//  - Ranged weapons
//  - Two-handed weapons
//  - Shields-as-weapons
//  - Bard/Ranger weapon skills
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSWeapon extends EQRMSSItem
{

    // ========================================================
    // DATA PREPARATION
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureWeaponData();

        this._prepareDamage();

        this._prepareRequirements();

        this._prepareCombatData();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureWeaponData()
    {

        this.system.weapon ??=
        {

            category:"one_hand",

            skill:null,

            group:"blade",

            damage:

            {

                base:1,

                bonus:0,

                type:"slash"

            },

            speed:5,

            reach:1,

            hands:1,

            range:

            {

                min:0,

                max:0

            },

            weightClass:"medium",

            quality:"normal",

            magical:false,

            enchantmentBonus:0,

            critical:

            {

                table:"normal",

                severity:0

            },

            fumble:

            {

                table:"weapon",

                severity:0

            }

        };

    }

    // ========================================================
    // DAMAGE
    // ========================================================

    _prepareDamage()
    {

        const damage =
            this.system.weapon.damage;

        this.system.weapon.damage.total =

            Number(
                damage.base
            )
            +
            Number(
                damage.bonus
            );

    }

    getDamage()
    {

        return (
            this.system.weapon.damage.total
            ??
            0
        );

    }

    getDamageType()
    {

        return (

            this.system.weapon.damage.type
            ??
            "physical"

        );

    }

    // ========================================================
    // WEAPON SKILL
    // ========================================================

    getSkill()
    {

        return (

            this.system.weapon.skill
            ??
            null

        );

    }

    setSkill(
        skill
    )
    {

        this.system.weapon.skill =
            skill;

    }

    // ========================================================
    // HANDLING
    // ========================================================

    getHands()
    {

        return (

            this.system.weapon.hands
            ??
            1

        );

    }

    isTwoHanded()
    {

        return (

            this.getHands()
            >=
            2

        );

    }

    isOneHanded()
    {

        return (

            this.getHands()
            ===
            1

        );

    }

    // ========================================================
    // SPEED / REACH
    // ========================================================

    getSpeed()
    {

        return (

            this.system.weapon.speed
            ??
            5

        );

    }

    getReach()
    {

        return (

            this.system.weapon.reach
            ??
            1

        );

    }

    // ========================================================
    // RANGE
    // ========================================================

    isRanged()
    {

        return (

            this.system.weapon.range.max
            >
            0

        );

    }

    getRange()
    {

        return {

            min:
                this.system.weapon.range.min,

            max:
                this.system.weapon.range.max

        };

    }

    // ========================================================
    // MAGIC / ENCHANTMENT
    // ========================================================

    getEnchantmentBonus()
    {

        return (

            this.system.weapon.enchantmentBonus
            ??
            0

        );

    }

    isMagical()
    {

        return (

            this.system.weapon.magical
            ===
            true

        );

    }

    // ========================================================
    // CRITICAL SYSTEM
    // ========================================================

    getCriticalProfile()
    {

        return (

            this.system.weapon.critical
            ??
            {}

        );

    }

    getCriticalSeverity()
    {

        return (

            this.system.weapon.critical.severity
            ??
            0

        );

    }

    // ========================================================
    // FUMBLE SYSTEM
    // ========================================================

    getFumbleProfile()
    {

        return (

            this.system.weapon.fumble
            ??
            {}

        );

    }

    // ========================================================
    // COMBAT HELPERS
    // ========================================================

    getAttackData()
    {

        return {

            weaponId:
                this.id,

            name:
                this.name,

            skill:
                this.getSkill(),

            damage:
                this.getDamage(),

            damageType:
                this.getDamageType(),

            speed:
                this.getSpeed(),

            reach:
                this.getReach(),

            critical:
                this.getCriticalProfile()

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

        if(
            this.isTwoHanded()
        )
        {

            // Future:
            // check shield/offhand conflicts

        }

        return true;

    }

    // ========================================================
    // WEAPON TYPE HELPERS
    // ========================================================

    isBlade()
    {

        return (

            this.system.weapon.group
            ===
            "blade"

        );

    }

    isBlunt()
    {

        return (

            this.system.weapon.group
            ===
            "blunt"

        );

    }

    isPolearm()
    {

        return (

            this.system.weapon.group
            ===
            "polearm"

        );

    }

    isBow()
    {

        return (

            this.system.weapon.group
            ===
            "bow"

        );

    }

}