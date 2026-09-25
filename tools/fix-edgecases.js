#!/usr/bin/env node
/**
 * EQ-RMSS Zone Fix - Phase 3 Final Cleanup
 * Fixes remaining edge cases:
 * - luclin/griegs-end/outer-madness: Unexpected end of JSON input (corrupted)
 * - Folders with .json in name: royal-archives-interior.json -> royal-archives-interior
 * - Folders with spaces: ascendant -causeway -> ascendant-causeway
 * - Both exist: 1 remaining
 */

const fs = require('fs');
const path = require('path');

const GEO_BASE = process.env.GEO_BASE || 'module/data/geography/worlds';
const DRY_RUN = process.argv.includes('--dry-run');

console.log(`\n=== Phase 3: Final Edge Cases ===`);
console.log(`Base: ${GEO_BASE}, Dry: ${DRY_RUN}\n`);

let fixed = 0;

function fixCorruptedZone(zonePath) {
  const zoneJsonPath = path.join(zonePath, 'zone.json');
  if (!fs.existsSync(zoneJsonPath)) return false;
  
  try {
    const content = fs.readFileSync(zoneJsonPath, 'utf8');
    if (content.trim() === '' || content.trim() === '{}' || content.length < 10) {
      throw new Error('Empty or too short');
    }
    JSON.parse(content);
    return false; // valid
  } catch (e) {
    console.log(`✗ Corrupted: ${zonePath}/zone.json - ${e.message}`);
    const zoneName = path.basename(zonePath);
    const regionName = path.basename(path.dirname(path.dirname(zonePath)));
    const worldName = path.basename(path.dirname(path.dirname(path.dirname(zonePath))));
    
    console.log(`  Rebuilding stub for ${worldName}/${regionName}/${zoneName}`);
    if (!DRY_RUN) {
      const backupPath = zoneJsonPath + '.corrupted.bak';
      fs.copyFileSync(zoneJsonPath, backupPath);
      
      const stub = {
        id: `zone-${zoneName}`,
        zone: zoneName,
        region: regionName,
        world: worldName,
        name: zoneName.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        type: "dungeon-zone",
        description: `Rebuilt stub - original was corrupted: ${e.message}`,
        eqrmss: { loader: "zone-v2", autoRegister: true, version: "2.2.0" }
      };
      
      fs.writeFileSync(zoneJsonPath, JSON.stringify(stub, null, 2) + '\n');
      console.log(`  ✓ Rebuilt stub, backup at ${path.basename(backupPath)}`);
      fixed++;
    }
    return true;
  }
}

function fixFolderNames() {
  const worlds = fs.readdirSync(GEO_BASE, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
  for (const world of worlds) {
    const worldPath = path.join(GEO_BASE, world);
    const regions = fs.readdirSync(worldPath, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
    for (const region of regions) {
      if (['continents','realms'].includes(region)) continue;
      const regionPath = path.join(worldPath, region);
      const zonesPath = path.join(regionPath, 'zones');
      if (!fs.existsSync(zonesPath)) continue;
      
      const zones = fs.readdirSync(zonesPath, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
      for (const zone of zones) {
        let newZoneName = zone;
        let needsRename = false;
        
        // Fix .json in folder name
        if (zone.endsWith('.json')) {
          newZoneName = zone.replace(/\.json$/, '');
          console.log(`✗ Folder has .json extension: ${world}/${region}/zones/${zone} -> ${newZoneName}`);
          needsRename = true;
        }
        
        // Fix spaces
        if (zone.includes(' ')) {
          newZoneName = newZoneName.replace(/\s+/g, '-').replace(/--+/g, '-');
          console.log(`✗ Folder has spaces: ${world}/${region}/zones/${zone} -> ${newZoneName}`);
          needsRename = true;
        }
        
        // Fix special unicode dashes (shadow‑tainted‑lowlands has non-ASCII hyphen)
        if (/[^\x00-\x7F]/.test(zone)) {
          newZoneName = newZoneName.replace(/[^\x00-\x7F]/g, '-').replace(/--+/g, '-');
          console.log(`✗ Folder has unicode chars: ${world}/${region}/zones/${zone} -> ${newZoneName}`);
          needsRename = true;
        }
        
        if (needsRename && !DRY_RUN) {
          const oldPath = path.join(zonesPath, zone);
          const newPath = path.join(zonesPath, newZoneName);
          if (!fs.existsSync(newPath)) {
            fs.renameSync(oldPath, newPath);
            console.log(`  ✓ Renamed folder`);
            fixed++;
          } else {
            console.log(`  ⚠ Target ${newZoneName} already exists, skipping`);
          }
        }
        
        // Fix corrupted zone.json inside
        const zonePath = path.join(zonesPath, needsRename && !DRY_RUN ? newZoneName : zone);
        if (fs.existsSync(zonePath)) {
          fixCorruptedZone(zonePath);
        }
      }
    }
  }
}

fixFolderNames();

console.log(`\n=== Phase 3 Summary ===`);
console.log(`Fixed: ${fixed} issues`);
if (DRY_RUN) console.log('*** DRY RUN ***');
else console.log('*** Done ***');
