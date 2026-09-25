#!/usr/bin/env node
/**
 * EQ-RMSS Zone Migration Script
 * Migrates legacy <zone>.json naming to canonical zone.json
 * 
 * Problem:
 *   - Old: worlds/kuua/bloodfields/zones/bloodfields-camps/bloodfields-camps.json
 *   - New: worlds/kuua/bloodfields/zones/bloodfields-camps/zone.json (literally zone.json)
 *   - Manifests still list <zone>.json, should list zone.json
 * 
 * Based on eqrmss-tree.txt analysis:
 *   - 42 zones already correct (zone.json)
 *   - 165 zones legacy (<zone>.json)
 *   - 7 regions missing influence.json
 * 
 * Usage:
 *   node tools/migrate-zones-to-v2.js [--dry-run] [--verbose]
 * 
 *   --dry-run: Show what would be done without making changes
 *   --verbose: Show detailed file lists
 *   --fix-manifest: Also fix manifest.json files (default true)
 *   --backup: Create .bak backups (default true)
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const FIX_MANIFEST = !args.includes('--no-manifest');
const BACKUP = !args.includes('--no-backup');

const GEO_BASES = [
  'module/data/geography/worlds',
  'systems/eqrmss/module/data/geography/worlds',
  './module/data/geography/worlds',
  '../module/data/geography/worlds'
];

let geoBase = null;
for (const base of GEO_BASES) {
  if (fs.existsSync(base)) {
    geoBase = base;
    break;
  }
}

if (!geoBase) {
  // Try to find from current file location
  const possible = path.join(__dirname, '../module/data/geography/worlds');
  if (fs.existsSync(possible)) {
    geoBase = possible;
  } else {
    console.error('Could not find geography worlds folder. Tried:');
    GEO_BASES.forEach(b => console.error(`  - ${b} (${fs.existsSync(b) ? 'exists' : 'not found'})`));
    console.error('\nRun this script from project root or specify GEO_BASE env var');
    if (process.env.GEO_BASE && fs.existsSync(process.env.GEO_BASE)) {
      geoBase = process.env.GEO_BASE;
    } else {
      // Fallback to scanning
      console.log('\nTrying to locate via tree file...');
      // If tree file exists, use it to inform, but still need actual files
      process.exit(1);
    }
  }
}

console.log(`\n=== EQ-RMSS Zone Migration: <zone>.json -> zone.json ===`);
console.log(`Base: ${geoBase}`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
console.log(`Fix manifest: ${FIX_MANIFEST}, Backup: ${BACKUP}, Verbose: ${VERBOSE}\n`);

let stats = {
  scanned: 0,
  alreadyCorrect: 0,
  legacyFound: 0,
  migrated: 0,
  manifestFixed: 0,
  bothExist: 0,
  neitherExist: 0,
  errors: 0,
  missingInfluence: []
};

function walkWorlds(base) {
  const worlds = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
  console.log(`Found ${worlds.length} worlds: ${worlds.join(', ')}`);
  
  for (const world of worlds) {
    const worldPath = path.join(base, world);
    const regions = fs.readdirSync(worldPath, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    
    for (const region of regions) {
      const regionPath = path.join(worldPath, region);
      const regionFiles = fs.readdirSync(regionPath).filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));
      
      // Check region completeness (factions, influence, lore, region, travel)
      const expectedRegion = ['factions','influence','lore','region','travel'];
      const missingRegion = expectedRegion.filter(f => !regionFiles.includes(f));
      if (missingRegion.length > 0) {
        stats.missingInfluence.push({ world, region, missing: missingRegion });
      }
      
      // Look for zones folder
      const zonesPath = path.join(regionPath, 'zones');
      if (!fs.existsSync(zonesPath)) continue;
      
      const zoneFolders = fs.readdirSync(zonesPath, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
      
      for (const zone of zoneFolders) {
        const zonePath = path.join(zonesPath, zone);
        stats.scanned++;
        
        const files = fs.readdirSync(zonePath);
        const hasZoneJson = files.includes('zone.json');
        const legacyFile = `${zone}.json`;
        const hasLegacy = files.includes(legacyFile);
        const hasManifest = files.includes('manifest.json');
        
        if (hasZoneJson && !hasLegacy) {
          stats.alreadyCorrect++;
          if (VERBOSE) console.log(`✓ ${world}/${region}/zones/${zone}: already correct (zone.json)`);
          continue;
        }
        
        if (hasZoneJson && hasLegacy) {
          stats.bothExist++;
          console.log(`⚠ ${world}/${region}/zones/${zone}: BOTH exist - has zone.json AND ${legacyFile}`);
          console.log(`  Files: ${files.join(', ')}`);
          // Prefer zone.json, backup legacy
          if (!DRY_RUN) {
            try {
              if (BACKUP) {
                fs.copyFileSync(path.join(zonePath, legacyFile), path.join(zonePath, `${legacyFile}.bak`));
              }
              // Check if they are identical
              const zoneContent = fs.readFileSync(path.join(zonePath, 'zone.json'), 'utf8');
              const legacyContent = fs.readFileSync(path.join(zonePath, legacyFile), 'utf8');
              if (zoneContent === legacyContent) {
                console.log(`  → Identical, removing legacy ${legacyFile}`);
                fs.unlinkSync(path.join(zonePath, legacyFile));
                stats.migrated++;
              } else {
                console.log(`  → Different content, keeping both but warning`);
              }
            } catch (e) {
              console.error(`  ✗ Error handling both: ${e.message}`);
              stats.errors++;
            }
          }
          continue;
        }
        
        if (!hasZoneJson && hasLegacy) {
          stats.legacyFound++;
          console.log(`→ ${world}/${region}/zones/${zone}: LEGACY found ${legacyFile} -> should be zone.json`);
          console.log(`  Files: ${files.join(', ')}`);
          
          if (!DRY_RUN) {
            try {
              const legacyPath = path.join(zonePath, legacyFile);
              const zoneJsonPath = path.join(zonePath, 'zone.json');
              
              if (BACKUP) {
                fs.copyFileSync(legacyPath, path.join(zonePath, `${legacyFile}.bak`));
              }
              
              fs.copyFileSync(legacyPath, zoneJsonPath);
              console.log(`  ✓ Copied ${legacyFile} -> zone.json`);
              
              // Optionally remove legacy after successful copy
              // fs.unlinkSync(legacyPath);
              // console.log(`  ✓ Removed legacy ${legacyFile}`);
              
              stats.migrated++;
              
              // Fix manifest if exists
              if (FIX_MANIFEST && hasManifest) {
                const manifestPath = path.join(zonePath, 'manifest.json');
                try {
                  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                  if (manifest.files && manifest.files.includes(legacyFile)) {
                    manifest.files = manifest.files.map(f => f === legacyFile ? 'zone.json' : f);
                    // Ensure zone.json is first
                    if (!manifest.files.includes('zone.json')) {
                      manifest.files.unshift('zone.json');
                    }
                    if (BACKUP) {
                      fs.copyFileSync(manifestPath, manifestPath + '.bak');
                    }
                    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
                    console.log(`  ✓ Fixed manifest.json: ${legacyFile} -> zone.json`);
                    stats.manifestFixed++;
                  }
                } catch (e) {
                  console.error(`  ✗ Failed to fix manifest: ${e.message}`);
                  stats.errors++;
                }
              }
            } catch (e) {
              console.error(`  ✗ Migration failed: ${e.message}`);
              stats.errors++;
            }
          }
          continue;
        }
        
        if (!hasZoneJson && !hasLegacy) {
          stats.neitherExist++;
          console.log(`✗ ${world}/${region}/zones/${zone}: NEITHER zone.json nor ${legacyFile} found`);
          console.log(`  Files: ${files.join(', ')}`);
          stats.errors++;
        }
      }
    }
  }
}

walkWorlds(geoBase);

console.log(`\n=== Summary ===`);
console.log(`Scanned zone folders: ${stats.scanned}`);
console.log(`Already correct (zone.json): ${stats.alreadyCorrect}`);
console.log(`Legacy found (<zone>.json): ${stats.legacyFound}`);
console.log(`Migrated: ${stats.migrated}`);
console.log(`Manifest fixed: ${stats.manifestFixed}`);
console.log(`Both exist: ${stats.bothExist}`);
console.log(`Neither exist: ${stats.neitherExist}`);
console.log(`Errors: ${stats.errors}`);

if (stats.missingInfluence.length > 0) {
  console.log(`\nRegions missing files (expected factions, influence, lore, region, travel):`);
  stats.missingInfluence.forEach(r => {
    console.log(`  - ${r.world}/${r.region}: missing ${r.missing.join(', ')}`);
  });
}

if (DRY_RUN) {
  console.log(`\n*** DRY RUN - No files changed ***`);
  console.log(`Run without --dry-run to apply changes`);
} else {
  console.log(`\n*** Migration complete ***`);
  console.log(`Backups created with .bak extension where applicable`);
}

console.log(`\nNext steps:`);
console.log(`1. Review changes with git diff`);
console.log(`2. Run: node module/data/geography/geography.test.js`);
console.log(`3. Update any code that references <zone>.json to use zone.json`);
console.log(`4. If happy, remove .bak files: find ${geoBase} -name "*.bak" -delete`);
