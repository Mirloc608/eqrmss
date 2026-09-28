// ============================================================
// EQRMSS CONFIGURATION
// ============================================================

import { EQRMSSRaceClassOverrideConfig } from "./apps/eqrmss-race-class-override-config.js";

Hooks.once("init", () => {
  CONFIG.EQRMSS = CONFIG.EQRMSS || {};
  CONFIG.EQRMSS.data = CONFIG.EQRMSS.data || {};
});

