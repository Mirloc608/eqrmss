// ============================================================
// EQRMSS Progression Loader
//
// Foundry VTT V13 / V14
//
// Bootstrap loader for progression data.
//
// Loads / initializes:
//
// - Class progression data
// - Level progression tables
// - Skill progression references
// - Ability progression references
//
// The full progression rules engine is handled by:
//
//     module/progression/
//
// Loader Contract:
//
//     ProgressionLoader.load()
//
// ============================================================


export class ProgressionLoader {


    // ========================================================
    // LOAD
    //
    // Standard EQRMSS bootstrap loader entry point.
    // ========================================================

    static async load()
    {

        console.log(
            "EQRMSS | Loading progression data"
        );


        CONFIG.EQRMSS ??= {};


        CONFIG.EQRMSS.progression ??=
        {
            classes: {},
            levels: {},
            skills: {},
            abilities: {}
        };


        console.log(
            "EQRMSS | Progression loader initialized"
        );


        return CONFIG.EQRMSS.progression;

    }


    // ========================================================
    // GET PROGRESSION
    // ========================================================

    static getProgression(className)
    {

        if (!className)
            return null;


        return (
            CONFIG.EQRMSS
                ?.progression
                ?.classes
                ?.[className]
            ??
            null
        );

    }


    // ========================================================
    // GET LEVEL PROGRESSION
    // ========================================================

    static getLevelProgression(level)
    {

        if (level == null)
            return null;


        return (
            CONFIG.EQRMSS
                ?.progression
                ?.levels
                ?.[level]
            ??
            null
        );

    }


    // ========================================================
    // REGISTER PROGRESSION
    //
    // Merge instead of replacing the existing progression
    // structure.
    // ========================================================

    static register(data = {})
    {

        CONFIG.EQRMSS ??= {};


        CONFIG.EQRMSS.progression ??=
        {
            classes: {},
            levels: {},
            skills: {},
            abilities: {}
        };


        CONFIG.EQRMSS.progression =
        {
            ...CONFIG.EQRMSS.progression,
            ...data
        };


        console.log(
            "EQRMSS | Progression data registered"
        );


        return CONFIG.EQRMSS.progression;

    }


}


// ============================================================
// PUBLIC API
// ============================================================


export async function loadProgression()
{

    return await ProgressionLoader.load();

}


export function getProgression(className)
{

    return ProgressionLoader.getProgression(
        className
    );

}


export function getLevelProgression(level)
{

    return ProgressionLoader.getLevelProgression(
        level
    );

}


export function registerProgression(data = {})
{

    return ProgressionLoader.register(
        data
    );

}


export default ProgressionLoader;