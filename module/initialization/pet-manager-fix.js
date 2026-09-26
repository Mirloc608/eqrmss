/**
 * EQRMSS Pet Manager Fix v4.7 - DISABLED old openWizard override
 * Now handled by master-fix-v47.js which injects ARRAYS not objects
 */
console.log("EQRMSS | Pet Manager Fix v4.7 | Loading - openWizard disabled, handled by master fix");

function patchRenderable(cls) {
    if (!cls?.prototype) return false;
    if (cls.prototype._eqrmssRenderPatched) return true;
    const proto = cls.prototype;
    let patched = false;
    if (!proto._renderHTML || proto._renderHTML.toString().includes('not renderable')) {
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
    if (patched) {
        proto._eqrmssRenderPatched = true;
        console.log(`EQRMSS | Pet Fix v4.7 | Patched ${cls.name}`);
    }
    return patched;
}

Hooks.once("init", () => {
    ['EQRMSSPetManager', 'PetManager'].forEach(name => {
        const cls = globalThis[name];
        if (cls) patchRenderable(cls);
    });
});

Hooks.once("ready", () => {
    ['EQRMSSPetManager', 'PetManager'].forEach(name => {
        const cls = globalThis[name];
        if (cls) patchRenderable(cls);
    });
    console.log("EQRMSS | Pet Fix v4.7 | Ready - openWizard handled by master-fix-v47");
});

export const PetManagerFixV47 = { version: "4.7" };
