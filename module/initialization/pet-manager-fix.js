
/**
 * EQRMSS Pet Manager Fix v4.13 - AGGRESSIVE polling + watcher
 */
console.log("EQRMSS | Pet Manager Fix v4.13 | Loading - aggressive watcher");

function patchRenderable(cls) {
    if (!cls?.prototype) return false;
    const proto = cls.prototype;
    let patched = false;
    const renderStr = proto._renderHTML?.toString() || '';
    if (!proto._renderHTML || renderStr.includes('not renderable') || renderStr.includes('not implemented') || renderStr.includes('abstract')) {
        proto._renderHTML = async function(context) {
            let templatePath = this.template || this.constructor?.template || this.constructor?.DEFAULT_OPTIONS?.template;
            if (typeof templatePath === 'function') { try { templatePath = templatePath.call(this); } catch {} }
            if (templatePath) {
                try { return await foundry.applications.handlebars.renderTemplate(templatePath, context||{}); }
                catch (e) { console.warn(e); }
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
        proto._eqrmssRenderPatched = true;
        proto._eqrmssV12Patched = true;
        console.log(`EQRMSS | Pet Fix v4.13 | Patched ${cls.name} to be renderable`);
    }
    return patched;
}

function tryPatchAll() {
    let count=0;
    for (const name of ['EQRMSSPetManager','PetManager','EQRMSSPetManagerV2','EQRMSSCompanionManager']) {
        const cls = globalThis[name];
        if (cls && patchRenderable(cls)) count++;
    }
    return count;
}

Hooks.once("init", () => { tryPatchAll(); });

Hooks.once("ready", () => {
    tryPatchAll();
    console.log("EQRMSS | Pet Fix v4.13 | Ready - polling for late definition");
    // Aggressive polling + watcher
    let _EQRMSSPetManager = globalThis.EQRMSSPetManager;
    try {
        Object.defineProperty(globalThis, 'EQRMSSPetManager', {
            get() { return _EQRMSSPetManager; },
            set(v) {
                _EQRMSSPetManager = v;
                if (v) { console.log(`EQRMSS | Pet Fix v4.13 | EQRMSSPetManager set, patching`); patchRenderable(v); }
            },
            configurable: true
        });
    } catch {}
    const interval = setInterval(() => {
        if (tryPatchAll()>0) console.log("EQRMSS | Pet Fix v4.13 | Poll patched pet manager");
    }, 300);
    setTimeout(() => clearInterval(interval), 20000);
    // Also hook render to patch just-in-time
    Hooks.on("renderApplication", (app) => {
        if (app.constructor.name?.includes('PetManager')) {
            patchRenderable(app.constructor);
        }
    });
});

export const PetManagerFixV413 = { version: "4.13" };
