// ============================================================
// EQRMSS Pet Actor Sheet
// ============================================================

import EQRMSSActorSheet from "./eqrmss_actor_sheet.js";

const { HandlebarsApplicationMixin, DocumentSheetV2 } = foundry.applications.api;

export default class EQRMSSPetSheet extends HandlebarsApplicationMixin(DocumentSheetV2) {

    static DEFAULT_OPTIONS = {
        classes: ["eqrmss", "sheet", "actor", "pet-sheet"],
        position: { width: 560, height: 560 },
        form: {
            closeOnSubmit: false,
            submitOnChange: true
        }
    };

    static PARTS = {
        form: {
            template: "systems/eqrmss/templates/sheets/actors/eqrmss_pet_sheet.html"
        }
    };

    get actor() {
        return this.document;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const system = this.actor.system ?? {};
        const pet = system.pet ?? {};
        const scaling = pet.scaling ?? {};

        // Owner name from flag (summonPet stores flags.eqrmss.ownerId)
        let ownerName = "—";
        try {
            const ownerId = pet.owner ?? this.actor.getFlag("eqrmss", "ownerId");
            const owner = ownerId ? game.actors.get(ownerId) : null;
            if (owner) ownerName = owner.name;
        } catch { /* ignore */ }

        const hitsMax = Number(system.hits?.max) || 0;
        const hitsTaken = Number(system.hits?.value) || 0;

        // Buffs & Debuffs (2026-10-08): same sources as the PC Status
        // tab — ActiveEffects + timed spellEffects + DoTs. Read-only
        // display (no dismiss buttons on the pet sheet).
        const buffs = [];
        const debuffs = [];
        for (const effect of this.actor?.effects ?? []) {
            if (effect.disabled) continue;
            const entry = { name: effect.name ?? "Unnamed Effect" };
            if (effect.flags?.eqrmss?.category === "debuff") debuffs.push(entry);
            else buffs.push(entry);
        }
        const timed = system.status?.spellEffects;
        if (Array.isArray(timed)) {
            for (const e of timed) {
                const label = e?.name ?? e?.label ?? "Timed Effect";
                const rounds = Number(e?.roundsLeft ?? e?.rounds ?? 0);
                const roundsTxt = rounds > 0 ? ` (${rounds} rounds)` : "";
                const entry = { name: `${label}${roundsTxt}` };
                if (e?.category === "debuff") debuffs.push(entry);
                else buffs.push(entry);
            }
        }
        const dots = system.status?.dots;
        if (Array.isArray(dots)) {
            for (const d of dots) {
                const dmg = d?.max ?? d?.min ?? 0;
                const rounds = Number(d?.roundsLeft ?? 0);
                debuffs.push({ name: `${d?.name ?? "Damage over time"} (${dmg}/round${rounds > 0 ? `, ${rounds} rounds` : ""})` });
            }
        }

        return {
            ...context,
            actor: this.actor,
            system,
            pet,
            ownerName,
            petLevel: Number(system.attributes?.level?.value) || 1,
            hitsTaken,
            hitsMax,
            petDefense: Number(scaling.defense) || 0,
            petOB: Number(scaling.ob) || 0,
            creatureType: system.details?.creatureType ?? pet.family ?? "—",
            buffs,
            debuffs
        };
    }

    async _onRender(context, options) {
        await super._onRender(context, options);

        const html = this.element;
        const actor = this.actor;

        // Command buttons: Attack / Guard / Follow
        html.querySelectorAll(".pet-command").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const command = el.dataset.command;
            if (!command) return;
            try {
                await actor.update({ "system.pet.command": command });
                ui.notifications.info(`${actor.name} commanded to ${command}.`);
            } catch (err) {
                console.warn("EQRMSS | pet command failed:", err);
                ui.notifications.warn(`Could not command ${actor.name}.`);
            }
        }));

        // Dismiss button: delete the pet actor
        html.querySelectorAll(".pet-dismiss").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Dismiss Pet" },
                content: `<p>Dismiss <strong>${actor.name}</strong>? This cannot be undone.</p>`
            });
            if (!confirmed) return;
            try {
                const ownerId = actor.system?.pet?.owner ?? actor.getFlag("eqrmss", "ownerId");
                await actor.delete();
                ui.notifications.info(`${actor.name} dismissed.`);
                void ownerId;
            } catch (err) {
                console.warn("EQRMSS | pet dismiss failed:", err);
                ui.notifications.warn(`Could not dismiss ${actor.name}.`);
            }
        }));
    }
}
