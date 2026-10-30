// ============================================================
// EQRMSS — Gear Evolution Dialog (Stage 2, T1->T2)
//
// ApplicationV2 — reforge a vessel piece. ARMOR (Crescent Reach
// redesign, 2026-10-27): combines burn a slot-scaled count of a
// catalyst material (family by current form, material by vessel
// class) to ripen the form or transition to the next; the augment
// combine is mandatory before a transition. WEAPONS (ladder build,
// 2026-10-29): the player picks a format at Begin Evolution (max
// 3 evolving weapons), the first feeder feed reclassifies, unnamed
// same-format feeds ripen with merge arithmetic, named same-format
// feeds transition (free identity; damage/delay from the curve),
// and the form-33 transition offers capstone overlays.
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
    ripen, transition, socketAugment, skillForVessel, TIER_NAMES,
    weaponFormats, legalWeaponFormats, weaponCurve, formatOfWeapon,
    classifyWeapon, countEvolvingWeapons, capstoneOptions,
    resolveProcChoice, validateWeaponFeed
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
            "socket": this.#onSocket,
            "beginEvolution": this.#onBeginEvolution,
            "convertCapstone": this.#onConvertCapstone
        }
    };

    static PARTS = {
        main: {
            template: "systems/eqrmss/templates/apps/eqrmss-evolution-dialog.html",
            scrollable: [".evo-two-panel", ".evo-augment-list"]
        }
    };

    constructor(actor, vessel) {
        super();
        this.actor = actor;
        this.vessel = vessel;
        this._route = "diy";
        this._fodderId = null;
        this._actionId = "ripening"; // armor catalyst combines: ripening | transition
        this._formatKey = null;      // weapon format-choice panel selection
        this._procChoice = "vessel"; // weapon proc choice: vessel | fodder
        this._capstoneKind = null;   // weapon form-33 overlay selection
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
            weaponFormat: formatOfWeapon(lines, item),
            weaponClass: classifyWeapon(lines, item),
            classes: classesOf(item)
        };
    }

    /** Display name for a weapon material id (prefix arithmetic). */
    _materialDisplayName(materialId) {
        if (!materialId) return null;
        try {
            const opts = game.eqrmss?.weapons?.getOptions?.() ?? game.eqrmss?.weapons?.options?.() ?? null;
            const mat = (opts?.materials ?? []).find(m => m.id === materialId);
            if (mat?.name) return mat.name;
        } catch { /* fall through to the capitalized id */ }
        return String(materialId).split(/[_\-\s]+/).filter(Boolean)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }

    /** A catalog entry by item name, normalized like a catalog add. */
    async _catalogDataByName(name) {
        const entries = Object.values(game.eqrmss?.items?.byId ?? {});
        const entry = entries.find(e => e?.name === name);
        if (!entry) throw new Error(`Catalog entry missing: ${name}`);
        const normalized = await normalizeCatalogData(foundry.utils.deepClone(entry));
        return { name: normalized.name ?? entry.name, img: normalized.img ?? entry.img, system: normalized.system ?? entry.system };
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
            ? (state.format ? (weaponFormats(lines)[state.format]?.name ?? state.format) : "Format not chosen")
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
        context.bakedHp = state.bakedHp;
        context.bakedMana = state.bakedMana;
        const bakedParts = [];
        for (const [k, v] of Object.entries(state.bakedStats ?? {})) if (v) bakedParts.push(`+${v} ${k.toUpperCase()}`);
        const resistVals = Object.values(state.bakedResists ?? {}).filter(v => v);
        if (resistVals.length) bakedParts.push(`Resists +${Math.max(...resistVals)}`);
        context.bakedExtra = bakedParts.join(", ");
        context.hasBaked = (state.bakedDb || state.bakedOb || state.bakedHp || state.bakedMana || bakedParts.length);
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
            // Mold fork (V1, generalized 2026-10-28 for the PoP
            // ornate/elemental fork): a transition into a form whose
            // family block carries factions burns one variant's
            // mold, and the mold chooses the set — one action per
            // variant, validated against that mold's held count.
            const factions = lines.catalysts?.families?.[String(state.form + 1)]?.factions ?? null;
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
        } else if (!state.format) {
            // No evolution record / format yet: the format-choice
            // panel. The chosen format IS the pin for dual-mode
            // templates (bastard sword, spear, ...).
            context.needsFormat = true;
            const formats = weaponFormats(lines);
            const legal = legalWeaponFormats(lines, ctx.classKey);
            if (!this._formatKey || !legal.includes(this._formatKey)) this._formatKey = legal[0] ?? null;
            context.formatChoices = legal.map(key => {
                const fmt = formats[key] ?? {};
                const anchorCurve = weaponCurve(lines, key, 33);
                return {
                    key, name: fmt.name ?? key,
                    floorDamage: fmt.floor?.damage, floorDelay: fmt.floor?.delay,
                    anchorDamage: anchorCurve?.damage, anchorDelay: anchorCurve?.delay,
                    selected: this._formatKey === key
                };
            });
            const mapped = lines.weaponLadders?.templateFormats?.[this.vessel.system?.weaponTemplate];
            context.dualModeNote = Array.isArray(mapped)
                ? "This weapon's template is dual-mode — the format you choose pins its mode for the life of the weapon."
                : null;
            context.maxEvolvingWeapons = Number(lines.weaponLadders?.maxEvolvingWeapons) || 3;
            context.evolvingWeapons = countEvolvingWeapons(this.actor.items);
            context.atWeaponCap = context.evolvingWeapons >= context.maxEvolvingWeapons;
            context.candidates = [];
            context.selectedFodder = null;
        } else {
            const candidates = [];
            for (const item of this.actor.items) {
                if (item.id === this.vessel.id) continue;
                if (item.type !== "weapon") continue;
                const desc = this._fodderDescriptor(lines, item, state);
                const verdict = validateWeaponFeed(lines, vesselDesc, desc, actorDesc);
                candidates.push({
                    id: item.id, name: item.name, img: item.img,
                    ok: verdict.ok, kind: verdict.kind,
                    kindLabel: verdict.kind === "transition" ? "TRANSITION" : verdict.kind === "ripening" ? "Ripen" : verdict.kind === "reclassify" ? "Reclassify" : "",
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

            // Proc choice: shown when the selected fodder (or the
            // capstone identity it would bring) carries a proc.
            const selItem = context.selectedFodder ? this.actor.items.get(context.selectedFodder.id) : null;
            let fodderProc = selItem?.system?.proc ?? null;

            // Capstone overlay: a form-32 vessel eating any named
            // fodder transitions into form 33 under the CHOSEN
            // overlay identity (epic / analog / ladder).
            if (state.form === 32 && context.selectedFodder?.kind === "transition") {
                const options = capstoneOptions(lines, state.format, ctx.classKey);
                if (options.length) {
                    if (!this._capstoneKind || !options.some(o => o.kind === this._capstoneKind)) {
                        this._capstoneKind = options[0].kind;
                    }
                    context.showCapstone = true;
                    context.capstoneOptions = options.map(o => ({
                        kind: o.kind, namesLabel: o.names.join(" + "), pair: !!o.pair,
                        selected: o.kind === this._capstoneKind
                    }));
                    if (!fodderProc) {
                        const chosen = options.find(o => o.kind === this._capstoneKind);
                        const entry = Object.values(game.eqrmss?.items?.byId ?? {})
                            .find(e => e?.name === chosen?.names?.[0]);
                        fodderProc = entry?.system?.proc ?? null;
                    }
                }
            }
            if (fodderProc) {
                context.showProcChoice = true;
                context.fodderProcName = fodderProc;
                context.vesselProcName = this.vessel.system?.proc ?? "none";
                context.procVesselSelected = this._procChoice !== "fodder";
                context.procFodderSelected = this._procChoice === "fodder";
            }

            // WAR capstone conversion: pair <-> Jagged Blade of War.
            if (state.form === 33 && ctx.classKey === "warrior") {
                const epic = capstoneOptions(lines, state.format, "warrior").find(o => o.kind === "epic");
                if (state.format === "1hs" && epic?.twoHanded
                    && (state.pairId || (epic.names ?? []).includes(state.identityName))) {
                    context.canConvertCapstone = true;
                    context.convertLabel = `Convert to ${epic.twoHanded} (two-handed)`;
                } else if (state.format === "2hs" && epic?.pairNames?.length
                    && state.identityName === epic.names?.[0]) {
                    context.canConvertCapstone = true;
                    context.convertLabel = `Convert to the ${epic.pairNames.join(" + ")} pair`;
                }
            }
        }

        // Routes.
        const tier = state.form;
        context.route = this._route;
        context.routeDiy = this._route === "diy";
        context.routeNpc = this._route === "npc";
        const skillId = skillForVessel(this.vessel, state, lines);
        context.skillId = skillId;
        context.skillName = skillId.replace("skill-", "").replace(/^./, c => c.toUpperCase());
        context.trivial = trivialForTier(cfg, tier);
        const access = canUseTradeskill(this.actor, skillId);
        context.skillAllowed = access.allowed;
        context.skillRestriction = access.allowed ? null : access.reason;
        const techniques = this.actor.getFlag("eqrmss", "techniques") ?? [];
        context.neededTechnique = selKind === "transition" ? `transition-${tier}`
            : (selKind === "ripening" || selKind === "reclassify") ? `socketing-${tier}` : null;
        context.techniqueKnown = context.neededTechnique ? techniques.includes(context.neededTechnique) : false;
        context.techniqueLabel = context.neededTechnique
            ? `Reforge: ${selKind === "transition" ? "Transition" : "Socketing"} (Tier ${tier})` : null;
        context.feeGp = npcFeeGp(cfg, tier);
        context.wealthGp = Math.floor(wealthCp(this.actor) / 100);
        context.canAfford = wealthCp(this.actor) >= context.feeGp * 100;
        context.canCombine = selectionOk
            && (this._route === "npc" ? context.canAfford
                : context.skillAllowed && context.techniqueKnown);

        // Augments in inventory. Picker (2026-10-28): only augments
        // for this vessel's kind are listed (the others can never
        // fit here), sorted fits-first, then by tier, then name.
        const free = freeSlots(state);
        context.augments = [];
        for (const item of this.actor.items) {
            const aug = item?.system?.augment;
            if (!aug) continue;
            if (aug.appliesTo !== state.kind) continue;
            const fits = (free[aug.tier] ?? 0) > 0;
            const parts = [];
            if (aug.db) parts.push(`+${aug.db} DB`);
            if (aug.ob) parts.push(`+${aug.ob} OB`);
            if (aug.hp) parts.push(`+${aug.hp} HP`);
            if (aug.mana) parts.push(`+${aug.mana} Mana`);
            for (const [k, v] of Object.entries(aug.stats ?? {})) if (v) parts.push(`+${v} ${k.toUpperCase()}`);
            const rv = Object.values(aug.resistances ?? {}).filter(v => v);
            if (rv.length) parts.push(`Resists +${Math.max(...rv)}`);
            context.augments.push({
                id: item.id, name: item.name, tier: aug.tier,
                bonus: parts.join(", "),
                fits
            });
        }
        context.augments.sort((a, b) =>
            (b.fits - a.fits)
            || (TIER_NAMES.indexOf(a.tier) - TIER_NAMES.indexOf(b.tier))
            || a.name.localeCompare(b.name));
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
        this.element?.querySelectorAll("input[name='evo-format']").forEach(r => {
            r.addEventListener("change", ev => {
                this._formatKey = ev.target.value;
            });
        });
        this.element?.querySelectorAll("input[name='evo-proc']").forEach(r => {
            r.addEventListener("change", ev => {
                this._procChoice = ev.target.value;
            });
        });
        this.element?.querySelectorAll("input[name='evo-capstone']").forEach(r => {
            r.addEventListener("change", ev => {
                this._capstoneKind = ev.target.value;
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
    _identityUpdate(targetData, newState, preserveList = null) {
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
        const PRESERVE = preserveList ?? ["evolution", "location", "quantity", "equipped", "worn"];
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
        // Effect carry-forward (user ruling 2026-10-28, option A):
        // armor should never slide back. The vessel's own triggered /
        // worn effects fill the target's slots when the target has
        // none of that kind; a target's own effects are never
        // displaced. (Overwrites any deletion scheduled above for a
        // field the target lacks.)
        const carry = (field, value) => {
            updates[`system.${field}`] = value;
            delete updates[`system.-=${field}`];
        };
        for (const field of ["triggeredEffect", "wornEffect"]) {
            if (current[field] && !targetSystem[field]) carry(field, current[field]);
        }
        // Stat carry-forward (user ruling 2026-10-28): the same
        // never-slide-back rule for numbers — defense / hp / mana and
        // each stat / resistance key take the better of vessel and
        // target, so a transition can only raise a profile, never
        // lower any part of it.
        for (const field of ["defense", "hp", "mana"]) {
            const c = Number(current[field]) || 0, t = Number(targetSystem[field]) || 0;
            if (c > t) carry(field, current[field]);
        }
        for (const field of ["stats", "resistances"]) {
            const c = current[field], t = targetSystem[field];
            if (!c) continue;
            if (!t) { carry(field, foundry.utils.deepClone(c)); continue; }
            const merged = { ...t };
            let raised = false;
            for (const [k, v] of Object.entries(c)) {
                if (!(k in merged) || (Number(v) || 0) > (Number(merged[k]) || 0)) { merged[k] = v; raised = true; }
            }
            if (raised) carry(field, merged);
        }
        updates["system.evolution"] = newState;
        return updates;
    }

    /**
     * Weapon variant of the identity update: the vessel's template
     * identity (attack table, material, condition, format, ...)
     * survives the swap — only the fed identity's name / look /
     * proc / classes / stats profile lands, merged never-slide-back
     * for stats, resistances, hp and mana by the base routine.
     */
    _weaponIdentityUpdate(targetData, newState) {
        return this._identityUpdate(targetData, newState,
            ["weaponTemplate", "type", "attackTable", "criticalType", "material", "condition",
             "evolution", "location", "quantity", "equipped", "worn", "weaponFormat", "classes"]);
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
                { forTransition: kind === "transition" && !!lines.catalysts?.families?.[String(state.form + 1)]?.factions, faction });
            const held = req ? dialog._catalystHeld(req.itemName) : 0;
            verdict = validateCatalystCombine(lines, vesselDesc, { kind, held, faction }, { classKey: ctx.classKey, raceKey: ctx.raceKey });
            consumedLabel = verdict.requirement ? `${verdict.cost ?? 0} × ${verdict.requirement.itemName}` : "the catalyst materials";
        } else {
            fodderItem = actor.items.get(dialog._fodderId);
            if (!fodderItem) return ui.notifications.warn("Choose a piece to consume.");
            const fodderDesc = dialog._fodderDescriptor(lines, fodderItem, state);
            verdict = validateWeaponFeed(lines, vesselDesc, fodderDesc, { classKey: ctx.classKey, raceKey: ctx.raceKey });
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
            const skillId = skillForVessel(vessel, state, lines);
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
        if (state.kind === "weapon" && verdict.kind === "reclassify") {
            // The first feed pins the format for life; it is not a
            // combine (no ripening count, no merge arithmetic).
            const next = { ...state, reclassified: true };
            await vessel.update({ "system.evolution": next, "system.weaponFormat": state.format });
            resultNote = `${vessel.name} is reclassified as a ${weaponFormats(lines)[state.format]?.name ?? state.format} weapon — its format is locked for life.`;
        } else if (verdict.kind === "ripening") {
            const { state: next, bakedTiers } = ripen(state);
            if (state.kind === "weapon") {
                const fodderClass = classifyWeapon(lines, fodderItem);
                const updates = { "system.evolution": next };
                if (fodderClass === "unnamed") {
                    // Merge arithmetic (Ghoulbane rule): the latest
                    // fed material prefixes the vessel's name
                    // (replacing any previous prefix; edged formats
                    // take " Bladed"), weight averages, and the proc
                    // follows the player's choice.
                    const materialName = dialog._materialDisplayName(fodderItem.system?.material);
                    if (materialName) {
                        const prefix = materialName + (["1hs", "2hs", "piercing"].includes(state.format) ? " Bladed" : "");
                        let baseName = vessel.name;
                        if (state.prefixApplied && baseName.startsWith(`${state.prefixApplied} `)) {
                            baseName = baseName.slice(state.prefixApplied.length + 1);
                        }
                        updates.name = `${prefix} ${baseName}`;
                        next.prefixApplied = prefix;
                        updates["system.evolution"] = next;
                    }
                    const vw = Number(vessel.system?.weight) || 0;
                    const fw = Number(fodderItem.system?.weight) || 0;
                    updates["system.weight"] = Math.round(((vw + fw) / 2) * 10) / 10;
                }
                if (fodderItem.system?.proc) {
                    updates["system.proc"] = resolveProcChoice(vessel.system?.proc, fodderItem.system?.proc, dialog._procChoice);
                }
                await vessel.update(updates);
            } else {
                await vessel.update({ "system.evolution": next });
            }
            resultNote = `${vessel.name} ${state.kind === "armor" ? "burns" : "consumes"} ${consumedLabel} and ripens (${next.combines}/${formCap(next.form)}).` +
                (bakedTiers.length ? ` Sockets fused — their augments baked in.` : ` New socket state: [${socketLayout(next.combines).join(", ") || "none"}].`);
        } else if (state.kind === "weapon") {
            // Weapon transition: bake, take the fed identity (or
            // the chosen capstone overlay at form 33), and stamp
            // damage/delay from the format curve.
            const next = transition(state, null);
            let targetData = await dialog._targetData(lines, state, fodderItem, verdict);
            let capstoneOption = null;
            if (next.form === 33) {
                const options = capstoneOptions(lines, state.format, ctx.classKey);
                capstoneOption = options.find(o => o.kind === dialog._capstoneKind) ?? options[0] ?? null;
                if (capstoneOption) targetData = await dialog._catalogDataByName(capstoneOption.names[0]);
            }
            next.identityName = targetData.name;
            next.prefixApplied = null; // the identity name carries no ripening prefix
            if (capstoneOption?.pair) next.pairId = state.pairId ?? foundry.utils.randomID();
            const oldName = vessel.name;
            const updates = dialog._weaponIdentityUpdate(targetData, next);
            updates["system.proc"] = resolveProcChoice(vessel.system?.proc, targetData.system?.proc, dialog._procChoice);
            const curve = weaponCurve(lines, state.format, next.form);
            if (curve) {
                updates["system.damage"] = curve.damage;
                updates["system.delay"] = curve.delay;
            }
            updates["system.weaponFormat"] = state.format;
            await vessel.update(updates);
            if (capstoneOption?.pair) {
                // Pair manifestation: the partner item is created
                // on the actor carrying a deep copy of the same
                // evolution record under the shared pairId.
                const partnerName = capstoneOption.names[1] ?? capstoneOption.names[0];
                const partnerData = await dialog._catalogDataByName(partnerName);
                const partnerSystem = foundry.utils.deepClone(partnerData.system ?? {});
                partnerSystem.evolution = foundry.utils.deepClone(next);
                partnerSystem.evolution.identityName = partnerName;
                partnerSystem.weaponFormat = state.format;
                if (curve) { partnerSystem.damage = curve.damage; partnerSystem.delay = curve.delay; }
                if (vessel.system?.location !== undefined) partnerSystem.location = vessel.system.location;
                await actor.createEmbeddedDocuments("Item", [{
                    name: partnerData.name, img: partnerData.img, type: "weapon", system: partnerSystem
                }]);
                resultNote = `${oldName} is reforged into ${targetData.name} — Form ${next.form}, manifested as a pair with ${partnerName}. Socketed augments baked in; slots reset.`;
            } else {
                resultNote = `${oldName} is reforged into ${targetData.name} — Form ${next.form}. Socketed augments baked in; slots reset.`;
            }
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

    static async #onBeginEvolution(event, target) {
        const dialog = this;
        const actor = dialog.actor;
        const lines = await loadEvolutionLines();
        cacheEvolutionLines(lines);
        const ctx = dialog._ctx();
        const state = evolutionState(lines, dialog.vessel, ctx);
        if (!state || state.kind !== "weapon") return ui.notifications.warn("Only a weapon can begin weapon evolution.");
        if (state.format) return ui.notifications.warn("This weapon's format is already chosen.");
        const legal = legalWeaponFormats(lines, ctx.classKey);
        const formatKey = dialog._formatKey ?? legal[0] ?? null;
        if (!formatKey || !legal.includes(formatKey)) {
            return ui.notifications.warn("Choose a format this character's class can wield.");
        }
        const max = Number(lines.weaponLadders?.maxEvolvingWeapons) || 3;
        const running = countEvolvingWeapons(actor.items);
        if (running >= max) {
            return ui.notifications.warn(`This character already runs ${running} evolving weapons — the limit is ${max}. A new weapon cannot begin evolution.`);
        }
        const record = {
            line: ctx.classKey, form: 1, format: formatKey, combines: 0,
            bakedDb: 0, bakedOb: 0, bakedHp: 0, bakedMana: 0,
            bakedStats: {}, bakedResists: {}, augments: [],
            identityName: null, pairId: null, reclassified: false, prefixApplied: null
        };
        await dialog.vessel.update({ "system.evolution": record });
        ui.notifications.info(`${dialog.vessel.name} begins evolution as a ${weaponFormats(lines)[formatKey]?.name ?? formatKey} weapon. Feed it a rusty or tarnished weapon of that format to reclassify it.`);
        dialog.render();
    }

    static async #onConvertCapstone(event, target) {
        const dialog = this;
        const actor = dialog.actor;
        const vessel = dialog.vessel;
        const lines = await loadEvolutionLines();
        cacheEvolutionLines(lines);
        const ctx = dialog._ctx();
        const state = evolutionState(lines, vessel, ctx);
        if (!state || state.kind !== "weapon" || state.form !== 33 || ctx.classKey !== "warrior") {
            return ui.notifications.warn("Only a warrior's form-33 capstone weapon can convert.");
        }
        const epic = capstoneOptions(lines, state.format, "warrior").find(o => o.kind === "epic");
        if (!epic) return ui.notifications.warn("No capstone conversion is authored for this format.");

        if (state.format === "1hs" && epic.twoHanded) {
            // Pair -> two-handed: the partner is consumed into the
            // single Jagged Blade manifestation; the evolution
            // record is preserved and the format flips to 2hs.
            const partner = state.pairId
                ? actor.items.find(i => i.id !== vessel.id && i.system?.evolution?.pairId === state.pairId)
                : actor.items.find(i => i.id !== vessel.id && (epic.names ?? []).includes(i.system?.evolution?.identityName));
            const targetData = await dialog._catalogDataByName(epic.twoHanded);
            const next = { ...state, format: "2hs", identityName: epic.twoHanded, prefixApplied: null };
            const updates = dialog._weaponIdentityUpdate(targetData, next);
            updates["system.proc"] = targetData.system?.proc ?? vessel.system?.proc ?? null;
            const curve = weaponCurve(lines, "2hs", 33);
            if (curve) { updates["system.damage"] = curve.damage; updates["system.delay"] = curve.delay; }
            updates["system.weaponFormat"] = "2hs";
            await vessel.update(updates);
            if (partner) await partner.delete();
            ui.notifications.info(`${vessel.name} is now the ${epic.twoHanded}.`);
        } else if (state.format === "2hs" && epic.pairNames?.length) {
            // Two-handed -> pair: the vessel takes Blade of
            // Strategy and a Blade of Tactics partner is created,
            // both sharing the preserved record and one pairId.
            const [firstName, partnerName] = epic.pairNames;
            const pairId = state.pairId ?? foundry.utils.randomID();
            const targetData = await dialog._catalogDataByName(firstName);
            const next = { ...state, format: "1hs", identityName: firstName, pairId, prefixApplied: null };
            const updates = dialog._weaponIdentityUpdate(targetData, next);
            const curve = weaponCurve(lines, "1hs", 33);
            if (curve) { updates["system.damage"] = curve.damage; updates["system.delay"] = curve.delay; }
            updates["system.weaponFormat"] = "1hs";
            await vessel.update(updates);
            const partnerData = await dialog._catalogDataByName(partnerName);
            const partnerSystem = foundry.utils.deepClone(partnerData.system ?? {});
            partnerSystem.evolution = foundry.utils.deepClone(next);
            partnerSystem.evolution.identityName = partnerName;
            partnerSystem.weaponFormat = "1hs";
            if (curve) { partnerSystem.damage = curve.damage; partnerSystem.delay = curve.delay; }
            if (vessel.system?.location !== undefined) partnerSystem.location = vessel.system.location;
            await actor.createEmbeddedDocuments("Item", [{
                name: partnerData.name, img: partnerData.img, type: "weapon", system: partnerSystem
            }]);
            ui.notifications.info(`${firstName} and ${partnerName} now manifest as a pair.`);
        } else {
            return ui.notifications.warn("This capstone weapon has no other manifestation to convert to.");
        }
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
        if (aug.hp) record.hp = Number(aug.hp) || 0;
        if (aug.mana) record.mana = Number(aug.mana) || 0;
        if (aug.stats) record.stats = { ...aug.stats };
        if (aug.resistances) record.resistances = { ...aug.resistances };
        await dialog.vessel.update({ "system.evolution": socketAugment(state, record) });
        await dialog._consumeItem(augmentItem);
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: dialog.actor }),
            content: `<p><strong>${augmentItem.name}</strong> socketed into ${dialog.vessel.name} (${aug.tier} slot). Socketing is permanent until the augment bakes in at a fusion or transition.</p>`
        });
        dialog.render();
    }
}
