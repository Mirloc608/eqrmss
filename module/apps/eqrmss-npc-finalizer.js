// ============================================================
// EQRMSS — NPC Quick-Build Finalizer (Stage 1)
//
// Builds generic NPCs: average stats, §3.8-style base hits by
// level, a fixed generic skill package, the class starter kit,
// and the class starter spells/songs.
//
// Detailed NPCs are built by the GM as full characters — this
// wizard intentionally stays shallow and fast.
// ============================================================

import { extractRacialModifiers } from "../utils/actor/rmss-stats.js";
import { rmssRankBonus } from "../data/skills/rmss-rank-bonus.js";
import { WEAPON_CATEGORIES, displayName } from "../development/dp-engine.js";

// Weapon template weaponType -> skill category key (dp-engine).
const WEAPON_TYPE_TO_SKILL = {
  "one-handed-edged": "oneHandedEdged",
  "one-handed-crushing": "oneHandedCrushing",
  "two-handed": "twoHanded",
  "missile": "bows",
  "thrown": "thrown",
  "polearm": "poleArms"
};

// Average stat line: temp 50 across the board (basic_bonus 0),
// racial modifiers applied on top — the quick-build "average".
const NPC_STAT_KEYS = ["ST", "AG", "SD", "CO", "ME", "RE", "IN", "PR", "QU", "EM"];
const NPC_TEMP = 50;

const NPC_SKILL_ICON = "systems/eqrmss/assets/Icons/game/skills.svg";

/** Resolve one record from a keyed object or an array. */
function resolveRecord(collection, id) {
  if (!collection || !id) return null;
  if (Array.isArray(collection)) {
    return collection.find(d => String(d?._id ?? d?.id ?? "") === String(id)) ?? null;
  }
  return collection[id] ?? null;
}

/** Race key matching module/data/races/base-hits.json ("dark-elf", …). */
function raceHitsKey(race) {
  const raw = String(race?.id ?? race?._id ?? "").toLowerCase().replace(/^eqrmss-/, "");
  if (raw) return raw;
  return String(race?.name ?? "").toLowerCase().trim().replace(/\s+/g, "-");
}

export class EQRMSSNPCFinalizer {

  constructor({ name = "", sex = "", raceId = "", classId = "", level = 1 } = {}) {
    this.name = String(name ?? "").trim();
    this.sex = String(sex ?? "");
    this.raceId = String(raceId ?? "");
    this.classId = String(classId ?? "");
    this.level = Math.min(125, Math.max(1, Math.floor(Number(level) || 1)));
    // Captured while granting the kit so the skill package can match
    // the NPC's actual weapon.
    this._kitWeaponType = "";
  }

  async finalize() {
    const race = resolveRecord(game?.eqrmss?.races, this.raceId);
    const cls = resolveRecord(game?.eqrmss?.classes, this.classId);

    if (!race || !cls) {
      ui.notifications.error("Race or class data is missing — cannot create NPC.");
      return null;
    }

    try {
      const stats = this.#buildStats(race);
      const baseHits = await this.#computeBaseHits(race);

      const actorData = {
        name: this.name || `Unnamed ${cls.name}`,
        type: "npc",
        system: {
          gender: this.sex,
          stats,
          hits: { base: baseHits, value: 0, stun: 0, bleeding: 0 },
          character: { level: this.level, experience: 0 },
          fixed_info: {
            race: race.name,
            profession: cls.name,
            sex: this.sex,
            realm: cls.realm ?? ""
          }
        },
        flags: {
          eqrmss: {
            createdByNPCWizard: true,
            raceId: race._id ?? race.id,
            classId: cls._id ?? cls.id,
            npcLevel: this.level
          }
        }
      };

      const actor = await Actor.create(actorData, { renderSheet: true });
      if (!actor) {
        ui.notifications.error("Failed to create NPC.");
        return null;
      }

      // Kit first: it captures the weapon type the skill package needs.
      // Every grant is fail-soft — none of them blocks creation.
      await this.#grantStarterKit(actor, cls, race);
      await this.#grantStartingSpells(actor, cls);
      await this.#grantSkillPackage(actor, cls);

      ui.notifications.info(`NPC "${actor.name}" created (level ${this.level} ${race.name} ${cls.name}).`);
      console.log("EQRMSS | NPC quick-build finalized", actor);
      return actor;
    }
    catch (error) {
      console.error("EQRMSS | NPC quick-build failed", error);
      ui.notifications.error(`NPC creation failed: ${error.message}`);
      return null;
    }
  }

  // ------------------------------------------------------------
  // STATS — average line: temp 50 / potential 50 + racial mods.
  // ------------------------------------------------------------

  #buildStats(race) {
    const modifiers = extractRacialModifiers(race);
    const stats = {};
    for (const key of NPC_STAT_KEYS) {
      const racialMod = Number(modifiers[key] ?? 0) || 0;
      stats[key] = {
        temp: NPC_TEMP,
        potential: NPC_TEMP,
        basic_bonus: Math.floor((NPC_TEMP - 50) / 5),
        racial_bonus: racialMod,
        special_bonus: 0,
        total: NPC_TEMP + racialMod
      };
    }
    return stats;
  }

  // ------------------------------------------------------------
  // HITS — §3.8 shape, quick-build version: ceil(temp CO / 10)
  // plus one average racial hit die per level, capped at the
  // racial maximum (base-hits.json). Total Hits derives on the
  // sheet from base + CO bonus.
  // ------------------------------------------------------------

  async #computeBaseHits(race) {
    let hitDie = 10;
    let maxBaseHits = 150;
    try {
      const resp = await fetch("systems/eqrmss/module/data/races/base-hits.json");
      if (resp.ok) {
        const rec = (await resp.json())?.races?.[raceHitsKey(race)];
        if (rec) {
          hitDie = Number(rec.hitDie) || 10;
          maxBaseHits = Number(rec.maxBaseHits) || 150;
        }
      }
    } catch { /* fall through to defaults */ }

    const dieAvg = hitDie / 2 + 0.5; // d8 -> 4.5, d10 -> 5.5
    const raw = Math.ceil(NPC_TEMP / 10) + this.level * dieAvg;
    return Math.min(maxBaseHits, Math.round(raw));
  }

  // ------------------------------------------------------------
  // SKILL PACKAGE — generic, ranks = level:
  //   kit weapon skill + Body Development + Perception.
  // ------------------------------------------------------------

  async #grantSkillPackage(actor, cls) {
    try {
      const level = this.level;
      const rankBonus = rmssRankBonus(level);
      const costs = await this.#classCosts(cls);
      const items = [];

      const pushSkill = (slug, category, cost) => {
        items.push({
          name: displayName(slug),
          type: "skill",
          img: NPC_SKILL_ICON,
          system: {
            slug,
            category,
            statsString: "",
            cost: cost ?? "",
            ranks: level,
            rankBonus,
            statBonus: 0,
            profBonus: 0,
            specialBonus: 0,
            bonus: rankBonus,
            favorite: false,
            description: `NPC quick-build (${level} rank${level === 1 ? "" : "s"}).`
          },
          flags: { eqrmss: { fromNPCWizard: true } }
        });
      };

      const weaponCat = WEAPON_TYPE_TO_SKILL[this._kitWeaponType];
      if (weaponCat) {
        const idx = WEAPON_CATEGORIES.indexOf(weaponCat);
        pushSkill(weaponCat, "Weapon", idx >= 0 ? costs.weaponCosts?.[idx] : "");
      }
      pushSkill("bodyDevelopment", "General", costs.specialSkills?.bodyDevelopment);
      pushSkill("perception", "General", costs.generalSkills?.perception);

      if (!items.length) return;
      await actor.createEmbeddedDocuments("Item", items);
      console.log(`EQRMSS | NPC quick-build | granted ${items.length} package skills`, items.map(i => i.name));
    } catch (error) {
      console.warn("EQRMSS | NPC quick-build | skill package grant failed (non-blocking)", error);
    }
  }

  async #classCosts(cls) {
    try {
      const key = String(cls?.id ?? cls?._id ?? "").toLowerCase();
      const resp = await fetch("systems/eqrmss/module/data/skills/class-development-costs.json");
      if (!resp.ok) return { generalSkills: {}, specialSkills: {}, weaponCosts: [] };
      const data = await resp.json();
      const c = data?.classes?.[key] ?? {};
      return {
        generalSkills: c.generalSkills ?? {},
        specialSkills: c.specialSkills ?? {},
        weaponCosts: c.weaponCosts ?? []
      };
    } catch {
      return { generalSkills: {}, specialSkills: {}, weaponCosts: [] };
    }
  }

  // ------------------------------------------------------------
  // STARTER KIT — adapted from the character finalizer: class
  // kit items (weapons composed at grant time), race overrides,
  // starting money. Records the kit weapon's weaponType for the
  // skill package. Fail-soft.
  // ------------------------------------------------------------

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
        console.warn(`EQRMSS | NPC quick-build | no starter kit for class "${key}"`);
        return;
      }

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
            category: null, rarity: "common", quality: "normal", weight: 0, value: 0,
            stackable: (entry.quantity ?? 1) > 1, quantity: entry.quantity ?? 1
          };
          system.consumable = {
            category: entry.category ?? "food",
            charges: entry.charges ?? 1,
            maxCharges: entry.charges ?? 1,
            consumeOnUse: true
          };
        }
        if (entry.type === "weapon" && entry.weaponTemplate) {
          const composed = this.#composeKitWeapon(entry);
          if (composed.weaponType) this._kitWeaponType = composed.weaponType;
          Object.assign(system, composed);
          delete system.weaponType; // internal only; the item keeps `type`
        }
        if (entry.type === "armor") {
          for (const k of ["at", "maneuverPenalty", "weight", "armorMaterial", "armorCondition", "notes"]) {
            if (entry[k] !== undefined) system[k] = entry[k];
          }
        }
        if (Object.keys(system).length) item.system = system;
        items.push(item);
      }

      if (items.length) {
        await actor.createEmbeddedDocuments("Item", items);
        console.log(`EQRMSS | NPC quick-build | granted starter kit (${key})`, items.map(i => i.name));
      }

      // Starting money: roll the kit's cp die (no wizard Equipment step).
      const money = kit.money ?? {};
      const gp = Number(money.gp) || 0;
      let cp = 0;
      if (typeof money.cp === "string" && money.cp.includes("d")) {
        try { cp = (await new Roll(money.cp).evaluate()).total ?? 0; }
        catch { cp = 0; }
      } else {
        cp = Number(money.cp) || 0;
      }
      await actor.update({
        "system.wealth": { pp: Number(money.pp) || 0, gp, sp: 0, cp }
      });
    } catch (error) {
      console.warn("EQRMSS | NPC quick-build | starter kit grant failed (non-blocking)", error);
    }
  }

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
        weaponType: composed.weaponType,
        weight: composed.weight,
        cost: composed.cost,
        prod_time: composed.prodTime,
        breakage_range: breakageStr,
        strength: composed.strength != null ? String(composed.strength) : "",
        fumble_range: composed.fumble,
        obMod: composed.obMod,
        damageMod: composed.damageMod
      };
      if (composed.attackTable != null) system.attackTable = composed.attackTable;
      if (composed.length != null) system.length = composed.length;
      if (composed.criticalType != null) system.criticalType = composed.criticalType;
      if (composed.notes != null) system.notes = composed.notes;
      return system;
    } catch (error) {
      console.warn("EQRMSS | NPC quick-build | kit weapon compose failed (non-blocking)", error);
      return {};
    }
  }

  // ------------------------------------------------------------
  // STARTER SPELLS/SONGS — the fixed class sets from
  // starting-spells.json. Fail-soft.
  // ------------------------------------------------------------

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
          console.warn(`EQRMSS | NPC quick-build | starting spell/song not found: "${name}" (${key})`);
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
        console.log(`EQRMSS | NPC quick-build | granted ${items.length} starting spell(s)/song(s)`, items.map(i => i.name));
      }
    } catch (error) {
      console.warn("EQRMSS | NPC quick-build | starting spell grant failed (non-blocking)", error);
    }
  }
}

/** Short human-readable summary line for one song effect record. */
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
