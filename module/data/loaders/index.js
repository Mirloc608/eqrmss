// ============================================================
// NORMALIZED LOADER FUNCTIONS
// ============================================================

async function loadClasses() { return await loadEQRMSSClasses(); }
async function loadRaces() { return await loadEQRMSSRaces(); }
async function loadSpells() { return await loadEQRMSSpells(); }
async function loadSongs() { return await loadEQRMSSSongs(); }
async function loadAbilities() { return await AbilityLoader.load(); }
async function loadSkills() { return await SkillLoader.load(); }
async function loadFeaturesRegistry() { return await loadFeatures(); }
async function loadProgressionRegistry() { return await loadProgression(); }

async function loadDisciplinesRegistry() { return await DisciplineLoader.load(); }

async function loadOriginRegistry() { return await loadOriginData(); }


// ============================================================
// REGISTRY
// ============================================================

export const EQRMSS_DATA_LOADERS = [

    { name: "classes", loader: loadClasses },
    { name: "races", loader: loadRaces },

    { name: "spells", loader: loadSpells },
    { name: "songs", loader: loadSongs },

    { name: "abilities", loader: loadAbilities },
    { name: "skills", loader: loadSkills },
    { name: "features", loader: loadFeaturesRegistry },

    { name: "progression", loader: loadProgressionRegistry },

    // --------------------------------------------------------
    // Disciplines
    // --------------------------------------------------------
    { name: "disciplines", loader: loadDisciplinesRegistry },

    // --------------------------------------------------------
    // Origin / Character Creation data
    // --------------------------------------------------------
    { name: "origin", loader: loadOriginRegistry }
];


// ============================================================
// DEFAULT EXPORT
// ============================================================

export default EQRMSS_DATA_LOADERS;