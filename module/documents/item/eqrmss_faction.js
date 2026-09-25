// ============================================================
// EQRMSS Faction Item
// ============================================================

import { EQRMSSItem } from "./eqrmss_item.js";

export class EQRMSSFaction extends EQRMSSItem
{

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this.system.faction ??=
        {

            standing:0,

            allies:[],

            enemies:[]

        };

    }

}