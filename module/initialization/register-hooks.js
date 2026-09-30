// ============================================================
// EQRMSS Hook Registration
// ============================================================

import { tickConditions } from "../combat/crit-conditions.js";

export function registerEQRMSSHooks() {
  console.info("EQRMSS | Registering hooks");

  // Critical conditions tick: on each combat round change the GM ticks
  // stun pools (-1, most severe first), bleed, and death timers.
  Hooks.on("updateCombat", (combat, changed) => {
    if (!game.user?.isGM) return;
    if (!changed || typeof changed.round !== "number") return;
    tickConditions(combat).catch(e => console.error("EQRMSS | Condition tick failed", e));
  });

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
      game.eqrmss?.openWizard?.();
    });
    target.appendChild(button);
  });

}

