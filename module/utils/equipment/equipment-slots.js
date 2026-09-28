// ============================================================
// EQRMSS Equipment Slots
//
// EverQuest - Rolemaster Standard System
//
// Equipment slot definitions and validation limits.
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

// ============================================================
// SLOT DEFINITIONS
// ============================================================

export const EQUIPMENT_SLOTS =
{

    head:
    {
        label:"Head"
    },

    shoulders:
    {
        label:"Shoulders"
    },

    chest:
    {
        label:"Chest"
    },

    back:
    {
        label:"Back"
    },

    arms:
    {
        label:"Arms"
    },

    hands:
    {
        label:"Hands"
    },

    legs:
    {
        label:"Legs"
    },

    feet:
    {
        label:"Feet"
    },

    // Weapons

    mainhand:
    {
        label:"Main Hand"
    },

    offhand:
    {
        label:"Off Hand"
    },

    ranged:
    {
        label:"Ranged"
    },

    // Jewelry

    neck:
    {
        label:"Neck"
    },

    ear1:
    {
        label:"Ear"
    },

    ear2:
    {
        label:"Ear"
    },

    finger1:
    {
        label:"Finger"
    },

    finger2:
    {
        label:"Finger"
    },

    wrist1:
    {
        label:"Wrist"
    },

    wrist2:
    {
        label:"Wrist"
    },

    // Weapon aliases

    primary:
    {
        label:"Primary Weapon",
        alias:"mainhand"
    },

    secondary:
    {
        label:"Secondary Weapon",
        alias:"offhand"
    }

};

// ============================================================
// SLOT LIMITS
//
// Maximum number of items allowed per slot.
//
// ============================================================

export const EQUIPMENT_SLOT_LIMITS =
{

    head:1,

    shoulders:1,

    chest:1,

    back:1,

    arms:1,

    hands:1,

    legs:1,

    feet:1,

    mainhand:1,

    offhand:1,

    ranged:1,

    neck:1,

    ear1:1,

    ear2:1,

    finger1:1,

    finger2:1,

    wrist1:1,

    wrist2:1

};

// ============================================================
// SLOT GROUPS
//
// Used by equipment validation and UI sorting.
//
// ============================================================

export const EQUIPMENT_SLOT_GROUPS =
{

    armor:
    [

        "head",

        "shoulders",

        "chest",

        "back",

        "arms",

        "hands",

        "legs",

        "feet"

    ],

    weapons:
    [

        "mainhand",

        "offhand",

        "primary",

        "secondary",

        "ranged"

    ],

    jewelry:
    [

        "neck",

        "ear1",

        "ear2",

        "finger1",

        "finger2",

        "wrist1",

        "wrist2"

    ],

    equipment:
    [

        "head",

        "shoulders",

        "chest",

        "back",

        "arms",

        "hands",

        "legs",

        "feet",

        "mainhand",

        "offhand",

        "primary",

        "secondary",

        "ranged",

        "neck",

        "ear1",

        "ear2",

        "finger1",

        "finger2",

        "wrist1",

        "wrist2"

    ]

};

// ============================================================
// HELPERS
// ============================================================

export function getEquipmentSlot(slot)
{

    return EQUIPMENT_SLOTS[slot] ?? null;

}

export function normalizeEquipmentSlot(slot)
{

    const data =
        EQUIPMENT_SLOTS[slot];

    if(
        data?.alias
    )
    {

        return data.alias;

    }

    return slot;

}