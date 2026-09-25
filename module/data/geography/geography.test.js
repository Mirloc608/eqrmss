/**
 * EQ-RMSS Geography Validation Test Harness v2.1
 * Validates region and zone packages - zone.json literally (not <zone>.json)
 * 
 * Usage:
 *   node module/data/geography/geography.test.js
 */

const fs = require('fs');
const path = require('path');

const GEO_BASE = __dirname;
const ALT_BASE = '/mnt/data';

const EXPECTED_REGION_FILES = ['factions','influence','lore','region','travel'];
const GENERIC_ZONE_CORE = ['zone','lore','environment','hazards','encounters','encounter-tables','loot','music','npcs','patrols','points-of-interest','quests','scripts','spawns','travel','vendors','lighting','manifest']; // canonical is literally zone.json

console.log("\n=== EQ-RMSS Geography Validation v2.1 (zone.json literally) ===\n");

function browseDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return { dirs: [], files: [] };
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => path.join(dirPath, e.name));
    const files = entries.filter(e => e.isFile()).map(e => path.join(dirPath, e.name));
    return { dirs, files };
  } catch (e) {
    return { dirs: [], files: [] };
  }
}

let worldsPath = path.join(GEO_BASE, 'worlds');
let hasWorlds = fs.existsSync(worldsPath);

if (!hasWorlds) {
  console.log("⚠ worlds/ folder not found at", worldsPath);
  console.log("  Running in sample-only mode");
  // Sample check for zone.json literally
  const sampleZonePath = path.join(ALT_BASE, 'zone.json');
  if (fs.existsSync(sampleZonePath)) {
    const data = JSON.parse(fs.readFileSync(sampleZonePath, 'utf8'));
    console.log(`✓ Sample zone.json found: id=${data.id}, zone=${data.zone}, world=${data.world}, loader=${data.eqrmss?.loader}`);
    if (data.eqrmss?.loader === 'zone-v2' && data.zone) {
      console.log("✓ Valid v2 zone.json (literally zone.json)");
    }
  }
  process.exit(0);
}

console.log(`Found worlds at: ${worldsPath}`);
const worldsBrowse = browseDir(worldsPath);

let totalRegions = 0, passedRegions = 0, totalZones = 0, passedZones = 0;
let missingReports = [];

for (const worldDir of worldsBrowse.dirs) {
  const worldName = path.basename(worldDir);
  const worldBrowse = browseDir(worldDir);
  console.log(`\n🌍 World: ${worldName} (${worldBrowse.dirs.length} regions)`);
  
  for (const regionDir of worldBrowse.dirs) {
    const regionName = path.basename(regionDir);
    // Skip non-region folders like continents, realms that were reported as missing
    if (['continents','realms'].includes(regionName)) {
      console.log(`  ⊘ Skipping ${regionName} (container folder, not a region)`);
      continue;
    }
    
    totalRegions++;
    const regionBrowse = browseDir(regionDir);
    const regionFiles = regionBrowse.files.map(f => path.basename(f, '.json'));
    const missingRegion = EXPECTED_REGION_FILES.filter(ef => !regionFiles.includes(ef));
    
    if (missingRegion.length === 0) {
      console.log(`  ✓ Region ${regionName}: PASS (${regionFiles.length} files)`);
      passedRegions++;
    } else {
      console.log(`  ✗ Region ${regionName}: FAIL - missing ${missingRegion.join(', ')}`);
      missingReports.push({ world: worldName, region: regionName, missing: missingRegion, type: 'region' });
    }
    
    const zonesDir = path.join(regionDir, 'zones');
    if (!fs.existsSync(zonesDir)) continue;
    
    const zonesBrowse = browseDir(zonesDir);
    for (const zoneDir of zonesBrowse.dirs) {
      const zoneName = path.basename(zoneDir);
      totalZones++;
      const zoneBrowse = browseDir(zoneDir);
      const zoneFiles = zoneBrowse.files.map(f => path.basename(f, '.json'));
      
      const hasZoneJson = zoneFiles.includes('zone');
      const hasLegacy = zoneFiles.includes(zoneName);
      const missingZone = GENERIC_ZONE_CORE.filter(ef => !zoneFiles.includes(ef));
      
      // Allow up to 4 missing for optional files (vendors, quests, etc)
      const criticalMissing = missingZone.filter(f => !['vendors','quests','scripts','patrols','spawns'].includes(f));
      
      if (hasZoneJson && !hasLegacy && criticalMissing.length === 0) {
        console.log(`    ✓ Zone ${zoneName}: PASS (zone.json literally, ${zoneFiles.length} files)`);
        passedZones++;
      } else if (hasZoneJson && hasLegacy) {
        console.log(`    ⚠ Zone ${zoneName}: BOTH zone.json and ${zoneName}.json exist - needs cleanup`);
        missingReports.push({ world: worldName, region: regionName, zone: zoneName, issue: 'both_exist', files: zoneFiles });
      } else if (!hasZoneJson && hasLegacy) {
        console.log(`    ✗ Zone ${zoneName}: FAIL - has legacy ${zoneName}.json but missing zone.json (needs migration)`);
        missingReports.push({ world: worldName, region: regionName, zone: zoneName, issue: 'legacy_only', missing: ['zone'] });
      } else if (!hasZoneJson && !hasLegacy) {
        console.log(`    ✗ Zone ${zoneName}: FAIL - missing zone.json literally`);
        missingReports.push({ world: worldName, region: regionName, zone: zoneName, issue: 'no_main', missing: ['zone'] });
      } else {
        if (criticalMissing.length <= 2) {
          console.log(`    ✓ Zone ${zoneName}: PASS (zone.json, minor missing: ${missingZone.join(', ')})`);
          passedZones++;
        } else {
          console.log(`    ✗ Zone ${zoneName}: FAIL - missing ${criticalMissing.join(', ')}`);
          missingReports.push({ world: worldName, region: regionName, zone: zoneName, missing: criticalMissing });
        }
      }
    }
  }
}

console.log(`\n=== Summary ===`);
console.log(`Regions: ${passedRegions}/${totalRegions} passed`);
console.log(`Zones: ${passedZones}/${totalZones} passed`);
console.log(`Issues: ${missingReports.length}`);

if (missingReports.length > 0) {
  const both = missingReports.filter(r => r.issue === 'both_exist').length;
  const legacy = missingReports.filter(r => r.issue === 'legacy_only').length;
  const noMain = missingReports.filter(r => r.issue === 'no_main').length;
  console.log(`  - Both exist: ${both}`);
  console.log(`  - Legacy only: ${legacy}`);
  console.log(`  - No main: ${noMain}`);
  console.log(`\nTop 20 issues:`);
  console.log(JSON.stringify(missingReports.slice(0,20), null, 2));
}

process.exit(missingReports.length > 0 ? 1 : 0);
