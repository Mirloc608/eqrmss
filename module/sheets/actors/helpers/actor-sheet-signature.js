/**
 * Signature Ability sheet helper: Lay on Hands (Paladin), Harm Touch (Shadowknight),
 * Summon Warder (Beastlord), Era Capstones (all classes)
 */
import { layOnHands, harmTouch } from "../../../combat/signature-abilities.js";
import { useSummonWarder } from "../../../spells/pets/summon-warder.js";
import { activateCapstone } from "../../../combat/capstones.js";

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

        html.querySelectorAll('[data-action="summonWarder"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                await useSummonWarder(actor);
                this.sheet.render(false);
            });
        });

        // Era Capstones (2026-10-09)
        html.querySelectorAll('[data-action="activateCapstone"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const capstoneId = el.dataset.capstoneId;
                if (!capstoneId) return;
                const targeted = [...(game.user?.targets ?? [])][0];
                const target = targeted?.actor ?? null;
                const result = await activateCapstone(actor, capstoneId, target);
                if (!result.ok) {
                    ui?.notifications?.warn(result.message);
                }
                this.sheet.render(false);
            });
        });

        // Disciplines (2026-10-09): descriptive activation (mechanical effects future work)
        html.querySelectorAll('[data-action="activateDiscipline"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const discId = el.dataset.disciplineId;
                if (!discId) return;
                const discs = context.disciplines || [];
                const disc = discs.find(d => d.id === discId);
                if (!disc) return;
                const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
                const fxList = (disc.effects || []).map(e => `${esc(e.type)}: ${esc(e.value)}`).join("<br>");
                await ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    content: `<div class="eqrmss-discipline"><h3>${esc(disc.name)}</h3><p><strong>${esc(actor.name)}</strong> uses <strong>${esc(disc.name)}</strong>!</p><p>Duration: ${disc.durationRounds} rounds</p><p>${fxList}</p></div>`
                });
            });
        });
    }
}
