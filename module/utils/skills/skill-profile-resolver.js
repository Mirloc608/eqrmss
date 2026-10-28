// EQRMSS Skill Profile Resolver
// Computes effective skill bonus for an actor + skillId.
//
// Source of truth (2026-10-28): the actor's skill ITEM — the same fields
// the character sheet's own skill roll reads (ranks, statBonus, profBonus,
// specialBonus, all stamped by the creation wizard and updated by sheet
// development). The legacy actor.system.skills map is not populated on
// real actors, which left every check rolling at the unskilled bonus.

import { getPrimaryStatForSkill, getStatBonus, sum } from "./skill-utils.js";
import { rmssRankBonus } from "../../data/skills/rmss-rank-bonus.js";

export function resolveSkillProfile(actor, skillId, registry) {
  const skill = registry.getSkillById(skillId);
  if (!skill) return null;

  const item = getActorSkillItem(actor, skillId);
  const legacy = getActorSkillInstance(actor, skillId);

  const totalRanks = Number(item?.system?.ranks ?? legacy?.ranks ?? 0);
  // Rank bonus comes from the canonical RMSS table (Table 15.2.2) — the
  // same curve the character sheet uses. Raw rank count is NOT a bonus.
  const rankBonus = rmssRankBonus(totalRanks);

  const metadata = registry.getMetadataById(skillId);
  const primaryStat = getPrimaryStatForSkill(skill, metadata);
  const statBonus = Number(item?.system?.statBonus ?? getStatBonus(actor, primaryStat));

  const professionId = actor?.system?.professionId;
  const professionCosts = registry.getProfessionCosts(professionId);
  const professionBonus = Number(item?.system?.profBonus ?? computeProfessionBonus(skill, professionCosts));
  const specialBonus = Number(item?.system?.specialBonus ?? item?.system?.special_bonus ?? 0);
  const talentBonus = computeTalentBonus(actor, skillId);
  const flawPenalty = computeFlawPenalty(actor, skillId);
  const effectBonus = computeEffectBonus(actor, skillId);

  const totalBonus = sum([
    statBonus,
    rankBonus,
    professionBonus,
    specialBonus,
    talentBonus,
    -flawPenalty,
    effectBonus
  ]);

  return {
    skill,
    totalRanks,
    rankBonus,
    statBonus,
    professionBonus,
    specialBonus,
    talentBonus,
    flawPenalty,
    effectBonus,
    totalBonus
  };
}

// Find the actor's skill item for a catalog skillId ("skill-smithing").
// Items are matched by their stamped system.skillId, then by slug.
function getActorSkillItem(actor, skillId) {
  const items = actor?.items;
  if (!items) return null;
  const arr = items.contents ?? items;
  if (!Array.isArray(arr)) return null;
  return arr.find(i => i?.type === "skill" && skillItemMatches(i, skillId)) ?? null;
}

function skillItemMatches(item, skillId) {
  const sys = item?.system ?? {};
  const key = String(skillId ?? "").toLowerCase();
  if (String(sys.skillId ?? "").toLowerCase() === key) return true;
  const slug = key.replace(/^skill-/, "");
  if (String(sys.slug ?? "").toLowerCase() === slug) return true;
  return false;
}

function getActorSkillInstance(actor, skillId) {
  const skills = actor?.system?.skills ?? {};
  return skills[skillId] ?? null;
}

function computeProfessionBonus(skill, professionCosts) {
  if (!professionCosts) return 0;
  // Example: favored skills list
  if (professionCosts.favoredSkills?.includes(skill._id)) return 5;
  return 0;
}

function computeTalentBonus(actor, skillId) {
  const talents = actor?.system?.talents ?? [];
  // Placeholder: search talents that reference skillId
  return 0;
}

function computeFlawPenalty(actor, skillId) {
  const flaws = actor?.system?.flaws ?? [];
  // Placeholder: search flaws that reference skillId
  return 0;
}

function computeEffectBonus(actor, skillId) {
  const effects = actor?.effects ?? [];
  // Placeholder: sum bonuses from active effects targeting this skill
  return 0;
}
