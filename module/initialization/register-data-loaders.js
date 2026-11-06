// ============================================================
// EQRMSS Data Loader Registration
// ============================================================
// The data loaders themselves run through
// initializeEQRMSSDataLoaders (initialize-data-loaders.js),
// which eqrmss.js invokes during the ready pipeline. This
// registration only exposes that entry point on game.eqrmss.
// (The former EQRMSS_DATA_LOADERS registry in
// module/data/loaders/index.js was removed in the 2026-11-05
// cleanup: it was never called, and its wrappers referenced
// identifiers that do not exist.)
// ============================================================

import { initializeEQRMSSDataLoaders } from "./initialize-data-loaders.js";

export function registerEQRMSSDataLoaders() {
  console.info("EQRMSS | Registering data loaders");

  game.eqrmss = game.eqrmss || {};
  game.eqrmss.initializeDataLoaders = initializeEQRMSSDataLoaders;

  console.info("EQRMSS | Data loaders registered");
}
