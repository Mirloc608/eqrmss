// ============================================================
// EQRMSS Effect Engine
//
// EverQuest - Rolemaster Standard System
//
// Central effect aggregation and application layer.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

export class EffectEngine
{

    // ========================================================
    // INITIALIZATION
    // ========================================================

    static initialized = false;

    static async initialize()
    {

        if(this.initialized)
        {
            return;
        }

        this.initialized = true;

        console.log(
            "EQRMSS | Effect Engine initialized"
        );

    }

    // ========================================================
    // COLLECT ACTIVE EFFECTS
    //
    // Returns normalized effect objects
    //
    // ========================================================

    static collect(actor)
    {

        const effects = [];

        // ----------------------------------------------------
        // Foundry Active Effects
        // ----------------------------------------------------

        for(
            const effect of actor.effects
        )
        {

            if(effect.disabled)
            {
                continue;
            }

            effects.push(

                this.normalizeEffect(
                    effect
                )

            );

        }

        // ----------------------------------------------------
        // Item Generated Effects
        // ----------------------------------------------------

        for(
            const item of actor.items
        )
        {

            if(
                !item.system?.effects
            )
            {
                continue;
            }

            for(
                const effect of item.system.effects
            )
            {

                effects.push(

                    this.normalizeEffect(
                        effect,
                        item

                    )

                );

            }

        }

        // ----------------------------------------------------
        // Spell / Song / AA Effects
        // ----------------------------------------------------

        const activeAbilities =
            actor.system?.activeAbilities
            ??
            [];

        for(
            const ability of activeAbilities
        )
        {

            if(
                !ability.effects
            )
            {
                continue;
            }

            for(
                const effect of ability.effects
            )
            {

                effects.push(

                    this.normalizeEffect(
                        effect,
                        ability

                    )

                );

            }

        }

        return effects;

    }

    // ========================================================
    // NORMALIZE EFFECT FORMAT
    // ========================================================

    static normalizeEffect(
        effect,
        source=null
    )
    {

        return {

            id:
                effect.id
                ??
                foundry.utils.randomID(),

            source:
                source?.name
                ??
                effect.source
                ??
                "Unknown",

            type:
                effect.type
                ??
                "modifier",

            target:
                effect.target
                ??
                null,

            mode:
                effect.mode
                ??
                "ADD",

            value:
                Number(
                    effect.value
                    ??
                    0
                ),

            duration:
                effect.duration
                ??
                null,

            priority:
                effect.priority
                ??
                0

        };

    }

    // ========================================================
    // BUILD EFFECT AGGREGATE
    // ========================================================

    static resolve(
        effects=[]
    )
    {

        const result =
        {

            stats:{},

            hp:0,

            mana:0,

            stamina:0,

            attackBonus:0,

            defense:0,

            armor:0,

            resistances:{},

            skills:{},

            modifiers:[]

        };

        for(
            const effect of effects
        )
        {

            this.applyModifier(
                result,
                effect
            );

        }

        return result;

    }

    // ========================================================
    // APPLY SINGLE EFFECT
    // ========================================================

    static applyModifier(
        target,
        effect
    )
    {

        const key =
            effect.target;

        if(
            !key
        )
        {
            return;
        }

        switch(key)
        {

            // -----------------------------------------------
            // STATS
            // -----------------------------------------------

            case "strength":
            case "agility":
            case "constitution":
            case "memory":
            case "reasoning":
            case "self_discipline":
            case "empathy":
            case "intuition":
            case "presence":
            case "quickness":

                target.stats[key] ??= 0;

                target.stats[key] +=
                    effect.value;

                break;

            // -----------------------------------------------
            // RESOURCES
            // -----------------------------------------------

            case "hp":

                target.hp +=
                    effect.value;

                break;

            case "mana":

                target.mana +=
                    effect.value;

                break;

            case "stamina":

                target.stamina +=
                    effect.value;

                break;

            // -----------------------------------------------
            // COMBAT
            // -----------------------------------------------

            case "attackBonus":

                target.attackBonus +=
                    effect.value;

                break;

            case "defense":

                target.defense +=
                    effect.value;

                break;

            case "armor":

                target.armor +=
                    effect.value;

                break;

            // -----------------------------------------------
            // RESISTS
            // -----------------------------------------------

            case "resist":

                target.resistances[
                    effect.type
                    ??
                    "generic"
                ] ??=0;

                target.resistances[
                    effect.type
                ] += effect.value;

                break;

            // -----------------------------------------------
            // SKILLS
            // -----------------------------------------------

            case "skill":

                target.skills[
                    effect.skill
                ] ??=0;

                target.skills[
                    effect.skill
                ] += effect.value;

                break;

        }

        target.modifiers.push(
            effect
        );

    }

     // ========================================================
    // ACTOR PIPELINE APPLY
    // ========================================================

    static apply(
        actor,
        effects
    )
    {

        const resolved =
            this.resolve(
                effects
            );

        actor.system.derived.effects =
            resolved;

        return resolved;

    }

} // ✅ <-- CLASS ENDS HERE

// ============================================================
// SYSTEM COMPATIBILITY WRAPPER
// ============================================================

export async function applyEffects(
    attacker,
    target,
    effects = [],
    context = {}
){

    if(!target){
        console.warn(
            "[EQRMSS] applyEffects called without target"
        );
        return null;
    }

    if(!Array.isArray(effects)){
        effects = [effects];
    }

    // Ensure derived structure exists
    target.system.derived ??= {};

    const resolved =
        EffectEngine.apply(
            target,
            effects
        );

    Hooks.call(
        "eqrmss.effectsApplied",
        {
            attacker,
            target,
            effects,
            context,
            resolved
        }
    );

    return resolved;

}