// EQRMSS Skill Utils
// Shared helpers for stat bonuses, designations, tags, etc.

/**
 * Get primary stat key for a skill, falling back to metadata or defaults.
 */
export function getPrimaryStatForSkill(skill, metadata) {
  if (skill.primary_stat) return skill.primary_stat;
  if (metadata?.primary_stat) return metadata.primary_stat;
  return "Reasoning"; // safe default
}

/**
 * Resolve RMSS stat bonus from actor system data.
 * Assumes actor.system.stats[statKey].bonus exists.
 */
export function getStatBonus(actor, statKey) {
  const stats = actor?.system?.stats;
  if (!stats) return 0;
  const stat = stats[statKey];
  if (!stat) return 0;
  return Number(stat.bonus ?? 0);
}

/**
 * Map skill designation to numeric modifier.
 * everyman / occupational / restricted
 */
export function getDesignationModifier(designation) {
  switch (designation) {
    case "everyman": return -1;
    case "occupational": return -0.5;
    case "restricted": return 1;
    default: return 0;
  }
}

/**
 * Sum numeric array safely.
 */
export function sum(values) {
  return (values ?? []).reduce((acc, v) => acc + Number(v ?? 0), 0);
}
