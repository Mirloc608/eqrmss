/**
 * EQRMSS Foundry V13 Compatibility Shim v4.2 - REAL FIX
 * Fixes: html.find is not a function at eqrmss_actor_sheet.js:122
 * 
 * Foundry V13 changed:
 * - V12: _onRender(html) where html is jQuery
 * - V13: _onRender(context, options) OR _onRender(html is HTMLElement)
 * - V13 ApplicationV2: render() returns HTMLElement, not jQuery
 * 
 * This shim provides full jQuery compat for HTMLElement
 */
console.log("EQRMSS | V13 Compat Shim v4.2 | Loading - REAL fix");

(function() {
    // 1. Patch HTMLElement.prototype.find BEFORE any sheet loads
    if (!HTMLElement.prototype._eqrmssPatched) {
        const originalQuery = HTMLElement.prototype.querySelectorAll;
        
        HTMLElement.prototype.find = function(selector) {
            if (!selector) return this._wrap([]);
            try {
                const nodes = this.querySelectorAll(selector);
                return this._wrap(Array.from(nodes));
            } catch (e) {
                console.warn(`EQRMSS | HTMLElement.find failed for ${selector}:`, e);
                return this._wrap([]);
            }
        };
        
        HTMLElement.prototype._wrap = function(arr) {
            if (!Array.isArray(arr)) arr = [arr].filter(Boolean);
            // Add jQuery-like methods
            arr.find = (sel) => {
                const results = [];
                for (const el of arr) {
                    if (el.querySelectorAll) {
                        try { results.push(...el.querySelectorAll(sel)); } catch {}
                    }
                }
                return arr[0]?._wrap ? arr[0]._wrap(results) : HTMLElement.prototype._wrap.call(arr[0] || document.createElement('div'), results);
            };
            arr.closest = function(sel) {
                for (const el of this) {
                    const c = el.closest?.(sel);
                    if (c) return this._wrap([c]);
                }
                return this._wrap([]);
            };
            arr.on = function(event, selectorOrHandler, handler) {
                // Support both .on(event, handler) and .on(event, selector, handler)
                if (typeof selectorOrHandler === 'function') {
                    for (const el of this) el.addEventListener(event, selectorOrHandler);
                } else if (typeof handler === 'function') {
                    for (const el of this) {
                        el.addEventListener(event, (e) => {
                            if (e.target.matches(selectorOrHandler) || e.target.closest(selectorOrHandler)) {
                                handler.call(e.target, e);
                            }
                        });
                    }
                }
                return this;
            };
            arr.off = function(event, handler) {
                for (const el of this) el.removeEventListener(event, handler);
                return this;
            };
            arr.click = function(handler) {
                if (handler) return this.on('click', handler);
                for (const el of this) el.click();
                return this;
            };
            arr.each = function(fn) {
                for (let i=0;i<this.length;i++) fn.call(this[i], i, this[i]);
                return this;
            };
            arr.val = function(value) {
                if (value === undefined) return this[0]?.value;
                for (const el of this) if ('value' in el) el.value = value;
                return this;
            };
            arr.text = function(value) {
                if (value === undefined) return this[0]?.textContent;
                for (const el of this) el.textContent = value;
                return this;
            };
            arr.html = function(value) {
                if (value === undefined) return this[0]?.innerHTML;
                for (const el of this) el.innerHTML = value;
                return this;
            };
            arr.attr = function(name, value) {
                if (value === undefined) return this[0]?.getAttribute(name);
                for (const el of this) el.setAttribute(name, value);
                return this;
            };
            arr.addClass = function(cls) { for (const el of this) el.classList.add(cls); return this; };
            arr.removeClass = function(cls) { for (const el of this) el.classList.remove(cls); return this; };
            arr.hasClass = function(cls) { return this[0]?.classList.contains(cls) || false; };
            arr.show = function() { for (const el of this) el.style.display = ''; return this; };
            arr.hide = function() { for (const el of this) el.style.display = 'none'; return this; };
            arr.length = arr.length;
            return arr;
        };
        
        // Also patch for single element access
        Object.defineProperty(HTMLElement.prototype, 'length', {
            get() { return 1; },
            configurable: true
        });
        
        HTMLElement.prototype._eqrmssPatched = true;
        console.log("EQRMSS | V13 Compat | HTMLElement.prototype.find patched");
    }

    // 2. Global $ fallback for sheets that expect jQuery
    if (!window.$ || !window.jQuery) {
        console.log("EQRMSS | V13 Compat | jQuery not found, creating minimal $");
        window.$ = window.jQuery = function(selectorOrElement) {
            if (selectorOrElement instanceof HTMLElement) {
                return selectorOrElement._wrap ? selectorOrElement._wrap([selectorOrElement]) : HTMLElement.prototype._wrap.call(selectorOrElement, [selectorOrElement]);
            }
            if (typeof selectorOrElement === 'string') {
                try {
                    return HTMLElement.prototype._wrap.call(document.createElement('div'), Array.from(document.querySelectorAll(selectorOrElement)));
                } catch { return HTMLElement.prototype._wrap.call(document.createElement('div'), []); }
            }
            return HTMLElement.prototype._wrap.call(document.createElement('div'), []);
        };
        window.$.fn = {};
    }

    // 3. Patch sheet _onRender to handle both V12 and V13 signatures
    function patchSheetClass(className) {
        const cls = globalThis[className];
        if (!cls?.prototype) return false;
        if (cls.prototype._eqrmssV13Patched) return true;
        
        const proto = cls.prototype;
        // Try to find the render method - could be _onRender, _renderHTML, _render, render
        const methods = ['_onRender', '_renderHTML', '_onFirstRender', 'render'];
        
        for (const methodName of methods) {
            const orig = proto[methodName];
            if (!orig || typeof orig !== 'function') continue;
            if (orig._eqrmssV13Patched) continue;
            
            console.log(`EQRMSS | V13 Compat | Patching ${className}.${methodName}`);
            
            proto[methodName] = async function(...args) {
                // Normalize args: V13 might pass (context, options) or (html)
                let html = args[0];
                let context = args[0];
                let options = args[1];
                
                // If html is HTMLElement, ensure it has find()
                if (html instanceof HTMLElement && !html.find) {
                    html.find = HTMLElement.prototype.find;
                    html._wrap = HTMLElement.prototype._wrap;
                }
                
                // If html is HTMLElement but code expects jQuery, wrap it
                if (html instanceof HTMLElement) {
                    // Create jQuery-like wrapper around html for legacy code
                    const jqWrapper = html._wrap ? html._wrap([html]) : [html];
                    // But also keep native methods on html itself
                    // For code like html.find(selector) - ensure html.find exists
                    if (!html.find) html.find = HTMLElement.prototype.find.bind(html);
                    
                    // Try to call original with both possibilities
                    try {
                        return await orig.apply(this, args);
                    } catch (e) {
                        if (e.message?.includes('find is not a function') || e.message?.includes('find is not defined')) {
                            console.warn(`EQRMSS | ${className}.${methodName} find error, retrying with jQuery wrapper`, e);
                            // Retry with jQuery wrapper as first arg
                            if (window.$) {
                                try {
                                    const $html = window.$(html);
                                    const newArgs = [ $html, ...args.slice(1) ];
                                    return await orig.apply(this, newArgs);
                                } catch (e2) {
                                    console.error(`EQRMSS | Retry failed for ${className}:`, e2);
                                    throw e;
                                }
                            }
                        }
                        throw e;
                    }
                } else {
                    return await orig.apply(this, args);
                }
            };
            proto[methodName]._eqrmssV13Patched = true;
            return true;
        }
        return false;
    }

    // Patch on init
    Hooks.once("init", () => {
        console.log("EQRMSS | V13 Compat v4.2 | Init - patching sheets");
        const sheets = ['EQRMSSActorSheet', 'EQRMSSPlayerSheet', 'EQRMSSNPCSheet', 'EQRMSSPetSheet', 'EQRMSSItemSheet', 'EQRMSSCharacterCreationWizard', 'CharacterCreationWizard', 'EQRMSSCharacterSheet'];
        sheets.forEach(patchSheetClass);
        
        // Also patch any class in globalThis that looks like a sheet
        Object.keys(globalThis).forEach(key => {
            if (key.includes('EQRMSS') && (key.includes('Sheet') || key.includes('Wizard') || key.includes('Actor'))) {
                patchSheetClass(key);
            }
        });
    });

    // Patch again on ready (sheets may be defined after init)
    Hooks.once("ready", () => {
        console.log("EQRMSS | V13 Compat v4.2 | Ready - patching again");
        const sheets = ['EQRMSSActorSheet', 'EQRMSSPlayerSheet', 'EQRMSSNPCSheet', 'EQRMSSPetSheet', 'EQRMSSItemSheet', 'EQRMSSCharacterCreationWizard', 'CharacterCreationWizard', 'EQRMSSCharacterSheet'];
        sheets.forEach(patchSheetClass);
        
        Object.keys(globalThis).forEach(key => {
            if (key.includes('EQRMSS') && (key.includes('Sheet') || key.includes('Wizard'))) {
                patchSheetClass(key);
            }
        });

        // Also patch ApplicationV2 render if needed
        if (foundry?.applications?.api?.ApplicationV2) {
            console.log("EQRMSS | V13 Compat | ApplicationV2 found, ensuring HTMLElement.find exists");
        }
        
        // Test the patch
        const testEl = document.createElement('div');
        testEl.innerHTML = '<span class="test"></span>';
        if (testEl.find) {
            const found = testEl.find('.test');
            console.log(`EQRMSS | V13 Compat | Test HTMLElement.find: ${found.length} found - PATCH WORKS`);
        } else {
            console.error("EQRMSS | V13 Compat | Test FAILED - find not patched");
        }
    });

    // Patch renderApplication hook to catch all renders
    Hooks.on("renderApplication", (app, html) => {
        if (html instanceof HTMLElement && !html.find) {
            html.find = HTMLElement.prototype.find.bind(html);
        }
        // Also patch if html is jQuery but inner elements need find
        if (html?.[0] instanceof HTMLElement && !html[0].find) {
            html[0].find = HTMLElement.prototype.find.bind(html[0]);
        }
    });
})();

export const V13CompatFix = { version: "4.2" };
