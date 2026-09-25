// ============================================================
// EQRMSS Ability Granter
// Foundry VTT V13 / V14 Compatible
//
// Handles:
//  - Initial character abilities
//  - Level progression abilities
//  - AA unlocks
//
// ============================================================

export class EQRMSSAbilityGranter {

    // ============================================================
    // Generic progression grant
    // ============================================================

    async grant(actor, abilities = [])
    {

        if(!actor || !abilities.length)
            return;

        const documents =
            abilities.map(
                ability =>
                ({

                    name:
                        typeof ability === "string"
                        ? ability
                        : ability.name,

                    type:
                        typeof ability === "object"
                        && ability.type
                        ?
                        ability.type
                        :
                        "feature",

                    img:
                        "systems/eqrmss/assets/Icons/game/ability.png",

                    system:
                    {

                        description:
                            ability.description
                            ??
                            "",

                        source:
                            "level_progression",

                        category:
                            ability.category
                            ??
                            "class",

                        granted:true

                    }

                })
            );

        await this.createDocuments(
            actor,
            documents
        );

    }

    // ============================================================
    // AA unlocks
    // ============================================================

    async grantAAUnlock(actor, level)
    {

        const aa =
        {
            name:
                `AA Tier ${level}`,

            type:
                "aa",

            img:
                "systems/eqrmss/assets/Icons/game/aa.png",

            system:
            {
                description:
                    `Alternate Ability tier unlocked at level ${level}`,

                source:
                    "progression",

                granted:true
            }
        };

        await this.createDocuments(
            actor,
            [
                aa
            ]
        );

    }

    // ============================================================
    // Initial abilities
    // ============================================================

    async grantInitialAbilities(actor, options={})
    {

        const sources =
        [
            options.race,
            options.class,
            options.trainingPackage
        ]
        .filter(Boolean);

        const abilities =
            this.collectAbilities(
                sources
            );

        await this.grant(
            actor,
            abilities
        );

    }

    // ============================================================
    // Collect abilities
    // ============================================================

    collectAbilities(sources)
    {

        const result=[];

        for(const source of sources)
        {

            const abilities =
                source.system?.initialAbilities
                ??
                source.system?.abilities
                ??
                [];

            if(!Array.isArray(abilities))
                continue;

            result.push(
                ...abilities
            );

        }

        return this.removeDuplicates(
            result
        );

    }

    // ============================================================
    // Create Items
    // ============================================================

    async createDocuments(
        actor,
        documents
    )
    {

        const existing =
            new Set(
                actor.items.map(
                    i =>
                    `${i.name}-${i.type}`
                )
            );

        const filtered =
            documents.filter(
                item =>
                {

                    const key =
                        `${item.name}-${item.type}`;

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

    // ============================================================
    // Duplicate protection
    // ============================================================

    removeDuplicates(list)
    {

        const seen =
            new Set();

        return list.filter(
            item =>
            {

                const key =
                    `${item.name}-${item.type ?? "feature"}`;

                if(seen.has(key))
                    return false;

                seen.add(key);

                return true;

            }
        );

    }

}

// ============================================================
// Singleton export
// ============================================================

export const abilityGranter =
    new EQRMSSAbilityGranter();

export default abilityGranter;