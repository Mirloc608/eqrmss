// ============================================================
// EQRMSS — NPC Finalizer (2026-10-20 rework: DP simulation)
//
// Builds NPCs with the SAME rules as a PC (user rulings,
// 2026-10-20), replacing the old one-shot average model:
//   Step 1 — race: level-1 template (temps at the average,
//     potentials rolled, chart rows for chart animals).
//   Step 2 — role (Striker/Defender/Caster/Healer, bought at
//     role-mapped profession costs) or PC class (bought at the
//     class's own costs, class purchase profile), plus target
//     level: npc-build-engine.js simulates level-by-level stat
//     gains + DP purchases; Body Development rolls grow base
//     hits to the racial cap (§3.8).
//   Step 3 — special attacks: one pick per 10-level band,
//     recorded on the actor (mechanics land with the PEQ menu
//     data); casting builds get curated per-band spell packages
//     instead of the full class catalog (user ruling B).
//
// Grants stay fail-soft: kit (mapped/actual class), band spell
// packages (starter sets as fallback), sim skills, and the
// natural-weapon attack package for non-sentients.
// ============================================================

import { extractRacialModifiers } from "../utils/actor/rmss-stats.js";
import { rmssRankBonus } from "../data/skills/rmss-rank-bonus.js";
import { displayName } from "../development/dp-engine.js";
import { simulateBuild, profileFor, buildCasts, spellClassFor, ROLE_PROFILES } from "./npc-build-engine.js";

// Weapon template weaponType -> weapon priority key (build engine).
const WEAPON_TYPE_TO_CATEGORY = {
  "one-handed-edged": "oneHandedEdged",
  "one-handed-crushing": "oneHandedCrushing",
  "two-handed": "twoHanded",
  "missile": "bows",
  "thrown": "thrown",
  "polearm": "poleArms"
};

const NPC_SKILL_ICON = "systems/eqrmss/assets/Icons/game/skills.svg";

/** Resolve one record from a keyed object or an array.
 *  Prefers the collection key, then scans records by _id/id/key/name
 *  (case-insensitive) so internal ids ("eqrmss-human") still resolve. */
function resolveRecord(collection, id) {
  if (!collection || id == null || id === "") return null;
  const sid = String(id);
  if (Array.isArray(collection)) {
    return collection.find(d =>
      [d?._id, d?.id, d?.key, d?.name].filter(v => v != null).map(String).includes(sid)
    ) ?? null;
  }
  if (collection[sid]) return collection[sid];
  const low = sid.toLowerCase();
  for (const r of Object.values(collection)) {
    if (!r) continue;
    const candidates = [r._id, r.id, r.key, r.name].filter(v => v != null).map(String);
    if (candidates.includes(sid) || candidates.some(c => c.toLowerCase() === low)) return r;
  }
  return null;
}

/** Race key matching module/data/races/base-hits.json ("dark-elf", …). */
function raceHitsKey(race) {
  const raw = String(race?.id ?? race?._id ?? "").toLowerCase().replace(/^eqrmss-/, "");
  if (raw) return raw;
  return String(race?.name ?? "").toLowerCase().trim().replace(/\s+/g, "-");
}

async function fetchJson(path) {
  try {
    const resp = await fetch(path);
    if (resp.ok) return await resp.json();
  } catch { /* fail-soft */ }
  return null;
}

export class EQRMSSNPCFinalizer {

  constructor({ name = "", sex = "", raceId = "", classId = "", level = 1, creatureType = "sentient",
                buildMode = "", role = "", specialPicks = [] } = {}) {
    this.name = String(name ?? "").trim();
    this.sex = String(sex ?? "");
    this.raceId = String(raceId ?? "");
    this.classId = String(classId ?? "");
    this.level = Math.min(130, Math.max(1, Math.floor(Number(level) || 1)));
    this.creatureType = String(creatureType ?? "sentient").toLowerCase();
    // Build mode: explicit, else class when a class was picked.
    this.buildMode = buildMode ? String(buildMode).toLowerCase()
      : (this.classId ? "class" : "role");
    this.role = String(role ?? "striker").toLowerCase();
    this.specialPicks = Array.isArray(specialPicks) ? specialPicks.filter(Boolean).map(String) : [];
    this._kitWeaponType = "";
  }

  async finalize() {
    const race = resolveRecord(game?.eqrmss?.races, this.raceId);
    const classMode = this.buildMode === "class";
    const cls = classMode && this.classId
      ? resolveRecord(game?.eqrmss?.classes, this.classId) : null;

    if (!race || (classMode && this.classId && !cls)) {
      ui.notifications.error("Race or class data is missing — cannot create NPC.");
      return null;
    }

    try {
      const spec = { buildMode: this.buildMode, role: this.role, classId: this.classId };
      const profile = profileFor(spec);
      // The class whose costs/kit/spells this build uses: the real
      // class in class mode, the role-mapped profession otherwise.
      const effectiveClassId = classMode ? this.classId : profile.costsClass;
      const effectiveCls = cls ?? resolveRecord(game?.eqrmss?.classes, effectiveClassId);

      const costsData = await fetchJson("systems/eqrmss/module/data/skills/class-development-costs.json");
      const costs = costsData?.classes?.[profile.costsClass] ?? {};

      const hitsRec = await this.#raceHitsRecord(race);

      // Kit weapon category must be known before the sim spends DP.
      const weaponKey = await this.#resolveWeaponKey(effectiveClassId, race);

      const sim = simulateBuild({
        race,
        hitDie: hitsRec.hitDie,
        maxBaseHits: hitsRec.maxBaseHits,
        costs,
        profile,
        weaponKey,
        targetLevel: this.level
      });

      const stats = this.#buildStats(race, sim);
      const buildLabel = classMode
        ? (cls?.name ?? this.classId)
        : `${ROLE_PROFILES[this.role]?.name ?? this.role} (${effectiveCls?.name ?? profile.costsClass})`;

      const actorData = {
        name: this.name || `Unnamed ${buildLabel} ${race.name}`,
        type: "npc",
        system: {
          gender: this.sex,
          stats,
          hits: { base: sim.baseHits, value: 0, stun: 0, bleeding: 0 },
          character: { level: this.level, experience: 0, developmentPoints: sim.dpLeftover },
          attributes: { level: { value: this.level } },
          origin: { classId: effectiveClassId },
          fixed_info: {
            race: race.name,
            profession: effectiveCls?.name ?? "",
            sex: this.sex,
            realm: effectiveCls?.realm ?? ""
          },
          details: { creatureType: this.creatureType }
        },
        flags: {
          eqrmss: {
            createdByNPCWizard: true,
            raceId: race._id ?? race.id,
            classId: effectiveCls?._id ?? effectiveCls?.id ?? null,
            creatureType: this.creatureType,
            npcLevel: this.level,
            npcBuild: {
              mode: this.buildMode,
              role: classMode ? null : this.role,
              costsClass: profile.costsClass,
              specialAttacks: this.specialPicks
            },
            // Chart defenses/size/MS/AQ: the defense derivation applies
            // chart AT/DB from these flags on every actor prepare.
            ...(race.chart ? { chartStats: {
              size: race.chart.size ?? null,
              at: race.chart.at ?? null,
              db: race.chart.db ?? null,
              ms: race.chart.ms ?? null,
              aq: race.chart.aq ?? null
            } } : {})
          }
        }
      };

      const actor = await Actor.create(actorData, { renderSheet: true });
      if (!actor) {
        ui.notifications.error("Failed to create NPC.");
        return null;
      }

      // Kit first: it captures the weapon type (already resolved
      // for the sim; the grant composes the same kit).
      await this.#grantStarterKit(actor, effectiveCls, race, effectiveClassId);
      if (buildCasts(spec)) {
        const granted = await this.#grantBandSpells(actor, spellClassFor(spec));
        if (!granted && effectiveCls) await this.#grantStartingSpells(actor, effectiveCls, effectiveClassId);
      } else if (effectiveCls && classMode) {
        await this.#grantStartingSpells(actor, effectiveCls, effectiveClassId);
      }
      await this.#grantSimSkills(actor, sim);
      await this.#grantSpecialAttacks(actor);
      if (this.creatureType !== "sentient") {
        await this.#grantAttackPackage(actor, race);
      }

      ui.notifications.info(`NPC "${actor.name}" created (level ${this.level} ${race.name} ${buildLabel}, ${sim.baseHits} base hits, ${sim.dpLeftover} DP unspent).`);
      console.log("EQRMSS | NPC build finalized", { actor, sim });
      return actor;
    }
    catch (error) {
      console.error("EQRMSS | NPC build failed", error);
      ui.notifications.error(`NPC creation failed: ${error.message}`);
      return null;
    }
  }

  // ------------------------------------------------------------
  // STATS — sim temps/potentials + racial modifiers, in the
  // actor shape the derived-values pipeline reads (total/temp).
  // ------------------------------------------------------------

  #buildStats(race, sim) {
    const modifiers = extractRacialModifiers(race);
    const stats = {};
    for (const [key, s] of Object.entries(sim.stats)) {
      const racialMod = Number(modifiers[key] ?? 0) || 0;
      stats[key] = {
        temp: s.temp,
        potential: s.potential,
        basic_bonus: Math.floor((s.temp - 50) / 5),
        racial_bonus: racialMod,
        special_bonus: 0,
        total: s.temp + racialMod
      };
    }
    return stats;
  }

  /** Racial hit die + base-hits cap (base-hits.json), defaults d10/150. */
  async #raceHitsRecord(race) {
    const data = await fetchJson("systems/eqrmss/module/data/races/base-hits.json");
    const rec = data?.races?.[raceHitsKey(race)];
    return {
      hitDie: Number(rec?.hitDie) || 10,
      maxBaseHits: Number(rec?.maxBaseHits) || 150
    };
  }

  /** Resolve the kit weapon's category for the sim's weapon
   *  priority (sentients with a kit only). Returns "weapon:<cat>". */
  async #resolveWeaponKey(kitClassId, race) {
    if (this.creatureType !== "sentient" || !kitClassId) return null;
    const data = await fetchJson("systems/eqrmss/module/data/starter-kits.json");
    const kit = data?.[kitClassId];
    const entry = (kit?.items ?? []).find(i => i.type === "weapon" && i.weaponTemplate);
    if (!entry) return null;
    const composed = this.#composeKitWeapon(entry);
    const cat = WEAPON_TYPE_TO_CATEGORY[composed.weaponType];
    return cat ? `weapon:${cat}` : null;
  }

  // ------------------------------------------------------------
  // SIM SKILLS — every skill the simulation bought, granted at
  // its simulated rank total.
  // ------------------------------------------------------------

  async #grantSimSkills(actor, sim) {
    try {
      if (!sim.skills.length) return;
      const items = sim.skills.map(s => {
        const rankBonus = rmssRankBonus(s.ranks);
        return {
          name: displayName(s.key),
          type: "skill",
          img: NPC_SKILL_ICON,
          system: {
            slug: s.key,
            category: s.group,
            statsString: "",
            cost: s.cost ?? "",
            ranks: s.ranks,
            rankBonus,
            statBonus: 0,
            profBonus: 0,
            specialBonus: 0,
            bonus: rankBonus,
            favorite: false,
            description: `NPC build (${s.ranks} rank${s.ranks === 1 ? "" : "s"}).`
          },
          flags: { eqrmss: { fromNPCWizard: true } }
        };
      });
      await actor.createEmbeddedDocuments("Item", items);
      console.log(`EQRMSS | NPC build | granted ${items.length} simulated skills`, items.map(i => i.name));
    } catch (error) {
      console.warn("EQRMSS | NPC build | skill grant failed (non-blocking)", error);
    }
  }

  // ------------------------------------------------------------
  // SPECIAL ATTACKS — the step-3 band picks, granted as feature
  // items (informational: name + EQ behavior from the PEQ menu
  // catalog). Combat handlers for individual specials are a
  // later wiring pass. Fail-soft.
  // ------------------------------------------------------------

  async #grantSpecialAttacks(actor) {
    try {
      if (!this.specialPicks.length) return;
      const data = await fetchJson("systems/eqrmss/module/data/creatures/special-attacks.json");
      const catalog = data?.catalog ?? {};
      const items = [];
      for (const id of this.specialPicks) {
        const entry = catalog[id];
        if (!entry) {
          console.warn(`EQRMSS | NPC build | unknown special attack "${id}" — skipped`);
          continue;
        }
        items.push({
          name: entry.name,
          type: "feature",
          img: "systems/eqrmss/assets/Icons/game/ability.png",
          system: {
            description: entry.desc ?? "",
            source: "npc-wizard",
            category: "special-attack",
            granted: true
          },
          flags: { eqrmss: { fromNPCWizard: true, specialAttack: id, specialKind: entry.kind ?? "attack" } }
        });
      }
      if (items.length) {
        const created = await actor.createEmbeddedDocuments("Item", items);
        console.log(`EQRMSS | NPC build | granted ${created.length} special attack(s)`, created.map(i => i.name));
        if (created.length < items.length) {
          console.warn(`EQRMSS | NPC build | ${items.length - created.length} special attack(s) failed to create`);
        }
      }
    } catch (error) {
      console.warn("EQRMSS | NPC build | special attack grant failed (non-blocking)", error);
    }
  }

  // ------------------------------------------------------------
  // BAND SPELL PACKAGES — curated per-band spell sets (user
  // ruling B) from module/data/spells/npc-band-packages.json:
  // { <classId>: { bands: { "1": [names], "2": [names], ... } } }
  // Each band's list is the COMPLETE spellbook at that band
  // (best version of each line), so only the NPC's own band is
  // granted — nearest lower band when its own is absent.
  // Returns true when at least one spell was granted.
  // ------------------------------------------------------------

  async #grantBandSpells(actor, spellClassId) {
    try {
      if (!spellClassId) return false;
      const data = await fetchJson("systems/eqrmss/module/data/spells/npc-band-packages.json");
      const bands = data?.[spellClassId]?.bands ?? null;
      if (!bands) return false;
      let names = null;
      for (let b = Math.ceil(this.level / 10); b >= 1; b--) {
        if (Array.isArray(bands[String(b)]) && bands[String(b)].length) {
          names = bands[String(b)];
          break;
        }
      }
      if (!names) return false;

      const granted = await this.#grantSpellsByName(actor, spellClassId, names);
      if (granted) console.log(`EQRMSS | NPC build | granted ${granted} band-package spell(s) for ${spellClassId} (level ${this.level})`);
      return granted > 0;
    } catch (error) {
      console.warn("EQRMSS | NPC build | band spell grant failed (non-blocking)", error);
      return false;
    }
  }

  /** Grant spell/song documents by name from the class pools. */
  async #grantSpellsByName(actor, classKey, names) {
    if (!names?.length) return 0;
    const spellPool = game?.eqrmss?.spells?.[classKey] ?? [];
    const songPool = CONFIG?.EQRMSS?.songs ?? [];
    const items = [];
    for (const name of names) {
      const doc =
        spellPool.find(s => s?.name === name) ??
        songPool.find(s => s?.name === name);
      if (!doc) {
        console.warn(`EQRMSS | NPC build | spell/song not found: "${name}" (${classKey})`);
        continue;
      }
      items.push(spellItemFromDoc(doc));
    }
    if (items.length) await actor.createEmbeddedDocuments("Item", items);
    return items.length;
  }

  // ------------------------------------------------------------
  // STARTER KIT — adapted from the character finalizer: class
  // kit items (weapons composed at grant time), race overrides,
  // starting money. Fail-soft.
  // ------------------------------------------------------------

  async #grantStarterKit(actor, cls, race, kitClassId) {
    try {
      if (!cls || this.creatureType !== "sentient") return;
      const key = String(kitClassId || "").toLowerCase();
      if (!key) return;

      const data = await fetchJson("systems/eqrmss/module/data/starter-kits.json") ?? {};
      const kit = data[key];
      if (!kit) {
        console.warn(`EQRMSS | NPC build | no starter kit for class "${key}"`);
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
        console.log(`EQRMSS | NPC build | granted starter kit (${key})`, items.map(i => i.name));
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
      console.warn("EQRMSS | NPC build | starter kit grant failed (non-blocking)", error);
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
      console.warn("EQRMSS | NPC build | kit weapon compose failed (non-blocking)", error);
      return {};
    }
  }

  // ------------------------------------------------------------
  // STARTER SPELLS/SONGS — the fixed class sets from
  // starting-spells.json. Fallback for casting builds when no
  // band packages exist yet; primary path for non-caster class
  // builds. Fail-soft.
  // ------------------------------------------------------------

  async #grantStartingSpells(actor, cls, classKey) {
    try {
      if (!cls) return;
      const key = String(classKey || "").toLowerCase();
      if (!key) return;
      const data = await fetchJson("systems/eqrmss/module/data/spells/starting-spells.json");
      const names = data?.[key] ?? [];
      if (!names.length) return;
      const granted = await this.#grantSpellsByName(actor, key, names);
      console.log(`EQRMSS | NPC build | granted ${granted} starting spell(s)/song(s)`);
    } catch (error) {
      console.warn("EQRMSS | NPC build | starting spell grant failed (non-blocking)", error);
    }
  }

  // ------------------------------------------------------------
  // ATTACK PACKAGE — natural-weapon items (composed from
  // natural templates) plus one Natural Weapons skill at level
  // ranks, so attacks flow through the normal combat rolls.
  // Fail-soft. (Unchanged from the quick-build finalizer.)
  // ------------------------------------------------------------

  async #grantAttackPackage(actor, race) {
    try {
      const raceKey = raceHitsKey(race);
      const data = await fetchJson("systems/eqrmss/module/data/creatures/attack-packages.json") ?? {};
      const pkg = data?.packages?.[raceKey] ?? data?.typeDefaults?.[this.creatureType] ?? null;
      const attacks = pkg?.attacks ?? [];
      if (!attacks.length) {
        console.log(`EQRMSS | NPC build | no attack package for race "${raceKey}" (type ${this.creatureType})`);
        return;
      }

      const weapons = game?.eqrmss?.weapons;
      const items = [];
      // Chart OBs are totals: the engine adds the Natural Weapons skill bonus
      // at the wizard's level, so each weapon carries chart OB minus the rank
      // bonus at CHART level. At chart level the engine total matches the chart
      // exactly; higher wizard levels scale OB through skill ranks.
      const chartLevel = Math.max(1, Math.floor(Number(race?.chart?.level) || this.level));
      const rankBonusAtChart = rmssRankBonus(chartLevel);
      for (const atk of attacks) {
        const templateId = String(atk?.weapon ?? "").trim();
        if (!templateId) {
          console.log(`EQRMSS | NPC build | attack "${atk?.name}" has no natural-weapon template yet — recorded but not granted (${atk?.chartAttack ?? ""})`);
          continue;
        }
        const chartOb = (atk?.ob != null && atk.ob !== "") ? Number(atk.ob) : null;
        const obMod = chartOb != null ? chartOb - rankBonusAtChart : (Number(atk?.obMod) || 0);
        const system = { type: "natural", equipped: true };
        try {
          // steel/normal are the compose baselines: neutral name, neutral mods.
          const composed = weapons?.compose?.(templateId);
          if (composed) {
            system.weaponTemplate = composed.templateId;
            system.material = composed.materialId;
            system.condition = composed.conditionId;
            system.type = composed.weaponType; // "natural"
            system.weight = composed.weight;
            system.obMod = (Number(composed.obMod) || 0) + obMod;
            if (composed.damageMod) system.damageMod = composed.damageMod;
            if (composed.attackTable != null) system.attackTable = composed.attackTable;
            if (composed.criticalType != null) system.criticalType = composed.criticalType;
            if (composed.fumble != null) system.fumble_range = composed.fumble;
            if (composed.length) system.length = composed.length;
          } else {
            system.obMod = obMod;
          }
        } catch (error) {
          console.warn(`EQRMSS | NPC build | natural weapon compose failed for "${templateId}" (non-blocking)`, error);
          system.obMod = obMod;
        }
        // Claw Law (AL&CL 11.1): the attack size selects the attack table's
        // maximum-result threshold at roll time.
        const atkSize = String(atk?.attackSize ?? "").trim().toUpperCase();
        if (["T", "S", "M", "L", "H"].includes(atkSize)) system.attackSize = atkSize;
        items.push({
          name: String(atk?.name ?? templateId),
          type: "weapon",
          system,
          flags: { eqrmss: { fromNPCWizard: true, attackPackage: true } }
        });
      }

      const level = this.level;
      const rankBonus = rmssRankBonus(level);
      items.push({
        name: "Natural Weapons",
        type: "skill",
        img: NPC_SKILL_ICON,
        system: {
          slug: "naturalWeapons",
          category: "Weapon",
          statsString: "",
          cost: "",
          ranks: level,
          rankBonus,
          statBonus: 0,
          profBonus: 0,
          specialBonus: 0,
          bonus: rankBonus,
          favorite: false,
          description: `NPC build (${level} rank${level === 1 ? "" : "s"}).`
        },
        flags: { eqrmss: { fromNPCWizard: true } }
      });

      if (!items.length) return;
      await actor.createEmbeddedDocuments("Item", items);
      console.log(`EQRMSS | NPC build | granted attack package (${attacks.length} natural weapon(s) + skill)`, items.map(i => i.name));
    } catch (error) {
      console.warn("EQRMSS | NPC build | attack package grant failed (non-blocking)", error);
    }
  }
}

/** Build a spell/song item from a catalog document (shared shape
 *  with the old quick-build grant). */
function spellItemFromDoc(doc) {
  if (doc.type === "song") {
    const perf = doc.performance ?? {};
    const targ = doc.targeting ?? {};
    const stack = doc.stacking ?? {};
    return {
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
        effects: JSON.parse(JSON.stringify(doc.effects ?? [])),
        effectsSummary: (doc.effects ?? []).map(songEffectSummary)
      }
    };
  }
  return {
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
  };
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
