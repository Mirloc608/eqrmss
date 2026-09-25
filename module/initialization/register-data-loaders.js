// ============================================================
// EQRMSS Data Loader Registration
// ============================================================

import { initializeEQRMSSDataLoaders } from "./initialize-data-loaders.js";
import { EQRMSS_DATA_LOADERS } from "../data/loaders/index.js";

export function registerEQRMSSDataLoaders() {
  console.info("EQRMSS | Registering data loaders");

  for (const entry of EQRMSS_DATA_LOADERS) {
    if (typeof entry.loader !== "function") {
      console.error(
        `EQRMSS | Invalid data loader: ${entry.name}. Expected loader to be a function.`
      );
    }
  }

  game.eqrmss = game.eqrmss || {};
  game.eqrmss.initializeDataLoaders = initializeEQRMSSDataLoaders;

  console.info("EQRMSS | Data loaders registered");
}
