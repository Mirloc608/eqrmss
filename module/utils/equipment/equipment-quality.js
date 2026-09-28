// ============================================================
// EQRMSS Equipment Quality
//
// EverQuest - Rolemaster Standard System
//
// Item quality and rarity resolver.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

export class EquipmentQuality
{

    // ========================================================
    // QUALITY DEFINITIONS
    // ========================================================

    static QUALITIES =
    {

        crude:
        {
            label:"Crude",

            tier:0,

            multiplier:0.75,

            durability:0.75,

            value:0.5,

            rarity:"poor"

        },

        rusty:
        {
            label:"Rusty",

            tier:1,

            multiplier:0.85,

            durability:0.85,

            value:0.75,

            rarity:"poor"

        },

        common:
        {
            label:"Common",

            tier:2,

            multiplier:1,

            durability:1,

            value:1,

            rarity:"common"

        },

        fine:
        {
            label:"Fine",

            tier:3,

            multiplier:1.10,

            durability:1.15,

            value:2,

            rarity:"uncommon"

        },

        excellent:
        {
            label:"Excellent",

            tier:4,

            multiplier:1.20,

            durability:1.25,

            value:3,

            rarity:"rare"

        },

        superior:
        {
            label:"Superior",

            tier:5,

            multiplier:1.35,

            durability:1.5,

            value:5,

            rarity:"rare"

        },

        masterwork:
        {
            label:"Masterwork",

            tier:6,

            multiplier:1.50,

            durability:2,

            value:10,

            rarity:"very_rare"

        },

        enchanted:
        {
            label:"Enchanted",

            tier:7,

            multiplier:1.75,

            durability:2,

            value:20,

            rarity:"magical"

        },

        legendary:
        {
            label:"Legendary",

            tier:8,

            multiplier:2,

            durability:3,

            value:50,

            rarity:"legendary"

        },

        artifact:
        {
            label:"Artifact",

            tier:9,

            multiplier:2.5,

            durability:5,

            value:100,

            rarity:"artifact"

        },

        epic:
        {
            label:"Epic",

            tier:10,

            multiplier:3,

            durability:10,

            value:500,

            rarity:"epic"

        }

    };

    // ========================================================
    // GET QUALITY DATA
    // ========================================================

    static get(item)
    {

        const key =

            item.system?.quality
            ??
            "common";

        return (

            this.QUALITIES[key]
            ??
            this.QUALITIES.common

        );

    }

    // ========================================================
    // APPLY QUALITY TO ITEM
    // ========================================================

    static apply(item)
    {

        const quality =
            this.get(item);

        const data =
            item.system
            ??
            {};

        return {

            ...data,

            quality:
                quality.label,

            stats:

                this.scaleObject(

                    data.stats,

                    quality.multiplier

                ),

            hp:

                this.scaleValue(

                    data.hp,

                    quality.multiplier

                ),

            mana:

                this.scaleValue(

                    data.mana,

                    quality.multiplier

                ),

            stamina:

                this.scaleValue(

                    data.stamina,

                    quality.multiplier

                ),

            durability:

            {

                max:

                    Math.floor(

                        (

                            data.durability?.max
                            ??
                            100

                        )
                        *
                        quality.durability

                    )

            },

            value:

                Math.floor(

                    (

                        data.value
                        ??
                        0

                    )
                    *
                    quality.value

                )

        };

    }

    // ========================================================
    // SCALE OBJECT
    // ========================================================

    static scaleObject(
        object={},
        multiplier=1
    )
    {

        const result={};

        for(
            const [
                key,
                value
            ]
            of Object.entries(object)
        )
        {

            result[key] =

                Math.floor(

                    Number(value)
                    *
                    multiplier

                );

        }

        return result;

    }

    // ========================================================
    // SCALE NUMBER
    // ========================================================

    static scaleValue(
        value,
        multiplier
    )
    {

        return Math.floor(

            Number(value ?? 0)
            *
            multiplier

        );

    }

    // ========================================================
    // QUALITY COMPARISON
    // ========================================================

    static compare(
        itemA,
        itemB
    )
    {

        return (

            this.get(itemA).tier

            -

            this.get(itemB).tier

        );

    }

    // ========================================================
    // QUALITY CHECKS
    // ========================================================

    static isBetter(
        itemA,
        itemB
    )
    {

        return (

            this.compare(
                itemA,
                itemB
            )
            > 0

        );

    }

    // ========================================================
    // DISPLAY
    // ========================================================

    static label(item)
    {

        return this.get(item).label;

    }

    // ========================================================
    // RANDOM QUALITY ROLL
    //
    // Used for loot generation
    //
    // ========================================================

    static random()
    {

        const table =

        [

            "common",

            "common",

            "common",

            "fine",

            "excellent",

            "superior",

            "masterwork"

        ];

        return (

            table[
                Math.floor(
                    Math.random()
                    *
                    table.length
                )
            ]

        );

    }

}