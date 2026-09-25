// ============================================================
// EQRMSS Song Granter
// Foundry VTT V13 / V14 Compatible
//
// Handles Bard song progression grants.
//
// ============================================================

export class EQRMSSSongGranter {

    // ============================================================
    // Grant Songs
    // ============================================================

    async grant(
        actor,
        songs = []
    )
    {

        if(!actor || !songs.length)
            return;

        const documents =
            songs.map(
                song =>
                ({

                    name:
                        typeof song === "string"
                        ?
                        song
                        :
                        song.name,

                    type:
                        "song",

                    img:
                        "systems/eqrmss/assets/Icons/game/song.png",

                    system:
                    {

                        description:
                            typeof song === "object"
                            ?
                            song.description ?? ""
                            :
                            "",

                        source:
                            "level_progression",

                        songGroup:
                            typeof song === "object"
                            ?
                            song.songGroup ?? ""
                            :
                            "",

                        instrument:
                            typeof song === "object"
                            ?
                            song.instrument ?? "voice"
                            :
                            "voice",

                        granted:true

                    }

                })
            );

        await this.createSongs(
            actor,
            documents
        );

    }

    // ============================================================
    // Create Documents
    // ============================================================

    async createSongs(
        actor,
        documents
    )
    {

        const existing =
            new Set(
                actor.items.map(
                    item =>
                    `${item.name}-${item.type}`
                )
            );

        const filtered =
            documents.filter(
                song =>
                {

                    const key =
                        `${song.name}-${song.type}`;

                    if(existing.has(key))
                        return false;

                    existing.add(key);

                    return true;

                }
            );

        if(!filtered.length)
            return;

        await actor.createEmbeddedDocuments(
            "Item",
            filtered
        );

    }

}

// ============================================================
// Singleton Export
// ============================================================

export const songGranter =
    new EQRMSSSongGranter();

export default songGranter;