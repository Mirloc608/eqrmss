// ============================================================
// EQRMSS Combatant — system Combatant document (RMSS §6.1).
//
// Foundry's combat tracker rolls initiative through
// combatant.getInitiativeRoll(). The system defines no die-based
// initiative formula — §6.1 initiative is a deterministic points
// total, highest acts first — so without this override the
// tracker's roll button evaluates an undefined formula and throws
// "Unresolved StringTerm undefined".
//
// This override returns the §6.1 total as the Roll. The tracker
// path uses derived values only (getInitiativeRoll is synchronous,
// so there is no situational prompt): for the full situational
// computation use the Combat tab's Initiative button, i.e.
// game.eqrmss.combat.rollInitiative(actor).
// ============================================================

import { computeInitiative } from "../combat/initiative.js";
import { deriveInitiativeInput } from "../combat/initiative-rolls.js";

export default class EQRMSSCombatant extends Combatant {

    getInitiativeRoll(options = {}) {
        const { input } = deriveInitiativeInput(this.actor, {
            round: Math.max(1, Number(this.combat?.round) || 1),
            situational: { surprised: false, charging: false, movementPct: 0 },
            useTargets: true
        });
        const { total } = computeInitiative(input);
        return new Roll(String(total));
    }

}
