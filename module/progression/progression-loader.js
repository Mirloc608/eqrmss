// ============================================================
// EQRMSS Progression Loader
// Foundry VTT V13 / V14 Compatible
//
// Loads class progression JSON files from:
// packs/progression/classes/
//
// Merges JSON progression data with:
// class-progression.js
//
// Data priority:
// JSON file > schema defaults
//
// ============================================================

import {
    EQRMSS_CLASS_PROGRESSIONS
}
from "./class-progression.js";

const PROGRESSION_PATH =
    "systems/eqrmss/packs/progression/classes/";

const loadedProgressions =
    {};

// ============================================================
// Load single class progression JSON
// ============================================================

async function loadClassJSON(
    profession
)
{

    const filename =
        `${profession}.json`;

    const path =
        `${PROGRESSION_PATH}${filename}`;

    try
    {

        const response =
            await fetch(path);

        if(!response.ok)
        {

            console.warn(
                `EQRMSS | Missing progression file ${path}`
            );

            return null;

        }

        return await response.json();

    }
    catch(err)
    {

        console.error(
            "EQRMSS | Progression JSON load failed",
            profession,
            err
        );

        return null;

    }

}

// ============================================================
// Deep merge helper
// ============================================================

function mergeProgression(
    base,
    override
)
{

    if(!override)
        return structuredClone(base);

    const result =
        structuredClone(base);

    for(
        const [key,value]
        of Object.entries(override)
    )
    {

        if(
            value
            &&
            typeof value === "object"
            &&
            !Array.isArray(value)
        )
        {

            result[key] =
                mergeProgression(
                    result[key] ?? {},
                    value
                );

        }

        else
        {

            result[key]=value;

        }

    }

    return result;

}

// ============================================================
// Load all class progressions
// ============================================================

export async function loadAllProgressions()
{

    console.log(
        "EQRMSS | Loading class progressions"
    );

    for(
        const profession
        of Object.keys(
            EQRMSS_CLASS_PROGRESSIONS
        )
    )
    {

        const base =
            EQRMSS_CLASS_PROGRESSIONS[profession];

        const json =
            await loadClassJSON(
                profession
            );

        loadedProgressions[profession] =
            mergeProgression(
                base,
                json
            );

    }

    console.log(
        "EQRMSS | Class progressions loaded",
        loadedProgressions
    );

    return loadedProgressions;

}

// ============================================================
// Accessors
// ============================================================

export function getLoadedProgression(
    profession
)
{

    return loadedProgressions[profession]
        ??
        EQRMSS_CLASS_PROGRESSIONS[profession]
        ??
        null;

}

export function getProgressionLevel(
    profession,
    level
)
{

    const progression =
        getLoadedProgression(
            profession
        );

    return progression
        ?.levels
        ?.[level]
        ??
        null;

}

// ============================================================
// Initialization helper
// ============================================================

export async function initializeProgressions()
{

    if(
        Object.keys(
            loadedProgressions
        ).length
    )
    {
        return loadedProgressions;
    }

    return await loadAllProgressions();

}

export default
{

    loadAllProgressions,

    initializeProgressions,

    getLoadedProgression,

    getProgressionLevel

};