/**
 * Bandolier sheet helper: wires the Combat tab Bandolier panel
 * (swap / configure / rename). Mirrors the signature-ability
 * helper pattern: constructed with the sheet, listeners attached
 * in _onRender.
 */
import {
    swapBandolierSet,
    setBandolierSlot,
    renameBandolierSet,
    setQuiver
} from "../../../combat/bandolier.js";

export class EQRMSSActorBandolierHelper {
    constructor(sheet) {
        this.sheet = sheet;
    }

    activateListeners(html) {
        const actor = this.sheet.actor;
        if (!actor || !html) return;

        html.querySelectorAll(".bandolier-swap").forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const result = await swapBandolierSet(actor, el.dataset.setIndex);
                if (!result.ok) ui.notifications?.warn(result.message);
                this.sheet.render(false);
            });
        });

        html.querySelectorAll(".bandolier-slot").forEach(el => {
            el.addEventListener("change", async (ev) => {
                ev.preventDefault();
                const result = await setBandolierSlot(actor, el.dataset.setIndex, el.dataset.side, el.value || null);
                if (!result.ok) ui.notifications?.warn(result.message);
                this.sheet.render(false);
            });
        });

        html.querySelectorAll(".bandolier-name").forEach(el => {
            el.addEventListener("change", async (ev) => {
                ev.preventDefault();
                const result = await renameBandolierSet(actor, el.dataset.setIndex, el.value);
                if (!result.ok) ui.notifications?.warn(result.message);
                this.sheet.render(false);
            });
        });

        html.querySelectorAll(".quiver-select").forEach(el => {
            el.addEventListener("change", async (ev) => {
                ev.preventDefault();
                const result = await setQuiver(actor, el.value || null);
                if (!result.ok) ui.notifications?.warn(result.message);
                this.sheet.render(false);
            });
        });
    }
}
