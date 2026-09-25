/**
 * EQRMSS Foundry V13 Compatibility Shim v4.1
 * Fixes: html.find is not a function (jQuery -> HTMLElement migration in Foundry v13)
 * 
 * In Foundry v12: _onRender(html) where html is jQuery object, html.find() works
 * In Foundry v13: _onRender(html) where html is HTMLElement, need querySelector
 * 
 * This shim adds jQuery-like methods to HTMLElement and wraps as needed
 */
console.log("EQRMSS | V13 Compat Shim v4.1 | Loading - fixing html.find");

Hooks.once("init", () => {
    console.log("EQRMSS | V13 Compat | Patching HTMLElement for jQuery compat");

    // Add jQuery-like methods to HTMLElement if not already present
    if (!HTMLElement.prototype.find) {
        HTMLElement.prototype.find = function(selector) {
            const nodes = this.querySelectorAll(selector);
            // Return a jQuery-like object with minimal methods needed
            const arr = Array.from(nodes);
            arr.find = function(sel) {
                const results = [];
                for (const el of this) {
                    if (el.querySelectorAll) results.push(...el.querySelectorAll(sel));
                }
                const r = Array.from(results);
                r.find = this.find;
                r.closest = this.closest;
                r.on = this.on;
                r.off = this.off;
                r.click = this.click;
                r.each = this.each;
                return r;
            };
            arr.closest = function(sel) {
                for (const el of this) {
                    const c = el.closest ? el.closest(sel) : null;
                    if (c) return [c];
                }
                return [];
            };
            arr.on = function(event, handler) {
                for (const el of this) el.addEventListener(event, handler);
                return this;
            };
            arr.off = function(event, handler) {
                for (const el of this) el.removeEventListener(event, handler);
                return this;
            };
            arr.each = function(fn) {
                for (let i=0;i<this.length;i++) fn.call(this[i], i, this[i]);
                return this;
            };
            return arr;
        };
    }

    if (!HTMLElement.prototype.closest) {
        // closest exists natively but keep for safety
    }

    // Patch all EQRMSS sheet _onRender methods to handle both jQuery and HTMLElement
    const patchSheetRender = (className) => {
        try {
            const cls = globalThis[className];
            if (!cls || !cls.prototype) return;
            const original = cls.prototype._onRender;
            if (!original || original._eqrmssPatched) return;
            
            console.log(`EQRMSS | V13 Compat | Patching ${className}._onRender`);
            cls.prototype._onRender = async function(html, ...rest) {
                // Normalize html to work with both jQuery and HTMLElement code
                let $html = html;
                
                // If html is HTMLElement, wrap it to have jQuery-like API
                if (html instanceof HTMLElement) {
                    // Create a jQuery-like wrapper that also keeps native methods
                    const jqWrapper = (selector) => {
                        if (!selector) return html;
                        return html.querySelectorAll(selector);
                    };
                    // Add jQuery methods to the element itself for direct calls like html.find()
                    if (!html._eqrmssWrapped) {
                        const origFind = html.find;
                        if (typeof origFind !== 'function' || origFind.toString().includes('native code') === false) {
                            // Already patched above, ensure it works
                        }
                        // Also add $ shortcut
                        html.$ = (sel) => html.querySelectorAll(sel);
                        html.find = html.find || function(sel) { return this.querySelectorAll(sel); };
                        html._eqrmssWrapped = true;
                    }
                    $html = html;
                    // Also try to provide jQuery object if jQuery exists
                    if (window.$ && typeof window.$ === 'function') {
                        try {
                            const jq = window.$(html);
                            // Merge jQuery methods onto html for compatibility
                            if (jq && jq.find) {
                                // If original code does html.find(), and html is now HTMLElement with our patched find, it should work
                                // Also support html as jQuery object for code that expects it
                                $html = jq;
                                // Keep reference to native element
                                $html[0] = html;
                                $html.nativeElement = html;
                            }
                        } catch {}
                    }
                } else if (html && html.jquery) {
                    // Already jQuery, keep as is
                    $html = html;
                } else if (Array.isArray(html) && html[0] instanceof HTMLElement) {
                    // jQuery-like array
                    $html = html;
                }

                try {
                    return await original.call(this, $html, ...rest);
                } catch (e) {
                    console.error(`EQRMSS | ${className}._onRender failed:`, e);
                    console.error(`  html type: ${html?.constructor?.name}, is HTMLElement: ${html instanceof HTMLElement}, has find: ${typeof html?.find}`);
                    // Try fallback: call with native element wrapped in jQuery if available
                    if (window.$ && html instanceof HTMLElement) {
                        try {
                            console.log(`EQRMSS | Trying fallback with jQuery wrapper for ${className}`);
                            const jqHtml = window.$(html);
                            return await original.call(this, jqHtml, ...rest);
                        } catch (e2) {
                            console.error(`EQRMSS | Fallback also failed for ${className}:`, e2);
                            throw e; // throw original
                        }
                    }
                    throw e;
                }
            };
            cls.prototype._onRender._eqrmssPatched = true;
        } catch (e) {
            console.warn(`EQRMSS | V13 Compat | Failed to patch ${className}:`, e.message);
        }
    };

    // Patch known sheet classes - do this on init and also on ready as classes may be defined later
    const sheetClasses = ['EQRMSSActorSheet', 'EQRMSSPlayerSheet', 'EQRMSSNPCSheet', 'EQRMSSPetSheet', 'EQRMSSItemSheet', 'EQRMSSCharacterCreationWizard'];
    sheetClasses.forEach(patchSheetRender);

    Hooks.once("ready", () => {
        console.log("EQRMSS | V13 Compat | Ready hook - patching sheets again (they may have been defined after init)");
        sheetClasses.forEach(patchSheetRender);
        // Also patch any class that ends with Sheet
        Object.keys(globalThis).forEach(key => {
            if (key.includes('EQRMSS') && (key.includes('Sheet') || key.includes('Wizard'))) {
                patchSheetRender(key);
            }
        });
    });
});

export const V13Compat = {
    patchElement: (el) => {
        if (el instanceof HTMLElement && !el.find) {
            el.find = HTMLElement.prototype.find;
        }
        return el;
    }
};
