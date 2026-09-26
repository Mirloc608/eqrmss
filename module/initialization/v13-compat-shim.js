/**
 * EQRMSS Foundry V13 Compatibility Shim v4.3 - FINAL
 * Fixes html.find + ApplicationV2 renderable check
 */
console.log("EQRMSS | V13 Compat Shim v4.3 | Loading");

(function() {
    // 1. Patch HTMLElement.prototype.find BEFORE any sheet loads
    if (!HTMLElement.prototype._eqrmssPatched) {
        HTMLElement.prototype.find = function(selector) {
            if (!selector) return this._wrap ? this._wrap([]) : [];
            try {
                const nodes = this.querySelectorAll(selector);
                return this._wrap ? this._wrap(Array.from(nodes)) : Array.from(nodes);
            } catch (e) {
                return this._wrap ? this._wrap([]) : [];
            }
        };
        
        HTMLElement.prototype._wrap = function(arr) {
            if (!Array.isArray(arr)) arr = [arr].filter(Boolean);
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
                    if (c) return this._wrap ? this._wrap([c]) : [c];
                }
                return this._wrap ? this._wrap([]) : [];
            };
            arr.on = function(event, selectorOrHandler, handler) {
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
            arr.data = function(key, value) {
                if (value === undefined) return this[0]?.dataset?.[key] || this[0]?.getAttribute(`data-${key}`);
                for (const el of this) {
                    if (el.dataset) el.dataset[key] = value;
                    else el.setAttribute(`data-${key}`, value);
                }
                return this;
            };
            arr.prop = function(key, value) {
                if (value === undefined) return this[0]?.[key];
                for (const el of this) el[key] = value;
                return this;
            };
            arr.css = function(prop, value) {
                if (typeof prop === 'object') {
                    for (const el of this) Object.assign(el.style, prop);
                } else if (value !== undefined) {
                    for (const el of this) el.style[prop] = value;
                } else {
                    return this[0] ? getComputedStyle(this[0])[prop] : undefined;
                }
                return this;
            };
            arr.length = arr.length;
            return arr;
        };
        
        HTMLElement.prototype._eqrmssPatched = true;
        console.log("EQRMSS | V13 Compat v4.3 | HTMLElement.prototype.find patched");
    }

    // Global $ fallback
    if (!window.$) {
        window.$ = window.jQuery = function(selectorOrElement) {
            if (selectorOrElement instanceof HTMLElement) {
                return selectorOrElement._wrap ? selectorOrElement._wrap([selectorOrElement]) : [selectorOrElement];
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

    // Patch sheet _onRender
    function patchSheetClass(className) {
        const cls = globalThis[className];
        if (!cls?.prototype) return false;
        if (cls.prototype._eqrmssV13Patched) return true;
        
        const proto = cls.prototype;
        const methods = ['_onRender', '_renderHTML', '_onFirstRender'];
        
        for (const methodName of methods) {
            const orig = proto[methodName];
            if (!orig || typeof orig !== 'function') continue;
            if (orig._eqrmssV13Patched) continue;
            
            console.log(`EQRMSS | V13 Compat v4.3 | Patching ${className}.${methodName}`);
            
            proto[methodName] = async function(...args) {
                let html = args[0];
                if (html instanceof HTMLElement && !html.find) {
                    html.find = HTMLElement.prototype.find.bind(html);
                    html._wrap = HTMLElement.prototype._wrap.bind(html);
                }
                try {
                    return await orig.apply(this, args);
                } catch (e) {
                    if (e.message?.includes('find is not a function')) {
                        console.warn(`EQRMSS | ${className}.${methodName} find error, retrying with jQuery wrapper`);
                        if (window.$ && html instanceof HTMLElement) {
                            try {
                                const $html = window.$(html);
                                return await orig.apply(this, [$html, ...args.slice(1)]);
                            } catch (e2) { throw e; }
                        }
                    }
                    throw e;
                }
            };
            proto[methodName]._eqrmssV13Patched = true;
            return true;
        }
        return false;
    }

    Hooks.once("init", () => {
        const sheets = ['EQRMSSActorSheet', 'EQRMSSPlayerSheet', 'EQRMSSNPCSheet', 'EQRMSSPetSheet', 'EQRMSSItemSheet', 'EQRMSSCharacterCreationWizard', 'CharacterCreationWizard', 'EQRMSSCharacterSheet', 'EQRMSSPetManager'];
        sheets.forEach(patchSheetClass);
        Object.keys(globalThis).forEach(key => {
            if (key.includes('EQRMSS') && (key.includes('Sheet') || key.includes('Wizard') || key.includes('Manager'))) {
                patchSheetClass(key);
            }
        });
    });

    Hooks.once("ready", () => {
        const sheets = ['EQRMSSActorSheet', 'EQRMSSPlayerSheet', 'EQRMSSNPCSheet', 'EQRMSSPetSheet', 'EQRMSSItemSheet', 'EQRMSSCharacterCreationWizard', 'CharacterCreationWizard', 'EQRMSSCharacterSheet', 'EQRMSSPetManager'];
        sheets.forEach(patchSheetClass);
        Object.keys(globalThis).forEach(key => {
            if (key.includes('EQRMSS') && (key.includes('Sheet') || key.includes('Wizard') || key.includes('Manager'))) {
                patchSheetClass(key);
            }
        });
        const testEl = document.createElement('div');
        testEl.innerHTML = '<span class="test"></span>';
        if (testEl.find) {
            const found = testEl.find('.test');
            console.log(`EQRMSS | V13 Compat v4.3 | Test: ${found.length} found - PATCH WORKS`);
        }
    });

    Hooks.on("renderApplication", (app, html) => {
        if (html instanceof HTMLElement && !html.find) {
            html.find = HTMLElement.prototype.find.bind(html);
        }
        if (html?.[0] instanceof HTMLElement && !html[0].find) {
            html[0].find = HTMLElement.prototype.find.bind(html[0]);
        }
    });
})();

export const V13CompatFix = { version: "4.3" };
