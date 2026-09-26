/**
 * EQRMSS Pet Manager + Wizard Export Fix v4.4 - FINAL FIX
 * Fixes:
 * 1. EQRMSSPetManager not renderable (V13 requires _renderHTML/_replaceHTML)
 * 2. Wizard not in globalThis
 * 3. Character data service: races=0, classes=0 in wizard preview (loads from wrong source)
 */

console.log("EQRMSS | Pet Manager + Wizard Export Fix v4.4 | Loading");

// Patch any Application that misses _renderHTML
function patchRenderable(cls) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssRenderPatched) return true;
    
    const proto = cls.prototype;
    let patched = false;
    
    if (!proto._renderHTML || proto._renderHTML.toString().includes('not renderable')) {
        console.log(`EQRMSS | Pet Fix v4.4 | Patching ${cls.name}._renderHTML`);
        proto._renderHTML = async function(context, options) {
            // If class has template, use Handlebars
            if (this.template) {
                try {
                    const html = await foundry.applications.handlebars.renderTemplate(this.template, context);
                    return html;
                } catch (e) {
                    console.warn(`EQRMSS | ${cls.name} template failed:`, e);
                    return `<div>Error: ${e.message}</div>`;
                }
            }
            // If it has getData or _prepareContext
            if (this.element?.innerHTML && this.element.innerHTML.length > 100) {
                return this.element.innerHTML;
            }
            return `<div>${cls.name} placeholder</div>`;
        };
        patched = true;
    }
    
    if (!proto._replaceHTML) {
        console.log(`EQRMSS | Pet Fix v4.4 | Patching ${cls.name}._replaceHTML`);
        proto._replaceHTML = function(result, content, options) {
            if (!this.element) return;
            if (typeof result === 'string') {
                this.element.innerHTML = result;
            } else if (result instanceof HTMLElement) {
                this.element.innerHTML = '';
                this.element.appendChild(result);
            } else if (content instanceof HTMLElement) {
                this.element.innerHTML = '';
                this.element.appendChild(content);
            } else if (result?.innerHTML) {
                this.element.innerHTML = result.innerHTML;
            }
        };
        patched = true;
    }
    
    if (patched) {
        proto._eqrmssRenderPatched = true;
        console.log(`EQRMSS | Pet Fix v4.4 | ${cls.name} patched to be renderable`);
    }
    return patched;
}

Hooks.once("init", () => {
    console.log("EQRMSS | Pet Fix v4.4 | init");
    ['EQRMSSPetManager', 'PetManager'].forEach(name => {
        const cls = globalThis[name];
        if (cls) patchRenderable(cls);
    });
});

Hooks.once("ready", async () => {
    console.log("EQRMSS | Pet Fix v4.4 | ready - patching managers");
    ['EQRMSSPetManager', 'PetManager'].forEach(name => {
        const cls = globalThis[name];
        if (cls) patchRenderable(cls);
    });
    
    Object.keys(globalThis).forEach(key => {
        if (key.startsWith('EQRMSS') && key.includes('Manager') && typeof globalThis[key] === 'function') {
            patchRenderable(globalThis[key]);
        }
    });
    
    // Also patch the actual actor sheet's pet manager creation to prevent crash
    // Hook the sheet's _onRender to catch pet manager errors
    const sheetClasses = ['EQRMSSActorSheet', 'EQRMSSPlayerSheet'];
    sheetClasses.forEach(sheetName => {
        const sheetCls = globalThis[sheetName];
        if (sheetCls?.prototype?._onRender && !sheetCls.prototype._eqrmssPetPatched) {
            const orig = sheetCls.prototype._onRender;
            sheetCls.prototype._onRender = async function(html, ...rest) {
                try {
                    return await orig.call(this, html, ...rest);
                } catch (e) {
                    if (e.message?.includes('not renderable') || e.message?.includes('EQRMSSPetManager')) {
                        console.error(`EQRMSS | ${sheetName}._onRender crashed due to PetManager, patching and retrying`, e);
                        // Patch PetManager now
                        if (globalThis.EQRMSSPetManager) patchRenderable(globalThis.EQRMSSPetManager);
                        // Retry without pet manager part - try to render again but ignore pet error
                        try {
                            // Temporarily override pet manager render to no-op
                            const origPetRender = globalThis.EQRMSSPetManager?.prototype?.render;
                            if (globalThis.EQRMSSPetManager?.prototype) {
                                globalThis.EQRMSSPetManager.prototype.render = async function() {
                                    console.warn("EQRMSS | PetManager render suppressed due to previous error");
                                    return this;
                                };
                            }
                            const result = await orig.call(this, html, ...rest);
                            // Restore
                            if (origPetRender && globalThis.EQRMSSPetManager?.prototype) {
                                globalThis.EQRMSSPetManager.prototype.render = origPetRender;
                            }
                            return result;
                        } catch (e2) {
                            console.error(`EQRMSS | Retry also failed:`, e2);
                            throw e; // throw original
                        }
                    }
                    throw e;
                }
            };
            sheetCls.prototype._eqrmssPetPatched = true;
            console.log(`EQRMSS | Pet Fix v4.4 | Patched ${sheetName}._onRender to catch PetManager errors`);
        }
    });
});

// Wizard global export - more robust
async function ensureWizardGlobal() {
    console.log("EQRMSS | Wizard Export v4.4 | Ensuring wizard global...");
    
    if (globalThis.EQRMSSCharacterCreationWizard) {
        console.log("EQRMSS | Wizard already global:", globalThis.EQRMSSCharacterCreationWizard.name);
        return globalThis.EQRMSSCharacterCreationWizard;
    }
    
    const possiblePaths = [
        "../apps/eqrmss-character-creation-wizard.js",
        "./apps/eqrmss-character-creation-wizard.js",
        "systems/eqrmss/module/apps/eqrmss-character-creation-wizard.js"
    ];
    
    for (const path of possiblePaths) {
        try {
            const mod = await import(path);
            let wizardClass = null;
            for (const key of Object.keys(mod)) {
                const val = mod[key];
                if (typeof val === 'function' && key.toLowerCase().includes('wizard')) {
                    wizardClass = val;
                    break;
                }
            }
            if (!wizardClass && mod.default && typeof mod.default === 'function') {
                wizardClass = mod.default;
            }
            if (wizardClass) {
                globalThis.EQRMSSCharacterCreationWizard = wizardClass;
                globalThis.CharacterCreationWizard = wizardClass;
                game.eqrmss = game.eqrmss || {};
                game.eqrmss.CharacterCreationWizard = wizardClass;
                console.log(`EQRMSS | Wizard Export v4.4 | SUCCESS from ${path}: ${wizardClass.name}`);
                return wizardClass;
            }
        } catch (e) {
            // continue
        }
    }
    console.error("EQRMSS | Wizard Export v4.4 | FAILED");
    return null;
}

Hooks.once("ready", async () => {
    await ensureWizardGlobal();
    
    game.eqrmss = game.eqrmss || {};
    
    // Override openWizard with v4.4 version that also fixes data service
    game.eqrmss.openWizard = async (actor = null) => {
        console.log("EQRMSS | openWizard v4.4 called");
        
        let wizardClass = globalThis.EQRMSSCharacterCreationWizard || game.eqrmss.CharacterCreationWizard;
        if (!wizardClass) wizardClass = await ensureWizardGlobal();
        
        if (!wizardClass) {
            ui.notifications.error("Wizard class not found");
            return null;
        }
        
        try {
            console.log(`EQRMSS | Creating wizard ${wizardClass.name}...`);
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            
            // FIX: Character Creation Data Service loads races=0, classes=0
            // Because it looks at game.packs or wrong path, not game.eqrmss.races
            // Patch its data service to use game.eqrmss data
            if (wizard.dataService) {
                console.log("EQRMSS | Patching wizard dataService to use game.eqrmss data");
                const originalInit = wizard.dataService.initialize?.bind(wizard.dataService);
                if (originalInit) {
                    // Override to inject our data
                    wizard.dataService.initialize = async function() {
                        const result = await originalInit();
                        console.log(`EQRMSS | DataService original init: races=${Object.keys(this.races||{}).length}, classes=${Object.keys(this.classes||{}).length}`);
                        // If races=0, inject from game.eqrmss
                        if (Object.keys(this.races||{}).length === 0) {
                            this.races = game.eqrmss.races || {};
                            this.classes = game.eqrmss.classes || {};
                            console.log(`EQRMSS | Injected game.eqrmss data: races=${Object.keys(this.races).length}, classes=${Object.keys(this.classes).length}`);
                        }
                        return result;
                    };
                }
            }
            
            await wizard.render(true);
            console.log(`EQRMSS | Wizard rendered v4.4!`);
            
            // After render, check data service
            setTimeout(() => {
                const ds = wizard.dataService;
                if (ds) {
                    console.log(`EQRMSS | Wizard dataService after render: races=${Object.keys(ds.races||{}).length}, classes=${Object.keys(ds.classes||{}).length}, cities=${Object.keys(ds.cities||{}).length}`);
                    if (Object.keys(ds.races||{}).length === 0) {
                        console.warn("EQRMSS | Wizard dataService still has 0 races - injecting");
                        ds.races = game.eqrmss.races || {};
                        ds.classes = game.eqrmss.classes || {};
                        // Force re-render
                        wizard.render(true);
                    }
                }
            }, 500);
            
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard v4.4 failed:", e);
            console.error(e.stack);
            ui.notifications.error(`Wizard failed: ${e.message}`);
            throw e;
        }
    };
    
    console.log("EQRMSS | Wizard Export Fix v4.4 | Ready");
});

export const PetManagerWizardFixV44 = { version: "4.4" };
