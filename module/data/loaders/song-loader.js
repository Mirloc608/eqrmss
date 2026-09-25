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


        for (const className of classes)
        {
            const classSongs =
                await loadClassSongs(
                    className
                );


            songs.push(
                ...classSongs
            );
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


            if (
                Array.isArray(
                    index?.songs
                )
            )
            {
                for (
                    const entry
                    of index.songs
                )
                {
                    const song =
                        await loadSongEntry(
                            className,
                            entry
                        );


                    if (song)
                        songs.push(song);
                }


                return songs;
            }
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


    for (const filename of commonFiles)
    {
        const song =
            await loadSongFile(
                className,
                filename
            );


        if (song)
            songs.push(song);
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
