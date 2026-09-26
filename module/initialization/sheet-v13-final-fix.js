/**
 * EQRMSS Sheet V13 Final Fix v4.5
 * Character and Pet sheets load but do not render in V13
 * 
 * Root cause: In V13, ActorSheet is now ActorSheetV2 (ApplicationV2 + HandlebarsApplicationMixin)
 * It requires:
 *   - _prepareContext(options) -> context
 *   - _renderHTML(context, options) -> HTML string or element
 *   - _replaceHTML(result, content, options)
 * 
 * Old sheets implement:
 *   - get template() -> path
 *   - getData() -> data
 *   - _onRender(html)
 * 
 * This fix injects V13 methods that bridge old API to new
 */
console.log("EQRMSS | Sheet V13 Final Fix v4.5 | Loading");

function isOldSheet(cls) {
    if (!cls?.prototype) return false;
    const proto = cls.prototype;
    // Old sheets have getData or template getter, but no _renderHTML
    return (typeof proto.getData === 'function' || Object.getOwnPropertyDescriptor(proto, 'template') || proto.template) && !proto._eqrmssV13FinalPatched;
}

function patchOldSheetToV13(cls, sheetName) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssV13FinalPatched) return true;
    
    const proto = cls.prototype;
    console.log(`EQRMSS | Sheet Fix v4.5 | Patching ${sheetName} (${cls.name}) to V13`);
    
    // Save originals
    const origGetData = proto.getData;
    const origPrepareContext = proto._prepareContext;
    const origOnRender = proto._onRender;
    const origActivateListeners = proto.activateListeners;
    
    // 1. _prepareContext - bridge getData -> context
    if (!proto._prepareContext || proto._prepareContext.toString().includes('not implemented')) {
        proto._prepareContext = async function(options) {
            console.log(`EQRMSS | ${sheetName}._prepareContext v4.5`);
            let context = {};
            
            // Try new API first if it exists in parent
            if (origPrepareContext && origPrepareContext !== proto._prepareContext) {
                try {
                    const parentContext = await origPrepareContext.call(this, options);
                    if (parentContext) Object.assign(context, parentContext);
                } catch (e) {
                    console.warn(`EQRMSS | ${sheetName} orig _prepareContext failed:`, e.message);
                }
            }
            
            // Try old getData
            if (origGetData) {
                try {
                    const data = await origGetData.call(this, options);
                    Object.assign(context, data);
                    console.log(`EQRMSS | ${sheetName} getData -> context keys:`, Object.keys(data || {}));
                } catch (e) {
                    console.warn(`EQRMSS | ${sheetName} getData failed:`, e.message);
                }
            }
            
            // Ensure actor data
            if (this.actor) {
                context.actor = this.actor;
                context.system = this.actor.system;
                context.flags = this.actor.flags;
            }
            if (this.item) {
                context.item = this.item;
                context.system = this.item.system;
            }
            
            // Add game.eqrmss data for sheets that need it
            context.eqrmss = game.eqrmss || {};
            context.races = game.eqrmss?.races || {};
            context.classes = game.eqrmss?.classes || {};
            
            return context;
        };
    }
    
    // 2. _renderHTML - render template with context
    if (!proto._renderHTML || proto._renderHTML.toString().includes('not implemented') || proto._renderHTML.toString().includes('not renderable')) {
        proto._renderHTML = async function(context, options) {
            console.log(`EQRMSS | ${sheetName}._renderHTML v4.5 - context keys:`, Object.keys(context || {}));
            
            let templatePath = null;
            
            // Get template from various sources
            if (this.template) {
                templatePath = typeof this.template === 'function' ? this.template : this.template;
            } else if (Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this), 'template')?.get) {
                try { templatePath = this.template; } catch {}
            } else if (proto.template) {
                templatePath = typeof proto.template === 'function' ? proto.template.call(this) : proto.template;
            }
            
            // Try class static properties
            if (!templatePath && this.constructor?.template) {
                templatePath = this.constructor.template;
            }
            
            console.log(`EQRMSS | ${sheetName} template:`, templatePath);
            
            if (!templatePath) {
                console.error(`EQRMSS | ${sheetName} NO TEMPLATE FOUND`);
                return `<div class="eqrmss-sheet-error">No template for ${sheetName}<br>Actor: ${this.actor?.name}<br>Check console</div>`;
            }
            
            try {
                const html = await foundry.applications.handlebars.renderTemplate(templatePath, context);
                console.log(`EQRMSS | ${sheetName} rendered ${html.length} chars`);
                return html;
            } catch (e) {
                console.error(`EQRMSS | ${sheetName} renderTemplate failed for ${templatePath}:`, e);
                console.error(e.stack);
                return `<div class="eqrmss-sheet-error">Template error: ${e.message}<br>Template: ${templatePath}<br>Check console for details</div>`;
            }
        };
    }
    
    // 3. _replaceHTML - put HTML into element
    if (!proto._replaceHTML || proto._replaceHTML.toString().includes('not implemented')) {
        proto._replaceHTML = function(result, content, options) {
            console.log(`EQRMSS | ${sheetName}._replaceHTML v4.5 - result type:`, typeof result, result?.length || result?.innerHTML?.length);
            if (!this.element) {
                console.warn(`EQRMSS | ${sheetName} no element in _replaceHTML`);
                return;
            }
            
            if (typeof result === 'string') {
                this.element.innerHTML = result;
            } else if (result instanceof HTMLElement) {
                this.element.innerHTML = '';
                this.element.appendChild(result);
            } else if (result?.innerHTML) {
                this.element.innerHTML = result.innerHTML;
            }
            
            // Call old _onRender if exists
            if (origOnRender) {
                try {
                    // old _onRender expects html (jQuery or HTMLElement)
                    // Give it element
                    const htmlParam = this.element;
                    // Ensure it has find
                    if (htmlParam && !htmlParam.find && HTMLElement.prototype.find) {
                        htmlParam.find = HTMLElement.prototype.find.bind(htmlParam);
                    }
                    const maybePromise = origOnRender.call(this, htmlParam, options);
                    if (maybePromise instanceof Promise) maybePromise.catch(e => console.warn(`EQRMSS | ${sheetName} _onRender failed:`, e));
                } catch (e) {
                    console.warn(`EQRMSS | ${sheetName} _onRender error:`, e);
                }
            }
            
            // Call activateListeners
            if (origActivateListeners) {
                try {
                    origActivateListeners.call(this, this.element);
                } catch (e) {
                    console.warn(`EQRMSS | ${sheetName} activateListeners failed:`, e);
                }
            }
        };
    }
    
    // 4. Also patch _onRender to ensure html.find exists
    if (proto._onRender && !proto._onRender._eqrmssPatched) {
        const orig = proto._onRender;
        proto._onRender = async function(html, ...rest) {
            if (html instanceof HTMLElement && !html.find) {
                html.find = HTMLElement.prototype.find.bind(html);
            }
            if (html?.[0] instanceof HTMLElement && !html[0].find) {
                html[0].find = HTMLElement.prototype.find.bind(html[0]);
            }
            return orig.call(this, html, ...rest);
        };
        proto._onRender._eqrmssPatched = true;
    }
    
    proto._eqrmssV13FinalPatched = true;
    console.log(`EQRMSS | Sheet Fix v4.5 | ${sheetName} patched to V13 - READY`);
    return true;
}

function patchAllSheets() {
    console.log("EQRMSS | Sheet Fix v4.5 | Patching all registered sheets");
    let patchedCount = 0;
    
    // Patch from CONFIG
    for (const [docType, sheetMap] of Object.entries(CONFIG.Actor?.sheetClasses || {})) {
        for (const [sheetId, sheetInfo] of Object.entries(sheetMap)) {
            const cls = sheetInfo?.cls;
            if (cls && isOldSheet(cls)) {
                if (patchOldSheetToV13(cls, `${docType}.${sheetId} (${cls.name})`)) {
                    patchedCount++;
                }
            }
        }
    }
    
    for (const [docType, sheetMap] of Object.entries(CONFIG.Item?.sheetClasses || {})) {
        for (const [sheetId, sheetInfo] of Object.entries(sheetMap)) {
            const cls = sheetInfo?.cls;
            if (cls && isOldSheet(cls)) {
                if (patchOldSheetToV13(cls, `Item ${docType}.${sheetId} (${cls.name})`)) {
                    patchedCount++;
                }
            }
        }
    }
    
    // Also patch any global sheet classes
    const globalSheetNames = Object.keys(globalThis).filter(k => 
        (k.includes('Sheet') || k.includes('ActorSheet')) && 
        k.startsWith('EQRMSS') &&
        typeof globalThis[k] === 'function'
    );
    
    for (const name of globalSheetNames) {
        const cls = globalThis[name];
        if (isOldSheet(cls)) {
            if (patchOldSheetToV13(cls, `globalThis.${name}`)) {
                patchedCount++;
            }
        }
    }
    
    console.log(`EQRMSS | Sheet Fix v4.5 | Patched ${patchedCount} sheets`);
    return patchedCount;
}

Hooks.once("init", () => {
    console.log("EQRMSS | Sheet Fix v4.5 | init - will patch after sheets registered");
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Sheet Fix v4.5 | ready - patching sheets now");
    
    // Sheets are registered in eqrmss.js ready, so patch after a short delay
    setTimeout(() => {
        const count = patchAllSheets();
        console.log(`EQRMSS | Sheet Fix v4.5 | Ready - patched ${count} sheets`);
        
        // Try to re-render any open sheets that are blank
        for (const app of Object.values(ui.windows)) {
            if (app.constructor.name.toLowerCase().includes('sheet') || app.constructor.name.toLowerCase().includes('eqrmss')) {
                if (app.element && app.element.innerHTML.length < 200) {
                    console.log(`EQRMSS | Sheet Fix v4.5 | Re-rendering blank sheet ${app.constructor.name}`);
                    try {
                        app.render(true, { force: true });
                    } catch (e) {
                        console.warn(`EQRMSS | Failed to re-render ${app.constructor.name}:`, e);
                    }
                }
            }
        }
        
        console.log("EQRMSS | Sheet Fix v4.5 | Run game.eqrmss.debugSheets() to check");
    }, 1000);
});

Hooks.on("renderApplication", (app, html, data) => {
    const name = app.constructor?.name || "";
    if (name.toLowerCase().includes('sheet') && name.toLowerCase().includes('eqrmss')) {
        const len = app.element?.innerHTML?.length || 0;
        console.log(`EQRMSS | Sheet render v4.5: ${name} - ${len} chars, rendered=${app.rendered}`);
        if (len < 100 && app.element) {
            console.warn(`EQRMSS | Sheet ${name} is nearly empty - attempting fix`);
            console.warn(`  Element:`, app.element);
            console.warn(`  HTML preview:`, app.element.innerHTML.substring(0, 500));
            // Try to force patch and re-render
            if (isOldSheet(app.constructor)) {
                patchOldSheetToV13(app.constructor, name);
                setTimeout(() => {
                    console.log(`EQRMSS | Retrying render for ${name}`);
                    app.render(true, { force: true }).catch(e => console.error(e));
                }, 100);
            }
        }
    }
});

// Also expose fix function
Hooks.once("ready", () => {
    game.eqrmss = game.eqrmss || {};
    game.eqrmss.fixSheetsV13 = () => {
        console.log("EQRMSS | fixSheetsV13() called");
        const count = patchAllSheets();
        for (const actor of game.actors.contents) {
            try {
                console.log(`  Fixing ${actor.name}...`);
                actor.sheet?.close({ animate: false });
            } catch {}
        }
        setTimeout(async () => {
            for (const actor of game.actors.contents) {
                try {
                    await actor.sheet?.render(true, { force: true });
                    console.log(`  Re-rendered ${actor.name}: ${actor.sheet.element.innerHTML.length} chars`);
                } catch (e) {
                    console.error(`  Failed ${actor.name}:`, e);
                }
            }
        }, 500);
        return count;
    };
    
    game.eqrmss.debugSheets = () => {
        console.log("=== EQRMSS SHEET DEBUG v4.5 ===");
        console.log("Actor sheet classes:", CONFIG.Actor.sheetClasses['character']);
        console.log("Pet sheet classes:", CONFIG.Actor.sheetClasses['pet']);
        for (const actor of game.actors.contents) {
            console.log(`Actor ${actor.name}: type=${actor.type}, sheet=${actor.sheet?.constructor.name}, rendered=${actor.sheet?.rendered}, htmlLen=${actor.sheet?.element?.innerHTML?.length || 0}`);
            if (actor.sheet?.element && actor.sheet.element.innerHTML.length < 500) {
                console.log(`  HTML preview:`, actor.sheet.element.innerHTML.substring(0, 500));
            }
        }
    };
});

export const SheetV13FinalFix = { version: "4.5" };
console.log("EQRMSS | Sheet V13 Final Fix v4.5 loaded");
