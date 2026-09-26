// EQRMSS v4.3 - Fix Pet Manager + Wizard global export
// Put this file at module/initialization/pet-manager-fix.js
// and import it FIRST in eqrmss.js

console.log("EQRMSS | Pet Manager + Wizard Export Fix v4.3 | Loading");

// Fix 1: Patch Application class to add missing _renderHTML/_replaceHTML if needed
Hooks.once("init", () => {
    console.log("EQRMSS | Pet Manager Fix v4.3 | init - patching Application classes");
    
    // Helper to patch any Application that fails the V13 renderable check
    function patchApplicationRenderable(cls) {
        if (!cls?.prototype) return;
        if (cls.prototype._eqrmssRenderPatched) return;
        
        const proto = cls.prototype;
        
        // If class extends Application but doesn't implement _renderHTML, add it
        if (!proto._renderHTML && !proto._eqrmssRenderPatched) {
            console.log(`EQRMSS | Patching ${cls.name}._renderHTML (was missing - causing renderable error)`);
            proto._renderHTML = async function(context, options) {
                // Try to use template if exists
                if (this.template) {
                    try {
                        const html = await foundry.applications.handlebars.renderTemplate(this.template, context);
                        return html;
                    } catch (e) {
                        console.warn(`EQRMSS | ${cls.name} template render failed:`, e);
                        return `<div>Template error: ${e.message}</div>`;
                    }
                }
                // Fallback: use element if already exists
                if (this.element?.innerHTML) return this.element.innerHTML;
                return `<div>${cls.name} - no template</div>`;
            };
            proto._eqrmssRenderPatched = true;
        }
        
        if (!proto._replaceHTML && !proto._eqrmssReplacePatched) {
            console.log(`EQRMSS | Patching ${cls.name}._replaceHTML`);
            proto._replaceHTML = function(result, content, options) {
                if (content instanceof HTMLElement && this.element) {
                    if (typeof content === 'string') {
                        this.element.innerHTML = content;
                    } else if (content.innerHTML) {
                        // If result is HTML string
                        if (typeof result === 'string') {
                            this.element.innerHTML = result;
                        } else if (result instanceof HTMLElement) {
                            this.element.innerHTML = '';
                            this.element.appendChild(result);
                        }
                    }
                    return;
                }
                // Default behavior
                if (this.element) {
                    if (typeof result === 'string') this.element.innerHTML = result;
                    else if (result?.innerHTML) this.element.innerHTML = result.innerHTML;
                }
            };
            proto._eqrmssReplacePatched = true;
        }
    }
    
    // Patch known problematic classes immediately
    const problematicClasses = ['EQRMSSPetManager', 'PetManager', 'EQRMSSCharacterCreationWizard', 'CharacterCreationWizard'];
    problematicClasses.forEach(name => {
        const cls = globalThis[name];
        if (cls) patchApplicationRenderable(cls);
    });
    
    // Also patch on ready - classes may be defined later
    Hooks.once("ready", () => {
        console.log("EQRMSS | Pet Manager Fix v4.3 | ready - patching again");
        problematicClasses.forEach(name => {
            const cls = globalThis[name];
            if (cls) patchApplicationRenderable(cls);
        });
        
        // Patch any EQRMSS Application
        Object.keys(globalThis).forEach(key => {
            if (key.startsWith('EQRMSS') && typeof globalThis[key] === 'function') {
                const cls = globalThis[key];
                // Check if it looks like an Application (has render method but missing _renderHTML)
                if (cls.prototype?.render && !cls.prototype._renderHTML) {
                    // Only patch if it's not already a proper ApplicationV2
                    if (!cls.prototype._renderHTML && cls.name.includes('Manager') || cls.name.includes('Wizard')) {
                        patchApplicationRenderable(cls);
                    }
                }
            }
        });
    });
    
    // Also hook application creation to patch on-demand
    const originalApplication = globalThis.Application;
    if (originalApplication) {
        // Monkey patch Application render to catch errors
        const originalRender = foundry?.applications?.api?.ApplicationV2?.prototype?.render;
    }
});

// Fix 2: Ensure wizard is exported to globalThis
// The wizard module is an ESModule, so its class isn't automatically global
// We need to import it and assign to globalThis

let wizardImportAttempted = false;

async function ensureWizardGlobal() {
    if (wizardImportAttempted) return globalThis.EQRMSSCharacterCreationWizard;
    wizardImportAttempted = true;
    
    console.log("EQRMSS | Wizard Export Fix | Trying to import wizard class...");
    
    const possiblePaths = [
        "./apps/eqrmss-character-creation-wizard.js",
        "../apps/eqrmss-character-creation-wizard.js",
        "systems/eqrmss/module/apps/eqrmss-character-creation-wizard.js"
    ];
    
    for (const path of possiblePaths) {
        try {
            const mod = await import(path);
            console.log(`EQRMSS | Wizard Export | Imported from ${path}:`, Object.keys(mod));
            
            // Try to find wizard class in module exports
            let wizardClass = null;
            for (const key of Object.keys(mod)) {
                const val = mod[key];
                if (typeof val === 'function' && key.toLowerCase().includes('wizard')) {
                    wizardClass = val;
                    console.log(`EQRMSS | Wizard Export | Found wizard class ${key} in ${path}`);
                    break;
                }
            }
            
            // Also check default export
            if (!wizardClass && mod.default && typeof mod.default === 'function') {
                if (mod.default.name.toLowerCase().includes('wizard')) {
                    wizardClass = mod.default;
                    console.log(`EQRMSS | Wizard Export | Found wizard as default export in ${path}`);
                }
            }
            
            if (wizardClass) {
                globalThis.EQRMSSCharacterCreationWizard = wizardClass;
                globalThis.CharacterCreationWizard = wizardClass;
                if (!game.eqrmss) game.eqrmss = {};
                game.eqrmss.CharacterCreationWizard = wizardClass;
                console.log(`EQRMSS | Wizard Export | SUCCESS - Wizard class now global: ${wizardClass.name}`);
                return wizardClass;
            }
        } catch (e) {
            console.log(`EQRMSS | Wizard Export | Failed to import from ${path}: ${e.message}`);
        }
    }
    
    // Last resort: search existing globals
    console.log("EQRMSS | Wizard Export | Searching existing globals for wizard...");
    for (const key of Object.keys(globalThis)) {
        const val = globalThis[key];
        if (typeof val === 'function' && key.toLowerCase().includes('wizard')) {
            console.log(`EQRMSS | Wizard Export | Found existing global wizard: ${key}`);
            globalThis.EQRMSSCharacterCreationWizard = val;
            return val;
        }
    }
    
    console.error("EQRMSS | Wizard Export | FAILED - Could not find wizard class anywhere");
    return null;
}

Hooks.once("ready", async () => {
    console.log("EQRMSS | Wizard Export Fix | ready - ensuring wizard is global");
    await ensureWizardGlobal();
    
    // Also expose openWizard that uses the imported class
    if (!game.eqrmss) game.eqrmss = {};
    const originalOpenWizard = game.eqrmss.openWizard;
    
    game.eqrmss.openWizard = async (actor = null) => {
        console.log("EQRMSS | openWizard v4.3 called");
        
        let wizardClass = globalThis.EQRMSSCharacterCreationWizard || game.eqrmss.CharacterCreationWizard;
        
        if (!wizardClass) {
            console.log("EQRMSS | No global wizard, trying import...");
            wizardClass = await ensureWizardGlobal();
        }
        
        if (!wizardClass) {
            console.error("EQRMSS | Wizard class still not found after import attempts");
            ui.notifications.error("Wizard class not found - check console, run game.eqrmss.debugWizard()");
            return null;
        }
        
        try {
            console.log(`EQRMSS | Creating wizard ${wizardClass.name}...`);
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            console.log(`EQRMSS | Rendering wizard...`);
            await wizard.render(true);
            console.log(`EQRMSS | Wizard rendered!`);
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard render failed:", e);
            console.error(e.stack);
            
            // Try V2 render
            try {
                const wizard2 = actor ? new wizardClass(actor) : new wizardClass();
                await wizard2.render({ force: true });
                return wizard2;
            } catch (e2) {
                ui.notifications.error(`Wizard failed: ${e.message}`);
                throw e;
            }
        }
    };
    
    console.log("EQRMSS | Wizard Export Fix | Ready - game.eqrmss.openWizard() available");
});

export const PetManagerWizardFix = { version: "4.3" };
