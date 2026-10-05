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

  // Displaced-spell landing (Table 15.7): the failure card's
  // "Place the stray spell" button opens the GM crosshair.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    root.querySelectorAll(".eqrmss-place-stray").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!game.user?.isGM) {
          ui.notifications?.warn("Only the GM can place the stray spell.");
          return;
        }
        try {
          const { handlePlaceStrayButton } = await import("../spells/displaced-spell.js");
          await handlePlaceStrayButton(btn.dataset);
        } catch (e) { console.error("EQRMSS | stray-spell placement failed", e); }
      });
    });
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

    // NPC quick-build wizard (Stage 1): generic NPCs only.
    const npcButton = document.createElement("button");
    npcButton.type = "button";
    npcButton.className = "eqrmss-npc-wizard-launcher";
    npcButton.innerHTML = '<i class="fas fa-hat-wizard"></i> Create NPC';
    npcButton.addEventListener("click", () => {
      game.eqrmss?.openNPCWizard?.();
    });
    target.appendChild(npcButton);
  });

}

