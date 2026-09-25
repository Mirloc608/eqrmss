/**
 * EQ-RMSS Expansion Loader
 * Loads expansion data and registers expansions with the system
 * Foundry VTT V13/V14 Compatible
 * 
 * This was missing (404) - now stubbed to prevent crash
 */

export const EQRMSSExpansionLoader = {
    expansions: {},
    loaded: false,

    async loadAll() {
        console.log("EQRMSS | ExpansionLoader | Starting (stub - no expansions configured)");
        
        // Try to browse expansion folder if it exists
        const basePath = "systems/eqrmss/module/expansion/data";
        try {
            const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
            if (!FilePickerImpl) {
                console.log("EQRMSS | ExpansionLoader | FilePicker unavailable, skipping");
                this.loaded = true;
                return {};
            }
            
            const browse = await FilePickerImpl.browse("data", basePath).catch(() => ({ dirs: [], files: [] }));
            
            if (browse.dirs.length === 0 && browse.files.length === 0) {
                console.log("EQRMSS | ExpansionLoader | No expansion data found at", basePath, "- this is normal if no expansions installed");
            } else {
                console.log("EQRMSS | ExpansionLoader | Found", browse.dirs.length, "expansion folders");
                // Future: load expansion manifests
            }
        } catch (err) {
            console.warn("EQRMSS | ExpansionLoader | Error browsing expansion data (non-fatal):", err.message);
        }
        
        this.loaded = true;
        game.eqrmss = game.eqrmss || {};
        game.eqrmss.expansions = this;
        
        return this.expansions;
    },

    getExpansion(id) {
        return this.expansions[id] || null;
    },

    getAllExpansions() {
        return Object.keys(this.expansions);
    },

    isLoaded() {
        return this.loaded;
    }
};

// Auto-expose for compatibility
if (typeof window !== 'undefined') {
    window.EQRMSSExpansionLoader = EQRMSSExpansionLoader;
}
