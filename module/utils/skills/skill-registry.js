// EQRMSS Skill Registry
// Central access to skills, categories, metadata, and profession costs.

export class SkillRegistry {
  constructor({ skills, categories, metadata, professionCosts }) {
    this.skillsById = new Map();
    this.skillsByCategory = new Map();
    this.metadataById = new Map();
    this.professionCostsById = new Map();

    // Skills
    for (const skill of skills ?? []) {
      this.skillsById.set(skill._id, skill);
      const cat = skill.category ?? "uncategorized";
      if (!this.skillsByCategory.has(cat)) this.skillsByCategory.set(cat, []);
      this.skillsByCategory.get(cat).push(skill);
    }

    // Metadata
    for (const meta of metadata ?? []) {
      this.metadataById.set(meta._id, meta);
    }

    // Profession costs
    for (const prof of professionCosts ?? []) {
      this.professionCostsById.set(prof.id, prof);
    }
  }

  getSkillById(id) {
    return this.skillsById.get(id) ?? null;
  }

  getSkillsByCategory(category) {
    return this.skillsByCategory.get(category) ?? [];
  }

  getMetadataById(id) {
    return this.metadataById.get(id) ?? null;
  }

  getProfessionCosts(professionId) {
    return this.professionCostsById.get(professionId) ?? null;
  }

  getSpellSchoolSkills() {
    return (this.skillsByCategory.get("magical") ?? []).filter(s =>
      s._id?.startsWith("skill-school-")
    );
  }

  getSystemSkills() {
    return this.skillsByCategory.get("system") ?? [];
  }
}
