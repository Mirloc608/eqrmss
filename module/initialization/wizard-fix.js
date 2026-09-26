/**
 * EQRMSS Wizard Fix v4.2 - REAL FIX
 * Ensures wizard button actually opens wizard
 */
console.log("EQRMSS | Wizard Fix v4.2 | Loading");

Hooks.once("init", () => {
    console.log("EQRMSS | Wizard Fix v4.2 | init");
});

Hooks.once("ready", () => {
    console.log("EQRMSS | Wizard Fix v4.2 | ready");
    
    game.eqrmss = game.eqrmss || {};
    
    // If openWizard already exists from sheet-wizard-fix, keep it, otherwise create
    if (!game.eqrmss.openWizard) {
        game.eqrmss.openWizard = async (actor = null) => {
            console.log("EQRMSS | Wizard Fix | openWizard called");
            const wizardClass = globalThis.EQRMSSCharacterCreationWizard;
            if (!wizardClass) {
                ui.notifications.error("Wizard class not found");
                return;
            }
            const wizard = actor ? new wizardClass(actor) : new wizardClass();
            await wizard.render(true);
            return wizard;
        };
    }
    
    // Hook the create actor button to offer wizard
    Hooks.on("renderActorDirectory", (app, html) => {
        const el = html instanceof HTMLElement ? html : html[0];
        if (!el) return;
        
        // Find create actor button
        const createBtn = el.querySelector('button.create-entity, button.create-document');
        if (createBtn && !createBtn._eqrmssWizardHooked) {
            createBtn._eqrmssWizardHooked = true;
            console.log("EQRMSS | Wizard Fix | Hooked create actor button");
        }
    });
    
    // Intercept clicks on wizard buttons - more aggressive
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button, a, [data-action]');
        if (!btn) return;
        
        const isWizardBtn = 
            btn.dataset?.action?.toLowerCase().includes('wizard') ||
            btn.id?.toLowerCase().includes('wizard') ||
            btn.className?.toLowerCase().includes('wizard') ||
            btn.textContent?.toLowerCase().includes('character creation') ||
            (btn.querySelector('i.fa-user-plus') && btn.textContent?.toLowerCase().includes('wizard'));
            
        if (isWizardBtn) {
            console.log("EQRMSS | Wizard Fix | Wizard button intercepted:", btn);
            // Let the original handler run first, then check if wizard opened
            setTimeout(async () => {
                const wizardOpen = Object.values(ui.windows).some(w => 
                    w.constructor.name.toLowerCase().includes('wizard')
                );
                if (!wizardOpen) {
                    console.warn("EQRMSS | Wizard Fix | Button clicked but no wizard window - forcing open");
                    try {
                        await game.eqrmss.openWizard();
                    } catch (err) {
                        console.error("EQRMSS | Wizard Fix | Force open failed:", err);
                    }
                }
            }, 800);
        }
    }, true);
    
    console.log("EQRMSS | Wizard Fix v4.2 | Ready - use game.eqrmss.openWizard()");
});

Hooks.on("eqrmss:dataLoadersReady", () => {
    console.log("EQRMSS | Wizard Fix v4.2 | dataLoadersReady - wizard should now work");
    console.log("EQRMSS | Wizard Fix | Run game.eqrmss.openWizard() to test");
});

export const WizardFixV42 = { version: "4.2" };
