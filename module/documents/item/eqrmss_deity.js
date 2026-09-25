// ============================================================
// EQRMSS Deity Item
// ============================================================

import { EQRMSSItem } from "./eqrmss_item.js";

export class EQRMSSDeity extends EQRMSSItem
{

    prepareDerivedData()
    {

        super.prepareDerivedData();

        this.system.deity ??=
        {

            alignment:"",

            domains:[],

            weapon:"",

            followers:[]

        };

    }

}