// ============================================================
// EQRMSS Transport Item
//
// EverQuest - Rolemaster Standard System
//
// Mount / vehicle specialization.
//
// Supports:
//  - Mounts
//  - Vehicles
//  - Travel modifiers
//  - Carry capacity
//  - Terrain bonuses
//  - Mounted combat
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSItem

}
from "./eqrmss_item.js";

export class EQRMSSTransport extends EQRMSSItem
{

    // ========================================================
    // PREPARE DATA
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureTransportData();

        this._prepareMovement();

        this._prepareCapacity();

        this._prepareCombat();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureTransportData()
    {

        this.system.transport ??=
        {

            category:"mount",

            subtype:"horse",

            size:"medium",

            movement:

            {

                speed:40,

                travelSpeed:8,

                flying:false,

                swimming:false

            },

            capacity:

            {

                passengers:1,

                weight:250

            },

            terrain:

            {

                road:0,

                forest:0,

                mountain:0,

                desert:0

            },

            combat:

            {

                usable:false,

                attack:false,

                defenseBonus:0

            },

            requirements:

            {

                level:0,

                skill:null

            },

            effects:[]

        };

    }

    // ========================================================
    // TRANSPORT TYPE
    // ========================================================

    getCategory()
    {

        return (

            this.system.transport.category
            ??
            "mount"

        );

    }

    getSubtype()
    {

        return (

            this.system.transport.subtype
            ??
            "unknown"

        );

    }

    isMount()
    {

        return (

            this.getCategory()
            ===
            "mount"

        );

    }

    isVehicle()
    {

        return (

            this.getCategory()
            ===
            "vehicle"

        );

    }

    isShip()
    {

        return (

            this.system.transport.subtype
            ===
            "ship"

        );

    }

    // ========================================================
    // MOVEMENT
    // ========================================================

    _prepareMovement()
    {

        this.system.transport.movement ??=
        {

            speed:0,

            travelSpeed:0

        };

    }

    getMovementSpeed()
    {

        return (

            this.system.transport
                .movement
                .speed
            ??
            0

        );

    }

    getTravelSpeed()
    {

        return (

            this.system.transport
                .movement
                .travelSpeed
            ??
            0

        );

    }

    canFly()
    {

        return (

            this.system.transport
                .movement
                .flying
            ===
            true

        );

    }

    canSwim()
    {

        return (

            this.system.transport
                .movement
                .swimming
            ===
            true

        );

    }

    // ========================================================
    // CAPACITY
    // ========================================================

    _prepareCapacity()
    {

        this.system.transport.capacity ??=
        {

            passengers:1,

            weight:0

        };

    }

    getPassengerCapacity()
    {

        return (

            this.system.transport
                .capacity
                .passengers
            ??
            0

        );

    }

    getCarryCapacity()
    {

        return (

            this.system.transport
                .capacity
                .weight
            ??
            0

        );

    }

    // ========================================================
    // TERRAIN
    // ========================================================

    getTerrainBonus(
        terrain
    )
    {

        return (

            this.system.transport
                .terrain
                ?.[terrain]
            ??
            0

        );

    }

    // ========================================================
    // MOUNTED COMBAT
    // ========================================================

    canFightMounted()
    {

        return (

            this.system.transport
                .combat
                .usable
            ===
            true

        );

    }

    getMountedDefenseBonus()
    {

        return (

            this.system.transport
                .combat
                .defenseBonus
            ??
            0

        );

    }

    // ========================================================
    // REQUIREMENTS
    // ========================================================

    canUse(
        actor
    )
    {

        const req =
            this.system.transport.requirements;

        if(
            actor.system.level
            <
            req.level
        )
        {
            return false;
        }

        return true;

    }

    // ========================================================
    // EFFECTS
    // ========================================================

    addTransportEffect(
        effect
    )
    {

        this.system.transport.effects ??=
            [];

        this.system.transport.effects.push(
            effect
        );

    }

    getTransportEffects()
    {

        return (

            this.system.transport.effects
            ??
            []

        );

    }

    // ========================================================
    // AGGREGATION
    // ========================================================

    getMovementData()
    {

        return {

            id:
                this.id,

            name:
                this.name,

            speed:
                this.getMovementSpeed(),

            travel:
                this.getTravelSpeed(),

            flying:
                this.canFly(),

            swimming:
                this.canSwim()

        };

    }

    // ========================================================
    // DISPLAY
    // ========================================================

    getTransportSummary()
    {

        return {

            name:
                this.name,

            category:
                this.getCategory(),

            subtype:
                this.getSubtype(),

            speed:
                this.getMovementSpeed()

        };

    }

}