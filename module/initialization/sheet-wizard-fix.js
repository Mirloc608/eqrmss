/**
 * EQRMSS Sheet+Wizard Fix v4.7 - DISABLED old openWizard override
 * Now only binds buttons and helps debug, openWizard is handled by master-fix-v47
 */
console.log("EQRMSS | Sheet+Wizard Fix v4.7 | Loading - openWizard disabled");

Hooks.once("ready", () => {
    console.log("EQRMSS | Fix v4.7 | ready - checking data");
    const races = Object.keys(game.eqrmss?.races||{}).length;
    const classes = Object.keys(game.eqrmss?.classes||{}).length;
    console.log(`EQRMSS | Fix v4.7 | Data at ready: races=${races}, classes=${classes}`);
    
    function bindWizardButtons() {
        document.querySelectorAll('button, a').forEach(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            const action = btn.dataset?.action?.toLowerCase() || '';
            if (text.includes('wizard') || action.includes('wizard') || btn.id?.toLowerCase().includes('wizard')) {
                if (!btn._eqrmssBound) {
                    btn.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        console.log("EQRMSS | Wizard button clicked");
                        game.eqrmss?.openWizard?.();
                    });
                    btn._eqrmssBound = true;
                }
            }
        });
    }
    
    Hooks.on("renderActorDirectory", (app, html) => {
        const el = html instanceof HTMLElement ? html : html[0];
        if (!el) return;
        if (el.querySelector('#eqrmss-wizard-btn')) return;
        const header = el.querySelector('.directory-header .header-actions') || el.querySelector('.directory-header');
        if (header) {
            const btn = document.createElement('button');
            btn.id = 'eqrmss-wizard-btn';
            btn.type = 'button';
            btn.innerHTML = '<i class="fas fa-user-plus"></i> EQRMSS Wizard';
            btn.style.cssText = 'margin:5px;padding:5px 10px;background:#4a90a4;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;';
            btn.onclick = (e) => { e.preventDefault(); game.eqrmss?.openWizard?.(); };
            header.appendChild(btn);
        }
        bindWizardButtons();
    });
    
    Hooks.on("renderApplication", () => { setTimeout(bindWizardButtons, 100); });
});

Hooks.on("eqrmss:dataLoadersReady", (data) => {
    console.log("EQRMSS | Fix v4.7 | dataLoadersReady", { races: Object.keys(data.races||{}).length, classes: Object.keys(data.classes||{}).length });
    setTimeout(async () => {
        for (const app of Object.values(ui.windows)) {
            if (app.constructor.name.toLowerCase().includes('sheet')) {
                try { await app.render(true, { force: true }); } catch {}
            }
        }
    }, 500);
});

export const EQRMSSFixV47 = { version: "4.7" };
console.log("EQRMSS | Sheet+Wizard Fix v4.7 loaded");
