// ============================================================
// EQRMSS Jewelry Item
//
// EverQuest - Rolemaster Standard System
//
// Jewelry specialization.
//
// Supports:
//  - Rings
//  - Earrings
//  - Neck items
//  - Charms
//  - Stat bonuses
//  - Resistances
//  - HP/Mana modifiers
//  - Regeneration
//  - Skill modifiers
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSJewelry extends EQRMSSItem
{

    // ========================================================
    // DATA PREPARATION
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureJewelryData();

        this._prepareBonuses();

        this._prepareEffects();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureJewelryData()
    {

        this.system.jewelry ??=
        {

            slot:"ring",

            wearableSlots:
            [
                "ring_left",
                "ring_right"
            ],

            material:"metal",

            bonuses:
            {

                stats:{},

                hp:0,

                mana:0,

                stamina:0,

                hpRegen:0,

                manaRegen:0

            },

            resistances:{},

            skillBonuses:{},

            spellBonuses:{},

            effects:[]

        };

    }

    // ========================================================
    // SLOT HANDLING
    // ========================================================

    getSlot()
    {

        return (

            this.system.jewelry.slot
            ??
            "ring"

        );

    }

    getWearableSlots()
    {

        return (

            this.system.jewelry.wearableSlots
            ??
            []

        );

    }

    fitsSlot(
        slot
    )
    {

        return this.getWearableSlots()
            .includes(
                slot
            );

    }

    // ========================================================
    // STAT BONUSES
    // ========================================================

    _prepareBonuses()
    {

        this.system.jewelry.bonuses ??=
        {

            stats:{},

            hp:0,

            mana:0,

            stamina:0

        };

    }

    getStatBonus(
        stat
    )
    {

        return (

            this.system.jewelry
                .bonuses
                .stats
                ?.[stat]
            ??
            0

        );

    }

    getStatBonuses()
    {

        return (

            this.system.jewelry
                .bonuses
                .stats
            ??
            {}

        );

    }

    addStatBonus(
        stat,
        value
    )
    {

        this.system.jewelry.bonuses.stats ??=
        {};

        this.system.jewelry
            .bonuses
            .stats[stat] =
            value;

    }

    // ========================================================
    // RESOURCE BONUSES
    // ========================================================

    getHPBonus()
    {

        return (

            this.system.jewelry
                .bonuses
                .hp
            ??
            0

        );

    }

    getManaBonus()
    {

        return (

            this.system.jewelry
                .bonuses
                .mana
            ??
            0

        );

    }

    getStaminaBonus()
    {

        return (

            this.system.jewelry
                .bonuses
                .stamina
            ??
            0

        );

    }

    getHPRegen()
    {

        return (

            this.system.jewelry
                .bonuses
                .hpRegen
            ??
            0

        );

    }

    getManaRegen()
    {

        return (

            this.system.jewelry
                .bonuses
                .manaRegen
            ??
            0

        );

    }

    // ========================================================
    // RESISTANCES
    // ========================================================

    getResistance(
        type
    )
    {

        return (

            this.system.jewelry
                .resistances
                ?.[type]
            ??
            0

        );

    }

    getResistances()
    {

        return (

            this.system.jewelry
                .resistances
            ??
            {}

        );

    }

    addResistance(
        type,
        value
    )
    {

        this.system.jewelry
            .resistances ??=
            {};

        this.system.jewelry
            .resistances[type] =
            value;

    }

    // ========================================================
    // SKILL MODIFIERS
    // ========================================================

    getSkillBonus(
        skill
    )
    {

        return (

            this.system.jewelry
                .skillBonuses
                ?.[skill]
            ??
            0

        );

    }

    getSkillBonuses()
    {

        return (

            this.system.jewelry
                .skillBonuses
            ??
            {}

        );

    }

    // ========================================================
    // SPELL MODIFIERS
    // ========================================================

    getSpellBonus(
        spell
    )
    {

        return (

            this.system.jewelry
                .spellBonuses
                ?.[spell]
            ??
            0

        );

    }

    // ========================================================
    // EFFECTS
    // ========================================================

    _prepareEffects()
    {

        this.system.jewelry.effects ??=
            [];

    }

    addJewelryEffect(
        effect
    )
    {

        this.system.jewelry.effects.push(
            effect
        );

    }

    getJewelryEffects()
    {

        return (

            this.system.jewelry.effects
            ??
            []

        );

    }

    // ========================================================
    // EQUIPMENT AGGREGATION
    // ========================================================

    getEquipmentModifiers()
    {

        return {

            stats:
                this.getStatBonuses(),

            hp:
                this.getHPBonus(),

            mana:
                this.getManaBonus(),

            stamina:
                this.getStaminaBonus(),

            hpRegen:
                this.getHPRegen(),

            manaRegen:
                this.getManaRegen(),

            resistances:
                this.getResistances(),

            skills:
                this.getSkillBonuses()

        };

    }

    // ========================================================
    // DISPLAY
    // ========================================================

    getJewelrySummary()
    {

        return {

            id:
                this.id,

            name:
                this.name,

            slot:
                this.getSlot(),

            bonuses:
                this.getEquipmentModifiers()

        };

    }

    // ========================================================
    // VALIDATION
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