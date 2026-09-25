/**
 * EQRMSS Wizard Fix v4.1 - Force Wizard to Open
 * Issue: Wizard does not load, no error - likely early return or data check fails silently
 */
console.log("EQRMSS | Wizard Fix v4.1 | Loading");

Hooks.once("init", () => {
    console.log("EQRMSS | Wizard Fix | init");
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Wizard Fix | ready - adding wizard open helper");
    
    // Add helper to open wizard manually
    game.eqrmss = game.eqrmss || {};
    game.eqrmss.openWizard = async () => {
        console.log("EQRMSS | openWizard() called manually");
        console.log(`  Data: races=${Object.keys(game.eqrmss?.races||{}).length}, classes=${Object.keys(game.eqrmss?.classes||{}).length}`);
        
        // Find wizard class
        const wizardClass = globalThis.EQRMSSCharacterCreationWizard || 
                           globalThis.CharacterCreationWizard ||
                           Object.values(globalThis).find(v => v?.name?.includes('Wizard') && typeof v === 'function' && v.name.includes('EQRMSS'));
        
        console.log("  Wizard class found:", wizardClass?.name, wizardClass);
        
        if (!wizardClass) {
            console.error("EQRMSS | No wizard class found in globalThis");
            console.log("  Searching all globals with wizard...");
            const allWizardKeys = Object.keys(globalThis).filter(k => k.toLowerCase().includes('wizard'));
            console.log("  All wizard keys:", allWizardKeys);
            ui.notifications?.error("EQRMSS Wizard class not found - check console");
            return;
        }
        
        try {
            console.log("  Creating wizard instance...");
            const wizard = new wizardClass();
            console.log("  Wizard instance:", wizard);
            console.log("  Rendering wizard...");
            await wizard.render(true);
            console.log("  Wizard rendered!");
            return wizard;
        } catch (e) {
            console.error("EQRMSS | Wizard open failed:", e);
            console.error(e.stack);
            ui.notifications?.error(`Wizard failed: ${e.message}`);
            throw e;
        }
    };
    
    // Add button to actor directory to open wizard
    Hooks.on("renderActorDirectory", (app, html) => {
        const el = html instanceof HTMLElement ? html : html[0];
        if (!el || el.querySelector('#eqrmss-wizard-btn')) return;
        
        const header = el.querySelector('.directory-header') || el.querySelector('.header-actions');
        if (header) {
            const btn = document.createElement('button');
            btn.id = 'eqrmss-wizard-btn';
            btn.innerHTML = '<i class="fas fa-user-plus"></i> EQRMSS Wizard';
            btn.style.cssText = 'margin:5px;padding:5px 10px;background:#4a90a4;color:white;border:none;border-radius:3px;cursor:pointer;';
            btn.onclick = () => game.eqrmss.openWizard();
            header.appendChild(btn);
            console.log("EQRMSS | Added wizard button to actor directory");
        }
    });
    
    // Also hook the existing wizard button if any
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action="openCharacterCreationWizard"], .open-wizard, #open-character-creation-wizard');
        if (target) {
            console.log("EQRMSS | Wizard button clicked (intercepted)", target);
            setTimeout(() => {
                const wizardWindows = Object.values(ui.windows).filter(w => w.constructor.name.toLowerCase().includes('wizard'));
                console.log(`  Wizard windows after click: ${wizardWindows.length}`, wizardWindows);
                if (wizardWindows.length === 0) {
                    console.warn("EQRMSS | Wizard button clicked but no wizard window opened - trying manual open");
                    // Check if there was an error
                }
            }, 500);
        }
    });
    
    console.log("EQRMSS | Wizard Fix | Ready - run game.eqrmss.openWizard() to test wizard manually");
});

Hooks.on("eqrmss:dataLoadersReady", () => {
    console.log("EQRMSS | Wizard Fix | dataLoadersReady - wizard data ready, wizard should now open");
});
