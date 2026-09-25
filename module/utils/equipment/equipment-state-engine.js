// ============================================================
// EQRMSS Equipment State Engine
//
// EverQuest - Rolemaster Standard System
//
// Central equipment aggregation engine.
//
// Resolves equipped item state into derived actor data.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EquipmentManager

}
from "./equipment-manager.js";

import {

    EquipmentEffects

}
from "./equipment-effects.js";

export class EquipmentStateEngine
{

    static initialized = false;

    // ========================================================
    // INITIALIZATION
    // ========================================================

    static initialize()
    {

        if(
            this.initialized
        )
        {
            return;
        }

        this.initialized = true;

        console.log(
            "EQRMSS | Equipment State Engine initialized"
        );

    }

    // ========================================================
    // MAIN ENTRY
    //
    // Called from EQRMSSActor.prepareDerivedData()
    //
    // ========================================================

    static calculate(actor)
    {

        const state =
        this.createEmptyState();

        const items =

            EquipmentManager
                .getEquippedItems(actor);

        for(
            const item of items
        )
        {

            this.processItem(
                item,
                state
            );

        }

        state.effects =

            EquipmentEffects
                .collect(actor);

        this.finalize(state);

        return state;

    }

    // ========================================================
    // EMPTY STATE
    // ========================================================

    static createEmptyState()
    {

        return {

            stats:{},

            hp:0,

            mana:0,

            stamina:0,

            attackBonus:0,

            damageBonus:0,

            defense:0,

            armor:0,

            shield:0,

            resistances:{},

            skills:{},

            haste:0,

            manaRegen:0,

            healthRegen:0,

            weapons:[],

            armorPieces:[],

            shields:[],

            jewelry:[],

            instruments:[],

            transport:null,

            effects:[]

        };

    }

    // ========================================================
    // ITEM PROCESSING
    // ========================================================

    static processItem(
        item,
        state
    )
    {

        const data =
            item.system
            ??
            {};

        // -----------------------------------------------
        // Stats
        // -----------------------------------------------

        this.addObject(

            state.stats,

            data.stats

        );

        // -----------------------------------------------
        // Resources
        // -----------------------------------------------

        state.hp +=

            Number(
                data.hp
                ??
                0
            );

        state.mana +=

            Number(
                data.mana
                ??
                0
            );

        state.stamina +=

            Number(
                data.stamina
                ??
                0
            );

        // -----------------------------------------------
        // Combat
        // -----------------------------------------------

        state.attackBonus +=

            Number(
                data.attackBonus
                ??
                0
            );

        state.damageBonus +=

            Number(
                data.damageBonus
                ??
                0
            );

        state.defense +=

            Number(
                data.defense
                ??
                0
            );

        state.armor +=

            Number(
                data.armor
                ??
                0
            );

        // -----------------------------------------------
        // Shield
        // -----------------------------------------------

        if(
            item.type === "shield"
        )
        {

            state.shield +=

                Number(

                    data.shieldBonus
                    ??
                    data.armor
                    ??
                    0

                );

            state.shields.push(
                item
            );

        }

        // -----------------------------------------------
        // Resistances
        // -----------------------------------------------

        this.addObject(

            state.resistances,

            data.resistances

        );

        // -----------------------------------------------
        // Skills
        // -----------------------------------------------

        this.addObject(

            state.skills,

            data.skills

        );

        // -----------------------------------------------
        // Special Effects
        // -----------------------------------------------

        state.haste +=

            Number(
                data.haste
                ??
                0
            );

        state.manaRegen +=

            Number(
                data.manaRegen
                ??
                0
            );

        state.healthRegen +=

            Number(
                data.healthRegen
                ??
                0
            );

        // -----------------------------------------------
        // Item Categories
        // -----------------------------------------------

        switch(
            item.type
        )
        {

            case "weapon":

                state.weapons.push(item);

                break;

            case "armor":

                state.armorPieces.push(item);

                break;

            case "jewelry":

                state.jewelry.push(item);

                break;

            case "instrument":

                state.instruments.push(item);

                break;

            case "transport":

                state.transport =
                    data;

                break;

        }

    }

    // ========================================================
    // OBJECT ADDITION
    // ========================================================

    static addObject(
        target,
        source={}
    )
    {

        for(
            const [
                key,
                value
            ]
            of Object.entries(source)
        )
        {

            target[key] ??=0;

            target[key] +=

                Number(value);

        }

    }

    // ========================================================
    // FINALIZE
    // ========================================================

    static finalize(state)
    {

        // Prevent NaN values

        for(
            const key of Object.keys(state)
        )
        {

            if(
                typeof state[key] === "number"
                &&
                Number.isNaN(state[key])
            )
            {

                state[key]=0;

            }

        }

        return state;

    }

    // ========================================================
    // HELPERS
    // ========================================================

    static getStats(actor)
    {

        return this.calculate(actor).stats;

    }

    static getEffects(actor)
    {

        return this.calculate(actor).effects;

    }

    static getCombat(actor)
    {

        const state =
            this.calculate(actor);

        return {

            attackBonus:
                state.attackBonus,

            damageBonus:
                state.damageBonus,

            defense:
                state.defense,

            armor:
                state.armor,

            shield:
                state.shield

        };

    }

    static getSummary(actor)
    {

        const state =
            this.calculate(actor);

        return {

            stats:
                state.stats,

            resources:
            {

                hp:
                    state.hp,

                mana:
                    state.mana,

                stamina:
                    state.stamina

            },

            combat:
            {

                attack:
                    state.attackBonus,

                defense:
                    state.defense

            },

            effects:
                state.effects.length

        };

    }

}