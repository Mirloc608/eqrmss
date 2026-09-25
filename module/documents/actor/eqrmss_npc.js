// ============================================================
// EQRMSS NPC Actor
//
// EverQuest - Rolemaster Standard System
//
// NPC specialization.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

import {

    EQRMSSActor

}
from "./eqrmss_actor.js";

import {

    getEffectiveFaction,
    getFactionStanding

}
from "../../utils/faction/faction.js";

export class EQRMSSNPC extends EQRMSSActor
{

    // ========================================================
    // DERIVED DATA
    // ========================================================

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this._ensureNPCData();

        this._prepareFaction();

        this._prepareAI();

        this._prepareChallenge();

        this._prepareLoot();

        this._prepareAbilities();

    }

    // ========================================================
    // DEFAULT DATA
    // ========================================================

    _ensureNPCData()
    {

        this.system.npc ??=
        {

            archetype:"common",

            faction:null,

            factionStanding:0,

            challengeRating:1,

            intelligence:"average",

            alignment:null,

            behavior:"neutral",

            ai:

            {

                type:"basic",

                aggression:"defensive",

                range:0,

                flee:false

            },

            loot:

            {

                enabled:true,

                table:null,

                currency:0,

                items:[]

            },

            abilities:
            [],

            spells:
            [],

            combatActions:
            []

        };

    }

    // ========================================================
    // NPC TYPE
    // ========================================================

    getArchetype()
    {

        return (

            this.system.npc.archetype
            ??
            "common"

        );

    }

    setArchetype(
        value
    )
    {

        this.system.npc.archetype =
            value;

    }

    // ========================================================
    // FACTION
    // ========================================================

    _prepareFaction()
    {

        this.system.npc.factionStanding ??=
            0;

    }

    getFaction()
    {

        return (

            this.system.npc.faction
            ??
            null

        );

    }

    setFaction(
        faction
    )
    {

        this.system.npc.faction =
            faction;

    }

    getFactionValue()
    {

        return (

            this.system.npc.factionStanding
            ??
            0

        );

    }

    getFactionReaction(
        actor
    )
    {

        if(
            !actor
        )
        {
            return null;
        }

        const faction =
            getEffectiveFaction(
                this,
                actor
            );

        return getFactionStanding(
            faction
        );

    }

    // ========================================================
    // AI
    // ========================================================

    _prepareAI()
    {

        this.system.npc.ai ??=
        {

            type:"basic",

            aggression:"defensive"

        };

    }

    getAIType()
    {

        return (

            this.system.npc.ai.type
            ??
            "basic"

        );

    }

    getAggression()
    {

        return (

            this.system.npc.ai.aggression
            ??
            "neutral"

        );

    }

    canFlee()
    {

        return (

            this.system.npc.ai.flee
            ===
            true

        );

    }

    // ========================================================
    // CHALLENGE
    // ========================================================

    _prepareChallenge()
    {

        this.system.npc.challengeRating ??=
            1;

    }

    getChallengeRating()
    {

        return (

            this.system.npc.challengeRating
            ??
            1

        );

    }

    // ========================================================
    // LOOT
    // ========================================================

    _prepareLoot()
    {

        this.system.npc.loot ??=
        {

            enabled:true,

            items:[]

        };

    }

    getLoot()
    {

        return (

            this.system.npc.loot
            ??
            {}

        );

    }

    addLootItem(
        item
    )
    {

        this.system.npc.loot.items.push(
            item
        );

    }

    // ========================================================
    // SPELLS
    // ========================================================

    _prepareAbilities()
    {

        this.system.npc.spells ??=
            [];

        this.system.npc.abilities ??=
            [];

        this.system.npc.combatActions ??=
            [];

    }

    getKnownSpells()
    {

        return (

            this.system.npc.spells
            ??
            []

        );

    }

    addSpell(
        spell
    )
    {

        this.system.npc.spells.push(
            spell
        );

    }

    // ========================================================
    // COMBAT ACTIONS
    // ========================================================

    getCombatActions()
    {

        return (

            this.system.npc.combatActions
            ??
            []

        );

    }

    addCombatAction(
        action
    )
    {

        this.system.npc.combatActions.push(
            action
        );

    }

    // ========================================================
    // NPC SUMMARY
    // ========================================================

    getNPCSummary()
    {

        return {

            name:
                this.name,

            archetype:
                this.getArchetype(),

            faction:
                this.getFaction(),

            challenge:
                this.getChallengeRating(),

            ai:
                this.getAIType(),

            loot:
                this.getLoot()

        };

    }

}