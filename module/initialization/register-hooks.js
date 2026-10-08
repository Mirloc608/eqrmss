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

  // Signature abilities (Lay on Hands / Harm Touch): once per combat —
  // reset on combat start and combat end for all combatants (2026-10-07).
  // GM-only to avoid double-processing.
  async function resetSignaturesFor(combat, label) {
    try {
      const { resetSignatureAbilities } = await import("../combat/signature-abilities.js");
      for (const c of combat?.combatants ?? []) {
        if (c.actor) await resetSignatureAbilities(c.actor);
      }
    } catch (e) { console.error(`EQRMSS | signature reset on combat ${label} failed`, e); }
  }
  Hooks.on("createCombat", (combat) => {
    if (!game.user?.isGM) return;
    resetSignaturesFor(combat, "start");
  });
  Hooks.on("deleteCombat", (combat) => {
    if (!game.user?.isGM) return;
    resetSignaturesFor(combat, "end");
  });

  // Summoned items (2026-10-07): expire after 1 day of game time.
  // GM-only to avoid double-processing.
  Hooks.on("updateWorldTime", (worldTime) => {
    if (!game.user?.isGM) return;
    import("../spells/summon.js")
      .then(m => m.expireSummonedItems(worldTime))
      .catch(e => console.error("EQRMSS | summoned item expiry failed", e));
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

  // Cast-time interruption (Option A) + damage tracking (Option B):
  // preUpdateActor gives old (actor.system) vs new (changed) values.
  // If hits.value increases → damage taken: mark damagedThisRound
  // (Option B fizzle) and interrupt any pending delayed cast (Option A).
  // If stun pool increases → interrupt pending cast.
  // GM-only to avoid double-processing.
  Hooks.on("preUpdateActor", async (actor, changed) => {
    if (!game.user?.isGM) return;
    try {
        const oldHits = Number(actor.system?.hits?.value) || 0;
        const newHits = Number(changed?.system?.hits?.value);
        const tookDamage = Number.isFinite(newHits) && newHits > oldHits;
        const oldStun = Number(actor.system?.hits?.stun) || 0;
        const newStun = Number(changed?.system?.hits?.stun);
        const gotStunned = Number.isFinite(newStun) && newStun > oldStun;

        if (tookDamage || gotStunned) {
            const { interruptPendingCast } = await import("../spells/cast-timing.js");
            const reason = gotStunned ? "stun" : "damage";
            await interruptPendingCast(actor, reason);
        }
        if (tookDamage) {
            // Mark for Option B (cleared at round start in tickConditions).
            // Use options to avoid recursion: set via changed, not a separate update.
            changed.system = changed.system ?? {};
            changed.system.status = changed.system.status ?? {};
            changed.system.status.damagedThisRound = true;
        }
    } catch (e) { console.error("EQRMSS | damage/stun hook failed", e); }
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

