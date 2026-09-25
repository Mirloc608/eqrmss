// ============================================================
// EQRMSS Equipment Repair
//
// EverQuest - Rolemaster Standard System
//
// Durability and repair system.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EquipmentQuality

}
from "./equipment-quality.js";

export class EquipmentRepair
{

    // ========================================================
    // DEFAULT SETTINGS
    // ========================================================

    static SETTINGS =
    {

        baseRepairCost:

            5,

        durabilityPerRepair:

            10,

        brokenThreshold:

            0

    };

    // ========================================================
    // GET DURABILITY
    // ========================================================

    static getDurability(item)
    {

        return {

            current:

                item.system?.durability?.current
                ??
                100,

            max:

                item.system?.durability?.max
                ??
                100

        };

    }

    // ========================================================
    // DAMAGE ITEM
    // ========================================================

    static async damage(
        item,
        amount
    )
    {

        const durability =
            this.getDurability(item);

        let current =

            durability.current
            -
            Number(amount);

        if(
            current < 0
        )
        {

            current = 0;

        }

        await item.update(

            {

                "system.durability.current":
                    current,

                "system.broken":
                    current <=
                    this.SETTINGS.brokenThreshold

            }

        );

        Hooks.callAll(

            "eqrmssEquipmentDamaged",

            item,
            amount

        );

        return current;

    }

    // ========================================================
    // REPAIR ITEM
    // ========================================================

    static async repair(
        item,
        amount=null
    )
    {

        const durability =
            this.getDurability(item);

        const quality =
            EquipmentQuality.get(item);

        const repairAmount =

            amount
            ??
            this.SETTINGS
                .durabilityPerRepair;

        let current =

            durability.current
            +
            repairAmount;

        if(
            current >
            durability.max
        )
        {

            current =
                durability.max;

        }

        await item.update(

            {

                "system.durability.current":
                    current,

                "system.broken":
                    false

            }

        );

        Hooks.callAll(

            "eqrmssEquipmentRepaired",

            item,
            repairAmount

        );

        return {

            repaired:

                repairAmount,

            current,

            quality:

                quality.label

        };

    }

    // ========================================================
    // REPAIR COST
    // ========================================================

    static getRepairCost(item)
    {

        const durability =
            this.getDurability(item);

        const quality =
            EquipmentQuality.get(item);

        const missing =

            durability.max
            -
            durability.current;

        const baseValue =

            item.system?.value
            ??
            0;

        const cost =

            Math.ceil(

                (

                    this.SETTINGS
                        .baseRepairCost

                    +

                    (
                        baseValue *
                        0.05
                    )

                )

                *

                (

                    missing /
                    durability.max

                )

                *

                quality.value

            );

        return Math.max(
            cost,
            1
        );

    }

    // ========================================================
    // CAN REPAIR
    // ========================================================

    static canRepair(
        item
    )
    {

        const durability =
            this.getDurability(item);

        return (

            durability.current
            <
            durability.max

        );

    }

    // ========================================================
    // FULL REPAIR
    // ========================================================

    static async restore(
        item
    )
    {

        const durability =
            this.getDurability(item);

        await item.update(

            {

                "system.durability.current":
                    durability.max,

                "system.broken":
                    false

            }

        );

        Hooks.callAll(

            "eqrmssEquipmentFullyRepaired",

            item

        );

        return true;

    }

    // ========================================================
    // CONDITION PERCENT
    // ========================================================

    static getCondition(
        item
    )
    {

        const durability =
            this.getDurability(item);

        if(
            durability.max <= 0
        )
        {

            return 0;

        }

        return Math.floor(

            (

                durability.current /
                durability.max

            )
            *
            100

        );

    }

    // ========================================================
    // CONDITION LABEL
    // ========================================================

    static getConditionLabel(
        item
    )
    {

        const value =
            this.getCondition(item);

        if(
            value <= 0
        )
        {
            return "Broken";
        }

        if(
            value < 25
        )
        {
            return "Ruined";
        }

        if(
            value < 50
        )
        {
            return "Damaged";
        }

        if(
            value < 75
        )
        {
            return "Worn";
        }

        if(
            value < 100
        )
        {
            return "Good";
        }

        return "Perfect";

    }

    // ========================================================
    // DURABILITY MODIFIER
    //
    // Used by EquipmentStateEngine
    //
    // ========================================================

    static getEffectiveness(
        item
    )
    {

        const condition =
            this.getCondition(item);

        if(
            condition <= 0
        )
        {
            return 0;
        }

        return condition / 100;

    }

    // ========================================================
    // REPAIR SUMMARY
    // ========================================================

    static summary(
        item
    )
    {

        return {

            condition:

                this.getCondition(item),

            label:

                this.getConditionLabel(item),

            cost:

                this.getRepairCost(item),

            canRepair:

                this.canRepair(item)

        };

    }

}