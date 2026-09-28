// ============================================================
// EQRMSS Progression Manager
// Foundry VTT V13 / V14 Compatible
//
// Controls class advancement.
//
// Does NOT create Items directly.
//
// Delegates:
//  ability-granter.js
//  song-granter.js
//  level-up-engine.js
//
// ============================================================

import {
    initializeProgressions,
    getLoadedProgression,
    getProgressionLevel
}
from "./progression-loader.js";

import {
    abilityGranter
}
from "./ability-granter.js";

import {
    songGranter
}
from "./song-granter.js";

class EQRMSSProgressionManager
{

    constructor()
    {

        this.ready=false;

    }

    // ============================================================
    // Initialize
    // ============================================================

    async initialize()
    {

        if(this.ready)
            return;

        await initializeProgressions();

        this.ready=true;

        console.log(
            "EQRMSS | Progression Manager Ready"
        );

    }

    // ============================================================
    // Get class progression
    // ============================================================

    getClassProgression(
        profession
    )
    {

        return getLoadedProgression(
            profession
        );

    }

    // ============================================================
    // Get level rewards
    // ============================================================

    getLevelRewards(
        profession,
        level
    )
    {

        return getProgressionLevel(
            profession,
            level
        );

    }

    // ============================================================
    // Process level gain
    // ============================================================

    async processLevelUp(
        actor,
        newLevel
    )
    {

        await this.initialize();

        const profession =
            actor.system
            ?.fixed_info
            ?.profession;

        if(!profession)
        {

            console.warn(
                "EQRMSS | Actor missing profession",
                actor
            );

            return;

        }

        const rewards =
            this.getLevelRewards(
                profession,
                newLevel
            );

        if(!rewards)
        {

            console.warn(
                "EQRMSS | No progression found",
                profession,
                newLevel
            );

            return;

        }

        console.log(
            "EQRMSS | Processing level",
            profession,
            newLevel,
            rewards
        );

        // ------------------------------------------
        // Abilities
        // ------------------------------------------

        if(
            rewards.abilities
            ?.length
        )
        {

            await abilityGranter.grant(
                actor,
                rewards.abilities
            );

        }

        // ------------------------------------------
        // Spells
        // ------------------------------------------

        if(
            rewards.spells
            ?.length
        )
        {

            await abilityGranter.grant(
                actor,
                rewards.spells.map(
                    spell =>
                    ({
                        source:"spell",
                        key:spell
                    })
                )
            );

        }

        // ------------------------------------------
        // Songs
        // ------------------------------------------

        if(
            rewards.songs
            ?.length
        )
        {

            await songGranter.grant(
                actor,
                rewards.songs
            );

        }

        // ------------------------------------------
        // AA Unlock
        // ------------------------------------------

        if(
            rewards.aa
        )
        {

            await abilityGranter.grantAAUnlock(
                actor,
                newLevel
            );

        }

        // ------------------------------------------
        // Record progression
        // ------------------------------------------

        await this.recordLevel(
            actor,
            newLevel
        );

    }

    // ============================================================
    // Prevent duplicate grants
    // ============================================================

    async recordLevel(
        actor,
        level
    )
    {

        const current =
            actor.system
            ?.progression
            ?.levelsGranted
            ??
            [];

        if(
            current.includes(level)
        )
            return;

        await actor.update(
        {

            "system.progression.levelsGranted":
            [
                ...current,
                level
            ]

        });

    }

    // ============================================================
    // Catch-up leveling
    //
    // Used when importing characters
    // ============================================================

    async syncActorProgression(
        actor
    )
    {

        const currentLevel =
            actor.system
            ?.level
            ??
            1;

        const granted =
            actor.system
            ?.progression
            ?.levelsGranted
            ??
            [];

        for(
            let level=1;
            level<=currentLevel;
            level++
        )
        {

            if(
                !granted.includes(level)
            )
            {

                await this.processLevelUp(
                    actor,
                    level
                );

            }

        }

    }

}

export const progressionManager =
    new EQRMSSProgressionManager();

export default progressionManager;