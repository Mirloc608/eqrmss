/**
 * EQRMSS Master Fix v4.12 - FINAL for sheets + pet manager + wizard
 * Wizard: already fixed in v4.11 (17 ARRAY)
 * Sheets: aggressive patch - any EQRMSS sheet without working _renderHTML gets patched
 * Pet Manager: patches EQRMSSPetManager to be renderable (HandlebarsApplicationMixin bridge)
 */
console.log("EQRMSS | Master Fix v4.12 | Loading");

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

function needsV13Patch(cls) {
    if (!cls?.prototype) return false;
    const proto = cls.prototype;
    if (proto._eqrmssV12Patched) return false;
    const renderStr = proto._renderHTML?.toString() || '';
    const hasBadRender = !proto._renderHTML || renderStr.includes('not renderable') || renderStr.includes('not implemented') || renderStr.includes('abstract');
    const isEQRMSS = cls.name?.includes('EQRMSS') || cls.name?.toLowerCase().includes('eqrmss');
    const hasOldAPI = typeof proto.getData === 'function';
    return (isEQRMSS && hasBadRender) || hasOldAPI || (isEQRMSS && !proto._renderHTML);
}

function patchSheetToV13(cls, name) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssV12Patched) return true;
    const proto = cls.prototype;
    console.log(`EQRMSS | Master Fix v4.12 | Patching sheet ${name} (${cls.name}) to V13`);
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
            try { const data = await origGetData.call(this, options); if (data) Object.assign(context, data); } catch {}
        }
        if (this.actor) { context.actor = this.actor; context.system = this.actor.system; context.flags = this.actor.flags; }
        if (this.item) { context.item = this.item; context.system = this.item.system; }
        if (this.document) { context.document = this.document; context.system = this.document.system; }
        context.eqrmss = game.eqrmss || {};
        context.races = game.eqrmss?.races || {};
        context.classes = game.eqrmss?.classes || {};
        return context;
    };
    proto._renderHTML = async function(context, options) {
        let templatePath = null;
        try { if (this.template) templatePath = typeof this.template === 'function' ? this.template : this.template; } catch {}
        if (!templatePath) {
            try {
                const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'template');
                if (desc?.get) templatePath = this.template;
            } catch {}
        }
        if (!templatePath && proto.template) {
            try { templatePath = typeof proto.template === 'function' ? proto.template.call(this) : proto.template; } catch {}
        }
        if (!templatePath && this.constructor?.template) templatePath = this.constructor.template;
        if (!templatePath && this.constructor?.DEFAULT_OPTIONS?.template) templatePath = this.constructor.DEFAULT_OPTIONS.template;
        if (!templatePath) {
            return `<div>No template for ${name} (${this.constructor.name})<br>Actor: ${this.actor?.name||this.document?.name||'unknown'}</div>`;
        }
        try { return await foundry.applications.handlebars.renderTemplate(templatePath, context); }
        catch (e) { console.error(e); return `<div>Template error ${e.message}<br>${templatePath}</div>`; }
    };
    proto._replaceHTML = function(result, content, options) {
        if (!this.element) return;
        if (typeof result === 'string') this.element.innerHTML = result;
        else if (result instanceof HTMLElement) { this.element.innerHTML = ''; this.element.appendChild(result); }
        else if (result?.innerHTML) this.element.innerHTML = result.innerHTML;
        if (origOnRender) {
            try {
                const htmlEl = this.element;
                if (!htmlEl.find) htmlEl.find = (sel) => htmlEl.querySelectorAll(sel);
                const r = origOnRender.call(this, htmlEl);
                if (r instanceof Promise) r.catch(()=>{});
            } catch {}
        }
        if (origActivateListeners) { try { origActivateListeners.call(this, this.element); } catch {} }
    };
    proto._eqrmssV12Patched = true;
    proto._eqrmssSheetV13Patched = true;
    return true;
}

function patchRenderable(cls, label) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssRenderPatched) return true;
    const proto = cls.prototype;
    let patched = false;
    const renderStr = proto._renderHTML?.toString() || '';
    if (!proto._renderHTML || renderStr.includes('not renderable') || renderStr.includes('not implemented') || renderStr.includes('abstract')) {
        console.log(`EQRMSS | Master Fix v4.12 | Patching renderable ${label || cls.name}`);
        proto._renderHTML = async function(context, options) {
            let templatePath = this.template || this.constructor?.template || this.constructor?.DEFAULT_OPTIONS?.template;
            if (typeof templatePath === 'function') { try { templatePath = templatePath.call(this); } catch {} }
            if (templatePath) {
                try { return await foundry.applications.handlebars.renderTemplate(templatePath, context||{}); }
                catch (e) { console.warn(e); }
            }
            return this.element?.innerHTML || `<div>${cls.name} - No template</div>`;
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
        proto._eqrmssRenderPatched = true;
        proto._eqrmssV12Patched = true;
    }
    return patched;
}

function patchAllSheets() {
    let count = 0;
    try {
        for (const [docType, sheetMap] of Object.entries(CONFIG.Actor?.sheetClasses || {})) {
            for (const [sheetId, info] of Object.entries(sheetMap || {})) {
                const cls = info?.cls;
                if (cls && needsV13Patch(cls)) {
                    if (patchSheetToV13(cls, `Actor ${docType}.${sheetId}`)) count++;
                }
            }
        }
        for (const [docType, sheetMap] of Object.entries(CONFIG.Item?.sheetClasses || {})) {
            for (const [sheetId, info] of Object.entries(sheetMap || {})) {
                const cls = info?.cls;
                if (cls && needsV13Patch(cls)) {
                    if (patchSheetToV13(cls, `Item ${docType}.${sheetId}`)) count++;
                }
            }
        }
        for (const key of Object.keys(globalThis)) {
            if (key.startsWith('EQRMSS') && (key.includes('Sheet') || key.includes('PetManager') || key.includes('Manager'))) {
                const cls = globalThis[key];
                if (typeof cls === 'function') {
                    if (key.includes('Sheet') && needsV13Patch(cls)) {
                        if (patchSheetToV13(cls, `globalThis.${key}`)) count++;
                    }
                    if (key.includes('PetManager') || key.includes('Manager')) {
                        if (patchRenderable(cls, `globalThis.${key}`)) {
                            console.log(`EQRMSS | Master Fix v4.12 | Patched ${key} renderable`);
                        }
                    }
                }
            }
        }
    } catch (e) { console.warn(e); }
    if (count>0) console.log(`EQRMSS | Master Fix v4.12 | Patched ${count} sheets`);
    return count;
}

function patchPetManagers() {
    let count = 0;
    for (const name of ['EQRMSSPetManager', 'PetManager', 'EQRMSSPetManagerV2', 'EQRMSSCompanionManager']) {
        const cls = globalThis[name];
        if (cls && patchRenderable(cls, name)) { count++; console.log(`EQRMSS | Master Fix v4.12 | Patched ${name}`); }
    }
    return count;
}

Hooks.once("init", () => { console.log("EQRMSS | Master Fix v4.12 | init"); });

Hooks.once("ready", () => {
    console.log("EQRMSS | Master Fix v4.12 | ready");
    patchAllSheets();
    patchPetManagers();
    setTimeout(() => { patchAllSheets(); patchPetManagers(); }, 800);
    setTimeout(() => { patchAllSheets(); patchPetManagers(); }, 2000);
    setTimeout(() => { patchAllSheets(); patchPetManagers(); }, 4000);

    Hooks.on("renderActorSheet", (app) => {
        if (needsV13Patch(app.constructor)) {
            console.log(`EQRMSS | Fix v4.12 renderActorSheet hook patching blank ${app.constructor.name}`);
            patchSheetToV13(app.constructor, app.constructor.name);
            setTimeout(() => app.render(true, { force: true }).catch(()=>{}), 100);
        } else if (app.element && app.element.innerHTML.length < 200) {
            const cls = app.constructor;
            if (cls.name?.includes('EQRMSS')) {
                console.log(`EQRMSS | Fix v4.12 blank sheet ${cls.name} ${app.element.innerHTML.length} chars, force patch`);
                patchSheetToV13(cls, cls.name);
                setTimeout(() => app.render(true, { force: true }).catch(()=>{}), 100);
            }
        }
    });

    Hooks.on("renderApplication", (app) => {
        if (app.constructor.name?.includes('PetManager') || app.constructor.name?.includes('EQRMSSPet')) {
            if (needsV13Patch(app.constructor) || app.element?.innerHTML?.length < 100) {
                patchRenderable(app.constructor, app.constructor.name);
            }
        }
    });

    const patchWizard = () => {
        const wcs = [globalThis.EQRMSSCharacterCreationWizard, globalThis.CharacterCreationWizard].filter(Boolean);
        for (const wc of wcs) {
            if (!wc?.prototype?._prepareContext) continue;
            if (wc.prototype._eqrmssV412Patched) continue;
            console.log(`EQRMSS | Master Fix v4.12 | Patching ${wc.name}._prepareContext to inject ARRAYS`);
            const orig = wc.prototype._prepareContext;
            wc.prototype._prepareContext = async function(...args) {
                let ctx;
                try { ctx = await orig.apply(this, args); } catch (e) { console.warn(e); ctx = {}; }
                try {
                    if (this.dataService) {
                        const rCount = Array.isArray(this.dataService.races) ? this.dataService.races.length : Object.keys(this.dataService.races||{}).length;
                        const cCount = Array.isArray(this.dataService.classes) ? this.dataService.classes.length : Object.keys(this.dataService.classes||{}).length;
                        console.log(`EQRMSS | Master Fix v4.12 | _prepareContext: DS races=${rCount} classes=${cCount}, game races=${Object.keys(game.eqrmss?.races||{}).length}`);
                        if (rCount === 0 || !Array.isArray(this.dataService.races)) {
                            const racesArr = toArray(game.eqrmss?.races||{});
                            if (racesArr.length>0) { this.dataService.races = racesArr; console.log(`EQRMSS | Master Fix v4.12 | INJECTED races ${racesArr.length} ARRAY`); }
                        }
                        if (cCount === 0 || !Array.isArray(this.dataService.classes)) {
                            const classesArr = toArray(game.eqrmss?.classes||{});
                            if (classesArr.length>0) { this.dataService.classes = classesArr; console.log(`EQRMSS | Master Fix v4.12 | INJECTED classes ${classesArr.length} ARRAY`); }
                        }
                        if (this.dataService.cities && !Array.isArray(this.dataService.cities)) this.dataService.cities = toArray(this.dataService.cities);
                        if (this.dataService.deities && !Array.isArray(this.dataService.deities)) this.dataService.deities = toArray(this.dataService.deities);
                        if (ctx) {
                            if (ctx.races && (!Array.isArray(ctx.races) || ctx.races.length===0)) ctx.races = toArray(game.eqrmss?.races||ctx.races||{});
                            if (ctx.classes && (!Array.isArray(ctx.classes) || ctx.classes.length===0)) ctx.classes = toArray(game.eqrmss?.classes||ctx.classes||{});
                            if (ctx.data) {
                                if (ctx.data.races && (!Array.isArray(ctx.data.races) || ctx.data.races.length===0)) ctx.data.races = this.dataService.races;
                                if (ctx.data.classes && (!Array.isArray(ctx.data.classes) || ctx.data.classes.length===0)) ctx.data.classes = this.dataService.classes;
                            }
                        }
                    }
                    if (typeof globalThis.filterByExpansionGate === 'function' && !globalThis._eqrmssFilterPatched412) {
                        const origF = globalThis.filterByExpansionGate;
                        globalThis.filterByExpansionGate = function(items, ...rest) { const arr = toArray(items); try { return origF(arr, ...rest); } catch { return arr; } };
                        globalThis._eqrmssFilterPatched412 = true;
                    }
                    if (this.dataService?.filterByExpansionGate && !this.dataService._eqrmssFilterPatched412) {
                        const origF = this.dataService.filterByExpansionGate.bind(this.dataService);
                        this.dataService.filterByExpansionGate = function(items, ...rest) { const arr = toArray(items); try { return origF(arr, ...rest); } catch { return arr; } };
                        this.dataService._eqrmssFilterPatched412 = true;
                    }
                } catch (e) { console.error(e); }
                return ctx;
            };
            wc.prototype._eqrmssV412Patched = true;
        }
    };
    patchWizard();
    setTimeout(patchWizard, 500);
    setTimeout(patchWizard, 1500);

    game.eqrmss = game.eqrmss || {};
    game.eqrmss.openWizard = async (actor=null) => {
        console.log("EQRMSS | Master Fix v4.12 openWizard called");
        patchWizard();
        let wizardClass = globalThis.EQRMSSCharacterCreationWizard || game.eqrmss.CharacterCreationWizard;
        if (!wizardClass) { ui.notifications.error("Wizard class not found"); return null; }
        try {
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            await wizard.render(true);
            console.log("EQRMSS | Master Fix v4.12 | Wizard rendered! races=", wizard.dataService?.races?.length, "classes=", wizard.dataService?.classes?.length);
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard v4.12 failed:", e);
            ui.notifications.error(`Wizard failed: ${e.message}`);
            throw e;
        }
    };

    console.log("EQRMSS | Master Fix v4.12 | Ready - wizard + sheets + pet manager");

    game.eqrmss.fixSheetsV13 = () => {
        const count = patchAllSheets() + patchPetManagers();
        for (const a of game.actors.contents) { try { a.sheet?.close({ animate:false }); } catch {} }
        setTimeout(async () => {
            for (const a of game.actors.contents) {
                try { await a.sheet?.render(true,{force:true}); console.log(`  ${a.name}: ${a.sheet?.element?.innerHTML?.length||0} chars ${a.sheet?.constructor.name}`); } catch(e){ console.error(e); }
            }
        }, 600);
        return count;
    };

    game.eqrmss.debugSheets = () => {
        console.log("=== SHEET DEBUG v4.12 ===");
        console.log("Actor sheet classes:", CONFIG.Actor.sheetClasses);
        for (const a of game.actors.contents) {
            console.log(`${a.name}: ${a.sheet?.constructor.name} html=${a.sheet?.element?.innerHTML?.length||0} rendered=${a.sheet?.rendered}`);
        }
        console.log("Global sheets:", Object.keys(globalThis).filter(k=>k.includes('Sheet')&&k.startsWith('EQRMSS')));
        console.log("Pet managers:", ['EQRMSSPetManager','PetManager'].map(k=>[k, !!globalThis[k], globalThis[k]?.prototype?._renderHTML?.toString().substring(0,100)]));
    };
});

export const MasterFixV412 = { version: "4.12" };
console.log("EQRMSS | Master Fix v4.12 loaded");
