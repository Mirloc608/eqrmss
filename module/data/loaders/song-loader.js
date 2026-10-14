// ============================================================
// EQRMSS Song Loader
//
// Foundry VTT V13 / V14
//
// Loads Bard songs from filesystem JSON.
//
// PUBLIC API
//
//     loadSongs()
//
// COMPATIBILITY
//
//     loadEQRMSSSongs()
// ============================================================


/* Parallel fetch helper (2026-10-14): concurrency-limited Promise.all
   to avoid hammering the server. Batches at 10 concurrent fetches. */
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let idx = 0;
    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            try { results[i] = await fn(items[i], i); }
            catch { results[i] = null; }
        }
    }
    const workers = Array(Math.min(limit, items.length)).fill().map(() => worker());
    await Promise.all(workers);
    return results;
}

const SONG_ROOT =
    "systems/eqrmss/module/data/songs";


// ============================================================
// LOAD SONGS
// ============================================================

export async function loadSongs()
{
    try
    {
        const indexResponse =
            await fetch(
                `${SONG_ROOT}/index.json`
            );


        let classes = [
            "bard"
        ];


        if (indexResponse.ok)
        {
            const index =
                await indexResponse.json();


            if (
                Array.isArray(
                    index?.classes
                )
                &&
                index.classes.length
            )
            {
                classes =
                    index.classes;
            }
        }


        const songs = [];


        const classResults = await mapLimit(classes, 4, loadClassSongs);
        for (const classSongs of classResults) {
            if (Array.isArray(classSongs)) songs.push(...classSongs);
        }


        CONFIG.EQRMSS ??= {};

        CONFIG.EQRMSS.songs =
            songs;


        console.info(
            "EQRMSS | Songs loaded",
            {
                classes:
                    classes.length,

                total:
                    songs.length
            }
        );


        return songs;

    }
    catch (error)
    {
        console.error(
            "EQRMSS | Failed to load songs",
            error
        );


        return [];
    }
}


// ============================================================
// LOAD CLASS SONGS
// ============================================================

async function loadClassSongs(
    className
)
{
    const songs = [];


    const indexPath =
        `${SONG_ROOT}/${className}/index.json`;


    try
    {
        const response =
            await fetch(indexPath);


        if (response.ok)
        {
            const index =
                await response.json();


            if (Array.isArray(index))
            {
                for (const entry of index)
                {
                    if (
                        entry
                        &&
                        typeof entry === "object"
                    )
                    {
                        songs.push(entry);
                    }
                }


                return songs;
            }


            // Band files: {"bands":["songs_01-05.json", ...]} — each band
            // file holds an array of song records.
            if (
                Array.isArray(
                    index?.bands
                )
            )
            {
                const bandResults = await mapLimit(index.bands, 10, (bandFile) => loadSongFile(className, bandFile));
                for (const band of bandResults) {
                    if (Array.isArray(band)) {
                        for (const entry of band) {
                            if (entry && typeof entry === "object") songs.push(entry);
                        }
                    } else if (band && typeof band === "object") {
                        songs.push(band);
                    }
                }
            }


            // Individual song files (legacy / hand-authored overrides).
            if (
                Array.isArray(
                    index?.songs
                )
            )
            {
                const songResults = await mapLimit(index.songs, 10, (entry) => loadSongEntry(className, entry));
                for (const song of songResults) {
                    if (song) songs.push(song);
                }
            }


            if (songs.length)
                return songs;
        }
    }
    catch (error)
    {
        console.warn(
            "EQRMSS | Song index unavailable",
            {
                className,
                error
            }
        );
    }


    // --------------------------------------------------------
    // Existing known files
    // --------------------------------------------------------

    const commonFiles = [

        "anthem_of_battle_1.json",
        "anthem_of_battle_2.json",
        "cassindras_chorus_of_clarity.json",
        "lullaby.json",
        "selos_accelerando_1.json",
        "song_of_soothing_1.json",
        "song_of_soothing_2.json"

    ];


    const commonResults = await mapLimit(commonFiles, 10, (filename) => loadSongFile(className, filename));
    for (const song of commonResults) {
        if (song) songs.push(song);
    }


    return songs;
}


// ============================================================
// LOAD INDEX ENTRY
// ============================================================

async function loadSongEntry(
    className,
    entry
)
{
    if (
        typeof entry === "object"
        &&
        entry.id
    )
    {
        return entry;
    }


    if (typeof entry !== "string")
        return null;


    let filename =
        entry;


    if (!filename.endsWith(".json"))
    {
        filename += ".json";
    }


    return loadSongFile(
        className,
        filename
    );
}


// ============================================================
// LOAD FILE
// ============================================================

async function loadSongFile(
    className,
    filename
)
{
    try
    {
        const path =
            `${SONG_ROOT}/${className}/${filename}`;


        const response =
            await fetch(path);


        if (!response.ok)
            return null;


        return await response.json();

    }
    catch
    {
        return null;
    }
}


// ============================================================
// LEGACY COMPATIBILITY EXPORT
// ============================================================

export async function loadEQRMSSSongs()
{
    return loadSongs();
}


// ============================================================
// DEFAULT
// ============================================================

export default loadSongs;

// ============================================================
// STANDARDIZED LOADER API (for register-data-loaders.js)
// ============================================================

export const SongLoader = {
    async load() {
        return loadSongs();
    }
};
