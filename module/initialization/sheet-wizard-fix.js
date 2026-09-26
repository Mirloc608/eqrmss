/**
 * EQRMSS Sheet+Wizard Fix v4.2 - REAL FIXES
 * Fixes:
 * 1. Character sheet not rendering - ensures ApplicationV2 compat + forces re-render after data load
 * 2. Wizard button not loading wizard - binds button + adds global opener + retries
 */
console.log("EQRMSS | Sheet+Wizard Fix v4.2 | Loading - REAL fixes");

let wizardOpenAttempts = 0;
let sheetRenderAttempts = 0;

Hooks.once("init", () => {
    console.log("EQRMSS | Fix v4.2 | init");
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Fix v4.2 | ready - checking data");
    const races = Object.keys(game.eqrmss?.races||{}).length;
    const classes = Object.keys(game.eqrmss?.classes||{}).length;
    console.log(`EQRMSS | Fix v4.2 | Data at ready: races=${races}, classes=${classes}`);
    
    game.eqrmss = game.eqrmss || {};
    
    // ===== WIZARD OPENER - ROBUST VERSION =====
    game.eqrmss.openWizard = async (actor = null) => {
        wizardOpenAttempts++;
        console.log(`EQRMSS | openWizard() attempt #${wizardOpenAttempts}`);
        console.log(`  Data: races=${Object.keys(game.eqrmss?.races||{}).length}, classes=${Object.keys(game.eqrmss?.classes||{}).length}`);
        
        // Ensure data is loaded
        if (Object.keys(game.eqrmss?.races||{}).length === 0) {
            console.warn("EQRMSS | No races yet - trying to load data loaders...");
            try {
                const mod = await import('../data/loaders/race-loader.js');
                if (mod?.EQRMSSRaceLoader?.load) await mod.EQRMSSRaceLoader.load();
            } catch {}
        }
        
        // Find wizard class - try multiple locations
        let wizardClass = null;
        const candidates = [
            globalThis.EQRMSSCharacterCreationWizard,
            globalThis.CharacterCreationWizard,
            globalThis.EQRMSS?.CharacterCreationWizard,
            game.eqrmss?.CharacterCreationWizard,
            foundry?.applications?.apps?.EQRMSSCharacterCreationWizard
        ];
        
        for (const c of candidates) {
            if (c && typeof c === 'function') { wizardClass = c; break; }
        }
        
        // Search globalThis for any wizard class
        if (!wizardClass) {
            for (const key of Object.keys(globalThis)) {
                const val = globalThis[key];
                if (typeof val === 'function' && key.toLowerCase().includes('wizard') && key.toLowerCase().includes('eqrmss')) {
                    wizardClass = val;
                    console.log(`  Found wizard via global search: ${key}`);
                    break;
                }
            }
        }
        
        // Also search for any class with wizard in name
        if (!wizardClass) {
            for (const key of Object.keys(globalThis)) {
                const val = globalThis[key];
                if (typeof val === 'function' && key.toLowerCase().includes('wizard')) {
                    console.log(`  Found generic wizard: ${key} - trying it`);
                    wizardClass = val;
                    break;
                }
            }
        }
        
        console.log("  Wizard class found:", wizardClass?.name, wizardClass);
        
        if (!wizardClass) {
            console.error("EQRMSS | No wizard class found");
            const allWizardKeys = Object.keys(globalThis).filter(k => k.toLowerCase().includes('wizard'));
            console.log("  All wizard keys:", allWizardKeys);
            ui.notifications?.error("Wizard class not found. Check console - run game.eqrmss.debugWizard()");
            return null;
        }
        
        try {
            console.log("  Creating wizard instance...");
            // Wizard might need actor param
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            console.log("  Wizard instance created:", wizard.constructor.name);
            
            console.log("  Rendering wizard...");
            await wizard.render(true);
            console.log("  Wizard rendered! Window:", wizard.id);
            
            // Also ensure it's visible
            if (wizard.element) {
                wizard.element.style.display = '';
                wizard.bringToTop?.();
            }
            
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard open failed:", e);
            console.error(e.stack);
            
            // Try alternative render method for ApplicationV2
            try {
                console.log("  Trying ApplicationV2 render method...");
                const wizard2 = actor ? new wizardClass(actor) : new wizardClass();
                if (wizard2.render && typeof wizard2.render === 'function') {
                    // For ApplicationV2, render is async and returns void
                    await wizard2.render({ force: true });
                    console.log("  Wizard rendered via V2 method");
                    return wizard2;
                }
            } catch (e2) {
                console.error("  V2 render also failed:", e2);
            }
            
            ui.notifications?.error(`Wizard failed: ${e.message}. Check console.`);
            throw e;
        }
    };
    
    // ===== DEBUG HELPERS =====
    game.eqrmss.debugWizard = () => {
        console.log("=== EQRMSS WIZARD DEBUG ===");
        console.log("game.eqrmss.races:", Object.keys(game.eqrmss.races||{}).length, Object.keys(game.eqrmss.races||{}));
        console.log("game.eqrmss.classes:", Object.keys(game.eqrmss.classes||{}).length, Object.keys(game.eqrmss.classes||{}));
        console.log("Wizard class:", globalThis.EQRMSSCharacterCreationWizard);
        console.log("All wizard globals:", Object.keys(globalThis).filter(k => k.toLowerCase().includes('wizard')));
        console.log("Actor sheet classes:", CONFIG.Actor.sheetClasses['character']);
        console.log("Open wizard: game.eqrmss.openWizard()");
        console.log("Test sheet: game.actors.contents[0]?.sheet?.render(true)");
    };
    
    game.eqrmss.debugSheets = () => {
        console.log("=== EQRMSS SHEET DEBUG ===");
        console.log("Sheet classes for character:", CONFIG.Actor.sheetClasses['character']);
        console.log("Sheet classes for npc:", CONFIG.Actor.sheetClasses['npc']);
        for (const actor of game.actors.contents) {
            console.log(`Actor ${actor.name}: type=${actor.type}, sheet=${actor.sheet?.constructor.name}, rendered=${actor.sheet?.rendered}, element=${!!actor.sheet?.element}`);
            if (actor.sheet?.element) {
                console.log(`  Element HTML length: ${actor.sheet.element.innerHTML?.length || actor.sheet.element.outerHTML?.length}`);
            }
        }
        console.log("Try: game.actors.contents[0]?.sheet?.render(true, {force: true})");
    };
    
    // ===== SHEET FIX - FORCE RENDER AFTER DATA LOAD =====
    game.eqrmss.fixSheets = async () => {
        console.log("EQRMSS | fixSheets() called");
        for (const actor of game.actors.contents) {
            try {
                console.log(`  Fixing sheet for ${actor.name}...`);
                await actor.sheet?.close?.({ animate: false });
                await actor.sheet?.render(true, { force: true });
                console.log(`  Sheet for ${actor.name} re-rendered`);
            } catch (e) {
                console.error(`  Failed to fix sheet for ${actor.name}:`, e);
            }
        }
    };
    
    // ===== BIND WIZARD BUTTON =====
    function bindWizardButtons() {
        // Find all wizard buttons and ensure they work
        const selectors = [
            '[data-action="openCharacterCreationWizard"]',
            '.open-wizard',
            '#open-character-creation-wizard',
            '.eqrmss-open-wizard',
            'button:contains("Wizard")',
            '.fa-user-plus'
        ];
        
        document.querySelectorAll('button, a').forEach(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            const action = btn.dataset?.action?.toLowerCase() || '';
            if (text.includes('wizard') || action.includes('wizard') || btn.id?.toLowerCase().includes('wizard')) {
                if (!btn._eqrmssBound) {
                    console.log("EQRMSS | Binding wizard button:", btn);
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log("EQRMSS | Wizard button clicked - opening wizard");
                        game.eqrmss.openWizard();
                    });
                    btn._eqrmssBound = true;
                }
            }
        });
    }
    
    // Bind now and on renderActorDirectory
    bindWizardButtons();
    
    // Also add our own button to actor directory if not exists
    Hooks.on("renderActorDirectory", (app, html) => {
        const el = html instanceof HTMLElement ? html : html[0];
        if (!el) return;
        if (el.querySelector('#eqrmss-wizard-btn')) return;
        
        const header = el.querySelector('.directory-header .header-actions') || 
                      el.querySelector('.directory-header') || 
                      el.querySelector('.header-actions');
        if (header) {
            const btn = document.createElement('button');
            btn.id = 'eqrmss-wizard-btn';
            btn.type = 'button';
            btn.innerHTML = '<i class="fas fa-user-plus"></i> EQRMSS Wizard';
            btn.style.cssText = 'margin:5px;padding:5px 10px;background:#4a90a4;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;';
            btn.onclick = (e) => {
                e.preventDefault();
                console.log("EQRMSS | Our wizard button clicked");
                game.eqrmss.openWizard();
            };
            header.appendChild(btn);
            console.log("EQRMSS | Added wizard button to actor directory");
        }
        bindWizardButtons();
    });
    
    // Re-bind on any render
    Hooks.on("renderApplication", () => {
        setTimeout(bindWizardButtons, 100);
    });
    
    if (Object.keys(game.eqrmss?.races||{}).length === 0) {
        console.warn("EQRMSS | Fix v4.2 | No races at ready - will retry on dataLoadersReady");
    } else {
        console.log("EQRMSS | Fix v4.2 | Data present at ready, sheets should work");
    }
});

Hooks.on("eqrmss:dataLoadersReady", (data) => {
    console.log("EQRMSS | Fix v4.2 | dataLoadersReady", {
        races: Object.keys(data.races||{}).length,
        classes: Object.keys(data.classes||{}).length
    });
    
    // Now that data is ready, re-render any open sheets
    setTimeout(async () => {
        console.log("EQRMSS | Fix v4.2 | Data ready - re-rendering open sheets");
        for (const app of Object.values(ui.windows)) {
            if (app.constructor.name.toLowerCase().includes('sheet') || app.constructor.name.toLowerCase().includes('eqrmss')) {
                try {
                    console.log(`  Re-rendering ${app.constructor.name}...`);
                    await app.render(true, { force: true });
                } catch (e) {
                    console.warn(`  Failed to re-render ${app.constructor.name}:`, e.message);
                }
            }
        }
        
        // Also try to fix all actor sheets
        if (game.eqrmss?.fixSheets) {
            // Don't auto-fix, just log
            console.log("EQRMSS | Fix v4.2 | Data ready - run game.eqrmss.fixSheets() if sheets still blank");
            console.log("EQRMSS | Fix v4.2 | Run game.eqrmss.debugSheets() to check sheets");
            console.log("EQRMSS | Fix v4.2 | Run game.eqrmss.openWizard() to test wizard");
        }
    }, 500);
});

// Catch wizard render errors
Hooks.on("renderApplication", (app) => {
    const name = app.constructor?.name || "";
    if (name.toLowerCase().includes('wizard')) {
        sheetRenderAttempts++;
        console.log(`EQRMSS | Wizard render #${sheetRenderAttempts}: ${name}`, {
            dataRaces: Object.keys(game.eqrmss?.races||{}).length,
            dataClasses: Object.keys(game.eqrmss?.classes||{}).length,
            element: app.element ? 'has element' : 'no element',
            rendered: app._state
        });
        
        if (app.element) {
            // Check if element is empty
            const html = app.element.innerHTML || '';
            if (html.length < 100) {
                console.warn(`EQRMSS | Wizard element is nearly empty (${html.length} chars) - template may have failed`, app.element);
            }
        }
    }
    
    if (name.toLowerCase().includes('sheet') && name.toLowerCase().includes('eqrmss')) {
        console.log(`EQRMSS | Sheet render: ${name}`, {
            rendered: app.rendered,
            element: app.element ? `${app.element.innerHTML?.length} chars` : 'no element'
        });
        
        if (app.element && app.element.innerHTML?.length < 100) {
            console.warn(`EQRMSS | Sheet ${name} has nearly empty HTML - template failed to render`);
            console.warn(`  Element:`, app.element);
            // Try to show what failed
            setTimeout(() => {
                console.log(`  After delay, element HTML: ${app.element.innerHTML?.substring(0, 500)}`);
            }, 100);
        }
    }
});

export const EQRMSSFixV42 = {
    version: "4.2",
    checkWizard: () => game.eqrmss?.debugWizard(),
    checkSheets: () => game.eqrmss?.debugSheets()
};

window.EQRMSSFix = EQRMSSFixV42;
console.log("EQRMSS | Sheet+Wizard Fix v4.2 loaded");
