/**
 * EQRMSS Master Fix v4.11 - FIXES races:0 even after v4.10
 * Root cause: wizard.dataService is null at openWizard time, created inside _prepareContext
 * So instance injection in openWizard never runs. Fix: patch _prepareContext to inject AFTER initialize
 */
console.log("EQRMSS | Master Fix v4.11 | Loading");

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
    console.log(`EQRMSS | Master Fix v4.11 | Patching sheet ${name} (${cls.name})`);
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
    if (count>0) console.log(`EQRMSS | Master Fix v4.11 | Patched ${count} sheets`);
    return count;
}

Hooks.once("init", () => {
    console.log("EQRMSS | Master Fix v4.11 | init");
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Master Fix v4.11 | ready");

    const doPatch = () => patchAllSheets();
    setTimeout(doPatch, 500);
    setTimeout(doPatch, 2000);
    setTimeout(doPatch, 4000);

    Hooks.on("renderActorSheet", (app) => {
        if (app.element && app.element.innerHTML.length < 300) {
            const cls = app.constructor;
            if (isOldSheet(cls)) {
                console.log(`EQRMSS | Fix v4.11 renderActorSheet blank -> patching ${cls.name}`);
                patchSheetToV13(cls, cls.name);
                setTimeout(() => app.render(true, { force: true }).catch(()=>{}), 150);
            }
        }
    });

    // CRITICAL: Patch wizard _prepareContext to inject ARRAYS after dataService.initialize()
    const patchWizard = () => {
        const wcs = [globalThis.EQRMSSCharacterCreationWizard, globalThis.CharacterCreationWizard].filter(Boolean);
        for (const wc of wcs) {
            if (!wc?.prototype?._prepareContext) continue;
            if (wc.prototype._eqrmssV411Patched) continue;
            console.log(`EQRMSS | Master Fix v4.11 | Patching ${wc.name}._prepareContext to inject ARRAYS`);
            const orig = wc.prototype._prepareContext;
            wc.prototype._prepareContext = async function(...args) {
                // Call original first - it creates dataService and calls initialize() which results in races:0
                let ctx;
                try {
                    ctx = await orig.apply(this, args);
                } catch (e) {
                    console.warn(`EQRMSS | Original _prepareContext failed:`, e);
                    ctx = {};
                }

                // NOW dataService exists - force inject ARRAYS from game.eqrmss
                try {
                    if (this.dataService) {
                        const rCount = Array.isArray(this.dataService.races) ? this.dataService.races.length : Object.keys(this.dataService.races||{}).length;
                        const cCount = Array.isArray(this.dataService.classes) ? this.dataService.classes.length : Object.keys(this.dataService.classes||{}).length;
                        
                        console.log(`EQRMSS | Master Fix v4.11 | _prepareContext: dataService has races=${rCount} classes=${cCount}, game has races=${Object.keys(game.eqrmss?.races||{}).length}`);

                        if (rCount === 0 || !Array.isArray(this.dataService.races)) {
                            const racesArr = toArray(game.eqrmss?.races||{});
                            if (racesArr.length > 0) {
                                this.dataService.races = racesArr;
                                console.log(`EQRMSS | Master Fix v4.11 | INJECTED races ${racesArr.length} ARRAY into dataService`);
                            }
                        }
                        if (cCount === 0 || !Array.isArray(this.dataService.classes)) {
                            const classesArr = toArray(game.eqrmss?.classes||{});
                            if (classesArr.length > 0) {
                                this.dataService.classes = classesArr;
                                console.log(`EQRMSS | Master Fix v4.11 | INJECTED classes ${classesArr.length} ARRAY into dataService`);
                            }
                        }
                        if (this.dataService.cities && !Array.isArray(this.dataService.cities)) {
                            this.dataService.cities = toArray(this.dataService.cities);
                        }
                        if (this.dataService.deities && !Array.isArray(this.dataService.deities)) {
                            this.dataService.deities = toArray(this.dataService.deities);
                        }

                        // Also fix context
                        if (ctx) {
                            if (ctx.races && (!Array.isArray(ctx.races) || ctx.races.length===0)) {
                                ctx.races = toArray(game.eqrmss?.races||ctx.races||{});
                            }
                            if (ctx.classes && (!Array.isArray(ctx.classes) || ctx.classes.length===0)) {
                                ctx.classes = toArray(game.eqrmss?.classes||ctx.classes||{});
                            }
                            if (ctx.data) {
                                if (ctx.data.races && (!Array.isArray(ctx.data.races) || ctx.data.races.length===0)) {
                                    ctx.data.races = this.dataService.races;
                                }
                                if (ctx.data.classes && (!Array.isArray(ctx.data.classes) || ctx.data.classes.length===0)) {
                                    ctx.data.classes = this.dataService.classes;
                                }
                            }
                        }
                    }
                    
                    // Patch filterByExpansionGate on the fly if global
                    if (typeof globalThis.filterByExpansionGate === 'function' && !globalThis._eqrmssFilterPatched411) {
                        const origFilter = globalThis.filterByExpansionGate;
                        globalThis.filterByExpansionGate = function(items, ...rest) {
                            const arr = toArray(items);
                            try { return origFilter(arr, ...rest); } catch { return arr; }
                        };
                        globalThis._eqrmssFilterPatched411 = true;
                    }
                    // Also patch dataService's own filter if exists
                    if (this.dataService?.filterByExpansionGate && !this.dataService._eqrmssFilterPatched411) {
                        const origF = this.dataService.filterByExpansionGate.bind(this.dataService);
                        this.dataService.filterByExpansionGate = function(items, ...rest) {
                            const arr = toArray(items);
                            try { return origF(arr, ...rest); } catch { return arr; }
                        };
                        this.dataService._eqrmssFilterPatched411 = true;
                    }

                } catch (e) {
                    console.error(`EQRMSS | Master Fix v4.11 injection failed:`, e);
                }

                return ctx;
            };
            wc.prototype._eqrmssV411Patched = true;
        }
    };

    patchWizard();
    setTimeout(patchWizard, 500);
    setTimeout(patchWizard, 1500);

    // FINAL openWizard - simple, just creates wizard, _prepareContext does injection
    game.eqrmss = game.eqrmss || {};
    game.eqrmss.openWizard = async (actor=null) => {
        console.log("EQRMSS | Master Fix v4.11 openWizard called - _prepareContext will inject ARRAYS");
        patchWizard();
        let wizardClass = globalThis.EQRMSSCharacterCreationWizard || game.eqrmss.CharacterCreationWizard;
        if (!wizardClass) { ui.notifications.error("Wizard class not found"); return null; }
        try {
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            await wizard.render(true);
            console.log("EQRMSS | Master Fix v4.11 | Wizard rendered! dataService races=", wizard.dataService?.races?.length, "classes=", wizard.dataService?.classes?.length);
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard v4.11 failed:", e);
            ui.notifications.error(`Wizard failed: ${e.message}`);
            throw e;
        }
    };

    console.log("EQRMSS | Master Fix v4.11 | Ready - game.eqrmss.openWizard() = v4.11");

    game.eqrmss.fixSheetsV13 = () => {
        const count = patchAllSheets();
        for (const a of game.actors.contents) { try { a.sheet?.close({ animate:false }); } catch {} }
        setTimeout(async () => {
            for (const a of game.actors.contents) {
                try { await a.sheet?.render(true,{force:true}); } catch(e){}
            }
        }, 500);
        return count;
    };
});

export const MasterFixV411 = { version: "4.11" };
console.log("EQRMSS | Master Fix v4.11 loaded");
