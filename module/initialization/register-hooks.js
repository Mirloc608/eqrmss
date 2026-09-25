// ============================================================
// EQRMSS Hook Registration
// ============================================================

export function registerEQRMSSHooks() {
  console.info("EQRMSS | Registering hooks");

  // NOTE: Templates are loaded once during "init" by the bootstrap
  // (eqrmss.js -> loadEQRMSSTemplates). The duplicate "ready" reload
  // that used to live here has been removed.
  Hooks.on("renderActorDirectory", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".eqrmss-character-wizard-launcher")) return;

    const target = root.querySelector(".directory-header") ?? root.querySelector(".directory-footer");
    if (!target) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "eqrmss-character-wizard-launcher";
    button.innerHTML = '<i class="fas fa-hat-wizard"></i> Create Character';
    button.addEventListener("click", () => {
      game.eqrmss?.subsystems?.characterWizard?.render(true);
    });
    target.appendChild(button);
  });

}

