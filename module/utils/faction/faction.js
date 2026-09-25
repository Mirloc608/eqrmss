// ============================================================
// EQRMSS Faction Utilities
// ============================================================

export const FACTION_STANDINGS = [

    {
        key:"ally",
        label:"Ally",
        min:1051,
        max:2000
    },

    {
        key:"warmly",
        label:"Warmly",
        min:701,
        max:1050
    },

    {
        key:"kindly",
        label:"Kindly",
        min:451,
        max:700
    },

    {
        key:"amiable",
        label:"Amiable",
        min:51,
        max:450
    },

    {
        key:"indifferent",
        label:"Indifferent",
        min:-49,
        max:50
    },

    {
        key:"apprehensive",
        label:"Apprehensive",
        min:-449,
        max:-50
    },

    {
        key:"dubious",
        label:"Dubious",
        min:-699,
        max:-450
    },

    {
        key:"threatening",
        label:"Threatening",
        min:-1049,
        max:-700
    },

    {
        key:"scowls",
        label:"Scowls",
        min:-2000,
        max:-1050
    }

];

export function getFactionStanding(value)
{

    const standing =
        Number(value ?? 0);

    return (
        FACTION_STANDINGS.find(
            s =>
            standing >= s.min &&
            standing <= s.max
        )
        ??
        FACTION_STANDINGS[4]
    );

}

export function getEffectiveFaction(actor, faction)
{

    const modifiers =
        actor?.system?.faction?.modifiers ?? {};

    return Number(
        faction +
        (modifiers[faction] ?? 0)
    );

}