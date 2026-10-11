/**
 * ============================================================
 * EQRMSS Discipline Loader
 * ============================================================
 *
 * Loads all class discipline definitions from:
 *
 *   module/data/disciplines/
 *
 * Result:
 *
 *   CONFIG.EQRMSS.data.results.disciplines
 *
 * ============================================================
 */

const MODULE_ID = "eqrmss";

export class DisciplineLoader {

    static REQUIRED_FIELDS = [
        "id",
        "name",
        "level",
        "durationRounds",
        "reuseRounds",
        "effects"
    ];

    static async load() {

        const classes = [
            "bard",
            "beastlord",
            "berserker",
            "cleric",
            "druid",
            "enchanter",
            "magician",
            "monk",
            "necromancer",
            "paladin",
            "ranger",
            "rogue",
            "shadowknight",
            "shaman",
            "warrior",
            "wizard"
        ];

        const disciplines = [];

        /**
         * Track uniqueness by class + discipline id
         *
         * Example:
         *
         * warrior:resistant
         * rogue:resistant
         * paladin:resistant
         *
         * are all valid.
         */
        const registry = new Set();

        // Discipline icons (2026-10-11): discipline id -> icon path lookup.
        // Map values are stored as "icons/disciplines/<file>.png";
        // iconFor() resolves them to full system asset paths for <img> use.
        // A missing/unreadable map is non-fatal: disciplines load without icons.
        let iconMap = {};
        try {
            const iconResponse =
                await fetch(`systems/${MODULE_ID}/module/data/disciplines/icon-map.json`);
            if (iconResponse.ok) iconMap = await iconResponse.json();
            else console.warn(`${MODULE_ID} | Discipline icon map missing`, iconResponse.status);
        } catch (error) {
            console.warn(`${MODULE_ID} | Discipline icon map failed to load`, error);
        }

        for (const className of classes) {

            const file =
                `systems/eqrmss/module/data/disciplines/${className}.json`;

            try {

                const response =
                    await fetch(file);

                if (!response.ok) {

                    console.warn(
                        `${MODULE_ID} | Discipline file missing`,
                        file
                    );

                    continue;
                }

                const json =
                    await response.json();

                const entries =
                    Array.isArray(json)
                        ? json
                        : Array.isArray(json.disciplines)
                            ? json.disciplines
                            : [];

                for (const discipline of entries) {

                    DisciplineLoader.validateDiscipline(
                        discipline,
                        className
                    );

                    const registryId =
                        `${className}:${discipline.id}`;

                    if (
                        registry.has(
                            registryId
                        )
                    ) {

                        console.error(
                            `${MODULE_ID} | Duplicate discipline id`,
                            registryId
                        );

                        continue;
                    }

                    registry.add(
                        registryId
                    );

                    disciplines.push({

                        type: "discipline",

                        class:
                            discipline.class ??
                            className,

                        classId:
                            className,

                        registryId,

                        ...discipline,

                        icon:
                            DisciplineLoader.iconFor(
                                discipline.id,
                                iconMap
                            ) ??
                            discipline.icon ??
                            null
                    });
                }

            } catch (error) {

                console.error(
                    `${MODULE_ID} | Discipline load failed`,
                    {
                        className,
                        error
                    }
                );
            }
        }

        console.info(
            `${MODULE_ID} | Disciplines loaded`,
            {
                classes:
                    classes.length,

                total:
                    disciplines.length
            }
        );

        return disciplines;
    }

    static validateDiscipline(
        discipline,
        className
    ) {

        for (
            const field
            of DisciplineLoader.REQUIRED_FIELDS
        ) {

            if (
                discipline[field] === undefined
            ) {

                throw new Error(
                    `${className}: discipline missing required field "${field}"`
                );
            }
        }

        if (
            !Array.isArray(
                discipline.effects
            )
        ) {

            throw new Error(
                `${discipline.id}: effects must be an array`
            );
        }

        return true;
    }

    /**
     * Resolve a discipline id to its full system icon asset path.
     * Returns null when the id has no mapped icon.
     */
    static iconFor(disciplineId, iconMap) {

        const mapped = iconMap?.[disciplineId];

        if (!mapped) return null;

        if (mapped.startsWith("systems/")) return mapped;

        if (mapped.startsWith("icons/")) return `systems/${MODULE_ID}/assets/${mapped}`;

        return `systems/${MODULE_ID}/assets/icons/disciplines/${mapped}`;
    }

    /**
     * Optional helper
     */
    static getRegistryId(
        classId,
        disciplineId
    ) {

        return `${classId}:${disciplineId}`;
    }
}

export default DisciplineLoader;