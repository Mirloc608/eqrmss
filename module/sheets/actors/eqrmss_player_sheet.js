// ============================================================
// EQRMSS Player Actor Sheet - Full Class & Context Implementation
// ============================================================

import EQRMSSActorSheet from "./eqrmss_actor_sheet.js";
import { isWorn } from "../../utils/equipment/equipment-utils.js";
import { structuralAreasFor, structuralDamageOf, structuralRating } from "../../combat/hit-locations.js";
import { exhaustionMaxFor } from "../../combat/subdue.js";
import { progressionManager } from "../../progression/progression-manager.js";
import { EQRMSSExpansionManager } from "../../expansions/expansion-manager.js";
import { EQRMSSAAAdvancement } from "../../aa/aa-advancement.js";

export default class EQRMSSPlayerSheet extends EQRMSSActorSheet {

    // ------------------------------------------------------------
    // Default Options
    // ------------------------------------------------------------
    static DEFAULT_OPTIONS = {
        classes: ["eqrmss", "sheet", "actor", "player"],
        position: {
            width: 800,
            height: 850
        },
        window: {
            title: "EQRMSS Character Sheet"
        },
        actions: {
            levelUp: EQRMSSPlayerSheet.prototype.levelUp,
            rollResistance: EQRMSSPlayerSheet.prototype.rollResistance,
            rollStat: EQRMSSPlayerSheet.prototype.rollStat,
            purchaseAA: EQRMSSPlayerSheet.prototype.purchaseAA,
            grantAAPoints: EQRMSSPlayerSheet.prototype.grantAAPoints,
            awardXP: EQRMSSPlayerSheet.prototype.awardXP,
            addLogEntry: EQRMSSPlayerSheet.prototype.addLogEntry
        }
    };

    // ------------------------------------------------------------
    // Sheet Parts (includes new Skill Engine tab)
    // ------------------------------------------------------------
    static PARTS = {
        header: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-header.html"
        },
        tabs: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-tabs.html"
        },
        main: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-main.html"
        },
        combat: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-combat.html"
        },
        skills: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-skills.html"
        },
        status: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-status.html"
        },
        equipment: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-equipment.html"
        },
        spells: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-spells.html"
        },
        songs: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-songs.html"
        },
        aa: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-aa.html"
        },
        logs: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-logs.html"
        },
        background: {
            template: "systems/eqrmss/templates/sheets/actors/parts/actor-background-info.html"
        }
    };

    // ------------------------------------------------------------
    // Context Preparation
    // ------------------------------------------------------------
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document;
        // Ensure derived data (incl. manaMax) is prepared: on page load
        // for newly created actors the sheet can render before the
        // actor's prepareDerivedData() has populated system.derived.
        // This is idempotent (prepareDerivedData resets derived each run).
        if (actor && actor.system?.derived?.manaMax === undefined) {
            try { actor.prepareDerivedData(); } catch (e) { /* non-fatal */ }
        }
        const system = actor.system ?? {};

        // Readied weapons = worn per the shared isWorn rule, for the Combat tab.
        const readiedWeapons = (context.items?.weapons ?? []).filter(
            w => isWorn(w)
        );

        // Ready spells (user ruling 2026-10-06): limited subset that casts
        // without the ESF short-preparation penalty. Base 8 slots; AAs
        // grant more via system.status.readySlotsBonus.
        const readySpells = Array.isArray(system.status?.readySpells)
            ? system.status.readySpells : [];
        const readyMax = 8 + (Number(system.status?.readySlotsBonus) || 0);
        context.readySpells = readySpells;
        context.readyCount = readySpells.length;
        context.readyMax = readyMax;
        for (const sp of context.items?.spells ?? []) {
            sp.isReady = readySpells.includes(sp._id ?? sp.id);
        }

        // Damage by Location (§4.15): structural damage per body area
        // against its Structural Rating ((CO/10) x BAM).
        context.structuralAreas = structuralAreasFor(actor).map(a => {
            const damage = structuralDamageOf(actor, a.key);
            const sr = structuralRating(actor, a.bam);
            return {
                key: a.key, name: a.name, damage,
                srLabel: sr == null ? "—" : String(sr),
                inactive: sr != null && damage >= sr
            };
        });

        // ------------------------------------------------------------
        // Combat Context
        // ------------------------------------------------------------
        const combat = system.combat ?? {
            armorType: "No Armor",
            mmp: 0,
            penalties: { quickness: 0, action: 0, weight: 0, missile: 0 },
            quicknessBonus: 0,
            adrenalDefense: 0,
            shieldBonus: 0,
            shieldMissileBonus: 0,
            enhancedArmorDB: 0,
            armorDBTotal: 0,
            adrenalSkillBonus: 0,
            adrenalBlockedByArmor: false,
            adrenalEffective: 0,
            otherDB: 0,
            armorDB: 0,
            formationDB: 0,
            formationMissileDB: 0,
            mixedArmorDB: 0,
            stanceDB: 0,
            helmetDF: 0,
            formationLeft: "",
            formationRight: "",
            totalDB: 0,
            totalMissileDB: 0,
            magic: ""
        };

        // ------------------------------------------------------------
        // Progression Context
        // ------------------------------------------------------------
        const level = system.attributes?.level?.value ?? 1;
        const profession = system.fixed_info?.profession ?? system.origin?.classId ?? null;

        const progressionData = {
            level,
            profession,
            maxLevel: 60,
            currentRewards: {},
            nextRewards: {}
        };

        if (profession) {
            progressionData.maxLevel = progressionManager.getClassProgression(profession)?.maxLevel ?? 60;
            progressionData.currentRewards = progressionManager.getLevelRewards(profession, level) ?? {};
            progressionData.nextRewards = progressionManager.getLevelRewards(profession, level + 1) ?? {};
        }

        // ------------------------------------------------------------
        // Stat Formatting
        // ------------------------------------------------------------
        const statNameMap = {
            "ST": "Strength (ST)",
            "AG": "Agility (AG)",
            "CO": "Constitution (CO)",
            "ME": "Memory (ME)",
            "RE": "Reasoning (RE)",
            "SD": "Self Discipline (SD)",
            "QU": "Quickness (QU)",
            "EM": "Empathy (EM)",
            "IN": "Intuition (IN)",
            "PR": "Presence (PR)"
        };

        const nameToKeyMap = {
            "Strength": "ST", "Agility": "AG", "Constitution": "CO",
            "Memory": "ME", "Reasoning": "RE", "Self Discipline": "SD",
            "Quickness": "QU", "Empathy": "EM", "Intuition": "IN", "Presence": "PR"
        };

        const classData = progressionManager.getClassProgression?.(profession) || {};
        let primeReqs = (classData.primeRequisites || classData.stats?.primeRequisites || classData.primeStats || [])
            .map(name => nameToKeyMap[name] || name);

        if (primeReqs.length === 0 && profession) {
            const lowerProf = profession.toLowerCase();
            if (lowerProf.includes("shadowknight")) primeReqs = ["ST", "CO"];
            else if (lowerProf.includes("bard")) primeReqs = ["ME", "PR"];
        }

        const rawStats = system.stats || {};
        const formattedStats = {};

        for (const [key, statData] of Object.entries(rawStats)) {
            if (key === "stats") continue;

            const data = (typeof statData === "object" && statData !== null) ? statData : {};
            const tempVal = data.temp ?? 0;

            let isDeficient = primeReqs.includes(key) && tempVal < 90;

            const storedBonus = data.basic_bonus ?? data.basicBonus ?? 0;
            const basicBonus = storedBonus !== 0 ? storedBonus : Math.floor((tempVal - 50) / 5);
            formattedStats[key] = {
                label: statNameMap[key] || key,
                temp: tempVal,
                pot: data.potential ?? data.pot ?? 0,
                basicBonus,
                racial: data.racial_bonus ?? data.racial ?? 0,
                special: data.special_bonus ?? data.special ?? 0,
                total: data.total ?? 0,
                isDeficient
            };
        }

        // ------------------------------------------------------------
        // Legacy RMSS Skill Preparation
        // ------------------------------------------------------------
        if (typeof actor._prepareSkills === "function") {
            actor._prepareSkills();
        }

        // ------------------------------------------------------------
        // Derived Context
        // ------------------------------------------------------------
        const getBonus = (k) => {
            // Try exact, uppercase, and title-case keys
            const variants = [k, k.toUpperCase(), k.charAt(0).toUpperCase() + k.slice(1).toLowerCase()];
            for (const v of variants) {
                if (formattedStats[v]?.basicBonus) return formattedStats[v].basicBonus;
            }
            // Fallback: search case-insensitively
            const found = Object.entries(formattedStats).find(([key]) => key.toUpperCase() === k.toUpperCase());
            return found ? found[1].basicBonus ?? 0 : 0;
        };

        const manualRes = system.resistance || {};
        const calcResistance = {
            essence: 3 * getBonus("EM") + (manualRes.essence ?? 0),
            channeling: 3 * getBonus("IN") + (manualRes.channeling ?? 0),
            mentalism: 3 * getBonus("PR") + (manualRes.mentalism ?? 0),
            poison: 3 * getBonus("CO") + (manualRes.poison ?? 0),
            disease: 3 * getBonus("CO") + (manualRes.disease ?? 0)
        };
        const derived = {
            stats: formattedStats,
            skills: actor.system?.derived?.skills || system.skills || {},
            categories: system.categories || [],
            initiative: system.attributes?.initiative?.value || 0,
            proficiency: system.attributes?.proficiency?.value || 0,
            resistance: calcResistance,
            wealth: {
                pp: system.wealth?.pp ?? 0,
                gp: system.wealth?.gp ?? 0,
                sp: system.wealth?.sp ?? 0,
                cp: system.wealth?.cp ?? 0
            }
        };

        // ------------------------------------------------------------
        // Status & Hits Calculations (RMSS formulas)
        // ------------------------------------------------------------
        const coBonus = getBonus("CO");

        // Concussion Hits — RMSS §3.8 total, derived in prepareDerivedData
        // from system.hits.base: base + round(base × CO bonus / 100).
        const hitsMax = Number(system.hits?.max) || 0;

        // Exhaustion Points = 40 + (3 × Co bonus)
        const exhaustionMax = 40 + (3 * coBonus);

        // Base Movement Rate — RMSS §7.2.1 (chart + racial + armor + stride + encumbrance).
        // Replaces the earlier 50 + (3 × Qu bonus) house formula.
        const baseMoveRate = system.movement?.baseRate ?? "—";

        const statusData = {
            hits: {
                max: hitsMax,
                value: system.hits?.value ?? 0,
                stun: system.hits?.stun ?? 0,
                bleeding: system.hits?.bleeding ?? 0
            },
            exhaustion: {
                max: exhaustionMax,
                value: system.exhaustion?.value ?? exhaustionMax
            },
            encumbrance: {
                bwa: system.encumbrance?.bwa ?? "—",
                load: system.encumbrance?.load ?? "—",
                penalty: system.encumbrance?.penalty ?? 0,
                moveRate: baseMoveRate
            }
        };

        // ------------------------------------------------------------
        // RMSS Skills: the actor's skill items (e.g. granted by the
        // character-creation wizard's two-pass development system).
        // ------------------------------------------------------------
        const skillModels = (actor.items?.contents ?? [])
            .filter(i => i?.type === "skill")
            .map(item => {
                const sys = item.system ?? {};
                return {
                    id: item.id,
                    name: item.name,
                    category: sys.category || "",
                    cost: sys.cost || "—",
                    ranks: Number(sys.ranks) || 0,
                    rankBonus: Number(sys.rankBonus) || 0,
                    totalBonus: Number(sys.bonus) || 0
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        // ------------------------------------------------------------
        // AA Advancement Context
        // ------------------------------------------------------------
        const aaState = EQRMSSAAAdvancement.getAAState(actor);
        const aaContext = {
            points: aaState.points,
            spent: aaState.spent,
            isGM: game?.user?.isGM ?? false,
            purchased: EQRMSSAAAdvancement.getPurchasedAAs(actor),
            available: []
        };
        try {
            aaContext.available = EQRMSSAAAdvancement.getAvailableAAs(actor);
        } catch (err) {
            console.warn("EQRMSS | AA context build failed", err);
        }

        // ------------------------------------------------------------
        // Logs / XP Context
        // ------------------------------------------------------------
        const logEntries = Array.isArray(system.logs?.entries) ? system.logs.entries : [];
        const logsContext = {
            xp: system.logs?.xp ?? 0,
            entries: logEntries,
            isGM: game?.user?.isGM ?? false,
            today: new Date().toISOString().slice(0, 10)
        };

        return {
            ...context,
            isGM: game?.user?.isGM ?? false,
            actor,
            system: {
                ...system,
                combat,
                hits: statusData.hits,
                exhaustion: statusData.exhaustion,
                encumbrance: statusData.encumbrance
            },
            derived,
            skills: skillModels,
            readiedWeapons,

            playerskill: actor.system?.derived?.skills || system.skills || {},
            progression: {
                ...(context.progression ?? {}),
                ...progressionData
            },
            aa: aaContext,
            logs: logsContext
        };
    }

    // ------------------------------------------------------------
    // Render + Skill Engine Bindings
    // (Tab switching is handled by EQRMSSActorTabsHelper via super._onRender)
    // ------------------------------------------------------------
    async _onRender(context, options) {
        await super._onRender(context, options);

        const html = this.element;

        // ------------------------------------------------------------
        // Skill Roll Buttons (RMSS skill items)
        // ------------------------------------------------------------
        html.querySelectorAll(".skill-roll").forEach(el => el.addEventListener("click", ev => {
            const itemId = ev.currentTarget.dataset.itemId;
            this._onSkillRoll(itemId);
        }));

        // ------------------------------------------------------------
        // Combat Tab: Weapon Attack Rolls (RMSS §6.2–6.4)
        // ------------------------------------------------------------
        html.querySelectorAll(".attack-roll").forEach(el => el.addEventListener("click", ev => {
            const itemId = ev.currentTarget.dataset.itemId;
            this._onAttackRoll(itemId);
        }));

        // ------------------------------------------------------------
        // Spells Tab: cast a spell (EQ mana; RMSS resolution)
        // ------------------------------------------------------------
        // ------------------------------------------------------------
        // Spells Tab: Toggle ready spell (out of combat only).
        // Ready spells cast without the ESF short-preparation penalty.
        // ------------------------------------------------------------
        html.querySelectorAll(".toggle-ready").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const actor = this.actor;
            const inCombat = (globalThis.game?.combat?.combatants ?? [])
                .some(c => c.actor?.id === actor.id);
            if (inCombat) {
                ui.notifications?.warn(`${actor.name} cannot change ready spells during combat. Exit combat first.`);
                return;
            }
            const spellId = ev.currentTarget.dataset.itemId;
            const readySpells = Array.isArray(actor.system?.status?.readySpells)
                ? [...actor.system.status.readySpells] : [];
            const readyMax = 8 + (Number(actor.system?.status?.readySlotsBonus) || 0);
            const idx = readySpells.indexOf(spellId);
            if (idx >= 0) {
                readySpells.splice(idx, 1);
                ui.notifications?.info(`Removed from ready spells.`);
            } else {
                if (readySpells.length >= readyMax) {
                    ui.notifications?.warn(`Ready spell slots full (${readyMax}). Remove one first.`);
                    return;
                }
                readySpells.push(spellId);
                const item = actor.items.get(spellId);
                ui.notifications?.info(`${item?.name ?? "Spell"} is now ready.`);
            }
            await actor.update({ "system.status.readySpells": readySpells });
            await this.render();
        }));

        html.querySelectorAll(".cast-spell").forEach(el => el.addEventListener("click", async ev => {
            const item = this.actor.items.get(ev.currentTarget.dataset.itemId);
            if (!item) return;
            try {
                const { castSpell } = await import("../../spells/cast-spell.js");
                await castSpell(this.actor, item);
            } catch (e) {
                console.error("EQRMSS | Cast spell failed", e);
                ui.notifications.error(`Cast failed: ${e.message}`);
            }
        }));

        // ------------------------------------------------------------
        // Combat Tab: Parry declarations (OB/DB split, Arms Law §4.3)
        // ------------------------------------------------------------
        html.querySelectorAll(".parry-declare").forEach(el => el.addEventListener("click", ev => {
            const itemId = ev.currentTarget.dataset.itemId;
            this._onParryDeclare(itemId);
        }));
        html.querySelectorAll(".missile-parry-declare").forEach(el => el.addEventListener("click", ev => {
            const itemId = ev.currentTarget.dataset.itemId;
            this._onMissileParryDeclare(itemId);
        }));
        html.querySelectorAll(".cqc-toggle").forEach(el => el.addEventListener("click", ev => {
            ev.preventDefault();
            this._onCQCToggle();
        }));
        html.querySelectorAll(".cauterize-wound").forEach(el => el.addEventListener("click", ev => {
            ev.preventDefault();
            this._onCauterize();
        }));
        // Rest & Recovery (out of combat): restore mana and
        // exhaustion points to full (user ruling 2026-10-05).
        html.querySelectorAll(".rest-recover").forEach(el => el.addEventListener("click", async ev => {
            ev.preventDefault();
            const actor = this.actor;
            const inCombat = (game.combat?.combatants ?? []).some?.(c => c.actor?.id === actor.id);
            if (inCombat) {
                ui.notifications?.warn(`${actor.name} cannot rest while in combat.`);
                return;
            }
            const manaMax = Number(actor.system?.derived?.manaMax)
                || Number(actor.system?.attributes?.mana?.max) || 0;
            const exMax = exhaustionMaxFor(actor);
            const updates = {};
            if (manaMax > 0) updates["system.attributes.mana.value"] = manaMax;
            updates["system.exhaustion.value"] = exMax;
            updates["system.exhaustion.max"] = exMax;
            if (actor.system?.status?.exhausted) updates["system.status.exhausted"] = false;
            if (actor.system?.status?.subdueDoubled) updates["system.status.subdueDoubled"] = false;
            await actor.update(updates);
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<p><em>${actor.name} rests — mana and exhaustion restored.</em></p>`
            });
        }));
        html.querySelectorAll(".stance-select").forEach(el => el.addEventListener("change", ev => {
            this.actor.update({ "system.status.stance": ev.currentTarget.value || "" });
        }));
        html.querySelectorAll(".attack-speed-select").forEach(el => el.addEventListener("change", ev => {
            this.actor.update({ "system.status.attackSpeed": ev.currentTarget.value || "" });
        }));
        html.querySelectorAll(".subdue-toggle").forEach(el => el.addEventListener("change", ev => {
            this.actor.update({ "system.status.subduing": !!ev.currentTarget.checked });
        }));
        html.querySelectorAll(".rac-select").forEach(el => el.addEventListener("change", ev => {
            const key = ev.currentTarget.dataset.key;
            if (!["height", "width", "weaponSpace"].includes(key)) return;
            this.actor.update({ [`system.status.restrictedArea.${key}`]: ev.currentTarget.value || "" });
        }));

        // Situational modifiers (§4.2): declared per combatant.
        html.querySelectorAll(".sit-select").forEach(el => el.addEventListener("change", ev => {
            const key = ev.currentTarget.dataset.key;
            if (!["charge", "ground", "weaponLength", "advance", "foesAlone", "alliesOnFoe"].includes(key)) return;
            this.actor.update({ [`system.status.situational.${key}`]: ev.currentTarget.value || "" });
        }));
        html.querySelectorAll(".sit-check").forEach(el => el.addEventListener("change", ev => {
            const key = ev.currentTarget.dataset.key;
            if (!["opportunity", "unstableGround", "temperature", "brawlScuffle"].includes(key)) return;
            this.actor.update({ [`system.status.situational.${key}`]: !!ev.currentTarget.checked });
        }));
        html.querySelectorAll(".unbalanced-toggle").forEach(el => el.addEventListener("change", ev => {
            this.actor.update({ "system.status.unbalanced": !!ev.currentTarget.checked });
        }));

        // Damage by Location (§4.15): attacker toggle + structural damage edits.
        html.querySelectorAll(".hitloc-toggle").forEach(el => el.addEventListener("change", ev => {
            this.actor.update({ "system.status.useHitLocations": !!ev.currentTarget.checked });
        }));
        html.querySelectorAll(".structural-input").forEach(el => el.addEventListener("change", ev => {
            const key = ev.currentTarget.dataset.key;
            if (!key) return;
            this.actor.update({ [`system.status.structural.${key}`]: Math.max(0, Number(ev.currentTarget.value) || 0) });
        }));

        // Shield formation (§5.6): GM-declared flank shields feeding DB.
        html.querySelectorAll(".formation-shield").forEach(el => el.addEventListener("change", ev => {
            const side = ev.currentTarget.dataset.side;
            if (side !== "left" && side !== "right") return;
            const key = side === "left" ? "system.combat.formationLeft" : "system.combat.formationRight";
            this.actor.update({ [key]: ev.currentTarget.value || "" });
        }));

        // ------------------------------------------------------------
        // Combat Tab: Initiative (RMSS §6.1)
        // ------------------------------------------------------------
        html.querySelectorAll(".initiative-roll").forEach(el => el.addEventListener("click", () => {
            this._onInitiativeRoll();
        }));

        // ------------------------------------------------------------
        // Equipment Location Changes
        // ------------------------------------------------------------
        html.querySelectorAll(".item-location").forEach(el => el.addEventListener("change", ev => {
            const itemId = ev.currentTarget.dataset.itemId;
            const newLocation = ev.currentTarget.value;
            this._onItemLocationChange(itemId, newLocation);
        }));

        // ------------------------------------------------------------
        // Open item sheet when clicking an item name in Equipment
        // ------------------------------------------------------------
        html.querySelectorAll(".item-open").forEach(el => {
            el.addEventListener("click", ev => {
                ev.preventDefault();
                const itemId = el.dataset.itemId;
                const item = this.actor.items.get(itemId);
                if (item) item.sheet.render(true);
            });
        });

        // ------------------------------------------------------------
        // Clicky ("Use") buttons on Equipment rows fire the item's
        // triggered effect against the current targets (or self)
        // ------------------------------------------------------------
        html.querySelectorAll(".item-clicky").forEach(el => {
            el.addEventListener("click", async ev => {
                ev.preventDefault();
                ev.stopPropagation();
                const itemId = el.dataset.itemId;
                const item = this.actor?.items?.get(itemId);
                if (!item) return;
                try {
                    const eng = game?.eqrmss?.itemEffects;
                    if (!eng?.activateClicky) {
                        ui.notifications.warn("Item effects engine not loaded yet.");
                        return;
                    }
                    await eng.activateClicky({ item });
                } catch (e) { console.error("EQRMSS | clicky use failed", e); }
            });
        });

        // ------------------------------------------------------------
        // Manual Drag & Drop binding (V13 ApplicationV2)
        // Use a flag to prevent duplicate bindings on re-render
        // ------------------------------------------------------------
        if (!this._dropBound) {
            html.addEventListener("dragover", ev => ev.preventDefault());
            html.addEventListener("drop", ev => this._onDrop(ev));
            this._dropBound = true;
        }
    }

    // ------------------------------------------------------------
    // Drag & Drop - Handle dropped items
    // ------------------------------------------------------------
    async _onDrop(event) {
        event.preventDefault();
        console.log("EQRMSS | Drop event received");
        const actor = this.document;
        if (!actor) return;

        try {
            const data = this._getDropData(event);
            console.log("EQRMSS | Drop data:", data);
            if (!data) {
                console.warn("EQRMSS | Drop ignored: could not read drag data from the drop event.");
                return;
            }

            // Handle Item drops
            if (data.type === "Item") {
                const item = await fromUuid(data.uuid);
                if (!item) {
                    console.warn("EQRMSS | Drop ignored: could not resolve", data.uuid);
                    return;
                }

                // If dropping from another actor, create a copy on this actor
                if (item.parent !== actor) {
                    const itemData = item.toObject();
                    // Default location to pack for new items
                    if (!itemData.system.location) {
                        itemData.system.location = "pack";
                    }
                    await actor.createEmbeddedDocuments("Item", [itemData]);
                    ui.notifications.info(`${item.name} added to inventory.`);
                }
                return;
            }

            // Fall back to default handling for other types
            await super._onDrop?.(event);
        } catch (err) {
            console.warn("EQRMSS | Drop failed", err);
        }
    }

    // ------------------------------------------------------------
    // Read drag data with fallbacks across Foundry versions.
    // V13 AppV2:  foundry.applications.ux.TextEditor.implementation.getDragEventData
    // Legacy:     global TextEditor.getDragEventData
    // Last resort: raw dataTransfer payload set by the drag source.
    // ------------------------------------------------------------
    _getDropData(event) {
        try {
            const te = foundry?.applications?.ux?.TextEditor?.implementation;
            if (te?.getDragEventData) return te.getDragEventData(event);
        } catch (err) { /* fall through to next method */ }
        try {
            if (typeof TextEditor !== "undefined" && TextEditor?.getDragEventData) {
                return TextEditor.getDragEventData(event);
            }
        } catch (err) { /* fall through to next method */ }
        try {
            const raw = event?.dataTransfer?.getData("text/plain");
            if (raw) return JSON.parse(raw);
        } catch (err) { /* no readable drag data */ }
        return null;
    }

    // ------------------------------------------------------------
    // Equipment Location Change Handler
    // ------------------------------------------------------------
    async _onItemLocationChange(itemId, newLocation) {
        const actor = this.document;
        if (!actor || !itemId) return;

        const item = actor.items.get(itemId);
        if (!item) return;

        if (newLocation === "ground") {
            // Dropped - remove from inventory
            const confirm = await Dialog.confirm({
                title: "Drop Item",
                content: `<p>Drop <strong>${item.name}</strong> on the ground? It will be removed from your inventory.</p>`
            });
            if (confirm) {
                await item.delete();
                ui.notifications.info(`${item.name} dropped.`);
            } else {
                // Revert dropdown
                await this.render();
            }
        } else {
            // Equipped or Pack - update location
            await item.update({ "system.location": newLocation });
            if (newLocation === "equipped") {
                ui.notifications.info(`${item.name} equipped.`);
                // Equipment bonuses apply automatically: calculateArmorAndDefenses
                // derives armorType, maneuver penalties, and shield DB from
                // equipped items on the next prepare.
            }
        }
    }

    // ------------------------------------------------------------
    // Level Up
    // ------------------------------------------------------------
    async levelUp() {
        const actor = this.document;
        if (!actor) return;

        const currentLevel = actor.system?.attributes?.level?.value ?? 1;
        const nextLevel = currentLevel + 1;

        const levelCap = EQRMSSExpansionManager.getLevelCap();

        if (nextLevel > levelCap) {
            ui.notifications.warn(
                `EQRMSS | Maximum level reached (${levelCap}, ${EQRMSSExpansionManager.getActiveExpansionName()})`
            );
            return;
        }

        await progressionManager.processLevelUp(actor, nextLevel);
        await actor.update({ "system.attributes.level.value": nextLevel });

        ui.notifications.info(`${actor.name} advanced to level ${nextLevel}!`);
        await this.render();
    }

    // ------------------------------------------------------------
    // AA Advancement
    // ------------------------------------------------------------
    async purchaseAA(event, target) {
        event.preventDefault();
        const actor = this.document;
        if (!actor) return;

        const aaId = target?.dataset?.aaId;
        if (!aaId) return;

        await EQRMSSAAAdvancement.purchaseRank(actor, aaId);
        await this.render();
    }

    async grantAAPoints(event, target) {
        event.preventDefault();
        const actor = this.document;
        if (!actor) return;

        if (!game?.user?.isGM) {
            ui.notifications.warn("EQRMSS | Only the GM can grant AA points.");
            return;
        }

        const input = this.element?.querySelector?.('[name="aaGrantAmount"]');
        const amount = Math.floor(Number(input?.value));

        const result = await EQRMSSAAAdvancement.grantPoints(actor, amount, {
            reason: "GM grant"
        });

        if (!result.ok) {
            ui.notifications.warn(`EQRMSS | ${result.reason}`);
            return;
        }

        await this.render();
    }

    // ------------------------------------------------------------
    // Logs / XP
    // ------------------------------------------------------------
    async awardXP(event, target) {
        event.preventDefault();
        const actor = this.document;
        if (!actor) return;

        if (!game?.user?.isGM) {
            ui.notifications.warn("EQRMSS | Only the GM can award XP.");
            return;
        }

        const input = this.element?.querySelector?.('[name="xpAwardAmount"]');
        const amount = Math.floor(Number(input?.value));
        if (!amount || amount < 1) {
            ui.notifications.warn("EQRMSS | Enter a positive XP amount.");
            return;
        }

        const currentXP = actor.system?.logs?.xp ?? 0;
        const entries = Array.isArray(actor.system?.logs?.entries)
            ? [...actor.system.logs.entries]
            : [];
        entries.push({
            date: new Date().toISOString().slice(0, 10),
            xp: amount,
            notes: "XP award"
        });

        await actor.update({
            "system.logs.xp": currentXP + amount,
            "system.logs.entries": entries
        });
        ui.notifications.info(`EQRMSS | Awarded ${amount} XP.`);
        await this.render();
    }

    async addLogEntry(event, target) {
        event.preventDefault();
        const actor = this.document;
        if (!actor) return;

        const dateInput = this.element?.querySelector?.('[name="logEntryDate"]');
        const xpInput = this.element?.querySelector?.('[name="logEntryXP"]');
        const notesInput = this.element?.querySelector?.('[name="logEntryNotes"]');

        const date = dateInput?.value || new Date().toISOString().slice(0, 10);
        const xp = Math.max(0, Math.floor(Number(xpInput?.value) || 0));
        const notes = notesInput?.value?.trim() || "";

        if (!notes && xp === 0) {
            ui.notifications.warn("EQRMSS | Entry needs notes or XP.");
            return;
        }

        const entries = Array.isArray(actor.system?.logs?.entries)
            ? [...actor.system.logs.entries]
            : [];
        entries.push({ date, xp, notes });

        const updates = { "system.logs.entries": entries };
        if (xp > 0) {
            updates["system.logs.xp"] = (actor.system?.logs?.xp ?? 0) + xp;
        }

        await actor.update(updates);
        await this.render();
    }

    // ------------------------------------------------------------
    // Resistance Roll
    // ------------------------------------------------------------
    async rollResistance(event, target) {
        event.preventDefault();

        const resistType = target.dataset.resist;
        const actor = this.document;
        const resistValue = actor.system?.resistance?.[resistType] ?? 0;

        let roll = new Roll(`1d100 + ${resistValue}`);
        await roll.evaluate();

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Resistance Roll (${resistType.toUpperCase()})`
        });
    }

    // ------------------------------------------------------------
    // Stat Roll
    // ------------------------------------------------------------
    async rollStat(event, target) {
        event.preventDefault();

        const statKey = target.dataset.stat;
        const statLabel = target.dataset.label || statKey;
        const actor = this.document;
        const statTotal = actor.system?.stats?.[statKey]?.total ?? 0;

        let roll = new Roll(`1d100 + ${statTotal}`);
        await roll.evaluate();

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Statistic Roll: ${statLabel}`
        });
    }

    // ------------------------------------------------------------
    // Skill Roll (RMSS skill item: 1d100 + total bonus vs target)
    // ------------------------------------------------------------
    async _onSkillRoll(itemId) {
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== "skill") {
            ui.notifications.error(`Unknown skill: ${itemId}`);
            return;
        }
        const totalBonus = Number(item.system?.bonus) || 0;

        const roll = await new Roll("1d100").evaluate();
        const total = roll.total + totalBonus;
        const target = 75;
        const success = total >= target;

        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: `
                <h2>${item.name}</h2>
                <p><strong>Roll:</strong> ${roll.total} + ${totalBonus} = ${total}</p>
                <p><strong>Target:</strong> ${target}</p>
                <p><strong>Success:</strong> ${success ? "Yes" : "No"}</p>
            `
        });
    }

    async _onInitiativeRoll() {
        try {
            const { rollInitiative } = await import("../../combat/initiative-rolls.js");
            await rollInitiative(this.actor);
        } catch (e) {
            console.error("EQRMSS | Initiative failed", e);
            ui.notifications.error(`Initiative failed: ${e.message}`);
        }
    }

    async _onAttackRoll(itemId) {
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== "weapon") {
            ui.notifications.error(`Unknown weapon: ${itemId}`);
            return;
        }
        try {
            const { rollWeaponAttack } = await import("../../combat/combat-rolls.js");
            await rollWeaponAttack(this.actor, item);
        } catch (e) {
            console.error("EQRMSS | Attack roll failed", e);
            ui.notifications.error(`Attack roll failed: ${e.message}`);
        }
    }

    async _onParryDeclare(itemId) {
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== "weapon") {
            ui.notifications.error(`Unknown weapon: ${itemId}`);
            return;
        }
        try {
            const { declareParry } = await import("../../combat/crit-conditions.js");
            await declareParry(this.actor, item);
        } catch (e) {
            console.error("EQRMSS | Parry declaration failed", e);
            ui.notifications.error(`Parry declaration failed: ${e.message}`);
        }
    }

    async _onMissileParryDeclare(itemId) {
        const item = this.actor.items.get(itemId);
        if (!item || item.type !== "weapon") {
            ui.notifications.error(`Unknown weapon: ${itemId}`);
            return;
        }
        try {
            const { declareMissileParry } = await import("../../combat/crit-conditions.js");
            await declareMissileParry(this.actor, item);
        } catch (e) {
            console.error("EQRMSS | Missile parry declaration failed", e);
            ui.notifications.error(`Missile parry declaration failed: ${e.message}`);
        }
    }

    async _onCQCToggle() {
        try {
            const { declareCloseQuarters } = await import("../../combat/crit-conditions.js");
            await declareCloseQuarters(this.actor);
        } catch (e) {
            console.error("EQRMSS | Close-quarters toggle failed", e);
            ui.notifications.error(`Close-quarters toggle failed: ${e.message}`);
        }
    }

    async _onCauterize() {
        try {
            const { cauterizeWound } = await import("../../combat/cauterize.js");
            await cauterizeWound(this.actor);
        } catch (e) {
            console.error("EQRMSS | Cauterize failed", e);
            ui.notifications.error(`Cauterize failed: ${e.message}`);
        }
    }
}
