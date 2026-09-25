// ============================================================
// EQRMSS Herb / Poison Item
// ============================================================

import { EQRMSSItem } from "./eqrmss_item.js";

export class EQRMSSHerbOrPoison extends EQRMSSItem
{

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this.system.effect ??=
        {

            duration:0,

            potency:0,

            type:""

        };

    }

}