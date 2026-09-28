// ============================================================================
// EQRMSS Actor Sheet — Tabs Helper
// ============================================================================
//
// Single tab controller for the player sheet (Phase 4 consolidation).
//
// - ONE implementation: nav buttons toggle .active on the matching
//   [data-tab] content panels. No hand-rolled switching elsewhere.
// - Correct selectors for the PARTS-based sheet structure, where each
//   tab panel is a part root (no .sheet-body wrapper).
// - Persists the last active tab across re-renders via sheet._lastActiveTab.
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

        const nav = html.querySelector("nav.sheet-tabs[data-group]");
        if (!nav) return;

        // Content panels: .tab elements carrying data-tab, excluding anything
        // nested inside the nav itself (defensive; nav should be buttons only).
        const panels = [...html.querySelectorAll(".tab[data-tab]")]
            .filter(el => !nav.contains(el));

        const show = (name) => {
            this.sheet._lastActiveTab = name;
            nav.querySelectorAll("[data-tab]").forEach(btn => {
                btn.classList.toggle("active", btn.dataset.tab === name);
            });
            panels.forEach(panel => {
                panel.classList.toggle("active", panel.dataset.tab === name);
            });
        };

        nav.querySelectorAll("[data-tab]").forEach(btn => {
            // Avoid double-binding across re-renders.
            if (btn.dataset.eqrmssTabBound) return;
            btn.dataset.eqrmssTabBound = "true";
            btn.addEventListener("click", ev => {
                ev.preventDefault();
                const name = btn.dataset.tab;
                if (name) show(name);
            });
        });

        show(this.sheet._lastActiveTab || "main");
    }

    // =========================================================================
    // PROGRAMMATIC TAB SWITCHING
    // =========================================================================
    switchTo(tabName) {
        const html = this.sheet.element;
        if (!html || !tabName) return;
        const btn = html.querySelector(`nav.sheet-tabs [data-tab="${tabName}"]`);
        if (btn) btn.click();
    }
}
