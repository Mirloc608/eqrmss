// ============================================================
// EQRMSS — Character Creation Wizard Application
// Foundry VTT V13 / V14 (ApplicationV2 Complete Implementation)
// ============================================================

import { EQRMSSCharacterCreationData } from "./eqrmss-character-creation-wizard-data.js";
import { buildCharacterCreationPreview } from "./eqrmss-character-creation-wizard-preview.js";
import { EQRMSSCharacterCreationWizardFinalizer } from "./eqrmss-character-creation-wizard-finalizer.js";
import { EQRMSSCharacterCreationRules, checkRaceClassCompatibility } from "./eqrmss-character-creation-wizard-rules.js";
import { getStatValueFromPoints, calculatePotentialStat } from "./eqrmss-character-creation-tables.js";
import { rmssStatBonus, rmssDevelopmentPoints } from "../data/stats/rmss-stat-bonus.js";
import { rmssRankBonus } from "../data/skills/rmss-rank-bonus.js";
import {
  WEAPON_CATEGORIES,
  parseCost,
  nextRankCost,
  maxRanksPerPass,
  createPassState,
  buyRank,
  refundRank,
  remainingDp,
  totalRanks,
  validateWeaponAssignment,
  rollHitDie,
  buildSkillList,
  displayName
} from "../development/dp-engine.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EQRMSSCharacterCreationWizard extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.dataService = null;
    this.currentStep = 0;
    this._savedScrollTop = 0;
    this.characterData = {
      name: "",
      gender: "",
      raceId: "",
      classId: "",
      cityId: "",
      continentId: "",
      regionId: "",
      originId: "",
      deityId: "",
      ownerUserId: game.userId,
      nationality: "",
      height: null,
      weight: null,
      tempPointPool: 655,
      statRolls: [],
      stats: { ST: 50, AG: 50, CO: 50, ME: 50, RE: 50, SD: 50, QU: 50, EM: 50, IN: 50, PR: 50 },
      potentials: {},
      trainingPackages: [],
      // Two-pass DP development (RMSS §16.4 adolescence → level 0,
      // §10.5 apprenticeship → level 1). Each pass gets the full DP
      // pool; pools never combine. dpPool is derived from temp stats
      // at render; spent/ranks/rolls persist here.
      development: {
        activePass: "adolescence",
        adolescence: { spent: 0, ranks: {}, bodyDevRolls: [], weaponAssignment: null },
        apprenticeship: { spent: 0, ranks: {}, bodyDevRolls: [] }
      },
      // Equipment step (step 8): the class starter kit is granted at
      // finalization; starting money is rolled when the step is first
      // entered (re-rolled if the class changes) and buy-list purchases
      // are tracked here until finalization.
      equipment: {
        moneyRolled: false,
        moneyClassId: "",
        gp: 0,
        cp: 0,
        buyList: null,
        kit: null,
        purchases: {}
      },
      // Background step (step 9, RMSS §7): freeform background notes —
      // past history, family, experiences (§7.0/§7.3) plus §7.1 special
      // abilities/equipment. §7.1 grants are GM-assigned; the wizard only
      // captures them as notes — no mechanics are invented here.
      background: {
        history: "",
        family_notes: "",
        experiences: "",
        parents: "",
        spouse: "",
        children: "",
        special_abilities: "",
        special_equipment: ""
      }
    };
    this._initializeDefaultPotentials();

    // Re-gate race/class selections when the active expansion changes.
    this._expansionHookId = null;
    if (typeof Hooks !== "undefined" && typeof Hooks.on === "function") {
      this._expansionHookId = Hooks.on(
        "eqrmssExpansionChanged",
        () => this._onExpansionChanged()
      );
    }
  }

  /**
   * Drop race/class selections that are no longer unlocked under the
   * new active expansion, then re-render so the option lists update.
   * Fail-open: the wizard keeps working when the manager is absent.
   */
  _onExpansionChanged() {
    const manager = game?.eqrmss?.expansions;
    if (manager) {
      try {
        if (
          this.characterData.raceId &&
          typeof manager.isRaceUnlocked === "function" &&
          !manager.isRaceUnlocked(this.characterData.raceId)
        ) {
          this.characterData.raceId = "";
        }
        if (
          this.characterData.classId &&
          typeof manager.isClassUnlocked === "function" &&
          !manager.isClassUnlocked(this.characterData.classId)
        ) {
          this.characterData.classId = "";
        }
      } catch (err) {
        console.warn("EQRMSS | Wizard | expansion change gate failed", err);
      }
    }
    this.render();
  }

  async close(options = {}) {
    if (
      this._expansionHookId != null &&
      typeof Hooks !== "undefined" &&
      typeof Hooks.off === "function"
    ) {
      Hooks.off("eqrmssExpansionChanged", this._expansionHookId);
      this._expansionHookId = null;
    }
    return super.close(options);
  }

  async _initializeDefaultPotentials() {
    for (const [key, val] of Object.entries(this.characterData.stats)) {
      if (this.characterData.potentials[key] === undefined) {
        this.characterData.potentials[key] = await calculatePotentialStat(val);
      }
    }
  }

  static DEFAULT_OPTIONS = {
    id: "eqrmss-character-creation-wizard",
    classes: ["eqrmss", "eqrmss-wizard-app"],
    tag: "div",
    window: {
      title: "EQRMSS.CharacterCreation.Title",
      resizable: true,
      minimizable: false,
      positioned: { width: 800, height: 650 }
    },
    actions: {
      next: EQRMSSCharacterCreationWizard._onNextStep,
      previous: EQRMSSCharacterCreationWizard._onPrevStep,
      gotoStep: EQRMSSCharacterCreationWizard._onGotoStep,
      "goto-step": EQRMSSCharacterCreationWizard._onGotoStep,
      setField: EQRMSSCharacterCreationWizard._onSetField,
      "set-field": EQRMSSCharacterCreationWizard._onSetField,
      setStat: EQRMSSCharacterCreationWizard._onSetStat,
      "set-stat": EQRMSSCharacterCreationWizard._onSetStat,
      incrementStat: EQRMSSCharacterCreationWizard._onIncrementStat,
      "increment-stat": EQRMSSCharacterCreationWizard._onIncrementStat,
      decrementStat: EQRMSSCharacterCreationWizard._onDecrementStat,
      "decrement-stat": EQRMSSCharacterCreationWizard._onDecrementStat,
      rollPool: EQRMSSCharacterCreationWizard._onRollTempPool,
      "roll-pool": EQRMSSCharacterCreationWizard._onRollTempPool,
      rollAllStats: EQRMSSCharacterCreationWizard._onRollAllStats,
      "roll-all-stats": EQRMSSCharacterCreationWizard._onRollAllStats,
      finish: EQRMSSCharacterCreationWizard._onCreateActor,
      nextStep: EQRMSSCharacterCreationWizard._onNextStep,
      prevStep: EQRMSSCharacterCreationWizard._onPrevStep,
      selectRace: EQRMSSCharacterCreationWizard._onSelectRace,
      selectClass: EQRMSSCharacterCreationWizard._onSelectClass,
      createActor: EQRMSSCharacterCreationWizard._onCreateActor,
      devBuyRank: EQRMSSCharacterCreationWizard._onDevBuyRank,
      "dev-buy-rank": EQRMSSCharacterCreationWizard._onDevBuyRank,
      devRefundRank: EQRMSSCharacterCreationWizard._onDevRefundRank,
      "dev-refund-rank": EQRMSSCharacterCreationWizard._onDevRefundRank,
      devSwitchPass: EQRMSSCharacterCreationWizard._onDevSwitchPass,
      "dev-switch-pass": EQRMSSCharacterCreationWizard._onDevSwitchPass,
      devAssignWeapon: EQRMSSCharacterCreationWizard._onDevAssignWeapon,
      "dev-assign-weapon": EQRMSSCharacterCreationWizard._onDevAssignWeapon,
      equipBuyItem: EQRMSSCharacterCreationWizard._onEquipBuyItem,
      "equip-buy-item": EQRMSSCharacterCreationWizard._onEquipBuyItem,
      equipRefundItem: EQRMSSCharacterCreationWizard._onEquipRefundItem,
      "equip-refund-item": EQRMSSCharacterCreationWizard._onEquipRefundItem
    }
  };

  static PARTS = {
    main: {
      template: "systems/eqrmss/templates/apps/character-creation/eqrmss-character-creation-wizard.html"
    }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    
    if (!this.dataService) {
      this.dataService = await EQRMSSCharacterCreationData.load();
    }

    await this._initializeDefaultPotentials();

    const dataContext = this.dataService.getContext();
    const selection = this.characterData;
    const selectedRace = dataContext.races.find(race => (race.id ?? race._id) === selection.raceId);
    const selectedClass = dataContext.classes.find(cls => (cls.id ?? cls._id) === selection.classId);

    // Locked starting spells/songs for the review display (fixed sets, no picker).
    const startingSpells = selectedClass
      ? (this.dataService?.resolveStartingSpells?.(selectedClass.id ?? selectedClass._id) ?? [])
      : [];
    
    const classChoices = dataContext.classes.map(cls => {
      const classKey = String(cls.key ?? cls.id ?? cls._id ?? "").toLowerCase();
      const favored = (selectedRace?.favoredProfessions ?? []).map(String).map(key => key.toLowerCase());
      return {
        ...cls,
        id: cls.id ?? cls._id,
        isFavored: favored.includes(classKey),
        isRestricted: Boolean(selectedRace) && !checkRaceClassCompatibility(selectedRace, cls)
      };
    });

    const primeStats = selectedClass?.primeStats ?? selectedClass?.primeRequisites ?? [];
    const nameToKeyMap = {
      "Strength": "ST", "Agility": "AG", "Constitution": "CO",
      "Memory": "ME", "Reasoning": "RE", "Self Discipline": "SD",
      "Quickness": "QU", "Empathy": "EM", "Intuition": "IN", "Presence": "PR"
    };
    const mappedPrimeStats = primeStats.map(name => nameToKeyMap[name] || name);

    const enrichedStats = {};
    let totalSpent = 0;

    for (const [key, val] of Object.entries(selection.stats)) {
      const isPrime = mappedPrimeStats.includes(key);
      const minRequired = isPrime ? 90 : 20;
      totalSpent += val;

      let potential = selection.potentials[key];
      if (potential === undefined || potential === null || Number.isNaN(Number(potential))) {
        potential = await calculatePotentialStat(val);
        selection.potentials[key] = potential;
      }

      enrichedStats[key] = {
        value: val,
        potential: potential,
        bonus: rmssStatBonus(Number(val)),
        isPrime,
        minRequired,
        isValid: val >= minRequired
      };
    }

    const remainingPoints = (selection.tempPointPool ?? 655) - totalSpent;

    // Hierarchical origin data: filter regions by continent, origins by region and race
    const continents = dataContext.continents ?? [];
    const regions = dataContext.regions ?? [];
    const settlements = dataContext.settlements ?? [];
    const cities = dataContext.cities ?? [];
    const raceAvailability = dataContext.raceAvailability ?? {};

    // Filter regions by selected continent
    const filteredRegions = selection.continentId
      ? regions.filter(r => r.continent === selection.continentId)
      : regions;

    // Get race name for city filtering
    const raceName = selectedRace?.name ?? "";
    const allowedCityNames = raceAvailability[raceName];

    // Filter cities by race (if mapping exists) and by region/continent
    let filteredCities = cities;
    if (allowedCityNames && allowedCityNames.length > 0) {
      filteredCities = filteredCities.filter(c => allowedCityNames.includes(c.name));
    }
    // Further filter by continent if selected (match city.system.continent)
    if (selection.continentId) {
      const continentName = continents.find(c => c.id === selection.continentId)?.name;
      if (continentName) {
        filteredCities = filteredCities.filter(c => {
          const cityContinent = c.system?.continent ?? "";
          return cityContinent.toLowerCase() === continentName.toLowerCase();
        });
      }
    }

    // Filter settlements by selected region
    const filteredSettlements = selection.regionId
      ? settlements.filter(s => s.parent === selection.regionId)
      : [];

    // Combine cities and settlements for the origin dropdown
    // Cities are marked with (City), settlements with their type
    const originOptions = [
      ...filteredCities.map(c => ({
        id: c.id ?? c.name,
        name: `${c.name} (City)`,
        type: "city",
        data: c
      })),
      ...filteredSettlements.map(s => ({
        id: s.id,
        name: `${s.name} (${s.type})`,
        type: s.type,
        data: s
      }))
    ];

    return {
      ...context,
      ...dataContext,
      filteredRegions,
      filteredCities,
      filteredSettlements,
      originOptions,
      wizard: {
        step: this.currentStep,
        selection,
        steps: [
          { label: "Overview" }, { label: "Basic Info" }, { label: "Race" },
          { label: "Class" }, { label: "Origin" }, { label: "Stats" },
          { label: "Skills" }, { label: "Spells & Songs" },
          { label: "Equipment" }, { label: "Background" }, { label: "Review" }
        ]
      },
      selectedRace,
      selectedClass,
      classChoices,
      startingSpells,
      physical: getPhysicalRange(selectedRace, selection.gender),
      preview: buildCharacterCreationPreview(selection, dataContext),
      ownerOptions: game.user.isGM
        ? game.users.map(u => ({
            id: u.id,
            name: u.name,
            active: u.active,
            isCurrent: u.id === game.userId
          }))
        : [],
      currentStep: this.currentStep,
      characterData: this.characterData,
      enrichedStats,
      totalSpentPoints: totalSpent,
      remainingPoints,
      isPoolExceeded: totalSpent > selection.tempPointPool,
      isFirstStep: this.currentStep === 0,
      isLastStep: this.currentStep === 10,
      skillsContext: this._buildSkillsContext(dataContext, selectedClass, selectedRace),
      developmentSummary: this._buildDevelopmentSummary(dataContext, selectedClass),
      equipmentContext: await this._buildEquipmentContext(dataContext, selectedClass, selectedRace)
    };
  }

  // ------------------------------------------------------------
  // SKILLS STEP — two-pass development-point system
  // RMSS §16.4 (adolescence → level 0) and §10.5 (apprenticeship →
  // level 1). Each pass gets the FULL DP pool; pools never combine.
  // Cost "a/b": first rank step in a pass costs a, second costs b;
  // progression resets each pass while ranks accumulate. Max 2
  // ranks/skill/pass; "a/*" costs buy unlimited ranks at a DP each.
  // ------------------------------------------------------------

  _getDevelopmentState() {
    return (this.characterData.development ??= {
      activePass: "adolescence",
      adolescence: { spent: 0, ranks: {}, bodyDevRolls: [], weaponAssignment: null },
      apprenticeship: { spent: 0, ranks: {}, bodyDevRolls: [] }
    });
  }

  /** DP pool for one pass: Table 15.1.3 bonus total of temp CO/AG/SD/RE/ME. */
  _getDpPool() {
    const s = this.characterData.stats ?? {};
    return rmssDevelopmentPoints({
      Co: s.CO ?? 0, Ag: s.AG ?? 0, SD: s.SD ?? 0, Me: s.ME ?? 0, Re: s.RE ?? 0
    });
  }

  _getClassCosts(dataContext, selectedClass) {
    const key = String(selectedClass?.id ?? selectedClass?._id ?? "").toLowerCase();
    if (!key) return null;
    return dataContext.developmentCosts?.classes?.[key] ?? null;
  }

  _getRaceHitDie(dataContext, selectedRace) {
    const key = String(selectedRace?.key ?? selectedRace?.id ?? selectedRace?._id ?? "").toLowerCase();
    return dataContext.baseHits?.[key]?.hitDie ?? 10;
  }

  /** Weapon cost for a category: assigned figure, or fixed (berserker). */
  _getWeaponCost(classCosts, dev, category) {
    if (classCosts?.weaponAssignment === "fixed") {
      return String(classCosts.weaponCosts?.[category] ?? "");
    }
    return String(dev.adolescence.weaponAssignment?.[category] ?? "");
  }

  _isWeaponAssignmentComplete() {
    const dataContext = this.dataService?.getContext?.();
    if (!dataContext) return true;
    const selectedClass = dataContext.classes.find(c => (c.id ?? c._id) === this.characterData.classId);
    const classCosts = this._getClassCosts(dataContext, selectedClass);
    if (!classCosts) return true;
    if (classCosts.weaponAssignment === "fixed") return true;
    const dev = this._getDevelopmentState();
    const figures = Array.isArray(classCosts.weaponCosts) ? classCosts.weaponCosts : [];
    return validateWeaponAssignment(figures, dev.adolescence.weaponAssignment).ok;
  }

  _buildSkillsContext(dataContext, selectedClass, selectedRace) {
    const dev = this._getDevelopmentState();
    const classCosts = this._getClassCosts(dataContext, selectedClass);
    if (!selectedClass || !classCosts) {
      return { hasClass: false };
    }

    const dpPool = this._getDpPool();
    const ado = dev.adolescence;
    const app = dev.apprenticeship;
    const activeKey = dev.activePass === "apprenticeship" ? "apprenticeship" : "adolescence";
    const activePass = dev[activeKey];
    const hitDie = this._getRaceHitDie(dataContext, selectedRace);

    const rowFor = (entry, costStr) => {
      const cost = parseCost(costStr);
      const ranksThisPass = activePass.ranks[entry.key] ?? 0;
      const total = totalRanks(ado, app, entry.key);
      const nextCost = nextRankCost(cost, ranksThisPass);
      const atCap = ranksThisPass >= maxRanksPerPass(cost);
      const afford = activePass.spent + nextCost <= dpPool;
      return {
        key: entry.key,
        name: entry.name,
        cost: costStr,
        unlimited: cost.unlimited,
        ranksThisPass,
        totalRanks: total,
        rankBonus: rmssRankBonus(total),
        nextCost,
        canBuy: !atCap && afford,
        buyBlockedReason: atCap ? "rank-cap" : (afford ? null : "insufficient-dp"),
        canRefund: ranksThisPass > 0
      };
    };

    // Non-weapon skill rows, grouped for display.
    const skillGroups = [];
    for (const [table, groupName] of [["generalSkills", "General"], ["magicalSkills", "Magical"], ["maneuveringInArmor", "Maneuvering"], ["specialSkills", "Special"]]) {
      const rows = [];
      for (const [key, cost] of Object.entries(classCosts[table] ?? {})) {
        if (key === "spellLists") continue;
        rows.push(rowFor({ key, name: displayName(key) }, String(cost)));
      }
      if (rows.length) skillGroups.push({ name: groupName, rows });
    }

    // Weapon section: costs come from the one-time adolescence assignment
    // (player mode) or the fixed table (berserker).
    const weaponMode = classCosts.weaponAssignment === "fixed" ? "fixed" : "player";
    const figures = weaponMode === "player" && Array.isArray(classCosts.weaponCosts)
      ? classCosts.weaponCosts.map(String)
      : [];
    const weaponFigureOptions = [...new Set(figures)];
    const weaponRows = WEAPON_CATEGORIES.map(cat => {
      const costStr = this._getWeaponCost(classCosts, dev, cat);
      const row = costStr
        ? rowFor({ key: cat, name: displayName(cat) }, costStr)
        : {
            key: cat, name: displayName(cat), cost: "—", unlimited: false,
            ranksThisPass: 0, totalRanks: totalRanks(ado, app, cat),
            rankBonus: rmssRankBonus(totalRanks(ado, app, cat)),
            nextCost: null, canBuy: false, buyBlockedReason: "unassigned", canRefund: false
          };
      row.assigned = costStr || "";
      return row;
    });

    const assignmentCheck = weaponMode === "fixed"
      ? { ok: true }
      : validateWeaponAssignment(figures, dev.adolescence.weaponAssignment);

    const bodyDevRolls = [...ado.bodyDevRolls, ...app.bodyDevRolls];

    return {
      hasClass: true,
      className: selectedClass.name,
      activePass: activeKey,
      passes: {
        adolescence: {
          key: "adolescence",
          label: "Adolescence",
          sublabel: "→ Level 0",
          dpPool,
          spent: ado.spent,
          remaining: dpPool - ado.spent
        },
        apprenticeship: {
          key: "apprenticeship",
          label: "Apprenticeship",
          sublabel: "→ Level 1",
          dpPool,
          spent: app.spent,
          remaining: dpPool - app.spent
        }
      },
      skillGroups,
      weaponMode,
      weaponFigures: figures,
      weaponFigureOptions,
      weaponRows,
      weaponAssignment: dev.adolescence.weaponAssignment ?? {},
      weaponAssignmentComplete: assignmentCheck.ok,
      hitDie,
      bodyDevRolls,
      bodyDevTotal: bodyDevRolls.reduce((a, b) => a + b, 0)
    };
  }

  /** Flat list of developed skills for the Review step. */
  _buildDevelopmentSummary(dataContext, selectedClass) {
    const dev = this._getDevelopmentState();
    const classCosts = this._getClassCosts(dataContext, selectedClass);
    if (!selectedClass || !classCosts) return [];
    const ado = dev.adolescence;
    const app = dev.apprenticeship;
    const summary = [];

    const assignment = dev.adolescence.weaponAssignment ?? {};
    for (const cat of WEAPON_CATEGORIES) {
      const total = totalRanks(ado, app, cat);
      if (total <= 0) continue;
      const costStr = classCosts.weaponAssignment === "fixed"
        ? String(classCosts.weaponCosts?.[cat] ?? "")
        : String(assignment[cat] ?? "");
      summary.push({
        name: displayName(cat),
        category: "Weapon",
        cost: costStr,
        adolescenceRanks: ado.ranks?.[cat] ?? 0,
        apprenticeshipRanks: app.ranks?.[cat] ?? 0,
        totalRanks: total,
        rankBonus: rmssRankBonus(total)
      });
    }

    for (const entry of buildSkillList(classCosts)) {
      const total = totalRanks(ado, app, entry.key);
      if (total <= 0) continue;
      summary.push({
        name: entry.name,
        category: { general: "General", magical: "Magical", maneuvering: "Maneuvering", special: "Special" }[entry.group] ?? entry.group,
        cost: entry.cost,
        adolescenceRanks: ado.ranks?.[entry.key] ?? 0,
        apprenticeshipRanks: app.ranks?.[entry.key] ?? 0,
        totalRanks: total,
        rankBonus: rmssRankBonus(total)
      });
    }
    return summary;
  }

  // ------------------------------------------------------------
  // EQUIPMENT STEP — starter kit preview, starting money, buy-list
  // ------------------------------------------------------------

  _getEquipmentState() {
    this.characterData.equipment ??= {
      moneyRolled: false, moneyClassId: "", gp: 0, cp: 0,
      buyList: null, kit: null, purchases: {}
    };
    return this.characterData.equipment;
  }

  // Coin helpers — same rates as the armor composer:
  // 1sp = 10bp, 1gp = 100bp, 1pp = 1000bp (cp/tp count as bp).
  _parseCostToBp(str) {
    const m = /^\s*([\d.]+)\s*(bp|sp|gp|cp|pp|tp)?\s*$/i.exec(str ?? "");
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = (m[2] ?? "bp").toLowerCase();
    if (unit === "sp") return n * 10;
    if (unit === "gp") return n * 100;
    if (unit === "pp") return n * 1000;
    return n;
  }

  _formatBp(bp) {
    bp = Math.round(bp);
    if (bp >= 100 && bp % 100 === 0) return `${bp / 100}gp`;
    if (bp >= 10 && bp % 10 === 0) return `${bp / 10}sp`;
    return `${bp}bp`;
  }

  async _loadBuyList() {
    const eq = this._getEquipmentState();
    if (eq.buyList) return eq.buyList;
    try {
      const resp = await fetch("systems/eqrmss/module/data/starter-buy-list.json");
      if (resp.ok) eq.buyList = await resp.json();
    } catch { /* fall through — empty list */ }
    eq.buyList ??= { items: [] };
    return eq.buyList;
  }

  // Kit preview mirrors the finalizer's #grantStarterKit lookup
  // (class kit + race overrides), without creating anything.
  async _loadKitPreview(selectedClass, selectedRace) {
    const eq = this._getEquipmentState();
    const classKey = String(selectedClass?.id ?? selectedClass?._id ?? "").toLowerCase();
    const raceKey =
      String(selectedRace?.id ?? selectedRace?._id ?? "").toLowerCase().replace(/^eqrmss-/, "") ||
      String(selectedRace?.name ?? "").toLowerCase();
    if (eq.kit && eq.kit.classKey === classKey && eq.kit.raceKey === raceKey) return eq.kit;
    let kit = null;
    try {
      const resp = await fetch("systems/eqrmss/module/data/starter-kits.json");
      if (resp.ok) {
        const data = await resp.json();
        const raw = data[classKey];
        if (raw) {
          const overrides = (data.raceOverrides ?? {})[raceKey] ?? {};
          kit = {
            classKey, raceKey,
            money: raw.money ?? {},
            items: (raw.items ?? []).map(entry => ({
              name: (entry.slot && overrides[entry.slot]) || entry.name,
              slot: entry.slot ?? "",
              quantity: entry.quantity ?? 1,
              type: entry.type ?? "item"
            }))
          };
        }
      }
    } catch { /* fall through — no preview */ }
    eq.kit = kit;
    return kit;
  }

  // Roll starting money once per class when the Equipment step is entered.
  async _ensureEquipmentMoney() {
    const eq = this._getEquipmentState();
    const classId = this.characterData.classId ?? "";
    if (eq.moneyRolled && eq.moneyClassId === classId) return;
    const dataContext = this.dataService?.getContext?.() ?? {};
    const selectedClass = (dataContext.classes ?? []).find(c => (c.id ?? c._id) === classId);
    const selectedRace = (dataContext.races ?? []).find(r => (r.id ?? r._id) === this.characterData.raceId);
    const kit = selectedClass ? await this._loadKitPreview(selectedClass, selectedRace) : null;
    const money = kit?.money ?? {};
    eq.gp = Number(money.gp) || 0;
    const cpSpec = money.cp;
    if (typeof cpSpec === "string" && cpSpec.includes("d")) {
      try {
        eq.cp = (await new Roll(cpSpec).evaluate()).total ?? 0;
      } catch {
        eq.cp = 0;
      }
    } else {
      eq.cp = Number(cpSpec) || 0;
    }
    eq.moneyRolled = true;
    eq.moneyClassId = classId;
  }

  _equipmentSpentBp(eq, buyList) {
    let spent = 0;
    for (const [id, qty] of Object.entries(eq.purchases ?? {})) {
      if (!(qty > 0)) continue;
      const item = (buyList.items ?? []).find(i => i.id === id);
      if (item) spent += this._parseCostToBp(item.cost) * qty;
    }
    return spent;
  }

  async _buildEquipmentContext(dataContext, selectedClass, selectedRace) {
    const eq = this._getEquipmentState();
    const buyList = await this._loadBuyList();
    const kit = selectedClass ? await this._loadKitPreview(selectedClass, selectedRace) : null;
    const startBp = eq.gp * 100 + eq.cp;
    const spentBp = this._equipmentSpentBp(eq, buyList);
    const remainingBp = Math.max(0, startBp - spentBp);

    const cart = [];
    for (const [id, qty] of Object.entries(eq.purchases ?? {})) {
      if (!(qty > 0)) continue;
      const item = (buyList.items ?? []).find(i => i.id === id);
      if (item) cart.push({ ...item, qty });
    }

    const CATEGORY_LABELS = {
      light: "Light", carry: "Carry", camping: "Camping", climbing: "Climbing",
      ammunition: "Ammunition", rogue: "Rogue Tools", writing: "Writing",
      clothing: "Clothing", tools: "Tools", weapons: "Backup Weapons", rations: "Rations"
    };
    const groups = [];
    for (const item of buyList.items ?? []) {
      const unitBp = this._parseCostToBp(item.cost);
      let group = groups.find(g => g.category === item.category);
      if (!group) {
        group = { category: item.category, label: CATEGORY_LABELS[item.category] ?? item.category, items: [] };
        groups.push(group);
      }
      group.items.push({ ...item, unitBp, affordable: unitBp <= remainingBp });
    }

    return {
      moneyRolled: eq.moneyRolled,
      hasClass: !!selectedClass,
      moneyLabel: `${eq.gp}gp + ${eq.cp}cp`,
      spentLabel: this._formatBp(spentBp),
      remainingLabel: this._formatBp(remainingBp),
      kitItems: kit?.items ?? [],
      cart,
      groups
    };
  }

  static async _onEquipBuyItem(event, target) {
    const eq = this._getEquipmentState();
    const id = target.dataset.item;
    if (!id) return;
    const buyList = await this._loadBuyList();
    const item = (buyList.items ?? []).find(i => i.id === id);
    if (!item) return;
    const costBp = this._parseCostToBp(item.cost);
    const remainingBp = (eq.gp * 100 + eq.cp) - this._equipmentSpentBp(eq, buyList);
    if (costBp > remainingBp) {
      ui.notifications.warn(`EQRMSS | Not enough coin for ${item.name} (${item.cost}).`);
      return;
    }
    eq.purchases[id] = (eq.purchases[id] ?? 0) + 1;
    this._savedScrollTop = this.element?.querySelector(".window-content")?.scrollTop ?? 0;
    this.render();
  }

  static async _onEquipRefundItem(event, target) {
    const eq = this._getEquipmentState();
    const id = target.dataset.item;
    if (!id || !(eq.purchases[id] > 0)) return;
    eq.purchases[id] -= 1;
    if (eq.purchases[id] <= 0) delete eq.purchases[id];
    this._savedScrollTop = this.element?.querySelector(".window-content")?.scrollTop ?? 0;
    this.render();
  }

  static async _onDevSwitchPass(event, target) {    const pass = target.dataset.pass === "apprenticeship" ? "apprenticeship" : "adolescence";
    this._getDevelopmentState().activePass = pass;
    this._savedScrollTop = this.element?.querySelector(".window-content")?.scrollTop ?? 0;
    this.render();
  }

  static async _onDevBuyRank(event, target) {
    const dev = this._getDevelopmentState();
    const activeKey = dev.activePass === "apprenticeship" ? "apprenticeship" : "adolescence";
    const pass = dev[activeKey];
    const skillKey = target.dataset.skill;
    if (!skillKey) return;

    const dataContext = this.dataService.getContext();
    const selectedClass = dataContext.classes.find(c => (c.id ?? c._id) === this.characterData.classId);
    const selectedRace = dataContext.races.find(r => (r.id ?? r._id) === this.characterData.raceId);
    const classCosts = this._getClassCosts(dataContext, selectedClass);
    if (!classCosts) return;

    // Resolve the cost: weapon categories use the assignment.
    let costStr = "";
    if (WEAPON_CATEGORIES.includes(skillKey)) {
      costStr = this._getWeaponCost(classCosts, dev, skillKey);
      if (!costStr) {
        ui.notifications.warn("EQRMSS | Assign a cost figure to this weapon category first.");
        return;
      }
    } else {
      const entry = buildSkillList(classCosts).find(e => e.key === skillKey);
      costStr = entry?.cost ?? "";
    }
    if (!costStr) return;
    const cost = parseCost(costStr);

    // Lazily set the pool from current temp stats (re-derived each render).
    pass.dpPool = this._getDpPool();

    const result = buyRank(pass, skillKey, cost);
    if (!result.ok) {
      ui.notifications.warn(
        result.reason === "rank-cap"
          ? `EQRMSS | ${displayName(skillKey)}: rank limit reached for this pass.`
          : `EQRMSS | Not enough development points (${result.cost ?? ""}).`
      );
      return;
    }

    // Body Development: roll the racial hit die immediately; the roll
    // persists so re-renders never re-roll it.
    if (skillKey === "bodyDevelopment") {
      const hitDie = this._getRaceHitDie(dataContext, selectedRace);
      const roll = rollHitDie(hitDie);
      pass.bodyDevRolls.push(roll);
      ui.notifications.info(`EQRMSS | Body Development: rolled ${roll} on d${hitDie}.`);
    }

    this._savedScrollTop = this.element?.querySelector(".window-content")?.scrollTop ?? 0;
    this.render();
  }

  static async _onDevRefundRank(event, target) {
    const dev = this._getDevelopmentState();
    const activeKey = dev.activePass === "apprenticeship" ? "apprenticeship" : "adolescence";
    const pass = dev[activeKey];
    const skillKey = target.dataset.skill;
    if (!skillKey) return;

    const dataContext = this.dataService.getContext();
    const selectedClass = dataContext.classes.find(c => (c.id ?? c._id) === this.characterData.classId);
    const classCosts = this._getClassCosts(dataContext, selectedClass);
    if (!classCosts) return;

    let costStr = "";
    if (WEAPON_CATEGORIES.includes(skillKey)) {
      costStr = this._getWeaponCost(classCosts, dev, skillKey);
    } else {
      costStr = buildSkillList(classCosts).find(e => e.key === skillKey)?.cost ?? "";
    }
    if (!costStr) return;

    pass.dpPool = this._getDpPool();
    const result = refundRank(pass, skillKey, parseCost(costStr));
    if (result.ok && skillKey === "bodyDevelopment") {
      // Remove the most recent Body Development roll (LIFO with the rank).
      pass.bodyDevRolls.pop();
    }
    this._savedScrollTop = this.element?.querySelector(".window-content")?.scrollTop ?? 0;
    this.render();
  }

  static async _onDevAssignWeapon(event, target) {
    const dev = this._getDevelopmentState();
    const category = target.dataset.weaponCategory;
    const figure = target.value;
    if (!category) return;
    dev.adolescence.weaponAssignment ??= {};
    if (!figure) delete dev.adolescence.weaponAssignment[category];
    else dev.adolescence.weaponAssignment[category] = figure;
    this._savedScrollTop = this.element?.querySelector(".window-content")?.scrollTop ?? 0;
    this.render();
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const content = this.element.querySelector?.('.window-content') ?? this.element?.querySelector?.('.window');
    if (content && this._savedScrollTop !== undefined) {
      content.scrollTop = this._savedScrollTop;
    }

    const root = this.element instanceof HTMLElement ? this.element : this.element?.[0];
    if (!root) return;

    // Weapon-category cost assignment selects (Skills step): delegated
    // change binding — the assignment is permanent once all six figures
    // are placed.
    for (const sel of root.querySelectorAll("[data-weapon-category]")) {
      sel.addEventListener("change", event => {
        EQRMSSCharacterCreationWizard._onDevAssignWeapon.call(this, event, event.currentTarget);
      });
    }

    for (const field of root.querySelectorAll("[data-field]")) {
      field.addEventListener("change", async event => {
        const input = event.currentTarget;
        const key = input.dataset.field;
        if (!key) return;

        const contentEl = this.element.querySelector?.('.window-content');
        this._savedScrollTop = contentEl ? contentEl.scrollTop : 0;

        if (Object.hasOwn(this.characterData.stats, key)) {
          const rawValue = Number(input.value);
          const actualVal = getStatValueFromPoints(rawValue);
          this.characterData.stats[key] = actualVal;
          this.characterData.potentials[key] = await calculatePotentialStat(actualVal);
        } else {
          this.characterData[key] = input.value;
        }

        if (key === "raceId" && this.characterData.classId) {
          const race = this.dataService?.getContext().races.find(item => (item.id ?? item._id) === input.value);
          const cls = this.dataService?.getContext().classes.find(item => (item.id ?? item._id) === this.characterData.classId);
          if (race && cls && !checkRaceClassCompatibility(race, cls)) this.characterData.classId = "";
        }

        // Hierarchical origin selection: cascading dropdowns
        if (key === "continentId") {
          // Changing continent clears region and origin selections
          this.characterData.regionId = "";
          this.characterData.originId = "";
          this.characterData.cityId = "";
        }
        if (key === "regionId") {
          // Changing region clears origin selection
          this.characterData.originId = "";
          this.characterData.cityId = "";
        }
        if (key === "originId") {
          // Origin selection sets cityId for backward compatibility
          this.characterData.cityId = input.value;
        }

        if (input.tagName === "SELECT" || input.type === "checkbox") this.render();
      });
    }
  }

  async _saveCurrentStepData(form) {
    if (!form) return;
    for (const field of form.querySelectorAll("[data-field]")) {
      const key = field.dataset.field;
      if (!key) continue;
      if (Object.hasOwn(this.characterData.stats, key)) {
        const rawValue = Number(field.value);
        const actualVal = getStatValueFromPoints(rawValue);
        this.characterData.stats[key] = actualVal;
        this.characterData.potentials[key] = await calculatePotentialStat(actualVal);
      } else if (key.includes(".")) {
        // One level of nesting, e.g. data-field="background.history".
        // Falls back to a flat key when the head object does not exist.
        const [head, ...rest] = key.split(".");
        const leaf = rest.join(".");
        if (Object.hasOwn(this.characterData, head) && typeof this.characterData[head] === "object") {
          this.characterData[head][leaf] = field.value;
        } else {
          this.characterData[key] = field.value;
        }
      } else {
        this.characterData[key] = field.value;
      }
    }
  }

  static async _onIncrementStat(event, target) {
    const statKey = target.dataset.stat;
    if (!statKey) return;
    const content = this.element?.querySelector('.window-content');
    this._savedScrollTop = content ? content.scrollTop : 0;

    const currentVal = this.characterData.stats[statKey] || 20;
    if (currentVal < 101) {
      const actualVal = getStatValueFromPoints(currentVal + 1);
      this.characterData.stats[statKey] = actualVal;
      this.characterData.potentials[statKey] = await calculatePotentialStat(actualVal);
      this.render();
    }
  }

  static async _onDecrementStat(event, target) {
    const statKey = target.dataset.stat;
    if (!statKey) return;
    const content = this.element?.querySelector('.window-content');
    this._savedScrollTop = content ? content.scrollTop : 0;

    const currentVal = this.characterData.stats[statKey] || 20;
    const selectedClass = this.dataService?.getContext().classes.find(c => (c.id ?? c._id) === this.characterData.classId);
    const primeStats = selectedClass?.primeStats ?? selectedClass?.primeRequisites ?? [];
    const nameToKeyMap = {
      "Strength": "ST", "Agility": "AG", "Constitution": "CO",
      "Memory": "ME", "Reasoning": "RE", "Self Discipline": "SD",
      "Quickness": "QU", "Empathy": "EM", "Intuition": "IN", "Presence": "PR"
    };
    const mappedPrimeStats = primeStats.map(name => nameToKeyMap[name] || name);
    const minAllowed = mappedPrimeStats.includes(statKey) ? 90 : 20;

    if (currentVal > minAllowed) {
      const actualVal = getStatValueFromPoints(currentVal - 1);
      this.characterData.stats[statKey] = actualVal;
      this.characterData.potentials[statKey] = await calculatePotentialStat(actualVal);
      this.render();
    }
  }

  static async _onRollTempPool(event, target) {
    const content = this.element?.querySelector('.window-content');
    this._savedScrollTop = content ? content.scrollTop : 0;

    let d10Sum = 0;
    const rolls = [];
    for (let i = 0; i < 10; i++) {
      const r = Math.floor(Math.random() * 10) + 1;
      rolls.push(r);
      d10Sum += r;
    }
    this.characterData.tempPointPool = 600 + d10Sum;
    this.characterData.statRolls = rolls;
    ui.notifications.info(`EQRMSS | Rolled temporary point pool: 600 + ${d10Sum} = ${this.characterData.tempPointPool}`);
    this.render();
  }

  static async _onRollAllStats(event, target) {
    const content = this.element?.querySelector('.window-content');
    this._savedScrollTop = content ? content.scrollTop : 0;

    const dataContext = this.dataService?.getContext();
    const selectedClass = dataContext?.classes.find(c => (c.id ?? c._id) === this.characterData.classId);
    const primeStats = selectedClass?.primeStats ?? selectedClass?.primeRequisites ?? [];
    const nameToKeyMap = {
      "Strength": "ST", "Agility": "AG", "Constitution": "CO",
      "Memory": "ME", "Reasoning": "RE", "Self Discipline": "SD",
      "Quickness": "QU", "Empathy": "EM", "Intuition": "IN", "Presence": "PR"
    };
    const mappedPrimeStats = primeStats.map(name => nameToKeyMap[name] || name);

    const pool = this.characterData.tempPointPool ?? 655;
    const statsKeys = Object.keys(this.characterData.stats);

    const allocated = {};
    let spent = 0;
    for (const key of statsKeys) {
      const min = mappedPrimeStats.includes(key) ? 90 : 20;
      allocated[key] = min;
      spent += min;
    }

    let remaining = pool - spent;
    while (remaining > 0) {
      const randomKey = statsKeys[Math.floor(Math.random() * statsKeys.length)];
      if (allocated[randomKey] < 101) {
        allocated[randomKey]++;
        remaining--;
      }
      if (Object.values(allocated).every(v => v >= 101)) break;
    }

    this.characterData.stats = {};
    this.characterData.potentials = {};

    for (const [key, rawVal] of Object.entries(allocated)) {
      const actualVal = getStatValueFromPoints(rawVal);
      this.characterData.stats[key] = actualVal;
      this.characterData.potentials[key] = await calculatePotentialStat(actualVal);
    }

    ui.notifications.info("EQRMSS | Rolled and distributed all stats automatically.");
    this.render();
  }

  static async _onNextStep(event, target) {
    const form = target.form || target.closest("form") || target.closest(".eqrmss-character-creation-wizard");
    await this._saveCurrentStepData(form);

    // Leaving the Skills step requires the one-time weapon-category
    // assignment (adolescence) — it is permanent once set.
    if (this.currentStep === 6 && !this._isWeaponAssignmentComplete()) {
      ui.notifications.warn("EQRMSS | Assign all six weapon cost figures before leaving the Skills step.");
      return;
    }

    if (this.currentStep < 10) {
      this.currentStep++;
      // Entering the Equipment step: roll starting money once per class.
      if (this.currentStep === 8) await this._ensureEquipmentMoney();
      this._savedScrollTop = 0;
      this.render();
    }
  }

  static async _onPrevStep(event, target) {
    const form = target.form || target.closest("form") || target.closest(".eqrmss-character-creation-wizard");
    await this._saveCurrentStepData(form);

    if (this.currentStep > 0) {
      this.currentStep--;
      this._savedScrollTop = 0;
      this.render();
    }
  }

  static async _onGotoStep(event, target) {
    const step = Number(target.dataset.step);
    if (!Number.isInteger(step) || step < 0 || step > 10) return;
    await this._saveCurrentStepData(target.closest("form") || target.closest(".eqrmss-character-creation-wizard"));
    this.currentStep = step;
    // Jumping straight to the Equipment step: roll starting money once per class.
    if (this.currentStep === 8) await this._ensureEquipmentMoney();
    this._savedScrollTop = 0;
    this.render();
  }

  static async _onSetField(event, target) {
    const field = target.dataset.field;
    if (!field) return;
    this.characterData[field] = target.value;
    this.render();
  }

  static async _onSetStat(event, target) {
    const stat = target.dataset.field;
    if (!stat) return;
    const content = this.element?.querySelector('.window-content');
    this._savedScrollTop = content ? content.scrollTop : 0;

    const rawVal = Number(target.value);
    const actualVal = getStatValueFromPoints(rawVal);
    this.characterData.stats[stat] = actualVal;
    this.characterData.potentials[stat] = await calculatePotentialStat(actualVal);
    this.render();
  }

  static async _onSelectRace(event, target) {
    const raceId = target.dataset.raceId;
    if (raceId) {
      this.characterData.raceId = raceId;
      this.render();
    }
  }

  static async _onSelectClass(event, target) {
    const classId = target.dataset.classId;
    if (classId) {
      this.characterData.classId = classId;
      this.render();
    }
  }

  static async _onCreateActor(event, target) {
    const form = target.form || target.closest("form") || target.closest(".eqrmss-character-creation-wizard");
    await this._saveCurrentStepData(form);

    const dataContext = this.dataService.getContext();
    const rules = new EQRMSSCharacterCreationRules();
    const errors = rules.validateSelection(this.characterData, dataContext);

    const selectedClass = dataContext.classes.find(c => (c.id ?? c._id) === this.characterData.classId);
    const primeStats = selectedClass?.primeStats ?? selectedClass?.primeRequisites ?? [];
    const nameToKeyMap = {
      "Strength": "ST", "Agility": "AG", "Constitution": "CO",
      "Memory": "ME", "Reasoning": "RE", "Self Discipline": "SD",
      "Quickness": "QU", "Empathy": "EM", "Intuition": "IN", "Presence": "PR"
    };
    const mappedPrimeStats = primeStats.map(name => nameToKeyMap[name] || name);

    for (const [statKey, val] of Object.entries(this.characterData.stats)) {
      const isPrime = mappedPrimeStats.includes(statKey);
      const minReq = isPrime ? 90 : 20;
      if (val < minReq) {
        ui.notifications.error(`EQRMSS | Stat ${statKey} must be at least ${minReq} (${isPrime ? "Prime Stat" : "Non-Prime"}).`);
        return;
      }
    }

    if (Object.keys(errors).length) {
      ui.notifications.error(`EQRMSS | ${Object.values(errors)[0]}`);
      return;
    }

    // Unspent development points are forfeited at finalization — warn first.
    const dev = this._getDevelopmentState();
    const dpPool = this._getDpPool();
    const unspentAdolescence = Math.max(0, dpPool - (dev.adolescence?.spent ?? 0));
    const unspentApprenticeship = Math.max(0, dpPool - (dev.apprenticeship?.spent ?? 0));
    const totalUnspent = unspentAdolescence + unspentApprenticeship;
    if (totalUnspent > 0) {
      const confirmed = await Dialog.confirm({
        title: "Forfeit Unspent Development Points",
        content: `<p>Unspent development points are <strong>forfeited</strong> when the character is finalized:</p>
          <ul><li>Adolescence: ${unspentAdolescence} unspent</li>
          <li>Apprenticeship: ${unspentApprenticeship} unspent</li></ul>
          <p>Finalize anyway?</p>`
      });
      if (!confirmed) return;
    }

    const actor = await new EQRMSSCharacterCreationWizardFinalizer(
      this.characterData,
      dataContext
    ).finalize();
    if (actor) this.close();
  }
}

function getPhysicalRange(race, gender) {
  if (!race || !gender) return null;
  const key = String(gender).toLowerCase();
  const combineOtherRange = (ranges, isHeight) => {
    const male = parseRange(ranges?.male, isHeight);
    const female = parseRange(ranges?.female, isHeight);
    if (!male && !female) return null;
    return {
      min: female?.min ?? male.min,
      max: male?.max ?? female.max
    };
  };
  const height = key === "other"
    ? combineOtherRange(race.height, true)
    : parseRange(race.height?.[key], true);
  const weight = key === "other"
    ? combineOtherRange(race.weight, false)
    : parseRange(race.weight?.[key], false);
  if (!height && !weight) return null;
  return { height, weight };
}

function parseRange(value, isHeight) {
  if (Array.isArray(value) && value.length >= 2) {
    return { min: Number(value[0]), max: Number(value[1]) };
  }
  const numbers = String(value ?? "").match(/\d+/g)?.map(Number) ?? [];
  if (isHeight && numbers.length >= 4) {
    return { min: numbers[0] * 12 + numbers[1], max: numbers[2] * 12 + numbers[3] };
  }
  if (!isHeight && numbers.length >= 2) return { min: numbers[0], max: numbers[1] };
  return null;
}