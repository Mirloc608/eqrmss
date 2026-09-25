// ============================================================
// EQRMSS Companion Actor
//
// EverQuest - Rolemaster Standard System
//
// Permanent NPC companion specialization.
//
// Supports:
//  - Followers
//  - Quest companions
//  - Adventuring allies
//  - Loyalty system
//  - Companion roles
//  - AI behavior
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSActor

}
from "./eqrmss_actor.js";

export class EQRMSSCompanion extends EQRMSSActor
{

    // ========================================================
    // DERIVED DATA
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureCompanionData();

        this._prepareOwner();

        this._prepareRole();

        this._prepareAI();

        this._prepareRelationship();

        this._prepareCommands();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureCompanionData()
    {

        this.system.companion ??=
        {

            owner:null,

            role:"fighter",

            archetype:"npc",

            level:1,

            loyalty:100,

            relationship:"neutral",

            ai:

            {

                type:"assist",

                aggression:"defensive",

                follow:true,

                retreat:false

            },

            commands:

            [

                "follow",

                "guard",

                "attack",

                "hold",

                "dismiss"

            ],

            abilities:[],

            equipmentLocked:false,

            progression:

            {

                enabled:true,

                experience:0

            }

        };

    }

    // ========================================================
    // OWNER
    // ========================================================

    _prepareOwner()
    {

        this.system.companion.owner ??=
            null;

    }

    getOwner()
    {

        return (

            this.system.companion.owner
            ??
            null

        );

    }

    setOwner(
        actorId
    )
    {

        this.system.companion.owner =
            actorId;

    }

    hasOwner()
    {

        return Boolean(
            this.getOwner()
        );

    }

    // ========================================================
    // ROLE
    // ========================================================

    _prepareRole()
    {

        this.system.companion.role ??=
            "fighter";

    }

    getRole()
    {

        return (

            this.system.companion.role
            ??
            "fighter"

        );

    }

    setRole(
        role
    )
    {

        this.system.companion.role =
            role;

    }

    isTank()
    {

        return (

            this.getRole()
            ===
            "tank"

        );

    }

    isHealer()
    {

        return (

            this.getRole()
            ===
            "healer"

        );

    }

    isCaster()
    {

        return (

            this.getRole()
            ===
            "caster"

        );

    }

    // ========================================================
    // AI SYSTEM
    // ========================================================

    _prepareAI()
    {

        this.system.companion.ai ??=
        {

            type:"assist",

            aggression:"defensive"

        };

    }

    getAIType()
    {

        return (

            this.system.companion.ai.type
            ??
            "assist"

        );

    }

    getAggression()
    {

        return (

            this.system.companion.ai.aggression
            ??
            "defensive"

        );

    }

    followsOwner()
    {

        return (

            this.system.companion.ai.follow
            !==
            false

        );

    }

    // ========================================================
    // RELATIONSHIP
    // ========================================================

    _prepareRelationship()
    {

        this.system.companion.loyalty ??=
            100;

        this.system.companion.relationship ??=
            "neutral";

    }

    getLoyalty()
    {

        return (

            this.system.companion.loyalty
            ??
            0

        );

    }

    modifyLoyalty(
        value
    )
    {

        this.system.companion.loyalty +=
            value;

        this.system.companion.loyalty =
            Math.clamped(
                this.system.companion.loyalty,
                0,
                200
            );

    }

    getRelationship()
    {

        return (

            this.system.companion.relationship
            ??
            "neutral"

        );

    }

    setRelationship(
        value
    )
    {

        this.system.companion.relationship =
            value;

    }

    // ========================================================
    // COMMAND SYSTEM
    // ========================================================

    _prepareCommands()
    {

        this.system.companion.commands ??=
        [

            "follow",

            "guard",

            "attack",

            "hold",

            "dismiss"

        ];

    }

    getCommands()
    {

        return (

            this.system.companion.commands
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

    getAbilities()
    {

        return (

            this.system.companion.abilities
            ??
            []

        );

    }

    addAbility(
        ability
    )
    {

        this.system.companion
            .abilities
            .push(
                ability
            );

    }

    // ========================================================
    // PROGRESSION
    // ========================================================

    getCompanionExperience()
    {

        return (

            this.system.companion
                .progression
                .experience
            ??
            0

        );

    }

    addCompanionExperience(
        xp
    )
    {

        this.system.companion
            .progression
            .experience +=
            xp;

    }

    canProgress()
    {

        return (

            this.system.companion
                .progression
                .enabled
            ===
            true

        );

    }

    // ========================================================
    // SUMMARY
    // ========================================================

    getCompanionSummary()
    {

        return {

            name:
                this.name,

            owner:
                this.getOwner(),

            role:
                this.getRole(),

            loyalty:
                this.getLoyalty(),

            relationship:
                this.getRelationship(),

            ai:
                this.getAIType()

        };

    }

}