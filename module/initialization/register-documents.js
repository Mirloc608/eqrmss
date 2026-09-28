// ============================================================
// EQRMSS Document Registration
// ============================================================

import EQRMSSActor from "../documents/actor.js";
import EQRMSSItem  from "../documents/item.js";

export function registerEQRMSSDocuments() {
  console.info("EQRMSS | Registering documents");

  CONFIG.Actor.documentClass = EQRMSSActor;
  CONFIG.Item.documentClass  = EQRMSSItem;
}
