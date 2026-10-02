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

                swimming:false,

                climbing:false,

                flightOnly:false

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
    //
    // Flight / climb semantics (ruling 2026-10-01):
    //  - Fly1 (bee, dragonfly, flying carpet): flight is the mount's ONLY
    //    movement mode (flightOnly = true). It cannot walk; where it cannot
    //    fly — indoors, wings bound — it is immobile.
    //  - Fly2 (griffon, sokokar): flight is SECONDARY (flightOnly = false).
    //    The mount keeps its ground speed; fly speed equals the listed rate.
    //  - Climb (spider): climbing = true. Treats up to 45-degree grades as
    //    normal terrain with a rider; no climb check where a horse needs one.
    // Chart `movement` entries map to these flags when a transport item is
    // created from the reference chart: Fly1/Fly2 -> flying (+flightOnly for
    // Fly1), Swim -> swimming, Climb -> climbing.
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

    canClimb()
    {

        return (

            this.system.transport
                .movement
                .climbing
            ===
            true

        );

    }

    isFlightOnly()
    {

        return (

            this.system.transport
                .movement
                .flightOnly
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
                this.canSwim(),

            climbing:
                this.canClimb(),

            flightOnly:
                this.isFlightOnly()

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