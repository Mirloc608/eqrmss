// EQRMSS Skill Cost Resolver
// Computes development point cost per rank for a skill.

import { getDesignationModifier } from "./skill-utils.js";

export function getSkillCost(actor, skillId, registry) {
  const skill = registry.getSkillById(skillId);
  if (!skill) return 99;

  const professionId = actor?.system?.professionId;
  const professionCosts = registry.getProfessionCosts(professionId);
  if (!professionCosts) return 99;

  const baseCategoryCost = getBaseCategoryCost(skill, professionCosts);
  const eqTagModifier = getEqTagModifier(skill, professionCosts);

  const metadata = registry.getMetadataById(skillId);
  const designation = metadata?.designation ?? "occupational";
  const designationModifier = getDesignationModifier(designation);

  const totalCost = baseCategoryCost + eqTagModifier + designationModifier;
  return Math.max(1, Math.round(totalCost));
}

function getBaseCategoryCost(skill, professionCosts) {
  const cat = skill.category ?? "uncategorized";
  const costs = professionCosts.costs ?? {};
  return Number(costs[cat] ?? 99);
}

function getEqTagModifier(skill, professionCosts) {
  const tags = skill.tags ?? [];
  const costs = professionCosts.costs ?? {};
  let mod = 0;

  if (tags.includes("music") && costs.music !== undefined) mod -= 1;
  if (tags.includes("necromancy") && costs.necromancy !== undefined) mod -= 1;
  if (tags.includes("summoning") && costs.summoning !== undefined) mod -= 1;

  return mod;
}
