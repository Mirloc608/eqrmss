// ============================================================
// EQRMSS Armor Item
//
// EverQuest - Rolemaster Standard System
//
// Armor specialization.
//
// Supports:
//  - Armor Types
//  - Defensive Bonus
//  - Encumbrance
//  - Maneuver penalties
//  - Spell penalties
//  - Resistances
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSArmor extends EQRMSSItem
{

    // ========================================================
    // DATA PREPARATION
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureArmorData();

        this._prepareArmorValue();

        this._preparePenalties();

        this._prepareEncumbrance();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureArmorData()
    {

        this.system.armor ??=
        {

            category:"body",

            armorType:"cloth",

            armorClass:1,

            defensiveBonus:0,

            weight:0,

            mobilityPenalty:0,

            maneuverPenalty:0,

            spellFailure:0,

            quicknessPenalty:0,

            encumbrance:"light",

            coverage:

            [

                "body"

            ],

            resistances:{}

        };

    }

    // ========================================================
    // ARMOR TYPE
    // ========================================================

    getArmorType()
    {

        return (

            this.system.armor.armorType
            ??
            "cloth"

        );

    }

    setArmorType(
        type
    )
    {

        this.system.armor.armorType =
            type;

    }

    getArmorClass()
    {

        return (

            this.system.armor.armorClass
            ??
            0

        );

    }

    getDefensiveBonus()
    {

        return (

            this.system.armor.defensiveBonus
            ??
            0

        );

    }

    // ========================================================
    // ROLEMASTER DEFENSE
    // ========================================================

    getDB()
    {

        return this.getDefensiveBonus();

    }

    getAT()
    {

        return this.getArmorClass();

    }

    // ========================================================
    // PENALTIES
    // ========================================================

    _preparePenalties()
    {

        this.system.armor.mobilityPenalty ??=
            0;

        this.system.armor.maneuverPenalty ??=
            0;

        this.system.armor.spellFailure ??=
            0;

        this.system.armor.quicknessPenalty ??=
            0;

    }

    getMobilityPenalty()
    {

        return (

            this.system.armor.mobilityPenalty
            ??
            0

        );

    }

    getManeuverPenalty()
    {

        return (

            this.system.armor.maneuverPenalty
            ??
            0

        );

    }

    getQuicknessPenalty()
    {

        return (

            this.system.armor.quicknessPenalty
            ??
            0

        );

    }

    getSpellFailure()
    {

        return (

            this.system.armor.spellFailure
            ??
            0

        );

    }

    // ========================================================
    // ENCUMBRANCE
    // ========================================================

    _prepareEncumbrance()
    {

        this.system.armor.encumbrance ??=
            "light";

    }

    getEncumbrance()
    {

        return (

            this.system.armor.encumbrance
            ??
            "light"

        );

    }

    getWeight()
    {

        return (

            this.system.armor.weight
            ??
            super.getWeight()

        );

    }

    // ========================================================
    // COVERAGE
    // ========================================================

    coversSlot(
        slot
    )
    {

        return (

            this.system.armor.coverage
            ??
            []
        )
        .includes(
            slot
        );

    }

    getCoverage()
    {

        return (

            this.system.armor.coverage
            ??
            []

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

            this.system.armor.resistances
                ?.[
                    type
                ]
            ??
            0

        );

    }

    addResistance(
        type,
        value
    )
    {

        this.system.armor.resistances ??=
        {};

        this.system.armor.resistances[type] =
            value;

    }

    // ========================================================
    // EQUIPMENT EFFECTS
    // ========================================================

    getDefenseData()
    {

        return {

            armorId:
                this.id,

            name:
                this.name,

            armorType:
                this.getArmorType(),

            AT:
                this.getAT(),

            DB:
                this.getDB(),

            penalties:
            {

                maneuver:
                    this.getManeuverPenalty(),

                quickness:
                    this.getQuicknessPenalty(),

                spell:
                    this.getSpellFailure()

            },

            resistances:
                this.system.armor.resistances

        };

    }

    // ========================================================
    // ARMOR CATEGORY HELPERS
    // ========================================================

    isCloth()
    {

        return this.getArmorType()
            ===
            "cloth";

    }

    isLeather()
    {

        return this.getArmorType()
            ===
            "leather";

    }

    isChain()
    {

        return this.getArmorType()
            ===
            "chain";

    }

    isPlate()
    {

        return this.getArmorType()
            ===
            "plate";

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