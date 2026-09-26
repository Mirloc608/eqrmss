/**
 * EQRMSS Master Fix v4.9 - DIRECT MODULE PATCH
 * - Imports wizard data module directly and patches its initialize to inject game.eqrmss data as ARRAY
 * - Fixes sheets by patching on every render attempt, not just at ready
 */
console.log("EQRMSS | Master Fix v4.9 | Loading");

function toArray(obj) {
    if (Array.isArray(obj)) return obj;
    if (!obj) return [];
    if (typeof obj === 'object') {
        return Object.entries(obj).map(([key, val]) => {
            if (typeof val === 'object' && val !== null) {
                const clone = { ...val };
                if (!clone.id) clone.id = key;
                if (!clone.key) clone.key = key;
                if (!clone.name) clone.name = clone.label || key;
                return clone;
            }
            return { id: key, name: String(val), value: val };
        });
    }
    return [];
}

// Patch renderable
function patchRenderable(cls) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssMasterPatched) return true;
    const proto = cls.prototype;
    let patched = false;
    if (!proto._renderHTML || proto._renderHTML.toString().includes('not renderable') || proto._renderHTML.toString().includes('not implemented')) {
        proto._renderHTML = async function(context) {
            if (this.template) {
                try { return await foundry.applications.handlebars.renderTemplate(this.template, context); }
                catch (e) { return `<div>Error: ${e.message}</div>`; }
            }
            return this.element?.innerHTML || `<div>${cls.name}</div>`;
        };
        patched = true;
    }
    if (!proto._replaceHTML) {
        proto._replaceHTML = function(result) {
            if (!this.element) return;
            if (typeof result === 'string') this.element.innerHTML = result;
            else if (result instanceof HTMLElement) { this.element.innerHTML = ''; this.element.appendChild(result); }
            else if (result?.innerHTML) this.element.innerHTML = result.innerHTML;
        };
        patched = true;
    }
    if (patched) { proto._eqrmssMasterPatched = true; }
    return patched;
}

function isOldSheet(cls) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssSheetV13Patched) return false;
    return typeof cls.prototype.getData === 'function';
}

function patchSheetToV13(cls, name) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssSheetV13Patched) return true;
    const proto = cls.prototype;
    console.log(`EQRMSS | Master Fix v4.9 | Patching sheet ${name} (${cls.name}) to V13`);
    const origGetData = proto.getData;
    const origPrepareContext = proto._prepareContext;
    const origOnRender = proto._onRender;
    const origActivateListeners = proto.activateListeners;
    
    proto._prepareContext = async function(options) {
        let context = {};
        if (origPrepareContext && origPrepareContext !== proto._prepareContext) {
            try { const pc = await origPrepareContext.call(this, options); if (pc) Object.assign(context, pc); } catch {}
        }
        if (origGetData) {
            try { const data = await origGetData.call(this, options); Object.assign(context, data); } catch (e) {}
        }
        if (this.actor) { context.actor = this.actor; context.system = this.actor.system; }
        if (this.item) { context.item = this.item; context.system = this.item.system; }
        context.eqrmss = game.eqrmss || {};
        return context;
    };
    
    proto._renderHTML = async function(context) {
        let templatePath = this.template || proto.template || this.constructor?.template;
        if (typeof templatePath === 'function') {
            try { templatePath = templatePath.call(this); } catch { templatePath = null; }
        }
        if (!templatePath) return `<div>No template for ${name}</div>`;
        try { return await foundry.applications.handlebars.renderTemplate(templatePath, context); }
        catch (e) { console.error(`EQRMSS | ${name} renderTemplate failed:`, e); return `<div>Template error: ${e.message}</div>`; }
    };
    
    proto._replaceHTML = function(result) {
        if (!this.element) return;
        if (typeof result === 'string') this.element.innerHTML = result;
        else if (result instanceof HTMLElement) { this.element.innerHTML = ''; this.element.appendChild(result); }
        else if (result?.innerHTML) this.element.innerHTML = result.innerHTML;
        if (origOnRender) {
            try {
                const htmlParam = this.element;
                if (htmlParam && !htmlParam.find && HTMLElement.prototype.find) htmlParam.find = HTMLElement.prototype.find.bind(htmlParam);
                const r = origOnRender.call(this, htmlParam);
                if (r instanceof Promise) r.catch(()=>{});
            } catch {}
        }
        if (origActivateListeners) { try { origActivateListeners.call(this, this.element); } catch {} }
    };
    
    proto._eqrmssSheetV13Patched = true;
    return true;
}

function patchAllSheets() {
    let count = 0;
    try {
        for (const [docType, map] of Object.entries(CONFIG.Actor?.sheetClasses || {})) {
            for (const [id, info] of Object.entries(map || {})) {
                if (info?.cls && isOldSheet(info.cls)) {
                    if (patchSheetToV13(info.cls, `${docType}.${id}`)) count++;
                }
            }
        }
        for (const [docType, map] of Object.entries(CONFIG.Item?.sheetClasses || {})) {
            for (const [id, info] of Object.entries(map || {})) {
                if (info?.cls && isOldSheet(info.cls)) {
                    if (patchSheetToV13(info.cls, `Item ${docType}.${id}`)) count++;
                }
            }
        }
        for (const key of Object.keys(globalThis)) {
            if (key.includes('Sheet') && key.startsWith('EQRMSS')) {
                const cls = globalThis[key];
                if (cls && isOldSheet(cls)) {
                    if (patchSheetToV13(cls, `globalThis.${key}`)) count++;
                }
            }
        }
    } catch (e) { console.warn(e); }
    if (count > 0) console.log(`EQRMSS | Master Fix v4.9 | Patched ${count} sheets`);
    return count;
}

// DIRECT MODULE PATCH - import the actual wizard data file and patch it
async function directPatchWizardData() {
    console.log("EQRMSS | Master Fix v4.9 | Direct patching wizard data module via import");
    
    const possiblePaths = [
        "./apps/eqrmss-character-creation-wizard-data.js",
        "../apps/eqrmss-character-creation-wizard-data.js",
        "../../apps/eqrmss-character-creation-wizard-data.js",
        "systems/eqrmss/module/apps/eqrmss-character-creation-wizard-data.js"
    ];
    
    for (const path of possiblePaths) {
        try {
            const mod = await import(path);
            console.log(`EQRMSS | Master Fix v4.9 | Imported ${path}:`, Object.keys(mod));
            
            for (const key of Object.keys(mod)) {
                const cls = mod[key];
                if (typeof cls === 'function' && cls.prototype) {
                    // Check if it's the data service
                    if (cls.prototype.initialize || cls.prototype.getContext) {
                        console.log(`EQRMSS | Master Fix v4.9 | Found data class ${key} in ${path}`);
                        
                        // Patch initialize
                        if (cls.prototype.initialize && !cls.prototype._eqrmssDirectPatched) {
                            const origInit = cls.prototype.initialize;
                            cls.prototype.initialize = async function(...args) {
                                let result = null;
                                try { result = await origInit.apply(this, args); } catch (e) { console.warn(e); }
                                
                                // Always inject from game.eqrmss as ARRAY if 0 or object
                                const racesIsArray = Array.isArray(this.races);
                                const racesCount = racesIsArray ? this.races.length : Object.keys(this.races||{}).length;
                                const classesIsArray = Array.isArray(this.classes);
                                const classesCount = classesIsArray ? this.classes.length : Object.keys(this.classes||{}).length;
                                
                                if (racesCount === 0) {
                                    const arr = toArray(game.eqrmss?.races || {});
                                    if (arr.length > 0) {
                                        this.races = arr;
                                        console.log(`EQRMSS | Master Fix v4.9 | ${key}.initialize injected races ${arr.length} ARRAY (was 0)`);
                                    }
                                } else if (!racesIsArray) {
                                    this.races = toArray(this.races);
                                    console.log(`EQRMSS | Master Fix v4.9 | ${key}.initialize converted races to ARRAY ${this.races.length}`);
                                }
                                
                                if (classesCount === 0) {
                                    const arr = toArray(game.eqrmss?.classes || {});
                                    if (arr.length > 0) {
                                        this.classes = arr;
                                        console.log(`EQRMSS | Master Fix v4.9 | ${key}.initialize injected classes ${arr.length} ARRAY`);
                                    }
                                } else if (!classesIsArray) {
                                    this.classes = toArray(this.classes);
                                }
                                
                                if (this.cities && !Array.isArray(this.cities)) this.cities = toArray(this.cities);
                                if (this.deities && !Array.isArray(this.deities)) this.deities = toArray(this.deities);
                                
                                return result;
                            };
                            cls.prototype._eqrmssDirectPatched = true;
                        }
                        
                        // Patch getContext to handle object->array and filter fix
                        if (cls.prototype.getContext && !cls.prototype._eqrmssContextPatched) {
                            const origGetContext = cls.prototype.getContext;
                            cls.prototype.getContext = async function(...args) {
                                // Ensure races/classes are arrays BEFORE original getContext does filter
                                if (this.races && !Array.isArray(this.races)) this.races = toArray(this.races);
                                if (this.classes && !Array.isArray(this.classes)) this.classes = toArray(this.classes);
                                if (this.cities && !Array.isArray(this.cities)) this.cities = toArray(this.cities);
                                if (this.deities && !Array.isArray(this.deities)) this.deities = toArray(this.deities);
                                
                                const ctx = await origGetContext.apply(this, args);
                                if (ctx) {
                                    if (ctx.races && !Array.isArray(ctx.races)) ctx.races = toArray(ctx.races);
                                    if (ctx.classes && !Array.isArray(ctx.classes)) ctx.classes = toArray(ctx.classes);
                                    if (ctx.cities && !Array.isArray(ctx.cities)) ctx.cities = toArray(ctx.cities);
                                    if (ctx.deities && !Array.isArray(ctx.deities)) ctx.deities = toArray(ctx.deities);
                                }
                                return ctx;
                            };
                            cls.prototype._eqrmssContextPatched = true;
                            console.log(`EQRMSS | Master Fix v4.9 | Patched ${key}.getContext`);
                        }
                        
                        // Patch filterByExpansionGate
                        if (cls.prototype.filterByExpansionGate && !cls.prototype._eqrmssFilterPatched) {
                            const origFilter = cls.prototype.filterByExpansionGate;
                            cls.prototype.filterByExpansionGate = function(items, ...rest) {
                                const arr = toArray(items);
                                try { return origFilter.call(this, arr, ...rest); } catch (e) { console.warn(e); return arr; }
                            };
                            cls.prototype._eqrmssFilterPatched = true;
                            console.log(`EQRMSS | Master Fix v4.9 | Patched ${key}.filterByExpansionGate`);
                        }
                    }
                }
            }
            
            // Also patch global function if exported
            if (typeof mod.filterByExpansionGate === 'function') {
                console.log("EQRMSS | Master Fix v4.9 | Found exported filterByExpansionGate function");
            }
            
            return true; // success
        } catch (e) {
            console.warn(`EQRMSS | Master Fix v4.9 | Failed to import ${path}:`, e.message);
        }
    }
    console.warn("EQRMSS | Master Fix v4.9 | Could not direct import wizard data module - will rely on globalThis fallback");
    return false;
}

Hooks.once("init", () => {
    console.log("EQRMSS | Master Fix v4.9 | init");
    // Try direct patch early
    directPatchWizardData().catch(e => console.warn(e));
    // Retry
    setTimeout(() => directPatchWizardData().catch(()=>{}), 1000);
    setTimeout(() => directPatchWizardData().catch(()=>{}), 2000);
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Master Fix v4.9 | ready");
    
    // Try direct patch again at ready (game.eqrmss data now available)
    directPatchWizardData().then(() => {
        console.log("EQRMSS | Master Fix v4.9 | Direct patch at ready complete");
    }).catch(()=>{});
    
    // Also patch wizard prepareContext
    const patchWizardContext = () => {
        const wizardClasses = [globalThis.EQRMSSCharacterCreationWizard, globalThis.CharacterCreationWizard].filter(Boolean);
        for (const wc of wizardClasses) {
            try {
                if (!wc?.prototype?._prepareContext) continue;
                if (wc.prototype._eqrmssWizardPatched) continue;
                const orig = wc.prototype._prepareContext;
                wc.prototype._prepareContext = async function(...args) {
                    try {
                        // Ensure dataService has arrays before prepare
                        if (this.dataService) {
                            if (this.dataService.races && !Array.isArray(this.dataService.races)) this.dataService.races = toArray(this.dataService.races);
                            if (this.dataService.classes && !Array.isArray(this.dataService.classes)) this.dataService.classes = toArray(this.dataService.classes);
                        }
                        const ctx = await orig.apply(this, args);
                        if (ctx) {
                            if (ctx.races && !Array.isArray(ctx.races)) ctx.races = toArray(ctx.races);
                            if (ctx.classes && !Array.isArray(ctx.classes)) ctx.classes = toArray(ctx.classes);
                        }
                        return ctx;
                    } catch (e) {
                        console.error(e);
                        return { races: toArray(game.eqrmss?.races||{}), classes: toArray(game.eqrmss?.classes||{}), cities: [], deities: [], error: e.message };
                    }
                };
                wc.prototype._eqrmssWizardPatched = true;
                console.log(`EQRMSS | Master Fix v4.9 | Patched ${wc.name}._prepareContext`);
            } catch {}
        }
    };
    
    patchWizardContext();
    setTimeout(patchWizardContext, 500);
    
    // Patch pet managers
    ['EQRMSSPetManager', 'PetManager'].forEach(n => { const c = globalThis[n]; if (c) patchRenderable(c); });
    
    // Sheet patching with delays
    const doPatchSheets = () => {
        const count = patchAllSheets();
        if (count > 0) {
            for (const app of Object.values(ui.windows || {})) {
                try {
                    if (app.element && app.element.innerHTML.length < 500 && app.constructor.name.includes('EQRMSS')) {
                        app.render(true, { force: true }).catch(()=>{});
                    }
                } catch {}
            }
        }
        return count;
    };
    
    setTimeout(doPatchSheets, 800);
    setTimeout(doPatchSheets, 2000);
    setTimeout(doPatchSheets, 4000);
    
    Hooks.on("renderActorSheet", (app) => {
        if (app.element && app.element.innerHTML.length < 300) {
            const cls = app.constructor;
            if (isOldSheet(cls)) {
                console.log(`EQRMSS | renderActorSheet hook - patching blank ${cls.name}`);
                patchSheetToV13(cls, cls.name);
                setTimeout(() => app.render(true, { force: true }).catch(()=>{}), 100);
            }
        }
    });
    
    // Final openWizard
    game.eqrmss = game.eqrmss || {};
    game.eqrmss.openWizard = async (actor = null) => {
        console.log("EQRMSS | Master Fix v4.9 openWizard");
        await directPatchWizardData().catch(()=>{});
        patchWizardContext();
        
        let wizardClass = globalThis.EQRMSSCharacterCreationWizard || game.eqrmss.CharacterCreationWizard;
        if (!wizardClass) { ui.notifications.error("Wizard class not found"); return null; }
        try {
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            if (wizard.dataService) {
                wizard.dataService.races = toArray(game.eqrmss.races||{});
                wizard.dataService.classes = toArray(game.eqrmss.classes||{});
                console.log(`EQRMSS | Injected ARRAYS: races ${wizard.dataService.races.length}, classes ${wizard.dataService.classes.length}`);
            }
            await wizard.render(true);
            console.log("EQRMSS | Wizard rendered v4.9!");
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard v4.9 failed:", e);
            ui.notifications.error(`Wizard failed: ${e.message}`);
            throw e;
        }
    };
    
    console.log("EQRMSS | Master Fix v4.9 | Ready");
    
    game.eqrmss.fixSheetsV13 = () => {
        const count = patchAllSheets();
        for (const a of game.actors.contents) { try { a.sheet?.close({ animate: false }); } catch {} }
        setTimeout(async () => {
            for (const a of game.actors.contents) {
                try { await a.sheet?.render(true, { force: true }); console.log(`  ${a.name}: ${a.sheet?.element?.innerHTML?.length||0} chars`); } catch (e) { console.error(e); }
            }
        }, 500);
        return count;
    };
    
    game.eqrmss.debugSheets = () => {
        console.log("=== SHEET DEBUG v4.9 ===");
        console.log("Sheet classes:", CONFIG.Actor.sheetClasses);
        for (const a of game.actors.contents) {
            console.log(`${a.name}: sheet=${a.sheet?.constructor.name}, html=${a.sheet?.element?.innerHTML?.length||0}`);
        }
    };
});

export const MasterFixV49 = { version: "4.9" };
console.log("EQRMSS | Master Fix v4.9 loaded");
