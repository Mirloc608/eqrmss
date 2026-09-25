// ============================================================
// EQRMSS Skill Category Sheet
// Foundry VTT V13 ApplicationV2
// ============================================================

import EQRMSSItemSheet
    from "../items/eqrmss_item_sheet.js";

export default class EQRMSSSkillCategorySheet
    extends EQRMSSItemSheet
{

    static PARTS =
    {

        form:
        {

            template:
                "systems/eqrmss/templates/sheets/skills/eqrmss-skill-category-sheet.html"

        }

    };

    /**
     * ---------------------------------------------------------
     * Prepare Context
     * ---------------------------------------------------------
     */
    async _prepareContext(options)
    {

        const context =
            await super._prepareContext(options);

        const category =
            this.document;

        const system =
            category.system ?? {};

        /*
        --------------------------------------------------------
        Applicable Stat List
        --------------------------------------------------------
        */

        const applicable_stat_list =
        {};

        const stats =
            CONFIG.eqrmss
                ?.stats
            ??
            {};

        for(
            const [key,data]
            of Object.entries(stats)
        )
        {

            applicable_stat_list[key] =
                data.fullname
                ??
                key;

        }

        /*
        --------------------------------------------------------
        Selected Stats
        --------------------------------------------------------
        Required by template:

        applicable_stat_1_selected
        applicable_stat_2_selected
        applicable_stat_3_selected

        --------------------------------------------------------
        */

        const applicable_stat_1_selected =
            system.app_stat_1
            ??
            "";

        const applicable_stat_2_selected =
            system.app_stat_2
            ??
            "";

        const applicable_stat_3_selected =
            system.app_stat_3
            ??
            "";

        /*
        --------------------------------------------------------
        New Rank Safety
        --------------------------------------------------------
        */

        system.new_ranks ??=
        {
            value:0
        };

        /*
        --------------------------------------------------------
        Owned Skills
        --------------------------------------------------------
        */

        const skills =
            category.parent
                ?.items
                ?.filter(

                    item =>

                        item.type === "skill"

                    &&

                        item.system.category === category.id

                )
            ??
            [];

        /*
        --------------------------------------------------------
        Return Context
        --------------------------------------------------------
        */

        return {

            ...context,

            item:
                category,

            category,

            system,

            applicable_stat_list,

            applicable_stat_1_selected,

            applicable_stat_2_selected,

            applicable_stat_3_selected,

            skills,

            enrichedDescription:
                context.enrichedDescription,

            editable:
                this.isEditable

        };

    }

}