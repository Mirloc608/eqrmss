// ============================================================
// EQRMSS — GM Screen (lightweight, eqrmss-native)
// ApplicationV2 — GM-only tabbed quick-reference panel.
// Inspired by samulopez/foundryvtt-gmScreen (MIT) but purpose-built:
// no drag-and-drop grid, no build step — just the tabs a GM needs.
//
// Tabs:
//   1. XP Scoreboard — pick a character, launch the Table 15.4.2 calculator
//   2. XP Thresholds — Table 15.4.1 level/XP reference
//   3. Stat Gains    — Table 15.1.2 stat gain roll reference
//   4. Combat        — level OB/spell bonus mappings + crit XP values
// ============================================================

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const BaseApplication = HandlebarsApplicationMixin(ApplicationV2);

// ----------------------------------------------------------------------------
// Table 15.4.1 — XP thresholds (book-pure).
// L1 starts at 10,000. +10k/lv 1-5, +20k/lv 6-10, +30k/lv 11-15,
// +40k/lv 16-20, +50k/lv 21+.
// ----------------------------------------------------------------------------
function xpThresholdRows(maxLevel = 30) {
    const rows = [];
    let xp = 0;
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
        let step;
        if (lvl === 1) step = 10000;
        else if (lvl <= 5) step = 10000;
        else if (lvl <= 10) step = 20000;
        else if (lvl <= 15) step = 30000;
        else if (lvl <= 20) step = 40000;
        else step = 50000;
        xp += step;
        rows.push({ level: lvl, xp });
    }
    return rows;
}

// ----------------------------------------------------------------------------
// Table 15.1.2 — Stat gain table (book-pure).
// Columns: difference between temp and potential.
// Rows: d100 roll. 01-04 = overstress (temp -2x roll).
// ----------------------------------------------------------------------------
const STAT_GAIN_COLUMNS = ["1", "2", "3", "4–5", "6–7", "8–9", "10–11", "12–14", "15+"];
const STAT_GAIN_ROWS = [
    { roll: "01–04", values: ["*", "*", "*", "*", "*", "*", "*", "*", "*"], overstress: true },
    { roll: "05–10", values: ["0", "0", "0", "0", "0", "0", "+1", "+1", "+1"] },
    { roll: "11–15", values: ["0", "0", "0", "0", "0", "+1", "+1", "+2", "+2"] },
    { roll: "16–20", values: ["0", "0", "0", "0", "+1", "+1", "+2", "+3", "+3"] },
    { roll: "21–25", values: ["0", "0", "0", "+1", "+1", "+2", "+2", "+4", "+4"] },
    { roll: "26–30", values: ["0", "0", "+1", "+1", "+2", "+2", "+3", "+5", "+5"] },
    { roll: "31–35", values: ["0", "+1", "+1", "+1", "+2", "+2", "+3", "+5", "+6"] },
    { roll: "36–40", values: ["0", "+1", "+1", "+1", "+2", "+3", "+4", "+6", "+7"] },
    { roll: "41–45", values: ["0", "+1", "+1", "+2", "+3", "+3", "+4", "+6", "+8"] },
    { roll: "46–50", values: ["0", "+1", "+1", "+2", "+3", "+3", "+5", "+7", "+9"] },
    { roll: "51–55", values: ["+1", "+1", "+2", "+2", "+3", "+4", "+5", "+7", "+10"] },
    { roll: "56–60", values: ["+1", "+1", "+2", "+2", "+4", "+4", "+6", "+8", "+11"] },
    { roll: "61–65", values: ["+1", "+1", "+2", "+3", "+4", "+4", "+6", "+8", "+11"] },
    { roll: "66–70", values: ["+1", "+2", "+2", "+3", "+4", "+5", "+7", "+9", "+12"] },
    { roll: "71–75", values: ["+1", "+2", "+2", "+3", "+5", "+5", "+7", "+9", "+12"] },
    { roll: "76–80", values: ["+1", "+2", "+3", "+3", "+5", "+6", "+8", "+10", "+13"] },
    { roll: "81–85", values: ["+1", "+2", "+3", "+4", "+5", "+6", "+8", "+10", "+13"] },
    { roll: "86–90", values: ["+1", "+2", "+3", "+4", "+6", "+7", "+9", "+11", "+14"] },
    { roll: "91–95", values: ["+1", "+2", "+3", "+4", "+6", "+7", "+9", "+11", "+14"] },
    { roll: "96–99", values: ["+1", "+2", "+3", "+4", "+6", "+8", "+10", "+12", "+15"] },
    { roll: "100", values: ["+1", "+2", "+3", "+4", "+6", "+8", "+10", "+12", "+15"] }
];

// ----------------------------------------------------------------------------
// Combat quick-reference: level OB/spell bonus mappings (§5.2.1, §5.2.2).
// User EQ-class mapping, 2026-10-16.
// ----------------------------------------------------------------------------
const COMBAT_BONUS_ROWS = [
    { classes: "Warrior, Berserker, Paladin, Shadowknight, Ranger", ob: "+3/level", obCap: "—", spell: "—" },
    { classes: "Rogue", ob: "+3/level", obCap: "+60", spell: "—" },
    { classes: "Monk, Beastlord", ob: "+2/level", obCap: "+40", spell: "—" },
    { classes: "Bard, Cleric, Druid, Shaman", ob: "+1/level", obCap: "+20", spell: "—" },
    { classes: "Wizard, Magician, Enchanter, Necromancer", ob: "+0", obCap: "—", spell: "—" }
];
const SPELL_BONUS_ROWS = [
    { classes: "Wizard, Magician, Enchanter, Necromancer, Cleric, Druid, Shaman", bonus: "+2/level", cap: "+20" },
    { classes: "Paladin, Shadowknight, Beastlord, Ranger", bonus: "+1/level", cap: "+20" },
    { classes: "Bard (songs)", bonus: "+1/level", cap: "+20" }
];
const CRIT_XP_ROWS = [
    { severity: "A", xp: "5 × foe level" },
    { severity: "B", xp: "10 × foe level" },
    { severity: "C", xp: "15 × foe level" },
    { severity: "D", xp: "20 × foe level" },
    { severity: "E", xp: "25 × foe level" },
    { severity: "Large creature", xp: "20 × foe level" },
    { severity: "Super-large", xp: "40 × foe level" }
];

export class GMScreen extends BaseApplication {

    static DEFAULT_OPTIONS = {
        id: "eqrmss-gm-screen",
        classes: ["eqrmss", "gm-screen"],
        window: {
            title: "GM Screen",
            icon: "fas fa-book-reader",
            resizable: true
        },
        position: { width: 760, height: 620 },
        actions: {
            "select-tab": this.#onSelectTab,
            "open-scoreboard": this.#onOpenScoreboard
        }
    };

    static PARTS = {
        main: {
            template: "systems/eqrmss/templates/apps/gm-screen.html"
        }
    };

    constructor(options = {}) {
        super(options);
        this.activeTab = "xp";
    }

    async _prepareContext(options) {
        const ctx = await super._prepareContext(options);
        if (!game?.user?.isGM) {
            return { ...ctx, notGM: true };
        }
        ctx.notGM = false;
        ctx.activeTab = this.activeTab;

        // Player characters for the XP scoreboard launcher.
        ctx.characters = (game.actors ?? [])
            .filter(a => a.type === "character")
            .map(a => ({ id: a.id, name: a.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        // Whether the XP scoreboard dialog is available.
        let scoreboardAvailable = false;
        try {
            const mod = await import("./xp-scoreboard-dialog.js");
            scoreboardAvailable = typeof mod?.XPScoreboardDialog === "function";
        } catch (e) { /* not available */ }
        ctx.scoreboardAvailable = scoreboardAvailable;

        ctx.xpThresholds = xpThresholdRows(30);
        // Pair rows two-per-line for a compact two-column table.
        const thresholds = ctx.xpThresholds;
        ctx.xpThresholdPairs = [];
        for (let i = 0; i < thresholds.length; i += 2) {
            ctx.xpThresholdPairs.push({
                left: thresholds[i],
                right: thresholds[i + 1] ?? null
            });
        }
        ctx.statGainColumns = STAT_GAIN_COLUMNS;
        ctx.statGainRows = STAT_GAIN_ROWS;
        ctx.combatBonusRows = COMBAT_BONUS_ROWS;
        ctx.spellBonusRows = SPELL_BONUS_ROWS;
        ctx.critXpRows = CRIT_XP_ROWS;
        return ctx;
    }

    static #onSelectTab(event, target) {
        const tab = target?.dataset?.tab;
        if (!tab) return;
        this.activeTab = tab;
        // Toggle without a full re-render to keep it snappy.
        this.element.querySelectorAll(".gm-screen-tabs [data-tab]").forEach(el => {
            el.classList.toggle("active", el.dataset.tab === tab);
        });
        this.element.querySelectorAll(".gm-screen-panel").forEach(el => {
            el.classList.toggle("active", el.dataset.panel === tab);
        });
    }

    static async #onOpenScoreboard(event, target) {
        const actorId = target?.dataset?.actorId;
        const actor = game.actors?.get(actorId);
        if (!actor) {
            ui.notifications?.warn("EQRMSS | Character not found.");
            return;
        }
        try {
            const { XPScoreboardDialog } = await import("./xp-scoreboard-dialog.js");
            new XPScoreboardDialog(actor).render(true);
        } catch (e) {
            console.error("EQRMSS | GM Screen: XP scoreboard unavailable", e);
            ui.notifications?.error("EQRMSS | XP Scoreboard is not available.");
        }
    }
}

// Singleton accessor.
let _gmScreenInstance = null;

export function openGMScreen() {
    if (!game?.user?.isGM) {
        ui.notifications?.warn("EQRMSS | The GM Screen is for GMs only.");
        return null;
    }
    if (!_gmScreenInstance) {
        _gmScreenInstance = new GMScreen();
    }
    _gmScreenInstance.render(true);
    _gmScreenInstance.bringToFront();
    return _gmScreenInstance;
}
