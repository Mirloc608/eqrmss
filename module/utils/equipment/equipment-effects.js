// ============================================================
// EQRMSS Equipment Effects
//
// EverQuest - Rolemaster Standard System
//
// Converts equipment bonuses into normalized effects.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

export class EquipmentEffects
{

    // ========================================================
    // COLLECT ALL ITEM EFFECTS
    // ========================================================

    static collect(actor)
    {

        const effects = [];

        for(
            const item of actor.items
        )
        {

            if(
                !item.system?.equipped
            )
            {
                continue;
            }

            if(
                item.system?.broken
            )
            {
                continue;
            }

            effects.push(

                ...this.fromItem(
                    item
                )

            );

        }

        return effects;

    }

    // ========================================================
    // CONVERT ITEM TO EFFECTS
    // ========================================================

    static fromItem(item)
    {

        const effects=[];

        const data =
            item.system
            ??
            {};

        // ----------------------------------------------------
        // STAT BONUSES
        // ----------------------------------------------------

        for(
            const [
                stat,
                value
            ]
            of Object.entries(
                data.stats
                ??
                {}
            )
        )
        {

            effects.push(

                this.createEffect(

                    stat,

                    value,

                    item

                )

            );

        }

        // ----------------------------------------------------
        // RESOURCES
        // ----------------------------------------------------

        this.pushIfValue(
            effects,
            "hp",
            data.hp,
            item
        );

        this.pushIfValue(
            effects,
            "mana",
            data.mana,
            item
        );

        this.pushIfValue(
            effects,
            "stamina",
            data.stamina,
            item
        );

        // ----------------------------------------------------
        // COMBAT
        // ----------------------------------------------------

        this.pushIfValue(
            effects,
            "attackBonus",
            data.attackBonus,
            item
        );

        this.pushIfValue(
            effects,
            "damageBonus",
            data.damageBonus,
            item
        );

        this.pushIfValue(
            effects,
            "defense",
            data.defense,
            item
        );

        this.pushIfValue(
            effects,
            "armor",
            data.armor,
            item
        );

        // ----------------------------------------------------
        // RESISTS
        // ----------------------------------------------------

        for(
            const [
                resist,
                value
            ]
            of Object.entries(
                data.resistances
                ??
                {}
            )
        )
        {

            effects.push(

                {

                    id:
                        foundry.utils.randomID(),

                    source:
                        item.name,

                    type:
                        "resistance",

                    target:
                        "resist",

                    resist,

                    value:
                        Number(value)

                }

            );

        }

        // ----------------------------------------------------
        // SKILL BONUSES
        // ----------------------------------------------------

        for(
            const [
                skill,
                value
            ]
            of Object.entries(

                data.skills
                ??
                {}

            )
        )
        {

            effects.push(

                {

                    id:
                        foundry.utils.randomID(),

                    source:
                        item.name,

                    type:
                        "skill",

                    target:
                        "skill",

                    skill,

                    value:
                        Number(value)

                }

            );

        }

        // ----------------------------------------------------
        // CUSTOM EFFECTS
        // ----------------------------------------------------

        if(
            Array.isArray(
                data.effects
            )
        )
        {

            for(
                const effect of data.effects
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
        // WEAPON PROCS
        // ----------------------------------------------------

        if(
            Array.isArray(
                data.procs
            )
        )
        {

            for(
                const proc of data.procs
            )
            {

                effects.push(

                    {

                        id:
                            foundry.utils.randomID(),

                        source:
                            item.name,

                        type:
                            "proc",

                        target:
                            "proc",

                        value:
                            proc

                    }

                );

            }

        }

        return effects;

    }

    // ========================================================
    // SIMPLE VALUE PUSH
    // ========================================================

    static pushIfValue(
        array,
        target,
        value,
        item
    )
    {

        if(
            value === undefined
            ||
            value === null
        )
        {
            return;
        }

        if(
            Number(value) === 0
        )
        {
            return;
        }

        array.push(

            this.createEffect(

                target,

                value,

                item

            )

        );

    }

    // ========================================================
    // CREATE NORMAL EFFECT
    // ========================================================

    static createEffect(
        target,
        value,
        item
    )
    {

        return {

            id:
                foundry.utils.randomID(),

            source:
                item.name,

            type:
                "equipment",

            target,

            value:
                Number(value)

        };

    }

    // ========================================================
    // NORMALIZE CUSTOM EFFECT
    // ========================================================

    static normalizeEffect(
        effect,
        item
    )
    {

        return {

            id:
                effect.id
                ??
                foundry.utils.randomID(),

            source:
                item.name,

            type:
                effect.type
                ??
                "equipment",

            target:
                effect.target
                ??
                null,

            value:
                Number(
                    effect.value
                    ??
                    0
                ),

            duration:
                effect.duration
                ??
                null

        };

    }

    // ========================================================
    // FIND EFFECTS BY TYPE
    // ========================================================

    static filter(
        effects,
        type
    )
    {

        return effects.filter(

            effect =>
                effect.type === type

        );

    }

    // ========================================================
    // DEBUG SUMMARY
    // ========================================================

    static summary(
        effects
    )
    {

        return effects.map(

            effect =>

            `${effect.source}: ${effect.target} ${effect.value}`

        );

    }

}