
/**
 * EQRMSS Master Fix v4.10 FINAL - No dynamic import, uses Hooks + instance patch
 * Fixes 404 issue by living in master-fix-v46.js which already exists
 * - Patches wizard dataService.initialize at instance level (after construction)
 * - Converts object->array for races/classes/cities/deities
 * - Patches sheets on renderActorSheet hook
 */
console.log("EQRMSS | Master Fix v4.10 | Loading");

function toArray(obj) {
    if (Array.isArray(obj)) return obj;
    if (!obj) return [];
    if (typeof obj === 'object') {
        return Object.entries(obj).map(([key, val]) => {
            if (typeof val === 'object' && val !== null) {
                const c = { ...val };
                if (!c.id) c.id = key;
                if (!c.key) c.key = key;
                if (!c.name) c.name = c.label || key;
                return c;
            }
            return { id: key, name: String(val), value: val };
        });
    }
    return [];
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
    console.log(`EQRMSS | Master Fix v4.10 | Patching sheet ${name} (${cls.name})`);
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
            try { const data = await origGetData.call(this, options); Object.assign(context, data); } catch {}
        }
        if (this.actor) { context.actor = this.actor; context.system = this.actor.system; }
        if (this.item) { context.item = this.item; context.system = this.item.system; }
        context.eqrmss = game.eqrmss || {};
        return context;
    };
    proto._renderHTML = async function(context) {
        let templatePath = this.template || proto.template || this.constructor?.template;
        if (typeof templatePath === 'function') { try { templatePath = templatePath.call(this); } catch { templatePath = null; } }
        if (!templatePath) return `<div>No template for ${name}</div>`;
        try { return await foundry.applications.handlebars.renderTemplate(templatePath, context); }
        catch (e) { return `<div>Template error: ${e.message}</div>`; }
    };
    proto._replaceHTML = function(result) {
        if (!this.element) return;
        if (typeof result === 'string') this.element.innerHTML = result;
        else if (result instanceof HTMLElement) { this.element.innerHTML = ''; this.element.appendChild(result); }
        else if (result?.innerHTML) this.element.innerHTML = result.innerHTML;
        if (origOnRender) { try { const r = origOnRender.call(this, this.element); if (r instanceof Promise) r.catch(()=>{}); } catch {} }
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
    } catch (e) {}
    if (count>0) console.log(`EQRMSS | Master Fix v4.10 | Patched ${count} sheets`);
    return count;
}

Hooks.once("init", () => {
    console.log("EQRMSS | Master Fix v4.10 | init");
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Master Fix v4.10 | ready");

    // Sheet patching
    const doPatch = () => patchAllSheets();
    setTimeout(doPatch, 500);
    setTimeout(doPatch, 2000);
    setTimeout(doPatch, 4000);

    Hooks.on("renderActorSheet", (app) => {
        if (app.element && app.element.innerHTML.length < 300) {
            const cls = app.constructor;
            if (isOldSheet(cls)) {
                console.log(`EQRMSS | Fix v4.10 renderActorSheet blank -> patching ${cls.name}`);
                patchSheetToV13(cls, cls.name);
                setTimeout(() => app.render(true, { force: true }).catch(()=>{}), 150);
            }
        }
    });

    // Wizard fix - THE CRITICAL PART
    // Patch the data service CLASS prototype if we can find it in globalThis or via wizard instance
    const patchDataServiceClass = () => {
        const names = ['EQRMSSCharacterCreationData', 'CharacterCreationDataService', 'EQRMSSCharacterCreationWizardData', 'CharacterCreationWizardData'];
        for (const name of names) {
            const cls = globalThis[name];
            if (cls?.prototype?.initialize && !cls.prototype._eqrmssV410Patched) {
                console.log(`EQRMSS | Master Fix v4.10 | Patching ${name}.initialize`);
                const origInit = cls.prototype.initialize;
                cls.prototype.initialize = async function(...args) {
                    let res = null;
                    try { res = await origInit.apply(this, args); } catch(e) { console.warn(e); }
                    // Force arrays from game.eqrmss
                    const rCount = Array.isArray(this.races) ? this.races.length : Object.keys(this.races||{}).length;
                    const cCount = Array.isArray(this.classes) ? this.classes.length : Object.keys(this.classes||{}).length;
                    if (rCount === 0) {
                        const arr = toArray(game.eqrmss?.races||{});
                        if (arr.length>0) { this.races = arr; console.log(`EQRMSS | ${name} injected races ${arr.length} ARRAY`); }
                    } else if (!Array.isArray(this.races)) {
                        this.races = toArray(this.races);
                    }
                    if (cCount === 0) {
                        const arr = toArray(game.eqrmss?.classes||{});
                        if (arr.length>0) { this.classes = arr; console.log(`EQRMSS | ${name} injected classes ${arr.length} ARRAY`); }
                    } else if (!Array.isArray(this.classes)) {
                        this.classes = toArray(this.classes);
                    }
                    if (this.cities && !Array.isArray(this.cities)) this.cities = toArray(this.cities);
                    if (this.deities && !Array.isArray(this.deities)) this.deities = toArray(this.deities);
                    return res;
                };
                cls.prototype._eqrmssV410Patched = true;

                // Also patch filterByExpansionGate
                if (cls.prototype.filterByExpansionGate && !cls.prototype._eqrmssFilterPatched) {
                    const orig = cls.prototype.filterByExpansionGate;
                    cls.prototype.filterByExpansionGate = function(items, ...rest) {
                        const arr = toArray(items);
                        try { return orig.call(this, arr, ...rest); } catch { return arr; }
                    };
                    cls.prototype._eqrmssFilterPatched = true;
                }
                // Patch getContext
                if (cls.prototype.getContext && !cls.prototype._eqrmssContextPatched) {
                    const orig = cls.prototype.getContext;
                    cls.prototype.getContext = async function(...a) {
                        if (this.races && !Array.isArray(this.races)) this.races = toArray(this.races);
                        if (this.classes && !Array.isArray(this.classes)) this.classes = toArray(this.classes);
                        const ctx = await orig.apply(this, a);
                        if (ctx) {
                            if (ctx.races && !Array.isArray(ctx.races)) ctx.races = toArray(ctx.races);
                            if (ctx.classes && !Array.isArray(ctx.classes)) ctx.classes = toArray(ctx.classes);
                        }
                        return ctx;
                    };
                    cls.prototype._eqrmssContextPatched = true;
                }
            }
        }
        // Patch global function
        if (typeof globalThis.filterByExpansionGate === 'function' && !globalThis._eqrmssFilterPatched) {
            const orig = globalThis.filterByExpansionGate;
            globalThis.filterByExpansionGate = function(items, ...rest) {
                const arr = toArray(items);
                try { return orig(arr, ...rest); } catch { return arr; }
            };
            globalThis._eqrmssFilterPatched = true;
        }
    };

    patchDataServiceClass();
    setTimeout(patchDataServiceClass, 1000);

    // Also patch wizard _prepareContext
    const patchWizard = () => {
        const wcs = [globalThis.EQRMSSCharacterCreationWizard, globalThis.CharacterCreationWizard].filter(Boolean);
        for (const wc of wcs) {
            if (wc?.prototype?._prepareContext && !wc.prototype._eqrmssV410WizardPatched) {
                console.log(`EQRMSS | Master Fix v4.10 | Patching ${wc.name}._prepareContext`);
                const orig = wc.prototype._prepareContext;
                wc.prototype._prepareContext = async function(...args) {
                    try {
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
                wc.prototype._eqrmssV410WizardPatched = true;
            }
        }
    };
    patchWizard();
    setTimeout(patchWizard, 1000);

    // FINAL openWizard - instance level injection
    game.eqrmss = game.eqrmss || {};
    game.eqrmss.openWizard = async (actor=null) => {
        console.log("EQRMSS | Master Fix v4.10 openWizard called");
        patchDataServiceClass();
        patchWizard();
        let wizardClass = globalThis.EQRMSSCharacterCreationWizard || game.eqrmss.CharacterCreationWizard;
        if (!wizardClass) { ui.notifications.error("Wizard class not found"); return null; }
        try {
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            if (wizard.dataService) {
                // CRITICAL: Inject ARRAYS directly into instance BEFORE initialize runs again
                const racesArr = toArray(game.eqrmss.races||{});
                const classesArr = toArray(game.eqrmss.classes||{});
                console.log(`EQRMSS | Master Fix v4.10 injecting ARRAYS: races ${racesArr.length}, classes ${classesArr.length}`);
                
                // Patch instance initialize to ALWAYS return arrays
                const origInstInit = wizard.dataService.initialize?.bind(wizard.dataService);
                wizard.dataService.initialize = async function() {
                    let result = null;
                    if (origInstInit) { try { result = await origInstInit(); } catch(e) { console.warn(e); } }
                    // Force our data regardless of what orig did
                    this.races = racesArr;
                    this.classes = classesArr;
                    if (!Array.isArray(this.cities)) this.cities = toArray(this.cities||game.eqrmss?.cities||{});
                    if (!Array.isArray(this.deities)) this.deities = toArray(this.deities||{});
                    console.log(`EQRMSS | Wizard DS after patched init: races=${this.races.length} ARRAY, classes=${this.classes.length} ARRAY`);
                    return result;
                };
                
                // Pre-set
                wizard.dataService.races = racesArr;
                wizard.dataService.classes = classesArr;
            }
            await wizard.render(true);
            console.log("EQRMSS | Master Fix v4.10 | Wizard rendered!");
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard v4.10 failed:", e);
            ui.notifications.error(`Wizard failed: ${e.message}`);
            throw e;
        }
    };

    console.log("EQRMSS | Master Fix v4.10 | Ready - game.eqrmss.openWizard() = v4.10 ARRAY fix");

    game.eqrmss.fixSheetsV13 = () => {
        const count = patchAllSheets();
        for (const a of game.actors.contents) { try { a.sheet?.close({ animate:false }); } catch {} }
        setTimeout(async () => {
            for (const a of game.actors.contents) {
                try { await a.sheet?.render(true,{force:true}); console.log(`  ${a.name}: ${a.sheet?.element?.innerHTML?.length||0} chars`); } catch(e){}
            }
        }, 500);
        return count;
    };
    game.eqrmss.debugSheets = () => {
        console.log("=== SHEET DEBUG v4.10 ===");
        console.log(CONFIG.Actor.sheetClasses);
        for (const a of game.actors.contents) {
            console.log(`${a.name}: ${a.sheet?.constructor.name} ${a.sheet?.element?.innerHTML?.length||0} chars`);
        }
    };
});

export const MasterFixV410 = { version: "4.10" };
console.log("EQRMSS | Master Fix v4.10 loaded");
