// ============================================================
// EQRMSS Initialization Facade
// Foundry VTT V13 / V14
// ============================================================
// Central export point for all initialization functions so that
// eqrmss.js can import everything from a single module.
//
// The actual implementations live in the sibling initialization
// files and in the data loaders directory.
// ============================================================

// Settings / documents / sheets / hooks / templates
export { registerEQRMSSSettings }      from "./register-settings.js";
export { registerEQRMSSDocuments }     from "./register-documents.js";
export { registerEQRMSSSheets }        from "./register-sheets.js";
export { registerEQRMSSHooks }         from "./register-hooks.js";
export { loadEQRMSSTemplates }         from "./template-loader.js";

// Subsystems
export { initializeEQRMSSSubsystems }  from "./initialize-subsystems.js";

// Data loader registration + runtime loader
export { registerEQRMSSDataLoaders }   from "./register-data-loaders.js";
export { initializeEQRMSSDataLoaders } from "./initialize-data-loaders.js";

// Optional: re-export the data loader registry itself if needed elsewhere
export { EQRMSS_DATA_LOADERS }         from "../data/loaders/index.js";
