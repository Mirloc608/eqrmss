// ============================================================
// EQRMSS Skill Loader (JSON Array Source of Truth)
// ------------------------------------------------------------
// Loads skill data from canonical JSON files and caches them 
// into CONFIG.EQRMSS.skills for global access.
// ============================================================

console.warn("EQRMSS | LOADING skill-loader.js");

const SKILL_ROOT = "systems/eqrmss/module/data/skills";

export class SkillLoader {
    // ------------------------------------------------------------
    // PUBLIC ENTRY POINT
    // ------------------------------------------------------------
    static async load() {
        CONFIG.EQRMSS ??= {};
        CONFIG.EQRMSS.skills ??= {};

        const path = `${SKILL_ROOT}/skills.json`;
        const skillsArray = await SkillLoader.loadJSON(path);

        if (!Array.isArray(skillsArray)) {
            console.warn("EQRMSS | Skill file invalid or missing (expected array):", path);
            return [];
        }

        const loaded = [];

        for (const skill of skillsArray) {
            if (!skill?.id) {
                console.warn("EQRMSS | Skill missing identifier ID:", skill);
                continue;
            }

            // Map into global configuration as the singular truth
            CONFIG.EQRMSS.skills[skill.id] = skill;
            loaded.push(skill);
        }

        console.log(`EQRMSS | Loaded ${loaded.length} canonical skills into CONFIG.`);
        return loaded;
    }

    // ------------------------------------------------------------
    // JSON FETCH WRAPPER
    // ------------------------------------------------------------
    static async loadJSON(path) {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                console.warn("EQRMSS | Skill file missing", path);
                return null;
            }
            return await response.json();
        } catch (error) {
            console.error("EQRMSS | Skill JSON failed", path, error);
            return null;
        }
    }

    // ------------------------------------------------------------
    // ACCESSORS
    // ------------------------------------------------------------
    static getSkill(id) {
        return CONFIG.EQRMSS?.skills?.[id] ?? null;
    }

    static getSkills() {
        return Object.values(CONFIG.EQRMSS?.skills ?? {});
    }

    static getByCategory(categoryName) {
        return SkillLoader.getSkills().filter(s => s.system?.category === categoryName);
    }
}