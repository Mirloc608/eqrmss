// ============================================================
// EQRMSS Pet Actor Sheet
// ============================================================

import EQRMSSActorSheet from "./eqrmss_actor_sheet.js";
import { EQRMSSActorTabsHelper } from "./helpers/actor-sheet-tabs.js";
import { dismissPet } from "../../spells/pets/summon-pet.js";
import {
    getPetSlots,
    getSlotForItem,
    equipPetItem,
    unequipPetItem,
    getPetDefense,
    getPetOB,
    getPetWeapon,
} from "../../spells/pets/pet-equipment.js";
import { PET_ATTACK_TABLES } from "../../spells/pets/pet-combat.js";

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

        // Equipment (2026-10-08): simple slot-based inventory.
        const slots = getPetSlots(this.actor).map((slot) => {
            const equipped = [...(this.actor.items ?? [])].find(
                (i) => i.system?.equipped === true && i.system?.petSlot === slot.id
            ) ?? null;
            return {
                ...slot,
                item: equipped ? { id: equipped.id, name: equipped.name, img: equipped.img } : null,
            };
        });
        const inventory = [...(this.actor.items ?? [])]
            .filter((i) => i.system?.equipped !== true)
            .map((i) => {
                const slot = getSlotForItem(this.actor, i);
                return {
                    id: i.id,
                    name: i.name,
                    img: i.img,
                    type: i.type,
                    slotId: slot?.id ?? null,
                    slotLabel: slot?.label ?? null,
                    canEquip: !!slot,
                };
            });

        return {
            ...context,
            actor: this.actor,
            system,
            pet,
            ownerName,
            petLevel: Number(system.attributes?.level?.value) || 1,
            hitsTaken,
            hitsMax,
            petDefense: getPetDefense(this.actor),
            petOB: getPetOB(this.actor),
            creatureType: system.details?.creatureType ?? pet.family ?? "—",
            buffs,
            debuffs,
            equipSlots: slots,
            equipInventory: inventory,
            attackForms: this._buildAttackForms(scaling, pet),
        };
    }

    /**
     * Build the attack-forms list for the Combat tab: one row for the
     * natural attack plus the equipped weapon (if any). Mirrors the
     * resolution logic in pet-combat.js syntheticPetWeapon() (display only).
     */
    _buildAttackForms(scaling, pet) {
        const forms = [];
        const actor = this.actor;
        const family = pet?.family ?? actor?.system?.details?.creatureType ?? "animal";
        const buffs = pet?.buffs ?? {};
        const ob = Number(scaling?.ob) || 0;
        const critSteps = Number(buffs.critSteps) || 0;
        const bonusAttacks = Number(buffs.bonusAttacks) || 0;
        const isMagical = pet?.isMagical ?? true;

        // Natural attack (family table)
        const tableName = PET_ATTACK_TABLES[family] ?? "Armored Fist";
        const notes = [];
        if (isMagical) notes.push("Magical");
        if (critSteps > 0) notes.push(`Crit +${critSteps}`);
        forms.push({
            name: `${actor?.name ?? "Pet"}'s Attack`,
            kind: "Natural",
            ob,
            table: tableName,
            attacks: 1 + bonusAttacks,
            notes: notes.join(", ") || "—",
        });

        // Equipped weapon (pet-equipment.js)
        try {
            const equipped = getPetWeapon(actor);
            if (equipped) {
                const sys = equipped.system ?? {};
                const bonuses = sys.bonuses ?? {};
                const wNotes = [];
                if (isMagical) wNotes.push("Magical");
                if (critSteps > 0) wNotes.push(`Crit +${critSteps}`);
                if (Number(bonuses.damageBonus)) wNotes.push(`Dmg +${bonuses.damageBonus}`);
                forms.push({
                    name: equipped.name ?? "Weapon",
                    kind: "Weapon",
                    ob: ob + (Number(bonuses.attackBonus) || 0),
                    table: sys.attackTable ?? tableName,
                    attacks: 1 + bonusAttacks,
                    notes: wNotes.join(", ") || "—",
                });
            }
        } catch { /* display-only; ignore */ }

        return forms;
    }

    async _onRender(context, options) {
        await super._onRender(context, options);

        // Tabs (2026-10-08): the pet sheet extends DocumentSheetV2 directly
        // (not EQRMSSActorSheet), so the shared tabs helper must be wired
        // here explicitly. Without this, tab clicks are never bound.
        try {
            new EQRMSSActorTabsHelper(this).activate();
        } catch (err) {
            console.warn("EQRMSS | pet sheet tabs failed:", err);
        }

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

        // Dismiss button: delete the pet actor and its tokens
        html.querySelectorAll(".pet-dismiss").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Dismiss Pet" },
                content: `<p>Dismiss <strong>${actor.name}</strong>? This cannot be undone.</p>`
            });
            if (!confirmed) return;
            try {
                const petName = actor.name;
                await dismissPet(actor, "has been dismissed");
                ui.notifications.info(`${petName} dismissed.`);
            } catch (err) {
                console.warn("EQRMSS | pet dismiss failed:", err);
                ui.notifications.warn(`Could not dismiss ${actor.name}.`);
            }
        }));

        // Equipment: equip / unequip buttons
        html.querySelectorAll(".pet-equip").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const itemId = el.dataset.itemId;
            const slotId = el.dataset.slotId || null;
            if (!itemId) return;
            await equipPetItem(actor, itemId, slotId);
        }));
        html.querySelectorAll(".pet-unequip").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const itemId = el.dataset.itemId;
            if (!itemId) return;
            await unequipPetItem(actor, itemId);
        }));

        // Drag & drop: drop an Item onto the sheet to add it to the pet
        if (!this._petDropBound) {
            html.addEventListener("dragover", ev => ev.preventDefault());
            html.addEventListener("drop", ev => this._onPetDrop(ev));
            this._petDropBound = true;
        }
    }

    async _onPetDrop(event) {
        event.preventDefault();
        const actor = this.document;
        if (!actor) return;
        try {
            const dt = event.dataTransfer;
            const raw = dt?.getData("text/plain") ?? "";
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data?.type !== "Item" || !data?.uuid) return;
            const item = await fromUuid(data.uuid);
            if (!item) return;
            // Copy onto the pet (don't move from another actor)
            if (item.parent !== actor) {
                const itemData = item.toObject();
                await actor.createEmbeddedDocuments("Item", [itemData]);
                ui.notifications.info(`${item.name} added to ${actor.name}.`);
            }
        } catch (err) {
            console.warn("EQRMSS | pet drop failed:", err);
        }
    }
}
