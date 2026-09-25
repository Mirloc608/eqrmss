// ============================================================
// EQRMSS Stats Loader
//
// Foundry VTT V13 / V14
//
// Loads base/stat definitions from filesystem JSON.
//
// Public API:
//     loadStats()
//     StatsLoader
//
// Compatibility:
//     StatsLoader.load()
// ============================================================


import { RMSS_STATS } from "../stats/rmss-stats.js";

const STATS_PATH =
    "systems/eqrmss/module/data/stats/stats.json";

function parseStatsPayload(text) {
    try {
        return JSON.parse(text);
    } catch (jsonError) {
        // Older deployments served this file as a JavaScript object with
        // unquoted property names. Normalize only identifier-shaped keys,
        // then parse as JSON without executing server-provided code.
        const normalized = text.replace(
            /([,{]\s*)([A-Za-z_$][\w$]*)(\s*:)/g,
            '$1"$2"$3'
        );
        try {
            return JSON.parse(normalized);
        } catch {
            throw jsonError;
        }
    }
}


// ============================================================
// STATS LOADER
// ============================================================

export class StatsLoader
{

    // ========================================================
    // LOAD
    // ========================================================

    static async load()
    {

        CONFIG.EQRMSS ??= {};


        try
        {

            const response =
                await fetch(
                    STATS_PATH
                );


            if (!response.ok)
            {

                console.warn(
                    "EQRMSS | Stats file missing",
                    STATS_PATH
                );


                CONFIG.EQRMSS.stats =
                    {};


                return {};

            }


            const payload =
                await response.text();

            const data =
                parseStatsPayload(payload);

            Object.keys(RMSS_STATS).forEach(key => delete RMSS_STATS[key]);
            Object.assign(RMSS_STATS, data);


            CONFIG.EQRMSS.stats =
                RMSS_STATS;


            console.info(
                "EQRMSS | Stats loaded",
                data
            );


            return data;

        }
        catch (error)
        {

            console.error(
                "EQRMSS | Failed to load stats",
                error
            );


            CONFIG.EQRMSS.stats =
                {};


            return {};

        }

    }


    // ========================================================
    // ACCESSOR
    // ========================================================

    static getStats()
    {

        return (
            CONFIG.EQRMSS?.stats
            ??
            {}
        );

    }


    // ========================================================
    // GET ONE STAT
    // ========================================================

    static getStat(
        statId
    )
    {

        if (!statId)
            return null;


        const stats =
            this.getStats();


        return (
            stats?.[statId]
            ??
            stats?.base?.[statId]
            ??
            null
        );

    }


    // ========================================================
    // REGISTER
    // ========================================================

    static register(
        data = {}
    )
    {

        CONFIG.EQRMSS ??= {};


        Object.keys(RMSS_STATS).forEach(key => delete RMSS_STATS[key]);
        Object.assign(RMSS_STATS, data);

        CONFIG.EQRMSS.stats =
            RMSS_STATS;


        console.info(
            "EQRMSS | Stats registry initialized"
        );


        return CONFIG.EQRMSS.stats;

    }

}


// ============================================================
// PUBLIC API
// ============================================================

export async function loadStats()
{

    return await StatsLoader.load();

}


// ============================================================
// ACCESSORS
// ============================================================

export function getStats()
{

    return StatsLoader.getStats();

}


export function getStat(
    statId
)
{

    return StatsLoader.getStat(
        statId
    );

}


// ============================================================
// REGISTRATION
// ============================================================

export function registerStats(
    data = {}
)
{

    return StatsLoader.register(
        data
    );

}


// ============================================================
// DEFAULT
// ============================================================

export default StatsLoader;