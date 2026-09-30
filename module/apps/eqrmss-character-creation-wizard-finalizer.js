// ============================================================
// EQRMSS — Character Creation Wizard Finalizer
// Part 4 — Final Actor Creation
// ============================================================

import { extractRacialModifiers } from "../utils/actor/rmss-stats.js";
import { rmssDevelopmentPoints } from "../data/stats/rmss-stat-bonus.js";
import { rmssRankBonus } from "../data/skills/rmss-rank-bonus.js";
import {
  WEAPON_CATEGORIES,
  totalRanks,
  displayName,
  buildSkillList
} from "../development/dp-engine.js";

/**
 * Format one song effect record into a short human-readable summary line
 * for display on the song item sheet.
 */
function songEffectSummary(e) {
  const base = e?.value?.base ?? e?.value;
  const plus = (typeof base === "number" && base > 0) ? "+" : "";
  const dur = e?.duration ? ` (${e.duration} rounds)` : "";
  const ot = e?.over_time ? ` over ${e.over_time.duration} rounds` : "";
  switch (e?.type) {
    case "modifier": return `${String(e.stat ?? "").toUpperCase()} ${plus}${base ?? ""}${dur}`.trim();
    case "damage": return `Damage ${plus}${base ?? ""}${e.element ? " " + e.element : ""}${ot}${e.condition ? " if " + e.condition : ""}`.trim();
    case "heal": return `Heal ${plus}${base ?? ""}${dur}`.trim();
    case "regen": return `Regen ${e.stat ?? ""} ${plus}${base ?? ""}${dur}`.trim();
    case "utility": return `Utility: ${e.effect ?? ""}`.trim();
    case "control": return `Control: ${e.condition ?? ""}${dur}`.trim();
    case "invisibility": return `Invisibility${e.variant ? " (" + e.variant + ")" : ""}`.trim();
    case "debuff": return `Debuff: ${e.effect ?? ""} ${plus}${base ?? ""}${dur}`.trim();
    case "cure": return `Cure: ${e.effect ?? ""}`.trim();
    case "summon": return `Summon: ${e.pet ?? e.effect ?? ""}`.trim();
    default: return String(e?.type ?? "effect");
  }
}

export class EQRMSSCharacterCreationWizardFinalizer {

  constructor(wizardState = {}, context = {}) {
    this.state = wizardState;
    this.context = context;
  }

  async finalize() {
    const race = this.#resolve(this.context.races, this.state.raceId);
    const cls = this.#resolve(this.context.classes, this.state.classId);
    const deity = this.#resolve(this.context.deities, this.state.deityId);

    // Resolve origin: prefer hierarchical originId, fall back to legacy cityId
    // Origin can be a city (with full game data) or a settlement (smaller location)
    const originId = this.state.originId || this.state.cityId;
    let city = this.#resolve(this.context.cities, originId);
    let settlement = null;

    if (!city) {
      // Try settlements
      settlement = (this.context.settlements ?? []).find(s => s.id === originId);
    }

    if (!race || !cls) {
      ui.notifications.error("Race or profession data is missing — cannot finalize character.");
      return null;
    }

    if (!city && !settlement) {
      ui.notifications.error("Origin data is missing — cannot finalize character.");
      return null;
    }

    // For settlements, find the parent city for game mechanics (or use settlement data)
    // For now, use the settlement name as home_town and pass settlement data
    const originData = city ?? settlement;
    const actorData = this.#buildActorData(race, cls, originData, deity, settlement);

    try {
      const actor = await Actor.create(actorData, { renderSheet: true });

      if (!actor) {
        ui.notifications.error("Failed to create EQRMSS character.");
        return null;
      }

      ui.notifications.info(`Character "${actor.name}" created successfully.`);
      console.log("EQRMSS | Character finalized", actor);

      // Grant the locked starting spells/songs (fixed sets from
      // module/data/spells/starting-spells.json). Fail-soft: never blocks
      // creation.
      await this.#grantStartingSpells(actor, cls);

      // Grant the class starter kit (equipment + starting money) from
      // module/data/starter-kits.json. Fail-soft: never blocks creation.
      await this.#grantStarterKit(actor, cls, race);

      // Grant buy-list purchases from the wizard's Equipment step and
      // deduct them from starting wealth. Fail-soft: never blocks creation.
      await this.#grantPurchases(actor);

      // Grant skills developed in the wizard's two-pass DP system
      // (adolescence + apprenticeship). Fail-soft: never blocks creation.
      await this.#grantDevelopedSkills(actor, cls);

      return actor;
    }
    catch (error) {
      console.error("EQRMSS | Character creation failed", error);
      ui.notifications.error(`Character creation failed: ${error.message}`);
      return null;
    }
  }

  #buildActorData(race, cls, city, deity, settlement = null) {
    const rawStats = this.state.stats || {};
    const rawPotentials = this.state.potentials || {};
    
        const finalStats = {};
    // Canonical, case-insensitive racial modifier lookup. Race JSONs use
    // "St"/"Ag"/… while the wizard uses "ST"/"AG"/…; raw bracket lookups
    // previously resolved every modifier to 0.
    const modifiers = extractRacialModifiers(race);

    for (const [key, tempVal] of Object.entries(rawStats)) {
      const potentialVal = rawPotentials[key] ?? tempVal;

      const racialMod = modifiers[key] ?? 0;

      const totalVal = Number(tempVal) + racialMod;

      finalStats[key] = {
        temp: Number(tempVal),
        potential: Number(potentialVal),
        basic_bonus: 0,
        racial_bonus: racialMod,
        special_bonus: 0,
        total: totalVal
      };
    }

    const charName = this.state.name?.trim() || "Unnamed Character";
    const raceName = race.name;
    const professionName = cls.name;
    const realm = cls.system?.realm || cls.realm || "Standard";

                return {
      name: charName,
      type: "character",

      // Ownership: the selected player owns the character (see #buildOwnership)
      ownership: this.#buildOwnership(),

            system: {
              name: charName,
              // Displayed in the sheet header "Player" field
              playerName: game.users.get(this.#resolveOwnerId())?.name ?? "",
              gender: this.state.gender || null,

        // Canonical stat schema consumed by eqrmss_actor._ensureSystemData()
        // and the sheet context helper. Previously this lived under
        // system.data.stats / system.attributes, which nothing read.
        stats: finalStats,

        // _ensureSystemData() backfills fixed_info (race/profession/city/
        // deity names) from this record automatically.
        origin: {
          raceId: String(race.id ?? race._id ?? ""),
          raceName,
          classId: String(cls.id ?? cls._id ?? ""),
          className: professionName,
          cityName: city.name,
          deityName: deity?.name ?? "",
          // Hierarchical origin data
          continentId: this.state.continentId ?? "",
          regionId: this.state.regionId ?? "",
          originId: this.state.originId ?? this.state.cityId ?? "",
          originType: settlement ? "settlement" : "city",
          settlementName: settlement?.name ?? null
        },

        character: {
          level: 1,
          experience: 0,
          developmentPoints: Number(this.state.devPoints) || 0
        },

        attributes: {
          hp: { value: 0, max: 0 },
          mana: { value: 0, max: 0 }
        },

        // RMSS §3.8: Base Hit Point Total starts at ceil(temp CO / 10),
        // plus 1d(racial hit die) per Body Development rank bought in the
        // wizard's Skills step, capped at the racial maximum (Table
        // 15.5.1). The sheet derives the running total from base + CO bonus.
        hits: {
          base: this.#computeBaseHits(finalStats, race),
          value: 0,
          stun: 0,
          bleeding: 0
        },

        // Two-pass DP development history (RMSS §16.4 / §10.5). The
        // weapon assignment is permanent; per-pass ranks/spent/rolls are
        // kept for audit and future level-up cost progression.
        development: this.#buildDevelopmentRecord(finalStats),

                fixed_info: {
          realm: realm,
          training_packages: (this.state.trainingPackages ?? []).join(", "),
          nationality: this.state.nationality ?? ""
        },

                background: {
          home_town: city.name,
          deity: deity?.name ?? "",
          nationality: this.state.nationality ?? "",
          // RMSS §7: background notes from the wizard's Background step.
          // §7.1 special abilities/equipment are GM-assigned; captured here
          // as notes only — no mechanics are derived from them.
          history: this.state.background?.history ?? "",
          family_notes: this.state.background?.family_notes ?? "",
          experiences: this.state.background?.experiences ?? "",
          parents: this.state.background?.parents ?? "",
          spouse: this.state.background?.spouse ?? "",
          children: this.state.background?.children ?? "",
          special_abilities: this.state.background?.special_abilities ?? "",
          special_equipment: this.state.background?.special_equipment ?? ""
        },

        physical: {
          height: Number(this.state.height) || null,
          weight: Number(this.state.weight) || null
        }
      },
      flags: {
        eqrmss: {
          createdByWizard: true,
          raceId: race._id ?? race.id,
          classId: cls._id ?? cls.id,
          cityId: city._id ?? city.id,
          deityId: deity?._id ?? deity?.id ?? null,
          ownerUserId: this.state.ownerUserId ?? game.userId
        }
      }
    };
  }

  // ------------------------------------------------------------
  // SKILLS STEP PERSISTENCE
  //
  // #computeBaseHits: RMSS §3.8 — ceil(temp CO / 10) plus the stored
  // Body Development d(racial hit die) rolls, capped at the racial
  // maximum BHPT (Table 15.5.1, via dataContext.baseHits).
  //
  // #buildDevelopmentRecord: the two-pass history for audit and for
  // future level-up cost progression (weapon assignment is permanent).
  //
  // #grantDevelopedSkills: creates one skill Item per developed
  // development area (total ranks > 0), mirroring the
  // #grantStartingSpells pattern. Fail-soft: never blocks creation.
  // ------------------------------------------------------------

  #computeBaseHits(finalStats, race) {
    const tempCo = Number(finalStats?.CO?.temp ?? 0);
    let base = Math.ceil(tempCo / 10);
    const dev = this.state?.development;
    if (dev) {
      for (const passKey of ["adolescence", "apprenticeship"]) {
        for (const roll of dev[passKey]?.bodyDevRolls ?? []) {
          base += Number(roll) || 0;
        }
      }
    }
    const raceKey = String(race?.key ?? race?.id ?? race?._id ?? "").toLowerCase();
    const max = this.context?.baseHits?.[raceKey]?.maxBaseHits;
    if (Number.isFinite(max) && base > max) base = max;
    return base;
  }

  #buildDevelopmentRecord(finalStats) {
    const dev = this.state?.development ?? {};
    const stats = {};
    for (const [k, v] of Object.entries(finalStats ?? {})) stats[k] = Number(v?.temp ?? 0);
    // rmssDevelopmentPoints expects {Co, Ag, SD, Me, Re}.
    const dpPool = rmssDevelopmentPoints({
      Co: stats.CO ?? 0, Ag: stats.AG ?? 0, SD: stats.SD ?? 0,
      Me: stats.ME ?? 0, Re: stats.RE ?? 0
    });
    const passRecord = (p = {}) => ({
      dpPool,
      spent: Number(p.spent) || 0,
      ranks: { ...(p.ranks ?? {}) },
      bodyDevRolls: [...(p.bodyDevRolls ?? [])]
    });
    return {
      dpPool,
      weaponAssignment: { ...(dev.adolescence?.weaponAssignment ?? {}) },
      adolescence: passRecord(dev.adolescence),
      apprenticeship: passRecord(dev.apprenticeship)
    };
  }

  async #grantDevelopedSkills(actor, cls) {
    try {
      const dev = this.state?.development;
      if (!dev) return;
      const key = String(cls?.id ?? cls?._id ?? "").toLowerCase();
      const classCosts = this.context?.developmentCosts?.classes?.[key];
      if (!classCosts) return;

      const ado = dev.adolescence ?? {};
      const app = dev.apprenticeship ?? {};
      const items = [];

      const pushSkill = (skillKey, name, category, costStr) => {
        const total = totalRanks(ado, app, skillKey);
        if (total <= 0) return;
        const rankBonus = rmssRankBonus(total);
        items.push({
          name,
          type: "skill",
          img: "systems/eqrmss/assets/Icons/game/skills.svg",
          system: {
            slug: skillKey,
            category,
            statsString: "",
            cost: costStr,
            ranks: total,
            rankBonus,
            statBonus: 0,
            profBonus: 0,
            specialBonus: 0,
            bonus: rankBonus,
            favorite: false,
            description: `Developed during character creation (${total} rank${total === 1 ? "" : "s"}).`
          },
          flags: {
            eqrmss: {
              fromWizardDevelopment: true,
              adolescenceRanks: ado.ranks?.[skillKey] ?? 0,
              apprenticeshipRanks: app.ranks?.[skillKey] ?? 0
            }
          }
        });
      };

      // Weapon categories use the permanent adolescence assignment
      // (player mode) or the fixed table (berserker).
      const assignment = dev.adolescence?.weaponAssignment ?? {};
      for (const cat of WEAPON_CATEGORIES) {
        const costStr = classCosts.weaponAssignment === "fixed"
          ? String(classCosts.weaponCosts?.[cat] ?? "")
          : String(assignment[cat] ?? "");
        if (costStr) pushSkill(cat, displayName(cat), "Weapon", costStr);
      }

      // Non-weapon development areas (spell lists excluded by ruling).
      for (const entry of buildSkillList(classCosts)) {
        const groupName = { general: "General", magical: "Magical", maneuvering: "Maneuvering", special: "Special" }[entry.group] ?? entry.group;
        pushSkill(entry.key, entry.name, groupName, entry.cost);
      }

      if (!items.length) return;
      await actor.createEmbeddedDocuments("Item", items);
      console.log(`EQRMSS | Finalizer | granted ${items.length} developed skills`);
    } catch (error) {
      console.warn("EQRMSS | Finalizer | developed-skill grant failed (non-blocking)", error);
    }
  }

    #resolve(collection = [], id) {
    return collection.find(
      document => document?._id === id || document?.id === id
    );
  }

  // ============================================================
  // OWNERSHIP
  //
  // GMs may assign the new character to any user via the wizard's
  // Review-step dropdown (state.ownerUserId). Players always own
  // their own creation. Falls back safely when the chosen id is
  // stale, invalid, or belongs to a non-player account.
  // ============================================================

    #buildOwnership() {
    const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const requested = this.state?.ownerUserId;
    const isGM = game.user.isGM;

    let ownerId = game.userId;

    if (isGM && requested) {
      const target = game.users.get(requested);
      if (target && !target.isGM) ownerId = target.id;
    }

    return {
      // Respect the world's default player permission when the core
      // setting exists; otherwise fall back to OBSERVER silently.
      // (Some Foundry versions do not register defaultActorOwnership.)
      default: this.#worldDefaultPlayerLevel(),
      [ownerId]: LEVELS.OWNER
    };
  }

  #worldDefaultPlayerLevel() {
    const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    try {
      const value = game.settings.get("core", "defaultActorOwnership");
      return (
        foundry.utils.getProperty(value ?? {}, "player") ??
        LEVELS.OBSERVER
      );
        } catch {
      return LEVELS.OBSERVER;
    }
  }

  /** The user id that will own the new actor (mirrors #buildOwnership logic). */
  #resolveOwnerId() {
    if (game.user.isGM) {
      const requested = this.state?.ownerUserId;
      const target = requested ? game.users.get(requested) : null;
      if (target && !target.isGM) return target.id;
    }
    return game.userId;
  }

  /**
   * Grant the locked starting spells/songs as lightweight embedded Item
   * documents, following the codebase's reference-item convention
   * (progression rewards / song unlock engine): name + type, details
   * resolved by name from the loaders at render time. Fail-soft: a
   * missing spell/song is skipped with a warning; creation never blocks.
   */
  async #grantStartingSpells(actor, cls) {
    try {
      const key = String(cls?.id ?? cls?._id ?? "").toLowerCase();
      if (!key) return;

      let names = [];
      try {
        const resp = await fetch("systems/eqrmss/module/data/spells/starting-spells.json");
        if (resp.ok) names = (await resp.json())[key] ?? [];
      } catch { /* fall through */ }

      if (!names.length) return;

      const spellPool = game?.eqrmss?.spells?.[key] ?? [];
      const songPool = CONFIG?.EQRMSS?.songs ?? [];
      const items = [];

      for (const name of names) {
        const doc =
          spellPool.find(s => s?.name === name) ??
          songPool.find(s => s?.name === name);
        if (!doc) {
          console.warn(`EQRMSS | Finalizer | starting spell/song not found: "${name}" (${key})`);
          continue;
        }
        if (doc.type === "song") {
          const perf = doc.performance ?? {};
          const targ = doc.targeting ?? {};
          const stack = doc.stacking ?? {};
          items.push({
            name: doc.name,
            type: "song",
            img: doc.img ?? "systems/eqrmss/assets/Icons/game/musical-notes.svg",
            system: {
              level: doc.level_required ?? 1,
              active: false,
              favorite: false,
              description: doc.description ?? "",
              activation: perf.activation ?? "",
              maintained: !!perf.maintained,
              pulse: perf.pulse_interval ?? "",
              targetType: targ.type ?? "",
              range: targ.range ?? "",
              targets: targ.targets ?? "",
              stacking: stack.group ?? "",
              effectsSummary: (doc.effects ?? []).map(songEffectSummary)
            }
          });
        } else {
          items.push({
            name: doc.name,
            type: "spell",
            img: doc.img ?? "icons/svg/book.svg",
            system: {
              rank: 1,
              favorite: false,
              memorized: false,
              spell_list: (doc.system ?? {}).class ?? "",
              level: (doc.system ?? {}).level ?? 1,
              area_of_effect: (doc.system ?? {}).radius ?? "",
              duration: (doc.system ?? {}).duration ?? "",
              range: (doc.system ?? {}).range ?? "",
              type: (doc.system ?? {}).school ?? "",
              description: (doc.system ?? {}).description ?? "",
              castTime: (doc.system ?? {}).castTime ?? "",
              manaCost: (doc.system ?? {}).manaCost ?? "",
              target: (doc.system ?? {}).target ?? "",
              resist: (doc.system ?? {}).resist ?? ""
            }
          });
        }
      }

      if (items.length) {
        await actor.createEmbeddedDocuments("Item", items);
        console.log(`EQRMSS | Finalizer | granted ${items.length} starting spell(s)/song(s)`, items.map(i => i.name));
      }
    } catch (error) {
      console.warn("EQRMSS | Finalizer | starting spell grant failed (non-fatal)", error);
    }
  }

  /**
   * Grant the class starter kit (equipment + starting money) from
   * module/data/starter-kits.json. Mirrors #grantStartingSpells:
   * lightweight embedded Item documents, fail-soft, never blocks creation.
   *
   * Race overrides apply after the class kit (e.g. any ogre character's
   * chest piece becomes the Worn Hide Tunic). Money gp is fixed per kit;
   * the cp die (e.g. "1d100") is rolled here.
   */
  async #grantStarterKit(actor, cls, race) {
    try {
      const key = String(cls?.id ?? cls?._id ?? "").toLowerCase();
      if (!key) return;

      let data = {};
      try {
        const resp = await fetch("systems/eqrmss/module/data/starter-kits.json");
        if (resp.ok) data = await resp.json();
      } catch { /* fall through */ }

      const kit = data[key];
      if (!kit) {
        console.warn(`EQRMSS | Finalizer | no starter kit for class "${key}"`);
        return;
      }

      // Race key: race JSON ids look like "eqrmss-ogre"; fall back to the name.
      const raceKey =
        String(race?.id ?? race?._id ?? "").toLowerCase().replace(/^eqrmss-/, "") ||
        String(race?.name ?? "").toLowerCase();
      const overrides = (data.raceOverrides ?? {})[raceKey] ?? {};

      const items = [];
      for (const entry of kit.items ?? []) {
        const name = (entry.slot && overrides[entry.slot]) || entry.name;
        const item = { name, type: entry.type };
        const system = {};
        if (entry.slot) system.slot = entry.slot;
        if (entry.equipped) system.equipped = true;
        if (entry.type === "consumable") {
          system.item = {
            category: null,
            rarity: "common",
            quality: "normal",
            weight: 0,
            value: 0,
            stackable: (entry.quantity ?? 1) > 1,
            quantity: entry.quantity ?? 1
          };
          system.consumable = {
            category: entry.category ?? "food",
            charges: entry.charges ?? 1,
            maxCharges: entry.charges ?? 1,
            consumeOnUse: true
          };
        }
        if (entry.type === "weapon" && entry.weaponTemplate) {
          // Compose the kit weapon now so it carries real stats immediately
          // (same bake the weapon sheet performs on recompose). Fail-soft.
          Object.assign(system, this.#composeKitWeapon(entry));
        }
        if (Object.keys(system).length) item.system = system;
        items.push(item);
      }

      if (items.length) {
        await actor.createEmbeddedDocuments("Item", items);
        console.log(`EQRMSS | Finalizer | granted starter kit (${key})`, items.map(i => i.name));
      }

      // Starting money: prefer the wizard's Equipment-step roll
      // (state.equipment); fall back to rolling the kit's cp die here
      // when the step was skipped.
      const eqMoney = this.state?.equipment;
      let gp = 0;
      let cp = 0;
      if (eqMoney?.moneyRolled) {
        gp = Number(eqMoney.gp) || 0;
        cp = Number(eqMoney.cp) || 0;
        console.log(`EQRMSS | Finalizer | starting money (wizard roll): ${gp} gp + ${cp} cp`);
      } else {
        const money = kit.money ?? {};
        gp = Number(money.gp) || 0;
        if (typeof money.cp === "string" && money.cp.includes("d")) {
          try {
            cp = (await new Roll(money.cp).evaluate()).total ?? 0;
          } catch {
            cp = 0;
          }
        } else {
          cp = Number(money.cp) || 0;
        }
        console.log(`EQRMSS | Finalizer | starting money: ${gp} gp + ${cp} cp`);
      }
      // Stash the pre-purchase total (in bp) so #grantPurchases can deduct.
      this._startingWealthBp = gp * 100 + cp;
      await actor.update({
        "system.wealth": {
          pp: Number(kit.money?.pp) || 0,
          gp,
          sp: 0,
          cp
        }
      });
    } catch (error) {
      console.warn("EQRMSS | Finalizer | starter kit grant failed (non-fatal)", error);
    }
  }

  /**
   * Compose a kit weapon (template + material + condition) at grant time so
   * the item carries real stats immediately. Mirrors the bake the weapon
   * sheet performs in _recomposeWeapon. Fail-soft: returns {} when the
   * composer is unavailable or the combination is invalid, leaving the
   * weapon as a bare name+type for the GM to compose by hand.
   */
  #composeKitWeapon(entry) {
    try {
      const weapons = game.eqrmss?.weapons;
      if (!weapons?.compose) return {};
      const composed = weapons.compose(
        entry.weaponTemplate,
        entry.material ?? "steel",
        entry.condition ?? "normal"
      );
      const breakageStr = composed.breakage
        ? composed.breakage.join("-") +
          (composed.breakageMod ? ` (${composed.breakageMod >= 0 ? "+" : ""}${composed.breakageMod})` : "")
        : "";
      const system = {
        weaponTemplate: composed.templateId,
        material: composed.materialId,
        condition: composed.conditionId,
        type: composed.weaponType,
        weight: composed.weight,
        cost: composed.cost,
        prod_time: composed.prodTime,
        breakage_range: breakageStr,
        strength: composed.strength != null ? String(composed.strength) : "",
        fumble_range: composed.fumble,
        obMod: composed.obMod,
        damageMod: composed.damageMod
      };
      // Only take attack table / length / crit type when the template
      // provides one, matching the sheet's recompose behavior.
      if (composed.attackTable != null) system.attackTable = composed.attackTable;
      if (composed.length != null) system.length = composed.length;
      if (composed.criticalType != null) system.criticalType = composed.criticalType;
      if (composed.notes != null) system.notes = composed.notes;
      return system;
    } catch (error) {
      console.warn("EQRMSS | Finalizer | kit weapon compose failed (non-fatal)", error);
      return {};
    }
  }

  /**
   * Grant Equipment-step buy-list purchases and deduct their cost from
   * starting wealth, leaving the remainder as gp/sp/cp. Fail-soft:
   * never blocks creation.
   */
  async #grantPurchases(actor) {
    try {
      const purchases = this.state?.equipment?.purchases ?? {};
      const ids = Object.entries(purchases).filter(([, qty]) => qty > 0);
      if (!ids.length) return;

      let buyList = { items: [] };
      try {
        const resp = await fetch("systems/eqrmss/module/data/starter-buy-list.json");
        if (resp.ok) buyList = await resp.json();
      } catch { /* fall through */ }

      const items = [];
      let spentBp = 0;
      for (const [id, qty] of ids) {
        const entry = (buyList.items ?? []).find(i => i.id === id);
        if (!entry) continue;
        spentBp += this.#parseCostToBp(entry.cost) * qty;
        for (let n = 0; n < qty; n++) items.push(this.#buyListItemToDoc(entry));
      }

      if (items.length) {
        await actor.createEmbeddedDocuments("Item", items);
        console.log(`EQRMSS | Finalizer | granted ${items.length} purchased items`, items.map(i => i.name));
      }

      const startBp = this._startingWealthBp
        ?? ((Number(this.state?.equipment?.gp) || 0) * 100 + (Number(this.state?.equipment?.cp) || 0));
      const remainingBp = Math.max(0, startBp - spentBp);
      const gp = Math.floor(remainingBp / 100);
      const sp = Math.floor((remainingBp % 100) / 10);
      const cp = remainingBp % 10;
      await actor.update({ "system.wealth": { pp: 0, gp, sp, cp } });
      console.log(`EQRMSS | Finalizer | wealth after purchases: ${gp}gp ${sp}sp ${cp}cp (spent ${spentBp}bp)`);
    } catch (error) {
      console.warn("EQRMSS | Finalizer | purchase grant failed (non-fatal)", error);
    }
  }

  #parseCostToBp(str) {
    const m = /^\s*([\d.]+)\s*(bp|sp|gp|cp|pp|tp)?\s*$/i.exec(str ?? "");
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const unit = (m[2] ?? "bp").toLowerCase();
    if (unit === "sp") return n * 10;
    if (unit === "gp") return n * 100;
    if (unit === "pp") return n * 1000;
    return n;
  }

  #buyListItemToDoc(entry) {
    const doc = { name: entry.name, type: entry.type ?? "item" };
    const system = {};
    const weight = parseFloat(entry.weight);
    if (Number.isFinite(weight)) system.weight = weight;
    // Carry the buy-list data onto the item so the sheet shows it.
    if (entry.cost) system.cost = String(entry.cost);
    if (entry.notes) system.description = String(entry.notes);
    system.quantity = 1;
    if (doc.type === "consumable") {
      system.item = {
        category: null,
        rarity: "common",
        quality: "normal",
        weight: Number.isFinite(weight) ? weight : 0,
        value: 0,
        stackable: false,
        quantity: 1
      };
      system.consumable = {
        category: entry.consumableCategory ?? "food",
        charges: entry.charges ?? 1,
        maxCharges: entry.charges ?? 1,
        consumeOnUse: true
      };
    }
    if (Object.keys(system).length) doc.system = system;
    return doc;
  }
}

console.log("EQRMSS | Character Creation Finalizer loaded");