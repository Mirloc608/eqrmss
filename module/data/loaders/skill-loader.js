/**
 * EQRMSS Skill Loader v4.0 - STUB - Fixes 404
 * Real skills loaded via manual scan in initialize-data-loaders
 * This file exists only to prevent 404 error
 */
console.log("EQRMSS | LOADING skill-loader.js v4.0 - stub (real load via manual scan)");

export const EQRMSSSkillLoader = {
    skills: {},
    async load() {
        console.log("EQRMSS | Skill Loader stub - skills loaded via manual scan in data-loaders v4.0");
        // Try to find skills folder
        try {
            const FilePickerImpl = foundry?.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
            if (!FilePickerImpl) return {};
            const browse = await FilePickerImpl.browse("data", "systems/eqrmss/module/data/skills");
            console.log(`EQRMSS | Skills folder: ${browse.files.length} files, ${browse.dirs.length} dirs`);
        } catch {}
        return game.eqrmss?.skills || {};
    }
};

export const SkillLoader = EQRMSSSkillLoader;
export async function load() { return EQRMSSSkillLoader.load(); }
export default EQRMSSSkillLoader;
