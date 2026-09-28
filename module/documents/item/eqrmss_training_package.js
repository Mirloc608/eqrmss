// ============================================================
// EQRMSS Training Package Item
// ============================================================

import { EQRMSSItem } from "./eqrmss_item.js";

export class EQRMSSTrainingPackage extends EQRMSSItem
{

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this.system.training ??=
        {

            skills:[],

            costs:{}

        };

    }

}