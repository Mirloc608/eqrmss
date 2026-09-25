// ============================================================
// EQRMSS Equipment Validator
//
// EverQuest - Rolemaster Standard System
//
// Equipment eligibility and restriction resolver.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {
    EQUIPMENT_SLOT_LIMITS
}
from "./equipment-slots.js";

export class EquipmentValidator
{

    // ========================================================
    // MASTER VALIDATION
    // ========================================================

    static validateEquip(
        actor,
        item
    )
    {

        const checks =

        [

            this.validateSlot(actor,item),

            this.validateSlotLimit(actor,item),

            this.validateBroken(item),

            this.validateLevel(actor,item),

            this.validateRace(actor,item),

            this.validateClass(actor,item),

            this.validateSkill(actor,item),

            this.validateWeapon(actor,item),

            this.validateArmor(actor,item),

            this.validateShield(actor,item),

            this.validateWeight(actor,item),

            this.validateLore(actor,item)

        ];

        for(
            const check of checks
        )
        {

            if(
                !check.valid
            )
            {

                return check;

            }

        }

        return {

            valid:true,

            reason:null

        };

    }

    // ========================================================
    // SLOT NORMALIZATION
    // ========================================================

    static normalizeSlot(slot)
    {

        const aliases =
        {

            primary:
                "mainhand",

            secondary:
                "offhand"

        };

        return aliases[slot] ?? slot;

    }

    // ========================================================
    // SLOT VALIDATION
    // ========================================================

    static validateSlot(
        actor,
        item
    )
    {

        const slot =
            this.normalizeSlot(
                item.system?.slot
            );

        if(!slot)
        {

            return {

                valid:true

            };

        }

        if(
            !EQUIPMENT_SLOT_LIMITS
            ||
            EQUIPMENT_SLOT_LIMITS[slot] === undefined
        )
        {

            return {

                valid:false,

                reason:
                    `${item.name} uses invalid equipment slot ${slot}.`

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // SLOT LIMITS
    // ========================================================

    static validateSlotLimit(
        actor,
        item
    )
    {

        const slot =
            this.normalizeSlot(
                item.system?.slot
            );

        if(!slot)
        {

            return {

                valid:true

            };

        }

        const limit =

            EQUIPMENT_SLOT_LIMITS[slot]
            ??
            1;

        const equipped =

            actor.items.filter(

                i =>

                    i.system?.equipped === true

                    &&

                    this.normalizeSlot(
                        i.system?.slot
                    )
                    ===
                    slot

                    &&

                    i.id !== item.id

            );

        if(
            equipped.length >= limit
        )
        {

            return {

                valid:false,

                reason:

                    `${item.name} cannot be equipped. ${slot} is already occupied.`

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // BROKEN ITEMS
    // ========================================================

    static validateBroken(item)
    {

        if(
            item.system?.broken === true
        )
        {

            return {

                valid:false,

                reason:
                    `${item.name} is broken.`

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // LEVEL REQUIREMENT
    // ========================================================

    static validateLevel(
        actor,
        item
    )
    {

        const required =

            Number(
                item.system?.requirements?.level
                ??
                0
            );

        const level =

            Number(
                actor.system?.level
                ??
                actor.system?.details?.level
                ??
                1
            );

        if(
            level < required
        )
        {

            return {

                valid:false,

                reason:

                    `${item.name} requires level ${required}.`

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // RACE RESTRICTIONS
    // ========================================================

    static validateRace(
        actor,
        item
    )
    {

        const allowed =

            item.system?.requirements?.races;

        if(
            !Array.isArray(allowed)
            ||
            allowed.length === 0
        )
        {

            return {

                valid:true

            };

        }

        const race =

            actor.system?.race
            ??
            actor.system?.details?.race;

        if(
            !allowed.includes(race)
        )
        {

            return {

                valid:false,

                reason:

                    `${race} cannot use ${item.name}.`

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // CLASS RESTRICTIONS
    // ========================================================

    static validateClass(
        actor,
        item
    )
    {

        const allowed =

            item.system?.requirements?.classes;

        if(
            !Array.isArray(allowed)
            ||
            allowed.length === 0
        )
        {

            return {

                valid:true

            };

        }

        const actorClass =

            actor.system?.class
            ??
            actor.system?.details?.class;

        if(
            !allowed.includes(actorClass)
        )
        {

            return {

                valid:false,

                reason:

                    `${actorClass} cannot use ${item.name}.`

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // SKILL REQUIREMENTS
    // ========================================================

    static validateSkill(
        actor,
        item
    )
    {

        const requirements =

            item.system?.requirements?.skills
            ??
            {};

        for(
            const [
                skill,
                required
            ]
            of Object.entries(
                requirements
            )
        )
        {

            const ranks =

                actor.system?.skills
                    ?. [skill]
                    ?.ranks
                ??
                0;

            if(
                ranks < required
            )
            {

                return {

                    valid:false,

                    reason:

                        `${item.name} requires ${skill} ${required}.`

                };

            }

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // WEAPON PROFICIENCY
    // ========================================================

    static validateWeapon(
        actor,
        item
    )
    {

        if(
            item.type !== "weapon"
        )
        {

            return {

                valid:true

            };

        }

        if(
            item.system?.twoHanded === true
        )
        {

            const offhand =

                actor.items.find(

                    i =>

                    i.system?.equipped === true

                    &&

                    [
                        "offhand",
                        "secondary"
                    ]
                    .includes(
                        i.system?.slot
                    )

                );

            if(offhand)
            {

                return {

                    valid:false,

                    reason:

                        `${item.name} requires both hands.`

                };

            }

        }

        const category =

            item.system?.weaponCategory;

        if(
            !category
        )
        {

            return {

                valid:true

            };

        }

        const skill =

            actor.system?.skills
                ?. [category];

        if(
            !skill
        )
        {

            return {

                valid:false,

                reason:

                    `No proficiency with ${category}.`

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // ARMOR RESTRICTIONS
    // ========================================================

    static validateArmor(
        actor,
        item
    )
    {

        if(
            item.type !== "armor"
        )
        {

            return {

                valid:true

            };

        }

        const maxArmor =

            actor.system?.classData
                ?.maxArmor
            ??
            null;

        if(
            maxArmor === null
        )
        {

            return {

                valid:true

            };

        }

        const armorType =

            item.system?.armorType;

        if(
            armorType > maxArmor
        )
        {

            return {

                valid:false,

                reason:

                    `${actor.name} cannot wear this armor type.`

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // SHIELD RESTRICTIONS
    // ========================================================

    static validateShield(
        actor,
        item
    )
    {

        if(
            item.type !== "shield"
        )
        {

            return {

                valid:true

            };

        }

        if(
            actor.system?.classData
                ?.canUseShield === false
        )
        {

            return {

                valid:false,

                reason:

                    `${actor.name} cannot use shields.`

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // WEIGHT
    // ========================================================

    static validateWeight(
        actor,
        item
    )
    {

        const max =

            actor.system?.derived
                ?.carryCapacity
            ??
            null;

        if(
            max === null
        )
        {

            return {

                valid:true

            };

        }

        const current =

            actor.system?.derived
                ?.equipmentWeight
            ??
            0;

        const weight =

            Number(
                item.system?.weight
                ??
                0
            );

        if(
            current + weight > max
        )
        {

            return {

                valid:false,

                reason:

                    "Too heavy to carry."

            };

        }

        return {

            valid:true

        };

    }

    // ========================================================
    // LORE / ATTUNEMENT
    // ========================================================

    static validateLore(
        actor,
        item
    )
    {

        const lore =

            item.system?.lore;

        if(
            !lore
        )
        {

            return {

                valid:true

            };

        }

        if(
            lore.owner
            &&
            lore.owner !== actor.id
        )
        {

            return {

                valid:false,

                reason:

                    `${item.name} is attuned to another owner.`

            };

        }

        return {

            valid:true

        };

    }

}