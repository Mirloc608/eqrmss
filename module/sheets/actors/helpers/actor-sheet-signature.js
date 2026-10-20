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

        // Disciplines (2026-10-10): mechanical activation via discipline-effects.js
        html.querySelectorAll('[data-action="activateDiscipline"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const discId = el.dataset.disciplineId;
                if (!discId) return;
                // Resolve from the boot registry (the same source the
                // sheet context builder filters): activateListeners
                // receives no context, and the old `context.disciplines`
                // reference threw on click — the buttons died silently.
                const discData = globalThis.CONFIG?.EQRMSS?.data?.results?.disciplines;
                let disc = null;
                if (Array.isArray(discData)) {
                    disc = discData.find(d => d.id === discId) ?? null;
                } else if (discData) {
                    for (const cd of Object.values(discData)) {
                        const arr = Array.isArray(cd) ? cd : (cd?.disciplines || []);
                        disc = arr.find(d => d.id === discId) ?? null;
                        if (disc) break;
                    }
                }
                if (!disc) {
                    try { ui?.notifications?.warn?.(`EQRMSS | Discipline not found: ${discId}`); } catch (e) {}
                    return;
                }
                const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
                const notes = [];
                try {
                    const { applyDisciplineEffects } = await import("../../../combat/discipline-effects.js");
                    await applyDisciplineEffects(actor, disc, notes);
                } catch (e) {
                    console.error("EQRMSS | Discipline activation failed", e);
                    notes.push(`<em>Error activating ${esc(disc.name)}.</em>`);
                }
                await ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    content: `<div class="eqrmss-discipline"><h3>${esc(disc.name)}</h3><p><strong>${esc(actor.name)}</strong> uses <strong>${esc(disc.name)}</strong>!</p><p>Duration: ${disc.durationRounds} rounds</p>${notes.join("")}</div>`
                });
            });
        });

        // Abilities (2026-10-10): combat ability buttons via ability-handlers.js
        html.querySelectorAll('[data-action="activateAbility"]').forEach(el => {
            el.addEventListener("click", async (ev) => {
                ev.preventDefault();
                const abilId = el.dataset.abilityId;
                if (!abilId) return;
                // Resolve from the boot registry (the same source the
                // sheet context builder filters): activateListeners
                // receives no context, and the old `context.abilities`
                // reference threw on click — Taunt/Slam died silently.
                const abilData = globalThis.game?.eqrmss?.abilities;
                let ability = null;
                if (abilData) {
                    for (const pool of Object.values(abilData)) {
                        if (!Array.isArray(pool)) continue;
                        ability = pool.find(a => a.id === abilId) ?? null;
                        if (ability) break;
                    }
                }
                if (!ability) {
                    try { ui?.notifications?.warn?.(`EQRMSS | Ability not found: ${abilId}`); } catch (e) {}
                    return;
                }
                const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
                const notes = [];
                // Target: use current targets or none
                const targets = Array.from(game.user?.targets ?? []);
                const target = targets[0]?.actor ?? null;
                try {
                    const { executeAbility } = await import("../../../combat/ability-handlers.js");
                    await executeAbility(actor, target, ability, notes);
                } catch (e) {
                    console.error("EQRMSS | Ability activation failed", e);
                    notes.push(`<em>Error activating ${esc(ability.name)}.</em>`);
                }
                await ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    content: `<div class="eqrmss-ability"><h3>${esc(ability.name)}</h3><p><strong>${esc(actor.name)}</strong> uses <strong>${esc(ability.name)}</strong>!</p>${notes.join("")}</div>`
                });
            });
        });
    }
}
