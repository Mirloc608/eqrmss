// ============================================================
// EQRMSS Pet Actor
//
// EverQuest - Rolemaster Standard System
//
// Pet / summon specialization.
//
// Supports:
//  - Combat pets
//  - Utility familiars
//  - Pet scaling
//  - Pet abilities
//  - Pet commands
//  - Pet focus bonuses
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSActor

}
from "./eqrmss_actor.js";

export class EQRMSSPet extends EQRMSSActor
{

    // ========================================================
    // DERIVED DATA
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensurePetData();

        this._preparePetType();

        this._prepareScaling();

        this._prepareCommands();

        this._prepareAbilities();

        this._prepareFocus();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensurePetData()
    {

        this.system.pet ??=
        {

            petType:"combat",

            family:"elemental",

            owner:null,

            ownerLevel:1,

            summonSpell:null,

            duration:0,

            scaling:

            {

                hp:1,

                damage:1,

                defense:1,

                resist:1

            },

            commands:

            [

                "follow",

                "stay",

                "attack",

                "guard",

                "dismiss"

            ],

            abilities:
            [],

            focusEffects:
            [],

            familiarBonus:

            {

                mana:0,

                manaRegen:0,

                resist:0,

                damage:0,

                critChance:0,

                fizzleReduction:0

            }

        };

    }

    // ========================================================
    // PET TYPE
    // ========================================================

    _preparePetType()
    {

        this.system.pet.petType ??=
            "combat";

    }

    getPetType()
    {

        return (

            this.system.pet.petType
            ??
            "combat"

        );

    }

    isCombatPet()
    {

        return (

            this.getPetType()
            ===
            "combat"

        );

    }

    isFamiliar()
    {

        return (

            this.getPetType()
            ===
            "familiar"

        );

    }

    // ========================================================
    // FAMILY
    // ========================================================

    getFamily()
    {

        return (

            this.system.pet.family
            ??
            "unknown"

        );

    }

    setFamily(
        family
    )
    {

        this.system.pet.family =
            family;

    }

    // ========================================================
    // OWNER
    // ========================================================

    getOwner()
    {

        return (

            this.system.pet.owner
            ??
            null

        );

    }

    setOwner(
        actorId
    )
    {

        this.system.pet.owner =
            actorId;

    }

    // ========================================================
    // SCALING
    // ========================================================

    _prepareScaling()
    {

        this.system.pet.scaling ??=
        {

            hp:1,

            damage:1,

            defense:1,

            resist:1

        };

    }

    getScaling()
    {

        return (

            this.system.pet.scaling
            ??
            {}

        );

    }

    scaleFromOwner(
        owner
    )
    {

        if(
            !owner
        )
        {
            return;
        }

        const level =
            owner.getLevel
            ?
            owner.getLevel()
            :
            1;

        this.system.pet.ownerLevel =
            level;

        this.system.derived.hp =
            Math.floor(
                this.system.derived.hp
                *
                this.system.pet.scaling.hp
            );

    }

    // ========================================================
    // PET COMMANDS
    // ========================================================

    _prepareCommands()
    {

        this.system.pet.commands ??=
        [

            "follow",

            "stay",

            "attack",

            "guard",

            "dismiss"

        ];

    }

    getCommands()
    {

        return (

            this.system.pet.commands
            ??
            []

        );

    }

    canCommand(
        command
    )
    {

        return this.getCommands()
            .includes(
                command
            );

    }

    // ========================================================
    // ABILITIES
    // ========================================================

    _prepareAbilities()
    {

        this.system.pet.abilities ??=
            [];

    }

    getPetAbilities()
    {

        return (

            this.system.pet.abilities
            ??
            []

        );

    }

    addAbility(
        ability
    )
    {

        this.system.pet.abilities.push(
            ability
        );

    }

    // ========================================================
    // FAMILIAR SYSTEM
    // ========================================================

    _prepareFocus()
    {

        this.system.pet.familiarBonus ??=
        {

            mana:0,

            manaRegen:0,

            resist:0,

            damage:0,

            critChance:0,

            fizzleReduction:0

        };

    }

    getFamiliarBonus()
    {

        return (

            this.system.pet.familiarBonus
            ??
            {}

        );

    }

    getManaBonus()
    {

        return (

            this.system.pet
                .familiarBonus
                .mana
            ??
            0

        );

    }

    getManaRegenBonus()
    {

        return (

            this.system.pet
                .familiarBonus
                .manaRegen
            ??
            0

        );

    }

    getCritBonus()
    {

        return (

            this.system.pet
                .familiarBonus
                .critChance
            ??
            0

        );

    }

    getFizzleReduction()
    {

        return (

            this.system.pet
                .familiarBonus
                .fizzleReduction
            ??
            0

        );

    }

    // ========================================================
    // PET FOCUS ITEMS
    // ========================================================

    addFocusEffect(
        effect
    )
    {

        this.system.pet
            .focusEffects
            .push(
                effect
            );

    }

    getFocusEffects()
    {

        return (

            this.system.pet
                .focusEffects
            ??
            []

        );

    }

    // ========================================================
    // SUMMARY
    // ========================================================

    getPetSummary()
    {

        return {

            name:
                this.name,

            type:
                this.getPetType(),

            family:
                this.getFamily(),

            owner:
                this.getOwner(),

            abilities:
                this.getPetAbilities()

        };

    }

}