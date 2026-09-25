// ============================================================
// EQRMSS Mercenary Actor
//
// EverQuest - Rolemaster Standard System
//
// Hired NPC / Contract ally specialization.
//
// Supports:
//  - Mercenary contracts
//  - Wages
//  - Roles
//  - Morale
//  - Tier progression
//  - AI profiles
//  - Equipment restrictions
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSActor

}
from "./eqrmss_actor.js";

export class EQRMSSMercenary extends EQRMSSActor
{

    // ========================================================
    // DERIVED DATA
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureMercenaryData();

        this._prepareContract();

        this._prepareRole();

        this._prepareAI();

        this._prepareMorale();

        this._prepareWages();

        this._prepareRestrictions();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureMercenaryData()
    {

        this.system.mercenary ??=
        {

            employer:null,

            role:"tank",

            tier:1,

            level:1,

            contract:

            {

                active:false,

                duration:0,

                startDate:null

            },

            wage:

            {

                amount:0,

                currency:"gold",

                interval:"day"

            },

            morale:100,

            loyalty:50,

            ai:

            {

                type:"mercenary",

                aggression:"balanced",

                protectOwner:true

            },

            equipment:

            {

                restricted:true,

                allowedTypes:[]

            },

            abilities:[],

            combatPackage:null

        };

    }

    // ========================================================
    // EMPLOYER
    // ========================================================

    getEmployer()
    {

        return (

            this.system.mercenary.employer
            ??
            null

        );

    }

    setEmployer(
        actorId
    )
    {

        this.system.mercenary.employer =
            actorId;

    }

    hasEmployer()
    {

        return Boolean(
            this.getEmployer()
        );

    }

    // ========================================================
    // ROLE SYSTEM
    // ========================================================

    _prepareRole()
    {

        this.system.mercenary.role ??=
            "tank";

    }

    getRole()
    {

        return (

            this.system.mercenary.role
            ??
            "tank"

        );

    }

    setRole(
        role
    )
    {

        this.system.mercenary.role =
            role;

    }

    isTank()
    {

        return this.getRole()
            ===
            "tank";

    }

    isHealer()
    {

        return this.getRole()
            ===
            "healer";

    }

    isDPS()
    {

        return this.getRole()
            ===
            "dps";

    }

    isCaster()
    {

        return this.getRole()
            ===
            "caster";

    }

    isScout()
    {

        return this.getRole()
            ===
            "scout";

    }

    // ========================================================
    // CONTRACT SYSTEM
    // ========================================================

    _prepareContract()
    {

        this.system.mercenary.contract ??=
        {

            active:false,

            duration:0

        };

    }

    isContractActive()
    {

        return (

            this.system.mercenary
                .contract
                .active
            ===
            true

        );

    }

    hire(
        duration
    )
    {

        this.system.mercenary
            .contract =
        {

            active:true,

            duration,

            startDate:
                Date.now()

        };

    }

    dismiss()
    {

        this.system.mercenary
            .contract
            .active =
            false;

    }

    getContractRemaining()
    {

        return (

            this.system.mercenary
                .contract
                .duration
            ??
            0

        );

    }

    // ========================================================
    // WAGES
    // ========================================================

    _prepareWages()
    {

        this.system.mercenary.wage ??=
        {

            amount:0,

            currency:"gold",

            interval:"day"

        };

    }

    getWage()
    {

        return (

            this.system.mercenary
                .wage
            ??
            {}

        );

    }

    calculateUpkeep(
        periods=1
    )
    {

        return (

            this.getWage()
                .amount
            *
            periods

        );

    }

    // ========================================================
    // TIER SYSTEM
    // ========================================================

    getTier()
    {

        return (

            this.system.mercenary
                .tier
            ??
            1

        );

    }

    setTier(
        tier
    )
    {

        this.system.mercenary.tier =
            tier;

    }

    // ========================================================
    // AI
    // ========================================================

    _prepareAI()
    {

        this.system.mercenary.ai ??=
        {

            type:"mercenary",

            aggression:"balanced",

            protectOwner:true

        };

    }

    getAIType()
    {

        return (

            this.system.mercenary
                .ai
                .type
            ??
            "mercenary"

        );

    }

    protectsOwner()
    {

        return (

            this.system.mercenary
                .ai
                .protectOwner
            !==
            false

        );

    }

    // ========================================================
    // MORALE / LOYALTY
    // ========================================================

    _prepareMorale()
    {

        this.system.mercenary.morale ??=
            100;

        this.system.mercenary.loyalty ??=
            50;

    }

    getMorale()
    {

        return (

            this.system.mercenary
                .morale
            ??
            0

        );

    }

    modifyMorale(
        amount
    )
    {

        this.system.mercenary.morale +=
            amount;

        this.system.mercenary.morale =
            Math.clamped(
                this.system.mercenary.morale,
                0,
                200
            );

    }

    getLoyalty()
    {

        return (

            this.system.mercenary
                .loyalty
            ??
            0

        );

    }

    modifyLoyalty(
        amount
    )
    {

        this.system.mercenary.loyalty +=
            amount;

        this.system.mercenary.loyalty =
            Math.clamped(
                this.system.mercenary.loyalty,
                0,
                200
            );

    }

    // ========================================================
    // EQUIPMENT RESTRICTIONS
    // ========================================================

    _prepareRestrictions()
    {

        this.system.mercenary
            .equipment ??=
        {

            restricted:true,

            allowedTypes:[]

        };

    }

    canEquip(
        item
    )
    {

        if(
            !this.system.mercenary
                .equipment
                .restricted
        )
        {
            return true;
        }

        const allowed =
            this.system.mercenary
                .equipment
                .allowedTypes;

        return allowed.includes(
            item.type
        );

    }

    // ========================================================
    // ABILITIES
    // ========================================================

    getAbilities()
    {

        return (

            this.system.mercenary
                .abilities
            ??
            []

        );

    }

    addAbility(
        ability
    )
    {

        this.system.mercenary
            .abilities
            .push(
                ability
            );

    }

    // ========================================================
    // COMBAT PACKAGE
    // ========================================================

    getCombatPackage()
    {

        return (

            this.system.mercenary
                .combatPackage
            ??
            null

        );

    }

    // ========================================================
    // SUMMARY
    // ========================================================

    getMercenarySummary()
    {

        return {

            name:
                this.name,

            role:
                this.getRole(),

            tier:
                this.getTier(),

            contract:
                this.isContractActive(),

            wage:
                this.getWage(),

            morale:
                this.getMorale()

        };

    }

}