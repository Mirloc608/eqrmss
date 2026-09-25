// ============================================================================
// EQRMSS Actor Sheet — Tabs Helper
// ============================================================================
//
// Responsibilities:
// - Activate Foundry's tab controller
// - Support right‑side vertical tab bar
// - Ensure tab switching works after every render
// - Provide safe DOM access under ApplicationV2
//
// ============================================================================

export class EQRMSSActorTabsHelper {

    constructor(sheet) {
        this.sheet = sheet;
        this.actor = sheet.actor;
    }

    // =========================================================================
    // ACTIVATE TABS
    // =========================================================================
    activate() {

        const html = this.sheet.element;
        if (!html) return;

        // ------------------------------------------------------------
        // Right‑side tab bar selector
        // ------------------------------------------------------------
        const navSelector     = ".eqrmss-tabs-right .tabs";
        const contentSelector = ".sheet-body";

        // Use the simple Tabs API provided by Foundry
        try {
            const TabsCls = foundry?.applications?.ux?.Tabs || foundry?.applications?.Tabs || window?.Tabs || Tabs;
            const tabs = new TabsCls({
                navSelector,
                contentSelector,
                initial: "record"
            });

            // Bind safely (support jQuery element or raw element)
            tabs.bind((html && html[0]) || html);
            this.sheet._tabs = tabs;
        }
        catch (err) {
            console.warn("eqrmss | Tabs activation failed", err);
        }

    }

    // =========================================================================
    // PROGRAMMATIC TAB SWITCHING (optional)
    // =========================================================================
    switchTo(tabName) {
        if (this.sheet._tabs) {
            this.sheet._tabs.activate(tabName);
        }
    }
}
