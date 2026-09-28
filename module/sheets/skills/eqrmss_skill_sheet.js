// ============================================================
// EQRMSS Skill Sheet
// Foundry VTT V13 ApplicationV2
// ============================================================

import EQRMSSItemSheet
    from "../items/eqrmss_item_sheet.js";

export default class EQRMSSSkillSheet
    extends EQRMSSItemSheet
{

    static PARTS =
    {

        form:
        {

            template:
                "systems/eqrmss/templates/sheets/skills/eqrmss-skill-sheet.html"

        }

    };

    /**
     * ---------------------------------------------------------
     * Prepare Skill Sheet Context
     * ---------------------------------------------------------
     */
    async _prepareContext(options)
    {

        const context =
            await super._prepareContext(options);

        const skill =
            this.document;

        const actor =
            skill.parent;

        /*
        --------------------------------------------------------
        Owned Skill Categories
        --------------------------------------------------------
        */

        const ownedSkillCategories =
            actor
                ?.items
                ?.filter(

                    item =>

                        item.type === "skill_category"

                )
            ??
            [];

        const owned_skillcats =
        {};

        for(
            const category of ownedSkillCategories
        )
        {

            owned_skillcats[category.id] =
                category.name;

        }

        /*
        --------------------------------------------------------
        Skill Designations
        --------------------------------------------------------
        */

        const designations =
            CONFIG.eqrmss
                ?.skill_designations
            ??
            {};

        /*
        --------------------------------------------------------
        New Rank Safety
        --------------------------------------------------------
        */

        skill.system.new_ranks ??=
        {
            value:0
        };

        /*
        --------------------------------------------------------
        Return Context
        --------------------------------------------------------
        */

        return {

            ...context,

            item:
                skill,

            skill,

            system:
                skill.system,

            owned_skillcats,

            designations,

            selected_skillcat:
                skill.system.category
                ??
                null,

            enrichedDescription:
                context.enrichedDescription,

            editable:
                this.isEditable

        };

    }

    /**
     * ---------------------------------------------------------
     * Activate Sheet Listeners
     * ---------------------------------------------------------
     */
    async _onRender(
        context,
        options
    )
    {

        await super._onRender(
            context,
            options
        );

        this._activateNewRankButton();

    }

    /**
     * ---------------------------------------------------------
     * New Rank Button
     * ---------------------------------------------------------
     */
    _activateNewRankButton()
    {

        if(
            !this.element
        )
        {
            return;
        }

        const buttons =
            this.element.querySelectorAll(
                ".skillsheet-newrank"
            );

        for(
            const button of buttons
        )
        {

            button.addEventListener(

                "click",

                async event =>
                {

                    event.preventDefault();

                    const current =
                        Number(
                            this.document.system.new_ranks?.value
                            ??
                            0
                        );

                    let next =
                        current + 1;

                    if(
                        next > 3
                    )
                    {
                        next = 0;
                    }

                    await this.document.update(
                    {

                        "system.new_ranks.value":
                            next

                    });

                }

            );

        }

    }

}