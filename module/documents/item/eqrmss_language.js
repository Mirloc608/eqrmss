// ============================================================
// EQRMSS Language Item
// ============================================================

import { EQRMSSItem } from "./eqrmss_item.js";

export class EQRMSSLanguage extends EQRMSSItem
{

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this.system.language ??=
        {

            spoken:false,

            written:false,

            rank:0

        };

    }

}