// EQRMSS Skill Profile Resolver
// Computes effective skill bonus for an actor + skillId.

import { getPrimaryStatForSkill, getStatBonus, sum } from "./skill-utils.js";
import { rmssRankBonus } from "../../data/skills/rmss-rank-bonus.js";

export function resolveSkillProfile(actor, skillId, registry) {
  const skill = registry.getSkillById(skillId);
  if (!skill) return null;

  const metadata = registry.getMetadataById(skillId);
  const primaryStat = getPrimaryStatForSkill(skill, metadata);
  const statBonus = getStatBonus(actor, primaryStat);

  const actorSkill = getActorSkillInstance(actor, skillId);
  const totalRanks = Number(actorSkill?.ranks ?? 0);
  // Rank bonus comes from the canonical RMSS table (Table 15.2.2) — the
  // same curve the character sheet uses. Raw rank count is NOT a bonus.
  const rankBonus = rmssRankBonus(totalRanks);

  const professionId = actor?.system?.professionId;
  const professionCosts = registry.getProfessionCosts(professionId);

  const professionBonus = computeProfessionBonus(skill, professionCosts);
  const talentBonus = computeTalentBonus(actor, skillId);
  const flawPenalty = computeFlawPenalty(actor, skillId);
  const effectBonus = computeEffectBonus(actor, skillId);

  const totalBonus = sum([
    statBonus,
    rankBonus,
    professionBonus,
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
    talentBonus,
    flawPenalty,
    effectBonus,
    totalBonus
  };
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
