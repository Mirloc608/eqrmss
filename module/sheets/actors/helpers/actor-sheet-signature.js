/**
 * Signature Ability sheet helper: Lay on Hands (Paladin), Harm Touch (Shadowknight)
 */
import { layOnHands, harmTouch } from "../../../combat/signature-abilities.js";

export class EQRMSSActorSignatureHelper {
    constructor(sheet) {
        this.sheet = sheet;
    }

    activateListeners(html) {
        const actor = this.sheet.actor;
        if (!actor) return;

        html.querySelectorAll('[data-action="layOnHands"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const targeted = [...(game.user?.targets ?? [])][0];
                const target = targeted?.actor ?? actor;
                await layOnHands(actor, target);
                this.sheet.render(false);
            });
        });

        html.querySelectorAll('[data-action="harmTouch"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const targeted = [...(game.user?.targets ?? [])][0];
                if (!targeted?.actor) {
                    ui?.notifications?.warn("Select a target for Harm Touch.");
                    return;
                }
                await harmTouch(actor, targeted.actor);
                this.sheet.render(false);
            });
        });
    }
}
