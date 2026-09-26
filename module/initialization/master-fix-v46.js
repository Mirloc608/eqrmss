/**
 * EQRMSS Master Fix v4.6 - FINAL FINAL
 * Fixes:
 * 1. Sheets blank in V13 (V12 getData/template -> V13 _prepareContext/_renderHTML)
 * 2. Wizard races=0 + .find is not a function (object vs array)
 * 3. PetManager not renderable
 * 4. Wizard global export + data injection
 */
console.log("EQRMSS | Master Fix v4.6 | Loading");

// === HELPERS ===
function toArray(obj) {
    if (Array.isArray(obj)) return obj;
    if (!obj) return [];
    // Object map -> array with id field
    return Object.entries(obj).map(([key, val]) => {
        if (typeof val === 'object' && val !== null) {
            if (!val.id) val.id = key;
            if (!val.key) val.key = key;
            return val;
        }
        return { id: key, name: key, value: val };
    });
}

function patchRenderable(cls) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssMasterPatched) return true;
    const proto = cls.prototype;
    let patched = false;
    
    if (!proto._renderHTML || proto._renderHTML.toString().includes('not renderable') || proto._renderHTML.toString().includes('not implemented')) {
        proto._renderHTML = async function(context, options) {
            if (this.template) {
                try {
                    const html = await foundry.applications.handlebars.renderTemplate(this.template, context);
                    return html;
                } catch (e) {
                    return `<div>Error: ${e.message}</div>`;
                }
            }
            return this.element?.innerHTML || `<div>${cls.name}</div>`;
        };
        patched = true;
    }
    if (!proto._replaceHTML) {
        proto._replaceHTML = function(result) {
            if (!this.element) return;
            if (typeof result === 'string') this.element.innerHTML = result;
            else if (result instanceof HTMLElement) {
                this.element.innerHTML = '';
                this.element.appendChild(result);
            } else if (result?.innerHTML) {
                this.element.innerHTML = result.innerHTML;
            }
        };
        patched = true;
    }
    if (patched) {
        proto._eqrmssMasterPatched = true;
        console.log(`EQRMSS | Master Fix v4.6 | Patched ${cls.name} to be renderable`);
    }
    return patched;
}

// === 1. SHEET V13 BRIDGE ===
function isOldSheet(cls) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssSheetV13Patched) return false;
    return typeof cls.prototype.getData === 'function';
}

function patchSheetToV13(cls, name) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssSheetV13Patched) return true;
    const proto = cls.prototype;
    console.log(`EQRMSS | Master Fix v4.6 | Patching sheet ${name} (${cls.name}) to V13`);
    
    const origGetData = proto.getData;
    const origPrepareContext = proto._prepareContext;
    const origOnRender = proto._onRender;
    const origActivateListeners = proto.activateListeners;
    
    proto._prepareContext = async function(options) {
        let context = {};
        if (origPrepareContext && origPrepareContext !== proto._prepareContext) {
            try {
                const pc = await origPrepareContext.call(this, options);
                if (pc) Object.assign(context, pc);
            } catch {}
        }
        if (origGetData) {
            try {
                const data = await origGetData.call(this, options);
                Object.assign(context, data);
            } catch (e) {
                console.warn(`EQRMSS | ${name} getData failed:`, e.message);
            }
        }
        if (this.actor) {
            context.actor = this.actor;
            context.system = this.actor.system;
        }
        if (this.item) {
            context.item = this.item;
            context.system = this.item.system;
        }
        context.eqrmss = game.eqrmss || {};
        return context;
    };
    
    proto._renderHTML = async function(context, options) {
        let templatePath = null;
        if (this.template) templatePath = typeof this.template === 'function' ? this.template : this.template;
        else if (proto.template) templatePath = typeof proto.template === 'function' ? proto.template.call(this) : proto.template;
        if (!templatePath && this.constructor?.template) templatePath = this.constructor.template;
        
        if (!templatePath) return `<div>No template for ${name}</div>`;
        try {
            const html = await foundry.applications.handlebars.renderTemplate(templatePath, context);
            return html;
        } catch (e) {
            console.error(`EQRMSS | ${name} renderTemplate failed:`, e);
            return `<div>Template error: ${e.message}<br>${templatePath}</div>`;
        }
    };
    
    proto._replaceHTML = function(result) {
        if (!this.element) return;
        if (typeof result === 'string') this.element.innerHTML = result;
        else if (result instanceof HTMLElement) {
            this.element.innerHTML = '';
            this.element.appendChild(result);
        } else if (result?.innerHTML) {
            this.element.innerHTML = result.innerHTML;
        }
        if (origOnRender) {
            try {
                const htmlParam = this.element;
                if (htmlParam && !htmlParam.find && HTMLElement.prototype.find) htmlParam.find = HTMLElement.prototype.find.bind(htmlParam);
                const r = origOnRender.call(this, htmlParam, options);
                if (r instanceof Promise) r.catch(e => console.warn(e));
            } catch (e) { console.warn(e); }
        }
        if (origActivateListeners) {
            try { origActivateListeners.call(this, this.element); } catch {}
        }
    };
    
    proto._eqrmssSheetV13Patched = true;
    return true;
}

function patchAllSheets() {
    let count = 0;
    for (const [docType, map] of Object.entries(CONFIG.Actor?.sheetClasses || {})) {
        for (const [id, info] of Object.entries(map)) {
            if (info?.cls && isOldSheet(info.cls)) {
                if (patchSheetToV13(info.cls, `${docType}.${id}`)) count++;
            }
        }
    }
    for (const [docType, map] of Object.entries(CONFIG.Item?.sheetClasses || {})) {
        for (const [id, info] of Object.entries(map)) {
            if (info?.cls && isOldSheet(info.cls)) {
                if (patchSheetToV13(info.cls, `Item ${docType}.${id}`)) count++;
            }
        }
    }
    return count;
}

// === 2. WIZARD DATA FIXES ===
function patchWizardDataService() {
    // Patch filterByExpansionGate globally if it exists as function
    const g = globalThis;
    
    // Monkey-patch EQRMSSCharacterCreationData if loaded
    Hooks.once("ready", () => {
        const dataServiceClasses = ['EQRMSSCharacterCreationData', 'CharacterCreationDataService', 'EQRMSSCharacterCreationWizardData'];
        for (const className of dataServiceClasses) {
            const cls = g[className];
            if (cls?.prototype?.getContext) {
                console.log(`EQRMSS | Master Fix v4.6 | Patching ${className}.getContext to handle object->array`);
                const origGetContext = cls.prototype.getContext;
                cls.prototype.getContext = async function(...args) {
                    const ctx = await origGetContext.apply(this, args);
                    // Ensure races/classes are arrays
                    if (ctx) {
                        if (ctx.races && !Array.isArray(ctx.races)) {
                            console.log(`EQRMSS | Converting ctx.races object->array: ${Object.keys(ctx.races).length} -> ${toArray(ctx.races).length}`);
                            ctx.races = toArray(ctx.races);
                        }
                        if (ctx.classes && !Array.isArray(ctx.classes)) {
                            ctx.classes = toArray(ctx.classes);
                        }
                        if (ctx.deities && !Array.isArray(ctx.deities)) ctx.deities = toArray(ctx.deities);
                        if (ctx.cities && !Array.isArray(ctx.cities)) ctx.cities = toArray(ctx.cities);
                    }
                    return ctx;
                };
            }
            
            // Patch filterByExpansionGate method if exists
            if (cls.prototype.filterByExpansionGate) {
                const origFilter = cls.prototype.filterByExpansionGate;
                cls.prototype.filterByExpansionGate = function(items, ...rest) {
                    const arr = toArray(items);
                    try { return origFilter.call(this, arr, ...rest); } 
                    catch (e) {
                        console.warn(`EQRMSS | filterByExpansionGate failed, returning all:`, e.message);
                        return arr;
                    }
                };
            }
        }
        
        // Also patch the standalone function if it's global
        if (typeof g.filterByExpansionGate === 'function') {
            const orig = g.filterByExpansionGate;
            g.filterByExpansionGate = function(items, ...rest) {
                const arr = toArray(items);
                try { return orig(arr, ...rest); }
                catch { return arr; }
            };
        }
    });
}

// Also patch wizard _prepareContext to handle object races
function patchWizardPrepareContext() {
    Hooks.once("ready", () => {
        const wizardClasses = [globalThis.EQRMSSCharacterCreationWizard, globalThis.CharacterCreationWizard];
        for (const wc of wizardClasses) {
            if (!wc?.prototype?._prepareContext) continue;
            if (wc.prototype._eqrmssWizardPatched) continue;
            
            console.log(`EQRMSS | Master Fix v4.6 | Patching ${wc.name}._prepareContext for object->array`);
            const orig = wc.prototype._prepareContext;
            wc.prototype._prepareContext = async function(...args) {
                try {
                    const ctx = await orig.apply(this, args);
                    // Fix dataContext
                    if (ctx?.races && !Array.isArray(ctx.races)) ctx.races = toArray(ctx.races);
                    if (ctx?.classes && !Array.isArray(ctx.classes)) ctx.classes = toArray(ctx.classes);
                    if (ctx?.data?.races && !Array.isArray(ctx.data.races)) ctx.data.races = toArray(ctx.data.races);
                    if (ctx?.data?.classes && !Array.isArray(ctx.data.classes)) ctx.data.classes = toArray(ctx.data.classes);
                    // Also fix races.find calls
                    if (ctx?.races && typeof ctx.races.find !== 'function') {
                        console.warn("EQRMSS | ctx.races still not array after conversion!");
                        ctx.races = toArray(ctx.races);
                    }
                    return ctx;
                } catch (e) {
                    console.error(`EQRMSS | Wizard _prepareContext failed:`, e);
                    console.error(e.stack);
                    // Try to return minimal context with arrays
                    return {
                        races: toArray(game.eqrmss?.races || {}),
                        classes: toArray(game.eqrmss?.classes || {}),
                        cities: toArray(game.eqrmss?.cities || {}),
                        deities: [],
                        error: e.message
                    };
                }
            };
            wc.prototype._eqrmssWizardPatched = true;
        }
    });
}

Hooks.once("init", () => {
    console.log("EQRMSS | Master Fix v4.6 | init");
    patchWizardDataService();
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Master Fix v4.6 | ready");
    
    // Patch sheets
    setTimeout(() => {
        const count = patchAllSheets();
        console.log(`EQRMSS | Master Fix v4.6 | Patched ${count} sheets to V13`);
    }, 500);
    
    // Patch pet managers
    ['EQRMSSPetManager', 'PetManager'].forEach(n => {
        const c = globalThis[n];
        if (c) patchRenderable(c);
    });
    
    patchWizardPrepareContext();
    
    // Fix wizard openWizard to inject arrays
    game.eqrmss = game.eqrmss || {};
    game.eqrmss.openWizard = async (actor = null) => {
        console.log("EQRMSS | Master Fix v4.6 openWizard called");
        let wizardClass = globalThis.EQRMSSCharacterCreationWizard || game.eqrmss.CharacterCreationWizard;
        if (!wizardClass) {
            ui.notifications.error("Wizard class not found");
            return null;
        }
        try {
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            
            // Pre-inject dataService with arrays BEFORE render
            if (wizard.dataService) {
                console.log("EQRMSS | Injecting array data into wizard dataService BEFORE render");
                // Convert game.eqrmss data to arrays and inject
                const racesArr = toArray(game.eqrmss.races || {});
                const classesArr = toArray(game.eqrmss.classes || {});
                console.log(`EQRMSS | Races: ${Object.keys(game.eqrmss.races||{}).length} obj -> ${racesArr.length} arr`);
                console.log(`EQRMSS | Classes: ${Object.keys(game.eqrmss.classes||{}).length} obj -> ${classesArr.length} arr`);
                
                // Patch initialize to return arrays
                const origInit = wizard.dataService.initialize?.bind(wizard.dataService);
                wizard.dataService.initialize = async function() {
                    let result = null;
                    if (origInit) result = await origInit().catch(e => { console.warn(e); return null; });
                    
                    // Always override with our array data
                    this.races = racesArr;
                    this.classes = classesArr;
                    this.cities = this.cities || toArray(game.eqrmss?.cities || {}) || [];
                    if (Object.keys(this.cities).length === 0) {
                        // Try to load cities from pack or game
                        this.cities = toArray(game.eqrmss?.data?.cities || {});
                    }
                    
                    console.log(`EQRMSS | Wizard dataService after injection: races=${this.races.length}, classes=${this.classes.length}`);
                    return result;
                };
                
                // Also set immediately
                wizard.dataService.races = racesArr;
                wizard.dataService.classes = classesArr;
            }
            
            await wizard.render(true);
            console.log("EQRMSS | Wizard rendered v4.6!");
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard v4.6 failed:", e);
            console.error(e.stack);
            ui.notifications.error(`Wizard failed: ${e.message}`);
            throw e;
        }
    };
    
    console.log("EQRMSS | Master Fix v4.6 | Ready - game.eqrmss.openWizard() fixed");
    
    game.eqrmss.fixSheetsV13 = () => {
        const count = patchAllSheets();
        for (const a of game.actors.contents) {
            a.sheet?.close({ animate: false });
        }
        setTimeout(async () => {
            for (const a of game.actors.contents) {
                try {
                    await a.sheet?.render(true, { force: true });
                    console.log(`  ${a.name}: ${a.sheet?.element?.innerHTML?.length || 0} chars`);
                } catch (e) { console.error(e); }
            }
        }, 500);
        return count;
    };
    
    game.eqrmss.debugSheets = () => {
        console.log("=== SHEET DEBUG v4.6 ===");
        for (const a of game.actors.contents) {
            console.log(`${a.name}: sheet=${a.sheet?.constructor.name}, html=${a.sheet?.element?.innerHTML?.length || 0}`);
            if (a.sheet?.element && a.sheet.element.innerHTML.length < 500) {
                console.log(a.sheet.element.innerHTML.substring(0, 500));
            }
        }
    };
});

export const MasterFixV46 = { version: "4.6" };
