// ============================================================
// EQRMSS Equipment Utilities
// ============================================================

export function getSystemData(item)
{

    return item?.system ?? {};

}

export function getEquipmentType(item)
{

    return item?.type ?? null;

}

export function getEquipmentName(item)
{

    return item?.name ?? "Unknown Item";

}

// ============================================================
// EQUIPPED
// ============================================================

export function isEquipped(item)
{

    return item?.system?.equipped === true;

}

export function isBroken(item)
{

    return (
        item?.system?.durability?.current <= 0
    );

}

// ============================================================
// SLOTS
// ============================================================

export function getSlot(item)
{

    return item?.system?.slot ?? null;

}

export function hasSlot(item,slot)
{

    return getSlot(item) === slot;

}

export function sameSlot(a,b)
{

    return (
        getSlot(a)
        &&
        getSlot(a)===getSlot(b)
    );

}

// ============================================================
// TYPES
// ============================================================

export function isWeapon(item)
{
    return item?.type==="weapon";
}

export function isArmor(item)
{
    return item?.type==="armor";
}

export function isShield(item)
{
    return item?.type==="shield";
}

export function isJewelry(item)
{
    return item?.type==="jewelry";
}

export function isInstrument(item)
{
    return item?.type==="instrument";
}

// ============================================================
// STATS
// ============================================================

export function getItemStats(item)
{

    return item?.system?.stats ?? {};

}

export function getItemStat(item,stat)
{

    return (
        item?.system?.stats?.[stat]
        ??
        0
    );

}

export function getEffectData(item)
{

    return item?.system?.effects ?? [];

}

// ============================================================
// DURABILITY
// ============================================================

export function getDurability(item)
{

    return (
        item?.system?.durability ??
        {
            current:0,
            maximum:0
        }
    );

}

export function getDurabilityPercent(item)
{

    const d =
        getDurability(item);

    if(!d.maximum)
        return 100;

    return Math.floor(
        (
            d.current /
            d.maximum
        ) * 100
    );

}

// ============================================================
// WEIGHT
// ============================================================

export function getWeight(item)
{

    return Number(

        item?.system?.weight
        ??
        item?.system?.item?.weight
        ??
        0

    );

}

export function calculateItemWeight(item)
{

    return getWeight(item);

}

export function calculateWeight(items=[])
{

    return items.reduce(

        (total,item)=>
            total + calculateItemWeight(item),

        0

    );

}

// ============================================================
// VALUE
// ============================================================

export function getValue(item)
{

    return Number(

        item?.system?.value
        ??
        item?.system?.item?.value
        ??
        0

    );

}

// ============================================================
// RESTRICTIONS
// ============================================================

export function getAllowedClasses(item)
{

    return (
        item?.system?.requirements?.class
        ??
        []
    );

}

export function getAllowedRaces(item)
{

    return (
        item?.system?.requirements?.race
        ??
        []
    );

}

export function hasRestrictions(item)
{

    return (

        getAllowedClasses(item).length
        ||
        getAllowedRaces(item).length

    );

}

export function cloneEquipmentData(data)
{

    return foundry.utils.deepClone(data);

}

export function logEquipment(item)
{

    console.log(
        "EQRMSS Equipment:",
        {
            name:item?.name,
            type:item?.type,
            slot:getSlot(item),
            equipped:isEquipped(item),
            stats:getItemStats(item)
        }
    );

}