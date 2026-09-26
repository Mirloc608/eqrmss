/**
 * EQRMSS Master Fix v4.7 - FIXES v4.6 CRASH
 * - Fixes TypeError at master-fix-v46.js:205 (cls undefined)
 * - Fixes wizard races.find not a function (object->array)
 * - Fixes sheets blank (V12->V13 bridge after sheets registered)
 * - Disables old v4.4 openWizard that injects object
 */
console.log("EQRMSS | Master Fix v4.7 | Loading");

function toArray(obj) {
    if (Array.isArray(obj)) return obj;
    if (!obj) return [];
    if (typeof obj === 'object') {
        // If it's already a map of objects
        return Object.entries(obj).map(([key, val]) => {
            if (typeof val === 'object' && val !== null) {
                const clone = { ...val };
                if (!clone.id) clone.id = key;
                if (!clone.key) clone.key = key;
                // Ensure name exists for display
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
                try {
                    return await foundry.applications.handlebars.renderTemplate(this.template, context);
                } catch (e) { return `<div>Error: ${e.message}</div>`; }
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
    if (patched) {
        proto._eqrmssMasterPatched = true;
        console.log(`EQRMSS | Master Fix v4.7 | Patched ${cls.name} renderable`);
    }
    return patched;
}

// Sheet V13 bridge
function isOldSheet(cls) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssSheetV13Patched) return false;
    // Check if it has getData (old style)
    return typeof cls.prototype.getData === 'function';
}

function patchSheetToV13(cls, name) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssSheetV13Patched) return true;
    const proto = cls.prototype;
    console.log(`EQRMSS | Master Fix v4.7 | Patching sheet ${name} (${cls.name})`);
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
        try {
            return await foundry.applications.handlebars.renderTemplate(templatePath, context);
        } catch (e) {
            console.error(`EQRMSS | ${name} renderTemplate failed:`, e);
            return `<div>Template error: ${e.message}<br>${templatePath}</div>`;
        }
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
    } catch (e) { console.warn("EQRMSS | patchAllSheets error:", e); }
    console.log(`EQRMSS | Master Fix v4.7 | Patched ${count} sheets`);
    return count;
}

// Wizard data service patches - FIXED to avoid cls undefined error
function patchWizardDataService() {
    const g = globalThis;
    const classNames = ['EQRMSSCharacterCreationData', 'CharacterCreationDataService', 'EQRMSSCharacterCreationWizardData'];
    
    for (const className of classNames) {
        try {
            const cls = g[className];
            if (!cls?.prototype) continue;
            
            // Patch getContext to convert objects to arrays
            if (cls.prototype.getContext && !cls.prototype._eqrmssPatchedGetContext) {
                console.log(`EQRMSS | Master Fix v4.7 | Patching ${className}.getContext`);
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
            
            // Patch filterByExpansionGate if exists - with optional chaining fix
            if (cls.prototype.filterByExpansionGate && !cls.prototype._eqrmssPatchedFilter) {
                console.log(`EQRMSS | Master Fix v4.7 | Patching ${className}.filterByExpansionGate`);
                const origFilter = cls.prototype.filterByExpansionGate;
                cls.prototype.filterByExpansionGate = function(items, ...rest) {
                    const arr = toArray(items);
                    try { return origFilter.call(this, arr, ...rest); }
                    catch (e) { console.warn(`EQRMSS | filter gate failed:`, e.message); return arr; }
                };
                cls.prototype._eqrmssPatchedFilter = true;
            }
        } catch (e) {
            console.warn(`EQRMSS | Failed to patch ${className}:`, e.message);
        }
    }
    
    // Also patch standalone global function
    try {
        if (typeof g.filterByExpansionGate === 'function' && !g._eqrmssFilterPatched) {
            const orig = g.filterByExpansionGate;
            g.filterByExpansionGate = function(items, ...rest) {
                const arr = toArray(items);
                try { return orig(arr, ...rest); } catch { return arr; }
            };
            g._eqrmssFilterPatched = true;
            console.log("EQRMSS | Master Fix v4.7 | Patched global filterByExpansionGate");
        }
    } catch {}
}

function patchWizardPrepareContext() {
    const wizardClasses = [globalThis.EQRMSSCharacterCreationWizard, globalThis.CharacterCreationWizard].filter(Boolean);
    for (const wc of wizardClasses) {
        try {
            if (!wc?.prototype?._prepareContext) continue;
            if (wc.prototype._eqrmssWizardPatched) continue;
            console.log(`EQRMSS | Master Fix v4.7 | Patching ${wc.name}._prepareContext`);
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
        } catch (e) {
            console.warn(`EQRMSS | Failed to patch wizard ${wc?.name}:`, e);
        }
    }
}

Hooks.once("init", () => {
    console.log("EQRMSS | Master Fix v4.7 | init");
    // Disable old v4.4 pet-manager fix that overrides openWizard with object injection
    // We will override it again in ready with correct array injection
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Master Fix v4.7 | ready - starting patches");
    
    try {
        patchWizardDataService();
    } catch (e) { console.error("EQRMSS | patchWizardDataService failed:", e); }
    
    try {
        // Patch pet managers
        ['EQRMSSPetManager', 'PetManager'].forEach(n => {
            const c = globalThis[n];
            if (c) patchRenderable(c);
        });
    } catch (e) {}
    
    try {
        patchWizardPrepareContext();
    } catch (e) { console.error(e); }
    
    // Patch sheets after a delay - sheets are registered in ready, so wait
    setTimeout(() => {
        try {
            const count = patchAllSheets();
            console.log(`EQRMSS | Master Fix v4.7 | Sheets patched: ${count}`);
            
            // Re-render any blank sheets
            for (const app of Object.values(ui.windows || {})) {
                try {
                    if (app.element && app.element.innerHTML.length < 200 && app.constructor.name.includes('EQRMSS')) {
                        console.log(`EQRMSS | Re-rendering blank ${app.constructor.name}`);
                        app.render(true, { force: true }).catch(()=>{});
                    }
                } catch {}
            }
        } catch (e) { console.error(e); }
    }, 1500);
    
    // Final wizard openWizard with ARRAY injection (not object)
    game.eqrmss = game.eqrmss || {};
    const oldOpenWizard = game.eqrmss.openWizard;
    
    game.eqrmss.openWizard = async (actor = null) => {
        console.log("EQRMSS | Master Fix v4.7 openWizard called (ARRAY fix)");
        let wizardClass = globalThis.EQRMSSCharacterCreationWizard || game.eqrmss.CharacterCreationWizard;
        if (!wizardClass) {
            ui.notifications.error("Wizard class not found");
            return null;
        }
        try {
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            
            if (wizard.dataService) {
                const racesArr = toArray(game.eqrmss.races || {});
                const classesArr = toArray(game.eqrmss.classes || {});
                console.log(`EQRMSS | Injecting ARRAYS: races ${racesArr.length}, classes ${classesArr.length}`);
                
                // Pre-set
                wizard.dataService.races = racesArr;
                wizard.dataService.classes = classesArr;
                
                // Patch initialize to always return arrays
                const origInit = wizard.dataService.initialize?.bind(wizard.dataService);
                if (origInit) {
                    wizard.dataService.initialize = async function() {
                        let result = null;
                        try { result = await origInit(); } catch (e) { console.warn(e); }
                        // Force arrays
                        this.races = racesArr;
                        this.classes = classesArr;
                        if (!Array.isArray(this.cities) || this.cities.length === 0) {
                            this.cities = toArray(game.eqrmss?.cities || this.cities || {});
                        }
                        if (!Array.isArray(this.deities) || this.deities.length === 0) {
                            this.deities = toArray(this.deities || {});
                        }
                        console.log(`EQRMSS | Wizard DS after init: races=${this.races.length} arr, classes=${this.classes.length} arr`);
                        return result;
                    };
                }
            }
            
            await wizard.render(true);
            console.log("EQRMSS | Wizard rendered v4.7!");
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard v4.7 failed:", e);
            console.error(e.stack);
            ui.notifications.error(`Wizard failed: ${e.message}`);
            throw e;
        }
    };
    
    console.log("EQRMSS | Master Fix v4.7 | Ready - game.eqrmss.openWizard() fixed with ARRAY");
    
    game.eqrmss.fixSheetsV13 = () => {
        const count = patchAllSheets();
        for (const a of game.actors.contents) { try { a.sheet?.close({ animate: false }); } catch {} }
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
        console.log("=== SHEET DEBUG v4.7 ===");
        console.log("Sheet classes:", CONFIG.Actor.sheetClasses);
        for (const a of game.actors.contents) {
            console.log(`${a.name}: sheet=${a.sheet?.constructor.name}, html=${a.sheet?.element?.innerHTML?.length || 0}, rendered=${a.sheet?.rendered}`);
        }
    };
});

export const MasterFixV47 = { version: "4.7" };
console.log("EQRMSS | Master Fix v4.7 loaded");
