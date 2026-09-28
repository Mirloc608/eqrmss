// EQRMSS Skill Engine - Index
// Wires together registry, resolvers, and engines.

import { SkillRegistry } from "./skill-registry.js";
import { resolveSkillProfile } from "./skill-profile-resolver.js";
import { getSkillCost } from "./skill-cost-resolver.js";
import { SkillCheckEngine } from "./skill-check-engine.js";
import { SkillAdvancementEngine } from "./skill-advancement-engine.js";

let _skillRegistry = null;
let _skillCheckEngine = null;
let _skillAdvancementEngine = null;

/**
 * Initialize the skill engine subsystem.
 * Call this from system init once skills data packs are available.
 */
export function initializeSkillEngine({ skills, categories, metadata, professionCosts, roller }) {
  _skillRegistry = new SkillRegistry({ skills, categories, metadata, professionCosts });
  _skillCheckEngine = new SkillCheckEngine({ registry: _skillRegistry, roller });
  _skillAdvancementEngine = new SkillAdvancementEngine({ registry: _skillRegistry });
}

/**
 * Get the singleton skill registry.
 */
export function getSkillRegistry() {
  return _skillRegistry;
}

/**
 * Get the singleton skill check engine.
 */
export function getSkillCheckEngine() {
  return _skillCheckEngine;
}

/**
 * Get the singleton skill advancement engine.
 */
export function getSkillAdvancementEngine() {
  return _skillAdvancementEngine;
}

/**
 * Convenience: resolve a skill profile for an actor + skillId.
 */
export function resolveActorSkillProfile(actor, skillId) {
  if (!_skillRegistry) throw new Error("SkillRegistry not initialized");
  return resolveSkillProfile(actor, skillId, _skillRegistry);
}

/**
 * Convenience: get skill cost for an actor + skillId.
 */
export function resolveActorSkillCost(actor, skillId) {
  if (!_skillRegistry) throw new Error("SkillRegistry not initialized");
  return getSkillCost(actor, skillId, _skillRegistry);
}
