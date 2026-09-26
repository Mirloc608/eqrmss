/**
 * EQRMSS Master Fix v4.8 - FINAL WIZARD DATA FIX
 * - Early patch of EQRMSSCharacterCreationData.prototype.initialize to load from game.eqrmss if 0
 * - Also patches filterByExpansionGate and getContext to handle object->array
 * - Sheets patched AFTER they are registered via Hooks.on render and delayed
 */
console.log("EQRMSS | Master Fix v4.8 | Loading");

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
    if (patched) { proto._eqrmssMasterPatched = true; console.log(`EQRMSS | Master Fix v4.8 | Patched ${cls.name} renderable`); }
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
    console.log(`EQRMSS | Master Fix v4.8 | Patching sheet ${name} (${cls.name})`);
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
            try { const data = await origGetData.call(this, options); Object.assign(context, data); } catch (e) { console.warn(e); }
        }
        if (this.actor) { context.actor = this.actor; context.system = this.actor.system; }
        if (this.item) { context.item = this.item; context.system = this.item.system; }
        context.eqrmss = game.eqrmss || {};
        return context;
    };
    
    proto._renderHTML = async function(context) {
        let templatePath = null;
        if (this.template) templatePath = typeof this.template === 'function' ? this.template : this.template;
        else if (proto.template) templatePath = typeof proto.template === 'function' ? proto.template.call(this) : proto.template;
        if (!templatePath && this.constructor?.template) templatePath = this.constructor.template;
        if (!templatePath) return `<div>No template for ${name}</div>`;
        try { return await foundry.applications.handlebars.renderTemplate(templatePath, context); }
        catch (e) { console.error(`EQRMSS | ${name} renderTemplate failed:`, e); return `<div>Template error: ${e.message}<br>${templatePath}</div>`; }
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
        // Also check global sheet classes
        for (const key of Object.keys(globalThis)) {
            if (key.includes('Sheet') && key.startsWith('EQRMSS')) {
                const cls = globalThis[key];
                if (cls && isOldSheet(cls)) {
                    if (patchSheetToV13(cls, `globalThis.${key}`)) count++;
                }
            }
        }
    } catch (e) { console.warn("EQRMSS | patchAllSheets error:", e); }
    if (count > 0) console.log(`EQRMSS | Master Fix v4.8 | Patched ${count} sheets`);
    return count;
}

// Early patch of wizard data service initialize - runs in init, before wizard constructed
function earlyPatchWizardDataService() {
    const g = globalThis;
    const classNames = ['EQRMSSCharacterCreationData', 'CharacterCreationDataService', 'EQRMSSCharacterCreationWizardData'];
    
    for (const className of classNames) {
        try {
            const cls = g[className];
            if (!cls?.prototype) continue;
            if (cls.prototype._eqrmssEarlyPatched) continue;
            
            // Patch initialize to fallback to game.eqrmss data if 0
            if (cls.prototype.initialize) {
                console.log(`EQRMSS | Master Fix v4.8 | Early patching ${className}.initialize`);
                const origInit = cls.prototype.initialize;
                cls.prototype.initialize = async function(...args) {
                    let result = null;
                    try { result = await origInit.apply(this, args); } catch (e) { console.warn(`EQRMSS | ${className}.initialize original failed:`, e.message); }
                    
                    // If races/classes still 0, inject from game.eqrmss as ARRAYS
                    const racesCount = Array.isArray(this.races) ? this.races.length : Object.keys(this.races||{}).length;
                    const classesCount = Array.isArray(this.classes) ? this.classes.length : Object.keys(this.classes||{}).length;
                    
                    if (racesCount === 0) {
                        const arr = toArray(game.eqrmss?.races || {});
                        if (arr.length > 0) {
                            this.races = arr;
                            console.log(`EQRMSS | ${className} injected races: ${arr.length} array`);
                        }
                    } else if (!Array.isArray(this.races)) {
                        this.races = toArray(this.races);
                        console.log(`EQRMSS | ${className} converted races object->array: ${this.races.length}`);
                    }
                    
                    if (classesCount === 0) {
                        const arr = toArray(game.eqrmss?.classes || {});
                        if (arr.length > 0) {
                            this.classes = arr;
                            console.log(`EQRMSS | ${className} injected classes: ${arr.length} array`);
                        }
                    } else if (!Array.isArray(this.classes)) {
                        this.classes = toArray(this.classes);
                    }
                    
                    if (!Array.isArray(this.cities)) this.cities = toArray(this.cities || {});
                    if (!Array.isArray(this.deities)) this.deities = toArray(this.deities || {});
                    
                    return result;
                };
                cls.prototype._eqrmssEarlyPatched = true;
            }
            
            // Patch getContext
            if (cls.prototype.getContext && !cls.prototype._eqrmssPatchedGetContext) {
                const origGetContext = cls.prototype.getContext;
                cls.prototype.getContext = async function(...args) {
                    const ctx = await origGetContext.apply(this, args);
                    if (ctx) {
                        if (ctx.races && !Array.isArray(ctx.races)) ctx.races = toArray(ctx.races);
                        if (ctx.classes && !Array.isArray(ctx.classes)) ctx.classes = toArray(ctx.classes);
                        if (ctx.deities && !Array.isArray(ctx.deities)) ctx.deities = toArray(ctx.deities);
                        if (ctx.cities && !Array.isArray(ctx.cities)) ctx.cities = toArray(ctx.cities);
                    }
                    return ctx;
                };
                cls.prototype._eqrmssPatchedGetContext = true;
            }
            
            if (cls.prototype.filterByExpansionGate && !cls.prototype._eqrmssPatchedFilter) {
                const origFilter = cls.prototype.filterByExpansionGate;
                cls.prototype.filterByExpansionGate = function(items, ...rest) {
                    const arr = toArray(items);
                    try { return origFilter.call(this, arr, ...rest); }
                    catch (e) { return arr; }
                };
                cls.prototype._eqrmssPatchedFilter = true;
            }
        } catch (e) { console.warn(`EQRMSS | Failed to early patch ${className}:`, e.message); }
    }
    
    try {
        if (typeof g.filterByExpansionGate === 'function' && !g._eqrmssFilterPatched) {
            const orig = g.filterByExpansionGate;
            g.filterByExpansionGate = function(items, ...rest) {
                const arr = toArray(items);
                try { return orig(arr, ...rest); } catch { return arr; }
            };
            g._eqrmssFilterPatched = true;
        }
    } catch {}
}

function patchWizardPrepareContext() {
    const wizardClasses = [globalThis.EQRMSSCharacterCreationWizard, globalThis.CharacterCreationWizard].filter(Boolean);
    for (const wc of wizardClasses) {
        try {
            if (!wc?.prototype?._prepareContext) continue;
            if (wc.prototype._eqrmssWizardPatched) continue;
            const orig = wc.prototype._prepareContext;
            wc.prototype._prepareContext = async function(...args) {
                try {
                    const ctx = await orig.apply(this, args);
                    if (ctx) {
                        if (ctx.races && !Array.isArray(ctx.races)) ctx.races = toArray(ctx.races);
                        if (ctx.classes && !Array.isArray(ctx.classes)) ctx.classes = toArray(ctx.classes);
                        if (ctx.data) {
                            if (ctx.data.races && !Array.isArray(ctx.data.races)) ctx.data.races = toArray(ctx.data.races);
                            if (ctx.data.classes && !Array.isArray(ctx.data.classes)) ctx.data.classes = toArray(ctx.data.classes);
                        }
                    }
                    return ctx;
                } catch (e) {
                    console.error(`EQRMSS | Wizard _prepareContext failed:`, e);
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
            console.log(`EQRMSS | Master Fix v4.8 | Patched ${wc.name}._prepareContext`);
        } catch (e) {}
    }
}

Hooks.once("init", () => {
    console.log("EQRMSS | Master Fix v4.8 | init - early patching data service");
    // Try early patch - classes may not be loaded yet, so also patch on ready
    earlyPatchWizardDataService();
    // Also patch every 500ms for first 3 seconds to catch late loading
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        earlyPatchWizardDataService();
        if (attempts >= 6) clearInterval(interval);
    }, 500);
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Master Fix v4.8 | ready - starting patches");
    
    try { earlyPatchWizardDataService(); } catch (e) {}
    
    try {
        ['EQRMSSPetManager', 'PetManager'].forEach(n => {
            const c = globalThis[n];
            if (c) patchRenderable(c);
        });
    } catch {}
    
    try { patchWizardPrepareContext(); } catch {}
    
    // Patch sheets with delay and also on render hook
    const doPatchSheets = () => {
        const count = patchAllSheets();
        if (count > 0) {
            // Re-render blank sheets
            for (const app of Object.values(ui.windows || {})) {
                try {
                    if (app.element && app.element.innerHTML.length < 500 && app.constructor.name.includes('EQRMSS')) {
                        console.log(`EQRMSS | Re-rendering blank ${app.constructor.name}`);
                        app.render(true, { force: true }).catch(()=>{});
                    }
                } catch {}
            }
        }
        return count;
    };
    
    // Patch sheets after 1s, 2s, 3s
    setTimeout(doPatchSheets, 1000);
    setTimeout(doPatchSheets, 2500);
    setTimeout(doPatchSheets, 4000);
    
    // Also patch whenever a sheet tries to render
    Hooks.on("renderActorSheet", (app) => {
        if (app.element && app.element.innerHTML.length < 200) {
            const cls = app.constructor;
            if (isOldSheet(cls)) {
                console.log(`EQRMSS | renderActorSheet hook - patching blank ${cls.name}`);
                patchSheetToV13(cls, cls.name);
                setTimeout(() => app.render(true, { force: true }).catch(()=>{}), 100);
            }
        }
    });
    
    // Final wizard openWizard
    game.eqrmss = game.eqrmss || {};
    game.eqrmss.openWizard = async (actor = null) => {
        console.log("EQRMSS | Master Fix v4.8 openWizard called");
        // Ensure data service patched
        earlyPatchWizardDataService();
        patchWizardPrepareContext();
        
        let wizardClass = globalThis.EQRMSSCharacterCreationWizard || game.eqrmss.CharacterCreationWizard;
        if (!wizardClass) { ui.notifications.error("Wizard class not found"); return null; }
        try {
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            if (wizard.dataService) {
                const racesArr = toArray(game.eqrmss.races || {});
                const classesArr = toArray(game.eqrmss.classes || {});
                console.log(`EQRMSS | Injecting ARRAYS: races ${racesArr.length}, classes ${classesArr.length}`);
                wizard.dataService.races = racesArr;
                wizard.dataService.classes = classesArr;
            }
            await wizard.render(true);
            console.log("EQRMSS | Wizard rendered v4.8!");
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard v4.8 failed:", e);
            ui.notifications.error(`Wizard failed: ${e.message}`);
            throw e;
        }
    };
    
    console.log("EQRMSS | Master Fix v4.8 | Ready");
    
    game.eqrmss.fixSheetsV13 = () => {
        const count = patchAllSheets();
        for (const a of game.actors.contents) { try { a.sheet?.close({ animate: false }); } catch {} }
        setTimeout(async () => {
            for (const a of game.actors.contents) {
                try { await a.sheet?.render(true, { force: true }); console.log(`  ${a.name}: ${a.sheet?.element?.innerHTML?.length || 0} chars`); } catch (e) { console.error(e); }
            }
        }, 500);
        return count;
    };
    
    game.eqrmss.debugSheets = () => {
        console.log("=== SHEET DEBUG v4.8 ===");
        console.log("Sheet classes:", CONFIG.Actor.sheetClasses);
        for (const a of game.actors.contents) {
            console.log(`${a.name}: sheet=${a.sheet?.constructor.name}, html=${a.sheet?.element?.innerHTML?.length || 0}`);
        }
    };
});

export const MasterFixV48 = { version: "4.8" };
console.log("EQRMSS | Master Fix v4.8 loaded");
