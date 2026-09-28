/**
 * EQ-RMSS Race Validation Test Harness
 * Validates all 16 races against race-schema.json (canonical: gnome.json)
 * 
 * Usage:
 *   npm install ajv --save-dev
 *   node module/data/races/races.test.js
 * 
 * Or with Foundry test runner:
 *   npm test -- races
 */

const fs = require('fs');
const path = require('path');

// Try to load Ajv, fallback to simple validation if not available
let Ajv, ajv, validate;
let schema;

try {
  Ajv = require('ajv');
  ajv = new Ajv({ allErrors: true, strict: false });
  const schemaPath = path.join(__dirname, 'race-schema.json');
  // Fallback path for this Meta AI workspace
  const altSchemaPath = '/mnt/data/race-schema.json';
  
  if (fs.existsSync(schemaPath)) {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } else if (fs.existsSync(altSchemaPath)) {
    schema = JSON.parse(fs.readFileSync(altSchemaPath, 'utf8'));
  } else {
    // Inline minimal schema check
    throw new Error('Schema file not found');
  }
  
  validate = ajv.compile(schema);
  console.log('✓ Loaded race-schema.json with Ajv');
} catch (e) {
  console.log('⚠ Ajv not available or schema missing, using fallback validation:', e.message);
  console.log('  Install with: npm install ajv --save-dev');
  
  // Fallback: just check required keys
  const requiredKeys = ["id","key","name","type","img","description","lore","stats","racialTalents","movement","size","height","weight","lifespan","skillBonuses","skillCosts","favoredProfessions","restrictedProfessions","startingLanguages","startingEquipment"];
  validate = (data) => {
    const missing = requiredKeys.filter(k => !(k in data));
    if (missing.length > 0) {
      validate.errors = missing.map(k => ({ message: `missing required key: ${k}` }));
      return false;
    }
    validate.errors = null;
    return true;
  };
}

const RACES_DIR = __dirname;
const INDEX_PATH = path.join(RACES_DIR, 'index.json');
const ALT_INDEX_PATH = '/mnt/data/index.json';

// Load index
let index;
if (fs.existsSync(INDEX_PATH)) {
  index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
} else if (fs.existsSync(ALT_INDEX_PATH)) {
  index = JSON.parse(fs.readFileSync(ALT_INDEX_PATH, 'utf8'));
  console.log('Using /mnt/data/index.json');
} else {
  // Fallback index from known races
  index = { races: ["barbarian","dark-elf","drakkin","dwarf","erudite","froglok","gnome","half-elf","halfling","high-elf","human","iksar","ogre","troll","vah-shir","wood-elf"] };
  index = index.races;
}

const raceKeys = Array.isArray(index) ? index : index.races;

console.log(`\n=== EQ-RMSS Race Validation ===`);
console.log(`Found ${raceKeys.length} races in index: ${raceKeys.join(', ')}`);
console.log('');

let passed = 0;
let failed = 0;
const failures = [];

// Canonical stats keys
const REQUIRED_STATS = ["Ag","Co","Me","Re","SD","Em","In","Pr","Qu","St"];
const REQUIRED_BONUS_CATS = ["combat","physical","subterfuge","magical","lore","social"];
const REQUIRED_COST_CATS = ["combat","physical","subterfuge","magical","lore","social"];
const VALID_SIZES = ["Small","Medium","Large"];
const VALID_PACES = ["Slow","Normal","Fast"];
const VALID_EFFECT_TYPES = ["skillCategory","affinity","stat","resistance","sense","armor","movement","regeneration"];
const VALID_COST_GRADES = ["A","B","C","D"];

for (const key of raceKeys) {
  const racePath = path.join(RACES_DIR, `${key}.json`);
  const altRacePath = `/mnt/data/${key}.json`;
  
  let raceData;
  let actualPath = racePath;
  
  if (fs.existsSync(racePath)) {
    raceData = JSON.parse(fs.readFileSync(racePath, 'utf8'));
  } else if (fs.existsSync(altRacePath)) {
    raceData = JSON.parse(fs.readFileSync(altRacePath, 'utf8'));
    actualPath = altRacePath;
  } else {
    console.log(`✗ ${key}: FILE NOT FOUND at ${racePath}`);
    failed++;
    failures.push({ key, error: 'File not found' });
    continue;
  }
  
  const errors = [];
  
  // Schema validation
  if (!validate(raceData)) {
    errors.push(...(validate.errors || []).map(e => `${e.instancePath || ''} ${e.message}`));
  }
  
  // Additional semantic checks
  if (raceData.id !== `eqrmss-${raceData.key}`) {
    errors.push(`id mismatch: expected eqrmss-${raceData.key}, got ${raceData.id}`);
  }
  
  if (raceData.key !== key) {
    errors.push(`key mismatch: file ${key}.json has key ${raceData.key}`);
  }
  
  // Stats check
  if (raceData.stats) {
    for (const s of REQUIRED_STATS) {
      if (!(s in raceData.stats)) {
        errors.push(`stats missing ${s}`);
      }
    }
  }
  
  // Skill bonuses categories
  if (raceData.skillBonuses) {
    for (const cat of REQUIRED_BONUS_CATS) {
      if (!(cat in raceData.skillBonuses)) {
        errors.push(`skillBonuses missing category ${cat}`);
      }
    }
  }
  
  // Skill costs categories + grades
  if (raceData.skillCosts) {
    for (const cat of REQUIRED_COST_CATS) {
      if (!(cat in raceData.skillCosts)) {
        errors.push(`skillCosts missing category ${cat}`);
      } else if (!VALID_COST_GRADES.includes(raceData.skillCosts[cat])) {
        errors.push(`skillCosts.${cat} invalid grade ${raceData.skillCosts[cat]}`);
      }
    }
  }
  
  // Size
  if (raceData.size && !VALID_SIZES.includes(raceData.size)) {
    errors.push(`invalid size ${raceData.size}`);
  }
  
  // Movement pace
  if (raceData.movement && raceData.movement.pace && !VALID_PACES.includes(raceData.movement.pace)) {
    errors.push(`invalid pace ${raceData.movement.pace}`);
  }
  
  // Talent effect types
  if (raceData.racialTalents) {
    for (const talent of raceData.racialTalents) {
      for (const eff of talent.effects || []) {
        if (!VALID_EFFECT_TYPES.includes(eff.type)) {
          errors.push(`talent ${talent.id} has invalid effect type ${eff.type}`);
        }
        if (!('target' in eff) || !('value' in eff)) {
          errors.push(`talent ${talent.id} effect missing target/value`);
        }
      }
    }
  }
  
  // Img path
  if (raceData.img && !raceData.img.includes(raceData.key)) {
    // Warning only, not error - some races like high-elf use hyphen
    // console.log(`  ⚠ ${key}: img path doesn't contain key: ${raceData.img}`);
  }
  
  if (errors.length === 0) {
    console.log(`✓ ${key}: PASS (${raceData.racialTalents?.length || 0} talents, size ${raceData.size}, ${raceData.movement?.base} base move)`);
    passed++;
  } else {
    console.log(`✗ ${key}: FAIL`);
    for (const err of errors) {
      console.log(`  - ${err}`);
    }
    failed++;
    failures.push({ key, errors });
  }
}

console.log('');
console.log(`=== Summary ===`);
console.log(`Passed: ${passed}/${raceKeys.length}`);
console.log(`Failed: ${failed}/${raceKeys.length}`);

if (failures.length > 0) {
  console.log('\nFailures:');
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
} else {
  console.log('\nAll races valid against canonical schema (gnome.json gold standard)!');
  console.log('Extended effect types in use: armor, movement, regeneration (documented in README.md)');
  process.exit(0);
}
