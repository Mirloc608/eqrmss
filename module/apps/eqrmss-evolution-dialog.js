// ============================================================
// EQRMSS — Gear Evolution Dialog (Stage 2, T1->T2)
//
// ApplicationV2 — reforge a vessel piece. ARMOR (Crescent Reach
// redesign, 2026-10-27): combines burn a slot-scaled count of a
// catalyst material (family by current form, material by vessel
// class) to ripen the form or transition to the next; the augment
// combine is mandatory before a transition. WEAPONS: unchanged —
// eat a same-type weapon to ripen or take the next rung.
// Two routes: DIY (tiered tradeskill combine, technique learned
// via Smithing, Tailoring, or Fletching) or a paid NPC (fee
// doubles per tier, 5% failure, fee kept on failure).
// On any failure the vessel is returned intact; the fuel is lost.
// ============================================================

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const BaseApplication = HandlebarsApplicationMixin(ApplicationV2);

import {
    loadEvolutionLines, cacheEvolutionLines, socketLayout, formCap,
    trivialForTier, npcFeeGp, armorLocationOf, armorCategoryOf,
    classesOf, setOf, weaponFormOf, evolutionState, freeSlots,
    augmentsByTier, validateCombine, validateCatalystCombine,
    catalystRequirement, catalystCost, nextForm,
    ripen, transition, socketAugment, skillForVessel, TIER_NAMES
} from "../gear/evolution.js";
import { canUseTradeskill, CRIT_FAIL_RANGE, CRIT_SUCCESS_RANGE } from "../tradeskills/tradeskill-engine.js";
import { normalizeCatalogData } from "../utils/inventory/catalog-picker.js";

const WEALTH_RATES = { pp: 1000, gp: 100, sp: 10, cp: 1 }; // in cp

function wealthCp(actor) {
    const w = actor?.system?.wealth ?? {};
    return (Number(w.pp) || 0) * WEALTH_RATES.pp + (Number(w.gp) || 0) * WEALTH_RATES.gp
        + (Number(w.sp) || 0) * WEALTH_RATES.sp + (Number(w.cp) || 0) * WEALTH_RATES.cp;
}

function wealthBreakdown(totalCp) {
    let rem = Math.max(0, Math.round(totalCp));
    const pp = Math.floor(rem / 1000); rem -= pp * 1000;
    const gp = Math.floor(rem / 100); rem -= gp * 100;
    const sp = Math.floor(rem / 10); rem -= sp * 10;
    return { pp, gp, sp, cp: rem };
}

export class EvolutionDialog extends BaseApplication {

    static DEFAULT_OPTIONS = {
        id: "eqrmss-evolution",
        classes: ["eqrmss", "evolution-dialog"],
        window: {
            title: "Reforge",
            icon: "fas fa-fire",
            resizable: true
        },
        position: { width: 640, height: 640 },
        actions: {
            "combine": this.#onCombine,
            "socket": this.#onSocket
        }
    };

    static PARTS = {
        main: {
            template: "systems/eqrmss/templates/apps/eqrmss-evolution-dialog.html"
        }
    };

    constructor(actor, vessel) {
        super();
        this.actor = actor;
        this.vessel = vessel;
        this._route = "diy";
        this._fodderId = null;
        this._actionId = "ripening"; // armor catalyst combines: ripening | transition
    }

    get title() {
        return `Reforge — ${this.vessel?.name ?? "Gear"}`;
    }

    // ----------------------------------------------------------
    // Descriptors
    // ----------------------------------------------------------

    _materialsById() {
        const out = {};
        const mats = game.eqrmss?.armor?.options?.().materials ?? [];
        for (const m of mats) out[m.id] = m;
        return out;
    }

    _ctx() {
        return {
            classKey: this.actor?.system?.fixed_info?.profession ?? null,
            raceKey: this.actor?.system?.fixed_info?.race ?? null
        };
    }

    /** Weapon fodder descriptor (weapons still eat weapons). */
    _fodderDescriptor(lines, item, vesselState) {
        const setKey = setOf(lines, item);
        const set = setKey ? lines.sets[setKey] : null;
        return {
            item,
            setKey,
            era: set ? set.era : null,
            crafted: !!set?.crafted,
            catalyst: !!set?.catalyst,
            location: armorLocationOf(item),
            category: armorCategoryOf(item, this._materialsById()),
            templateId: item?.system?.weaponTemplate ?? null,
            weaponForm: weaponFormOf(lines, item),
            classes: classesOf(item)
        };
    }

    /** Units of a named catalyst material this actor holds. */
    _catalystHeld(name) {
        let held = 0;
        for (const item of this.actor.items) {
            if (item.name === name) held += Number(item.system?.quantity) || 1;
        }
        return held;
    }

    /** Consume `count` units of a named catalyst material. */
    async _consumeCatalyst(name, count) {
        let remaining = count;
        for (const item of this.actor.items.filter(i => i.name === name)) {
            if (remaining <= 0) break;
            const qty = Number(item.system?.quantity) || 1;
            if (qty <= remaining) {
                remaining -= qty;
                await item.delete();
            } else {
                await item.update({ "system.quantity": qty - remaining });
                remaining = 0;
            }
        }
    }

    _vesselDescriptor(lines, state) {
        const set = state.set ? lines.sets[state.set] : null;
        return {
            item: this.vessel,
            state,
            location: armorLocationOf(this.vessel),
            category: armorCategoryOf(this.vessel, this._materialsById()),
            templateId: this.vessel?.system?.weaponTemplate ?? null,
            era: set ? set.era : 0
        };
    }

    // ----------------------------------------------------------
    // Context
    // ----------------------------------------------------------

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const lines = await loadEvolutionLines();
        cacheEvolutionLines(lines);
        const cfg = lines.config ?? {};
        const ctx = this._ctx();
        const state = evolutionState(lines, this.vessel, ctx);

        context.vesselName = this.vessel.name;
        context.vesselImg = this.vessel.img;
        if (!state) {
            context.notEvolvable = true;
            context.reason = "This piece is not on an evolution line for this character.";
            return context;
        }
        context.evolvable = true;
        const lineName = state.kind === "weapon"
            ? (lines.weaponLine?.forms ?? []).find(f => f.form === state.form)?.name ?? `Form ${state.form}`
            : (lines.armorLines?.[state.line]?.forms ?? []).find(f => f.form === state.form)?.name ?? `Form ${state.form}`;
        context.formLabel = `${lineName} — Form ${state.form}`;
        context.combines = state.combines;
        context.cap = formCap(state.form);
        context.atCap = state.combines >= formCap(state.form);
        const layout = socketLayout(state.combines);
        const byTier = augmentsByTier(state);
        const used = {};
        context.slots = layout.map(tier => {
            const i = used[tier] ?? 0;
            used[tier] = i + 1;
            const aug = (byTier[tier] ?? [])[i];
            return { tier, filled: !!aug, label: aug ? aug.name : `Empty ${tier} slot` };
        });
        context.bakedDb = state.bakedDb;
        context.bakedOb = state.bakedOb;
        context.hasBaked = (state.bakedDb || state.bakedOb);
        const nf = nextForm(lines, state, ctx);
        context.nextFormLabel = nf ? `Form ${nf.form}${nf.name ? ` — ${nf.name}` : ""}` : null;

        // Combine selection: armor burns catalyst materials
        // (Crescent Reach redesign); weapons still pick fodder.
        const vesselDesc = this._vesselDescriptor(lines, state);
        const actorDesc = { classKey: ctx.classKey, raceKey: ctx.raceKey };
        let selKind = null;
        let selectionOk = false;
        if (state.kind === "armor") {
            context.catalystMode = true;
            const req = catalystRequirement(lines, state, vesselDesc.category);
            const cost = req ? catalystCost(lines, vesselDesc.location) : 0;
            const held = req ? this._catalystHeld(req.itemName) : 0;
            context.catalyst = req ? { name: req.itemName, family: req.family, cost, held } : null;
            const actions = [];
            const ripenVerdict = req
                ? validateCatalystCombine(lines, vesselDesc, { kind: "ripening", held }, actorDesc)
                : { ok: false, reasons: ["No catalyst family is authored for this form."] };
            actions.push({
                id: "ripening",
                label: `Ripen — ${cost} × ${req?.itemName ?? "catalyst"}`,
                ok: ripenVerdict.ok, kind: "ripening", reasons: ripenVerdict.reasons
            });
            // Velious fork (V1): a form-3 transition burns a faction
            // mold, and the mold chooses the form-4 set — one action
            // per faction, validated against that mold's held count.
            const factions = state.form === 3 ? lines.catalysts?.families?.["4"]?.factions : null;
            if (factions) {
                for (const [facKey, fac] of Object.entries(factions)) {
                    const mreq = catalystRequirement(lines, state, vesselDesc.category,
                        { forTransition: true, faction: facKey });
                    const mheld = mreq ? this._catalystHeld(mreq.itemName) : 0;
                    const verdict = mreq
                        ? validateCatalystCombine(lines, vesselDesc,
                            { kind: "transition", held: mheld, faction: facKey }, actorDesc)
                        : { ok: false, reasons: ["No mold is authored for this material class."] };
                    const tnf = nextForm(lines, state, { ...actorDesc, faction: facKey });
                    actions.push({
                        id: `transition:${facKey}`, faction: facKey,
                        label: `Transition${tnf ? ` to ${tnf.name}` : ""} — ${cost} × ${mreq?.itemName ?? "mold"}`,
                        ok: verdict.ok, kind: "transition", reasons: verdict.reasons
                    });
                }
            } else {
                const verdict = req
                    ? validateCatalystCombine(lines, vesselDesc, { kind: "transition", held }, actorDesc)
                    : { ok: false, reasons: ["No catalyst family is authored for this form."] };
                actions.push({
                    id: "transition",
                    label: `Transition${nf ? ` to ${nf.name}` : ""} — ${cost} × ${req?.itemName ?? "catalyst"}`,
                    ok: verdict.ok, kind: "transition", reasons: verdict.reasons
                });
            }
            if (!actions.some(a => a.id === this._actionId)) this._actionId = "ripening";
            if (!actions.find(a => a.id === this._actionId)?.ok) {
                const firstOk = actions.find(a => a.ok);
                if (firstOk) this._actionId = firstOk.id;
            }
            for (const a of actions) a.selected = a.id === this._actionId;
            context.combineActions = actions;
            context.selectedAction = actions.find(a => a.id === this._actionId) ?? null;
            context.selectedIsTransition = context.selectedAction?.kind === "transition";
            selKind = context.selectedAction?.kind ?? null;
            selectionOk = !!context.selectedAction?.ok;
        } else {
            const candidates = [];
            for (const item of this.actor.items) {
                if (item.id === this.vessel.id) continue;
                if (item.type !== "weapon") continue;
                const desc = this._fodderDescriptor(lines, item, state);
                const verdict = validateCombine(lines, vesselDesc, desc, actorDesc);
                candidates.push({
                    id: item.id, name: item.name, img: item.img,
                    ok: verdict.ok, kind: verdict.kind,
                    kindLabel: verdict.kind === "transition" ? "TRANSITION" : verdict.kind === "ripening" ? "Ripen" : "",
                    reasons: verdict.reasons
                });
            }
            candidates.sort((a, b) => (b.ok - a.ok) || a.name.localeCompare(b.name));
            context.candidates = candidates;
            if (!this._fodderId || !candidates.some(c => c.id === this._fodderId)) {
                this._fodderId = candidates.find(c => c.ok)?.id ?? candidates[0]?.id ?? null;
            }
            context.selectedFodder = candidates.find(c => c.id === this._fodderId) ?? null;
            context.selectedIsTransition = context.selectedFodder?.kind === "transition";
            for (const c of candidates) c.selected = c.id === this._fodderId;
            selKind = context.selectedFodder?.kind ?? null;
            selectionOk = !!context.selectedFodder?.ok;
        }

        // Routes.
        const tier = state.form;
        context.route = this._route;
        context.routeDiy = this._route === "diy";
        context.routeNpc = this._route === "npc";
        const skillId = skillForVessel(this.vessel, state);
        context.skillId = skillId;
        context.skillName = skillId.replace("skill-", "").replace(/^./, c => c.toUpperCase());
        context.trivial = trivialForTier(cfg, tier);
        const access = canUseTradeskill(this.actor, skillId);
        context.skillAllowed = access.allowed;
        context.skillRestriction = access.allowed ? null : access.reason;
        const techniques = this.actor.getFlag("eqrmss", "techniques") ?? [];
        context.neededTechnique = selKind === "transition" ? `transition-${tier}`
            : selKind === "ripening" ? `socketing-${tier}` : null;
        context.techniqueKnown = context.neededTechnique ? techniques.includes(context.neededTechnique) : false;
        context.techniqueLabel = context.neededTechnique
            ? `Reforge: ${selKind === "transition" ? "Transition" : "Socketing"} (Tier ${tier})` : null;
        context.feeGp = npcFeeGp(cfg, tier);
        context.wealthGp = Math.floor(wealthCp(this.actor) / 100);
        context.canAfford = wealthCp(this.actor) >= context.feeGp * 100;
        context.canCombine = selectionOk
            && (this._route === "npc" ? context.canAfford
                : context.skillAllowed && context.techniqueKnown);

        // Augments in inventory.
        const free = freeSlots(state);
        context.augments = [];
        for (const item of this.actor.items) {
            const aug = item?.system?.augment;
            if (!aug) continue;
            const fits = aug.appliesTo === state.kind && (free[aug.tier] ?? 0) > 0;
            context.augments.push({
                id: item.id, name: item.name, tier: aug.tier,
                bonus: aug.db ? `+${aug.db} DB` : aug.ob ? `+${aug.ob} OB` : "",
                fits
            });
        }
        context.freeSlotSummary = TIER_NAMES.filter(t => (free[t] ?? 0) > 0)
            .map(t => `${free[t]} ${t}`).join(", ");
        return context;
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        this.element?.querySelector(".evo-fodder-select")?.addEventListener("change", ev => {
            this._fodderId = ev.target.value;
            this.render();
        });
        this.element?.querySelector(".evo-action-select")?.addEventListener("change", ev => {
            this._actionId = ev.target.value;
            this.render();
        });
        this.element?.querySelectorAll("input[name='evo-route']").forEach(r => {
            r.addEventListener("change", ev => {
                this._route = ev.target.value;
                this.render();
            });
        });
    }

    // ----------------------------------------------------------
    // Combine resolution
    // ----------------------------------------------------------

    async _consumeItem(item) {
        const qty = Number(item?.system?.quantity) || 1;
        if (qty > 1) await item.update({ "system.quantity": qty - 1 });
        else await item.delete();
    }

    /** Build the vessel update that takes the target piece's identity. */
    _identityUpdate(targetData, newState) {
        const updates = { name: targetData.name, img: targetData.img };
        const targetSystem = foundry.utils.deepClone(targetData.system ?? {});
        const keepLocation = this.vessel.system?.location;
        const current = this.vessel.system ?? {};
        // Vessel state that is NOT part of the piece's identity and
        // must survive the swap: the evolution stamp (set below),
        // where the piece sits, its stack size, and its worn state.
        // Armor derivation (armor-tier, actor prepare) reads the
        // boolean system.equipped / system.worn, which catalog
        // targets do not carry — deleting them left transitioned
        // pieces reading as unworn ("No Armor") until re-equipped.
        const PRESERVE = ["evolution", "location", "quantity", "equipped", "worn"];
        // Foundry V14 deprecates the legacy "system.-=key" deletion
        // syntax in update data; use the ForcedDeletion operator
        // when the core provides it, legacy keys otherwise.
        const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
        for (const key of Object.keys(current)) {
            if (!(key in targetSystem) && !PRESERVE.includes(key)) {
                if (ForcedDeletion) updates[`system.${key}`] = new ForcedDeletion();
                else updates[`system.-=${key}`] = null;
            }
        }
        for (const [key, value] of Object.entries(targetSystem)) {
            if (PRESERVE.includes(key)) continue;
            updates[`system.${key}`] = value;
        }
        if (keepLocation !== undefined) updates["system.location"] = keepLocation;
        if (current.equipped !== undefined) updates["system.equipped"] = current.equipped;
        if (current.worn !== undefined) updates["system.worn"] = current.worn;
        updates["system.evolution"] = newState;
        return updates;
    }

    async _targetData(lines, state, fodderItem, verdict) {
        // Weapon transitions: the eaten weapon itself is the template.
        if (state.kind === "weapon") {
            return { name: fodderItem.name, img: fodderItem.img, system: fodderItem.system };
        }
        // Armor catalyst transition: the target piece (same slot,
        // the line's next form set) comes from the catalog registry,
        // normalized like a catalog add. The set is the verdict's —
        // it already carries the race variant and, at the Velious
        // fork, the burned mold's faction variant.
        const targetSet = lines.sets[verdict.targetSet];
        const byId = game.eqrmss?.items?.byId ?? {};
        const entries = Object.values(byId);
        const vesselLoc = armorLocationOf(this.vessel);
        let pieceName = null;
        if (vesselLoc) {
            pieceName = (targetSet?.pieces ?? []).find(p => {
                const e = entries.find(x => x?.name === p);
                const loc = e?.system?.armorLocation ?? e?.system?.slot ?? null;
                return loc === vesselLoc;
            }) ?? null;
        }
        if (!pieceName) throw new Error(`No ${targetSet?.name ?? verdict.targetSet} piece found for slot ${vesselLoc}.`);
        const entry = entries.find(e => e?.name === pieceName);
        if (!entry) throw new Error(`Catalog entry missing: ${pieceName}`);
        const normalized = await normalizeCatalogData(foundry.utils.deepClone(entry));
        return { name: normalized.name ?? entry.name, img: normalized.img ?? entry.img, system: normalized.system ?? entry.system };
    }

    static async #onCombine(event, target) {
        const dialog = this;
        const actor = dialog.actor;
        const vessel = dialog.vessel;
        const lines = await loadEvolutionLines();
        cacheEvolutionLines(lines);
        const cfg = lines.config ?? {};
        const ctx = dialog._ctx();
        const state = evolutionState(lines, vessel, ctx);
        if (!state) return ui.notifications.warn("This piece is not on an evolution line.");

        const vesselDesc = dialog._vesselDescriptor(lines, state);
        let fodderItem = null;
        let verdict = null;
        let consumedLabel = "";
        if (state.kind === "armor") {
            // Catalyst combine: validate the chosen action against
            // the actor's held count of the required material. The
            // action id is "ripening", "transition", or — at the
            // Velious fork — "transition:<faction>" (the mold).
            const [kind, faction] = String(dialog._actionId).split(":");
            const req = catalystRequirement(lines, state, vesselDesc.category,
                { forTransition: kind === "transition" && state.form === 3, faction });
            const held = req ? dialog._catalystHeld(req.itemName) : 0;
            verdict = validateCatalystCombine(lines, vesselDesc, { kind, held, faction }, { classKey: ctx.classKey, raceKey: ctx.raceKey });
            consumedLabel = verdict.requirement ? `${verdict.cost ?? 0} × ${verdict.requirement.itemName}` : "the catalyst materials";
        } else {
            fodderItem = actor.items.get(dialog._fodderId);
            if (!fodderItem) return ui.notifications.warn("Choose a piece to consume.");
            const fodderDesc = dialog._fodderDescriptor(lines, fodderItem, state);
            verdict = validateCombine(lines, vesselDesc, fodderDesc, { classKey: ctx.classKey, raceKey: ctx.raceKey });
            consumedLabel = fodderItem.name;
        }
        if (!verdict.ok) return ui.notifications.warn(verdict.reasons[0] ?? "That combine is not legal.");
        // Critical outcomes (2026-10-28, user rulings): a critical failure
        // burns double fuel; a critical success burns 1 catalyst for slots
        // costing multiples and nothing for slots costing 1 (for a weapon
        // feed, the single fodder piece survives a critical success; a
        // critical failure still consumes it — a unique piece cannot be
        // doubled).
        let fuelOutcome = "normal";
        const consumeFuel = async () => {
            if (state.kind === "armor") {
                const cost = verdict.cost ?? 0;
                const qty = fuelOutcome === "critFail" ? cost * 2
                    : fuelOutcome === "critSuccess" ? (cost > 1 ? 1 : 0)
                    : cost;
                if (qty > 0) await dialog._consumeCatalyst(verdict.requirement.itemName, qty);
                consumedLabel = `${qty} × ${verdict.requirement.itemName}`;
            } else if (fuelOutcome === "critSuccess") {
                consumedLabel = `nothing (the ${fodderItem.name} survives)`;
            } else {
                await dialog._consumeItem(fodderItem);
            }
        };

        const tier = state.form;
        const route = dialog._route;
        let rollNote = "";
        let success = false;

        if (route === "npc") {
            const fee = npcFeeGp(cfg, tier);
            if (wealthCp(actor) < fee * 100) return ui.notifications.warn(`The smith asks ${fee} gp — you cannot pay.`);
            // The fee is payment for the attempt: kept on failure.
            await actor.update({ "system.wealth": wealthBreakdown(wealthCp(actor) - fee * 100) });
            const roll = await new Roll("1d100").evaluate();
            success = roll.total > (Number(cfg.npcFailChance) || 0.05) * 100;
            rollNote = `Paid the smith ${fee} gp.`;
        } else {
            const technique = verdict.kind === "transition" ? `transition-${tier}` : `socketing-${tier}`;
            const known = (actor.getFlag("eqrmss", "techniques") ?? []).includes(technique);
            if (!known) return ui.notifications.warn(`The technique "Reforge: ${verdict.kind === "transition" ? "Transition" : "Socketing"} (Tier ${tier})" must be learned first (Smithing, Tailoring, or Fletching).`);
            const skillId = skillForVessel(vessel, state);
            const access = canUseTradeskill(actor, skillId);
            if (!access.allowed) return ui.notifications.warn(access.reason);
            let toolBonus = 0;
            for (const t of actor.items.filter(i => i.type === "tool" && String(i.system?.tradeskillId ?? "") === skillId)) {
                toolBonus += Number(t.system?.skillBonus ?? 0);
            }
            const engine = game.eqrmss?.getSkillCheckEngine?.();
            if (!engine) return ui.notifications.error("Skill check engine unavailable.");
            const trivial = trivialForTier(cfg, tier);
            const check = await engine.rollSkillCheck(actor, skillId, { target: trivial, label: `Reforge ${vessel.name}` }, { situationalModifiers: toolBonus });
            const natural = check.roll.total;
            const isCritFail = natural >= CRIT_FAIL_RANGE[0] && natural <= CRIT_FAIL_RANGE[1];
            const isCritSuccess = natural >= CRIT_SUCCESS_RANGE[0] && natural <= CRIT_SUCCESS_RANGE[1];
            success = (check.success || isCritSuccess) && !isCritFail;
            fuelOutcome = isCritFail ? "critFail" : isCritSuccess ? "critSuccess" : "normal";
            rollNote = `${skillId.replace("skill-", "")} check: rolled ${natural} (total ${check.total}) vs trivial ${trivial}.`
                + (isCritFail ? " Critical failure!" : isCritSuccess ? " Critical success!" : "");
        }

        if (!success) {
            await consumeFuel();
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<p><strong>Reforge failed.</strong> ${vessel.name} is returned intact, but ${consumedLabel} ${state.kind === "armor" ? "are" : "is"} lost in the attempt. ${rollNote}</p>`
            });
            ui.notifications.warn(`Reforge failed — ${consumedLabel} lost.`);
            dialog.render();
            return;
        }

        let resultNote = "";
        if (verdict.kind === "ripening") {
            const { state: next, bakedTiers } = ripen(state);
            await vessel.update({ "system.evolution": next });
            resultNote = `${vessel.name} ${state.kind === "armor" ? "burns" : "consumes"} ${consumedLabel} and ripens (${next.combines}/${formCap(next.form)}).` +
                (bakedTiers.length ? ` Sockets fused — their augments baked in.` : ` New socket state: [${socketLayout(next.combines).join(", ") || "none"}].`);
        } else {
            const next = transition(state, verdict.targetSet);
            const targetData = await dialog._targetData(lines, state, fodderItem, verdict);
            const oldName = vessel.name;
            await vessel.update(dialog._identityUpdate(targetData, next));
            resultNote = `${oldName} is reforged into ${targetData.name} — Form ${next.form}. Socketed augments baked in; slots reset.`;
        }
        await consumeFuel();
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<p><strong>Reforge complete.</strong> ${resultNote} ${rollNote}</p>`
        });
        ui.notifications.info("Reforge complete.");
        dialog.render();
    }

    static async #onSocket(event, target) {
        const dialog = this;
        const augmentItem = dialog.actor.items.get(target.dataset.augmentId);
        if (!augmentItem) return;
        const lines = await loadEvolutionLines();
        cacheEvolutionLines(lines);
        const state = evolutionState(lines, dialog.vessel, dialog._ctx());
        if (!state) return ui.notifications.warn("This piece is not on an evolution line.");
        const aug = augmentItem.system?.augment;
        if (!aug) return ui.notifications.warn("That is not an augment.");
        if (aug.appliesTo !== state.kind) return ui.notifications.warn(`That augment is for ${aug.appliesTo === "armor" ? "armor" : "weapons"}.`);
        const free = freeSlots(state);
        if ((free[aug.tier] ?? 0) <= 0) return ui.notifications.warn(`No empty ${aug.tier} slot — augments match their slot tier exactly.`);
        const record = {
            tier: aug.tier, appliesTo: aug.appliesTo,
            db: Number(aug.db) || 0, ob: Number(aug.ob) || 0,
            name: augmentItem.name
        };
        await dialog.vessel.update({ "system.evolution": socketAugment(state, record) });
        await dialog._consumeItem(augmentItem);
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: dialog.actor }),
            content: `<p><strong>${augmentItem.name}</strong> socketed into ${dialog.vessel.name} (${aug.tier} slot). Socketing is permanent until the augment bakes in at a fusion or transition.</p>`
        });
        dialog.render();
    }
}
