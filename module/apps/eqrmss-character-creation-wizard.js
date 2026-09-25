// ============================================================
// EQRMSS — Character Creation Wizard Application
// Foundry VTT V13 / V14 (ApplicationV2 Complete Implementation)
// ============================================================

import { EQRMSSCharacterCreationData } from "./eqrmss-character-creation-wizard-data.js";
import { buildCharacterCreationPreview } from "./eqrmss-character-creation-wizard-preview.js";
import { EQRMSSCharacterCreationWizardFinalizer } from "./eqrmss-character-creation-wizard-finalizer.js";
import { EQRMSSCharacterCreationRules, checkRaceClassCompatibility } from "./eqrmss-character-creation-wizard-rules.js";
import { getStatValueFromPoints, calculatePotentialStat } from "./eqrmss-character-creation-tables.js";
import { rmssStatBonus } from "../data/stats/rmss-stat-bonus.js";

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
      deityId: "",
      ownerUserId: game.userId,
      nationality: "",
      height: null,
      weight: null,
      tempPointPool: 655,
      statRolls: [],
      useFixedPotentials: false,
      stats: { ST: 50, AG: 50, CO: 50, ME: 50, RE: 50, SD: 50, QU: 50, EM: 50, IN: 50, PR: 50 },
      potentials: {},
      trainingPackages: []
    };
    this._initializeDefaultPotentials();
  }

  async _initializeDefaultPotentials() {
    for (const [key, val] of Object.entries(this.characterData.stats)) {
      if (this.characterData.potentials[key] === undefined) {
        this.characterData.potentials[key] = await calculatePotentialStat(val, this.characterData.useFixedPotentials);
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
      togglePotentials: EQRMSSCharacterCreationWizard._onToggleFixedPotentials,
      "toggle-potentials": EQRMSSCharacterCreationWizard._onToggleFixedPotentials,
      finish: EQRMSSCharacterCreationWizard._onCreateActor,
      nextStep: EQRMSSCharacterCreationWizard._onNextStep,
      prevStep: EQRMSSCharacterCreationWizard._onPrevStep,
      selectRace: EQRMSSCharacterCreationWizard._onSelectRace,
      selectClass: EQRMSSCharacterCreationWizard._onSelectClass,
      createActor: EQRMSSCharacterCreationWizard._onCreateActor
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
        potential = await calculatePotentialStat(val, selection.useFixedPotentials);
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

    return {
      ...context,
      ...dataContext,
      wizard: {
        step: this.currentStep,
        selection,
        steps: [
          { label: "Overview" }, { label: "Basic Info" }, { label: "Race" },
          { label: "Class" }, { label: "Origin" }, { label: "Stats" }, { label: "Review" }
        ]
      },
      selectedRace,
      selectedClass,
      classChoices,
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
      isLastStep: this.currentStep === 6
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const content = this.element.querySelector?.('.window-content') ?? this.element?.querySelector?.('.window');
    if (content && this._savedScrollTop !== undefined) {
      content.scrollTop = this._savedScrollTop;
    }

    const root = this.element instanceof HTMLElement ? this.element : this.element?.[0];
    if (!root) return;

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
          this.characterData.potentials[key] = await calculatePotentialStat(actualVal, this.characterData.useFixedPotentials);
        } else {
          this.characterData[key] = input.value;
        }

        if (key === "raceId" && this.characterData.classId) {
          const race = this.dataService?.getContext().races.find(item => (item.id ?? item._id) === input.value);
          const cls = this.dataService?.getContext().classes.find(item => (item.id ?? item._id) === this.characterData.classId);
          if (race && cls && !checkRaceClassCompatibility(race, cls)) this.characterData.classId = "";
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
        this.characterData.potentials[key] = await calculatePotentialStat(actualVal, this.characterData.useFixedPotentials);
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
      this.characterData.potentials[statKey] = await calculatePotentialStat(actualVal, this.characterData.useFixedPotentials);
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
      this.characterData.potentials[statKey] = await calculatePotentialStat(actualVal, this.characterData.useFixedPotentials);
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
      this.characterData.potentials[key] = await calculatePotentialStat(actualVal, this.characterData.useFixedPotentials);
    }

    ui.notifications.info("EQRMSS | Rolled and distributed all stats automatically.");
    this.render();
  }

  static async _onToggleFixedPotentials(event, target) {
    const content = this.element?.querySelector('.window-content');
    this._savedScrollTop = content ? content.scrollTop : 0;

    const isChecked = target.checked;
    this.characterData.useFixedPotentials = isChecked;
    for (const [key, val] of Object.entries(this.characterData.stats)) {
      this.characterData.potentials[key] = await calculatePotentialStat(val, isChecked);
    }
    this.render();
  }

  static async _onNextStep(event, target) {
    const form = target.form || target.closest("form") || target.closest(".eqrmss-character-creation-wizard");
    await this._saveCurrentStepData(form);

    if (this.currentStep < 6) {
      this.currentStep++;
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
    if (!Number.isInteger(step) || step < 0 || step > 6) return;
    await this._saveCurrentStepData(target.closest("form") || target.closest(".eqrmss-character-creation-wizard"));
    this.currentStep = step;
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
    this.characterData.potentials[stat] = await calculatePotentialStat(actualVal, this.characterData.useFixedPotentials);
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