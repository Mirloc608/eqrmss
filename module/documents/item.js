// ============================================================
// EQRMSS Item Document Entry
//
// EverQuest - Rolemaster Standard System
//
// Item Document Export Gateway
//
// Foundry VTT V13 / V14 Compatible
//
// ============================================================

// Re-export all named item types
export * from "./item/index.js";

// Default export used by CONFIG.Item.documentClass
export { EQRMSSItem as default } from "./item/index.js";