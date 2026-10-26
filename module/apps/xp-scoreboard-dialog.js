// ============================================================
// EQRMSS — XP Scoreboard Dialog (RMSS Table 15.4.2)
// ApplicationV2 — GM-only panel for calculating XP awards
// by the book's Experience Guideline Table and awarding them.
// ============================================================

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const BaseApplication = HandlebarsApplicationMixin(ApplicationV2);

import {
    XP_MULTIPLIER_LABELS,
    KILL_RACE_BONUSES,
    MANEUVER_DIFFICULTY_MULT,
    calculateXpBreakdown
} from "../progression/xp-calculator.js";
import { checkAndApplyLevelUps } from "../progression/xp-engine.js";
import { getXPTracker, trackerHasData, clearXPTracker } from "../progression/xp-tracker.js";

export class XPScoreboardDialog extends BaseApplication {

    static DEFAULT_OPTIONS = {
        id: "eqrmss-xp-scoreboard",
        classes: ["eqrmss", "xp-scoreboard"],
        window: {
            title: "XP Scoreboard — Table 15.4.2",
            icon: "fas fa-trophy",
            resizable: true
        },
        position: { width: 720, height: 640 },
        actions: {
            "calculate": this.#onCalculate,
            "award": this.#onAward,
            "add-crit": this.#onAddCrit,
            "remove-crit": this.#onRemoveCrit
        }
    };

    static PARTS = {
        main: {
            template: "systems/eqrmss/templates/apps/xp-scoreboard-dialog.html"
        }
    };

    constructor(actor, options = {}) {
        super(options);
        this.actor = actor;
        // Form state; crits is a dynamic row list.
        this.formState = {
            novelty: "subsequent",
            killHits: "",
            killLevel: "",
            killRace: "",
            killRaceBonus: "",
            killDemonType: "",
            hitsDelivered: "",
            hitsReceived: "",
            healingDelivered: "",
            charKnockedOut: false,
            foeKnockedOut: false,
            crits: [],
            maneuverXp: "",
            maneuverDifficulty: "hard",
            ideaGroupTotal: "",
            ideaPlanners: "1",
            deathKillValue: "",
            deathNearDeath: false,
            deathResurrected: false,
            travelMiles: "",
            travelAirSea: false,
            travelTerrain: "normal",
            spellPower: "",
            religiousPoints: "",
            miscPoints: "",
            miscLabel: ""
        };
        this.breakdown = null;
        // Pre-fill from the combat XP tracker (2026-10-16). The GM can
        // still edit every field before calculating/awarding.
        this.trackedNote = "";
        try {
            const tracked = getXPTracker(actor);
            if (trackerHasData(tracked)) {
                const f = this.formState;
                // Kills: pre-fill the first; note any additional kills.
                if (tracked.kills.length > 0) {
                    const k = tracked.kills[0];
                    if (k.hits > 0) f.killHits = String(k.hits);
                    if (k.level > 0) f.killLevel = String(k.level);
                    if (k.raceKey) f.killRace = k.raceKey;
                    if (tracked.kills.length > 1) {
                        const others = tracked.kills.slice(1)
                            .map(x => `${x.name} (lvl ${x.level})`).join(", ");
                        this.trackedNote += `Also tracked kills: ${others}. Pre-filled the first — adjust as needed. `;
                    }
                }
                // Hits delivered/received and knockout flags.
                if (tracked.hitsDelivered > 0) f.hitsDelivered = String(tracked.hitsDelivered);
                if (tracked.hitsReceived > 0) f.hitsReceived = String(tracked.hitsReceived);
                if (tracked.healingDelivered > 0) f.healingDelivered = String(tracked.healingDelivered);
                if (tracked.spellPointsEarned > 0) f.spellPower = String(tracked.spellPointsEarned);
                f.charKnockedOut = !!tracked.charKnockedOut;
                f.foeKnockedOut = !!tracked.foeKnockedOut;
                // Crits: one row per tracked crit.
                for (const c of tracked.crits) {
                    f.crits.push({
                        severity: c.severity || "C",
                        foeLevel: c.foeLevel > 0 ? String(c.foeLevel) : "",
                        large: !!c.large,
                        superLarge: !!c.superLarge,
                        foeUnconscious: !!c.foeUnconscious,
                        foeStunned: !!c.foeStunned,
                        singleCombat: !!c.singleCombat
                    });
                }
                if (this.trackedNote) {
                    console.log(`EQRMSS | XP scoreboard pre-filled from combat tracker for ${actor?.name}`);
                }
            }
        } catch (e) {
            console.warn("EQRMSS | XP tracker pre-fill failed", e);
        }
    }

    get title() {
        const name = this.actor?.name ?? "Character";
        return `XP Scoreboard — ${name} (Table 15.4.2)`;
    }

    async _prepareContext(options) {
        const ctx = await super._prepareContext(options);
        if (!game?.user?.isGM) {
            return { ...ctx, notGM: true };
        }
        ctx.notGM = false;
        ctx.actorName = this.actor?.name ?? "Character";
        ctx.form = this.formState;
        ctx.multiplierLabels = XP_MULTIPLIER_LABELS;
        ctx.raceBonuses = KILL_RACE_BONUSES;
        ctx.maneuverDifficulties = MANEUVER_DIFFICULTY_MULT;
        ctx.breakdown = this.breakdown;
        ctx.trackedNote = this.trackedNote || "";
        return ctx;
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        // Keep form state in sync without full re-renders on every keystroke.
        this.element.querySelectorAll("[data-xp-field]").forEach(el => {
            const field = el.dataset.xpField;
            const evt = el.type === "checkbox" ? "change" : "input";
            el.addEventListener(evt, () => {
                this.formState[field] = el.type === "checkbox" ? el.checked : el.value;
                // Changing inputs invalidates the last calculation.
                this.breakdown = null;
                const results = this.element.querySelector(".xp-results");
                if (results) results.innerHTML = "";
            });
        });
        this.element.querySelectorAll("[data-crit-field]").forEach(el => {
            el.addEventListener(el.type === "checkbox" ? "change" : "input", () => {
                const idx = Number(el.dataset.critIdx);
                const field = el.dataset.critField;
                if (this.formState.crits[idx]) {
                    this.formState.crits[idx][field] = el.type === "checkbox" ? el.checked : el.value;
                }
                this.breakdown = null;
                const results = this.element.querySelector(".xp-results");
                if (results) results.innerHTML = "";
            });
        });
    }

    /** Read the live DOM into form state (covers selects too). */
    _syncForm() {
        this.element.querySelectorAll("[data-xp-field]").forEach(el => {
            const field = el.dataset.xpField;
            this.formState[field] = el.type === "checkbox" ? el.checked : el.value;
        });
        this.element.querySelectorAll("[data-crit-field]").forEach(el => {
            const idx = Number(el.dataset.critIdx);
            const field = el.dataset.critField;
            if (this.formState.crits[idx]) {
                this.formState.crits[idx][field] = el.type === "checkbox" ? el.checked : el.value;
            }
        });
    }

    _buildInput() {
        const f = this.formState;
        const num = v => {
            const n = Number(v);
            return Number.isFinite(n) ? n : 0;
        };
        const input = { novelty: f.novelty || "subsequent" };

        if (num(f.killHits) > 0 || num(f.killLevel) > 0) {
            const kill = { hits: num(f.killHits), level: num(f.killLevel) };
            if (f.killRace === "demon") {
                kill.raceKey = "demon";
                kill.demonType = num(f.killDemonType);
            } else if (f.killRace === "custom") {
                kill.raceBonus = num(f.killRaceBonus);
            } else if (f.killRace) {
                kill.raceKey = f.killRace;
            }
            input.kill = kill;
        }

        if (num(f.hitsDelivered) > 0 || num(f.hitsReceived) > 0) {
            input.hits = {
                delivered: num(f.hitsDelivered),
                received: num(f.hitsReceived),
                charKnockedOut: !!f.charKnockedOut,
                foeKnockedOut: !!f.foeKnockedOut
            };
        }

        if (num(f.healingDelivered) > 0) {
            input.healing = { amount: num(f.healingDelivered) };
        }

        const crits = (f.crits ?? [])
            .filter(c => c.severity && num(c.foeLevel) > 0)
            .map(c => ({
                severity: c.severity,
                foeLevel: num(c.foeLevel),
                large: !!c.large,
                superLarge: !!c.superLarge,
                foeUnconscious: !!c.foeUnconscious,
                foeStunned: !!c.foeStunned,
                singleCombat: !!c.singleCombat
            }));
        if (crits.length) input.crits = crits;

        if (num(f.maneuverXp) > 0) {
            input.maneuver = { resultingXp: num(f.maneuverXp), difficulty: f.maneuverDifficulty || "hard" };
        }
        if (num(f.ideaGroupTotal) > 0) {
            input.idea = { groupTotal: num(f.ideaGroupTotal), planners: Math.max(1, num(f.ideaPlanners) || 1) };
        }
        if (num(f.deathKillValue) > 0) {
            input.death = {
                ownKillValue: num(f.deathKillValue),
                nearDeath: !!f.deathNearDeath,
                resurrected: !!f.deathResurrected
            };
        }
        if (num(f.travelMiles) > 0) {
            input.travel = {
                miles: num(f.travelMiles),
                airOrSea: !!f.travelAirSea,
                terrain: f.travelTerrain || "normal"
            };
        }
        if (num(f.spellPower) > 0) input.spell = { powerPoints: num(f.spellPower) };
        if (num(f.religiousPoints) > 0) input.religious = { points: num(f.religiousPoints) };
        if (num(f.miscPoints) > 0) input.misc = { points: num(f.miscPoints), label: f.miscLabel?.trim() || "Miscellaneous" };

        return input;
    }

    static async #onCalculate(event, target) {
        event.preventDefault();
        this._syncForm();
        this.breakdown = calculateXpBreakdown(this._buildInput());
        await this.render();
    }

    static async #onAddCrit(event, target) {
        event.preventDefault();
        this._syncForm();
        this.formState.crits.push({
            severity: "C", foeLevel: "",
            large: false, superLarge: false,
            foeUnconscious: false, foeStunned: false, singleCombat: false
        });
        this.breakdown = null;
        await this.render();
    }

    static async #onRemoveCrit(event, target) {
        event.preventDefault();
        this._syncForm();
        const idx = Number(target.dataset.critIdx);
        this.formState.crits.splice(idx, 1);
        this.breakdown = null;
        await this.render();
    }

    static async #onAward(event, target) {
        event.preventDefault();
        if (!game?.user?.isGM) {
            ui.notifications.warn("EQRMSS | Only the GM can award XP.");
            return;
        }
        this._syncForm();
        const breakdown = calculateXpBreakdown(this._buildInput());
        if (!breakdown.total || breakdown.total < 1) {
            ui.notifications.warn("EQRMSS | Nothing to award — calculate first.");
            return;
        }
        const actor = this.actor;
        if (!actor) {
            ui.notifications.warn("EQRMSS | No character targeted.");
            return;
        }
        const notes = "XP scoreboard (15.4.2): " +
            breakdown.lines.map(l => `${l.label} ${l.xp}`).join("; ");
        const currentXP = actor.system?.logs?.xp ?? 0;
        const entries = Array.isArray(actor.system?.logs?.entries)
            ? [...actor.system.logs.entries]
            : [];
        entries.push({
            date: new Date().toISOString().slice(0, 10),
            xp: breakdown.total,
            notes
        });
        await actor.update({
            "system.logs.xp": currentXP + breakdown.total,
            "system.logs.entries": entries
        });
        ui.notifications.info(`EQRMSS | Awarded ${breakdown.total} XP to ${actor.name}.`);
        await checkAndApplyLevelUps(actor);
        // Clear the combat tracker so the same events aren't double-counted
        // if the scoreboard is opened again.
        try {
            await clearXPTracker(actor);
            // Reset pre-filled form state for the next session.
            this.trackedNote = "";
        } catch (e) { /* non-fatal */ }
        this.breakdown = breakdown;
        await this.render();
    }
}
