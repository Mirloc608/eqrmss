// ============================================================
// EQRMSS Equipment Manager
//
// EverQuest - Rolemaster Standard System
//
// Equipment lifecycle controller.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EquipmentValidator

}
from "./equipment-validator.js";

import {

    calculateItemWeight

}
from "./equipment-utils.js";

import {

    EquipmentRepair

}
from "./equipment-repair.js";

export class EquipmentManager
{

    static initialized = false;

    static async initialize()
    {

        if(this.initialized)
        {
            return;
        }

        this.initialized = true;

        console.log(
            "EQRMSS | Equipment Manager initialized"
        );

    }

    static getEquippedItems(actor)
    {

        return actor.items.filter(

            item =>
                item.system?.equipped === true

        );

    }

    static async equip(actor,item)
    {

        const validation =
            EquipmentValidator.validateEquip(
                actor,
                item
            );

        if(!validation.valid)
        {

            ui.notifications.warn(

                validation.reason ??
                "Cannot equip item"

            );

            return false;

        }

        await this.unequipConflictingItems(
            actor,
            item
        );

        await item.update({

            "system.equipped":true

        });

        Hooks.callAll(

            "eqrmssEquipmentEquipped",
            actor,
            item

        );

        return true;

    }

    static async unequip(actor,item)
    {

        await item.update({

            "system.equipped":false

        });

        Hooks.callAll(

            "eqrmssEquipmentUnequipped",
            actor,
            item

        );

        return true;

    }

    static async unequipConflictingItems(actor,item)
    {

        const slot =
            item.system?.slot;

        if(!slot)
        {
            return;
        }

        for(const existing of this.getEquippedItems(actor))
        {

            if(existing.id === item.id)
            {
                continue;
            }

            if(existing.system?.slot === slot)
            {

                await existing.update({

                    "system.equipped":false

                });

            }

        }

    }

    static getEquipmentWeight(actor)
    {

        let weight = 0;

        for(const item of actor.items)
        {

            weight += calculateItemWeight(item);

        }

        return weight;

    }

    static async repair(item,amount)
    {

        return EquipmentRepair.repair(
            item,
            amount
        );

    }

}