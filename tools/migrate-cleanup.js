#!/usr/bin/env node
/**
 * EQ-RMSS Zone Migration - Phase 2 Cleanup
 * Cleans up after first migration where both <zone>.json and zone.json exist
 * 
 * Handles your current state:
 *   Scanned: 295, Already correct: 41, Both exist: 239, Neither: 15, Migrated: 238
 * 
 * Usage:
 *   node tools/migrate-cleanup.js --dry-run
 *   node tools/migrate-cleanup.js --remove-legacy --fix-manifest
 */

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const REMOVE_LEGACY = process.argv.includes('--remove-legacy') || true; // default true for phase 2
const FIX_MANIFEST = !process.argv.includes('--no-manifest');
const VERBOSE = process.argv.includes('--verbose');

const GEO_BASES = [
  'module/data/geography/worlds',
  'systems/eqrmss/module/data/geography/worlds',
  './module/data/geography/worlds',
];

let geoBase = null;
for (const base of GEO_BASES) {
  if (fs.existsSync(base)) { geoBase = base; break; }
}
if (!geoBase && process.env.GEO_BASE && fs.existsSync(process.env.GEO_BASE)) {
  geoBase = process.env.GEO_BASE;
}
if (!geoBase) {
  console.error('Geography base not found');
  process.exit(1);
}

console.log(`\n=== Phase 2 Cleanup: Both Exist -> Keep zone.json ===`);
console.log(`Base: ${geoBase}, Dry: ${DRY_RUN}\n`);

let stats = { both: 0, removedLegacy: 0, keptBoth: 0, fixedManifest: 0, createdMissing: 0, neither: 0 };

function walk() {
  const worlds = fs.readdirSync(geoBase, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
  for (const world of worlds) {
    const worldPath = path.join(geoBase, world);
    const regions = fs.readdirSync(worldPath, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
    for (const region of regions) {
      const regionPath = path.join(worldPath, region);
      const zonesPath = path.join(regionPath, 'zones');
      if (!fs.existsSync(zonesPath)) continue;
      
      const zones = fs.readdirSync(zonesPath, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
      for (const zone of zones) {
        const zonePath = path.join(zonesPath, zone);
        const files = fs.readdirSync(zonePath);
        const hasZone = files.includes('zone.json');
        const legacyFile = `${zone}.json`;
        const hasLegacy = files.includes(legacyFile);
        
        // Case 1: Both exist
        if (hasZone && hasLegacy) {
          stats.both++;
          const zoneJsonPath = path.join(zonePath, 'zone.json');
          const legacyPath = path.join(zonePath, legacyFile);
          
          try {
            const zoneContent = fs.readFileSync(zoneJsonPath, 'utf8');
            const legacyContent = fs.readFileSync(legacyPath, 'utf8');
            
            const zoneData = JSON.parse(zoneContent);
            const legacyData = JSON.parse(legacyContent);
            
            // Ensure zone.json has correct canonical fields (literally zone.json)
            // If zone.json was copied from legacy, it's already correct
            // But ensure it has zone field matching folder name
            if (zoneData.zone !== zone) {
              console.log(`  Fixing zone field in ${world}/${region}/${zone}: ${zoneData.zone} -> ${zone}`);
              if (!DRY_RUN) {
                zoneData.zone = zone;
                fs.writeFileSync(zoneJsonPath, JSON.stringify(zoneData, null, 2) + '\n');
              }
            }
            
            if (zoneContent === legacyContent) {
              console.log(`✓ ${world}/${region}/${zone}: identical, removing legacy ${legacyFile}`);
              if (!DRY_RUN && REMOVE_LEGACY) {
                fs.unlinkSync(legacyPath);
                stats.removedLegacy++;
              }
            } else {
              // Different - keep zone.json, backup and remove legacy if requested
              console.log(`⚠ ${world}/${region}/${zone}: different content, keeping zone.json, backing up legacy`);
              if (VERBOSE) {
                console.log(`  zone.json id: ${zoneData.id}, legacy id: ${legacyData.id}`);
              }
              if (!DRY_RUN && REMOVE_LEGACY) {
                fs.copyFileSync(legacyPath, legacyPath + '.bak-phase1');
                fs.unlinkSync(legacyPath);
                console.log(`  → Backed up to ${legacyFile}.bak-phase1 and removed`);
                stats.removedLegacy++;
              } else {
                stats.keptBoth++;
              }
            }
            
            // Fix manifest
            if (FIX_MANIFEST) {
              const manifestPath = path.join(zonePath, 'manifest.json');
              if (fs.existsSync(manifestPath)) {
                try {
                  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                  if (manifest.files && manifest.files.includes(legacyFile)) {
                    console.log(`  → Fixing manifest: ${legacyFile} -> zone.json`);
                    if (!DRY_RUN) {
                      manifest.files = manifest.files.map(f => f === legacyFile ? 'zone.json' : f);
                      // Ensure zone.json is present and first
                      if (!manifest.files.includes('zone.json')) {
                        manifest.files.unshift('zone.json');
                      }
                      // Deduplicate
                      manifest.files = [...new Set(manifest.files)];
                      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
                      stats.fixedManifest++;
                    }
                  } else if (manifest.files && !manifest.files.includes('zone.json')) {
                    console.log(`  → Adding zone.json to manifest`);
                    if (!DRY_RUN) {
                      manifest.files.unshift('zone.json');
                      manifest.files = [...new Set(manifest.files)];
                      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
                      stats.fixedManifest++;
                    }
                  }
                } catch (e) {
                  console.error(`  ✗ Manifest fix failed: ${e.message}`);
                }
              }
            }
            
          } catch (e) {
            console.error(`✗ ${world}/${region}/${zone}: error ${e.message}`);
          }
        }
        
        // Case 2: Neither exist - create stub zone.json
        if (!hasZone && !hasLegacy) {
          stats.neither++;
          console.log(`✗ ${world}/${region}/${zone}: NEITHER zone.json nor ${legacyFile} - creating stub zone.json`);
          if (!DRY_RUN) {
            const stub = {
              id: `zone-${zone}`,
              zone: zone,
              region: region,
              world: world,
              name: zone.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
              type: "wilderness-dungeon-zone",
              description: `Auto-generated stub for ${zone}. Please fill.`,
              eqrmss: { loader: "zone-v2", autoRegister: true, version: "2.2.0" }
            };
            fs.writeFileSync(path.join(zonePath, 'zone.json'), JSON.stringify(stub, null, 2) + '\n');
            
            // Create/update manifest
            const manifestPath = path.join(zonePath, 'manifest.json');
            let manifest;
            if (fs.existsSync(manifestPath)) {
              try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { manifest = { files: [] }; }
            } else {
              manifest = { files: [] };
            }
            if (!manifest.files.includes('zone.json')) {
              manifest.files.unshift('zone.json');
            }
            // Ensure minimal required files list
            const required = ["zone.json","lore.json","environment.json","encounters.json","manifest.json"];
            for (const r of required) {
              if (!manifest.files.includes(r)) manifest.files.push(r);
            }
            manifest.files = [...new Set(manifest.files)];
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
            console.log(`  ✓ Created stub zone.json + manifest`);
            stats.createdMissing++;
          }
        }
      }
    }
  }
}

walk();

console.log(`\n=== Phase 2 Summary ===`);
console.log(`Both existed: ${stats.both}`);
console.log(`Removed legacy: ${stats.removedLegacy}`);
console.log(`Kept both (different): ${stats.keptBoth}`);
console.log(`Manifest fixed: ${stats.fixedManifest}`);
console.log(`Neither existed - created stub: ${stats.createdMissing}`);
console.log(`Neither (total): ${stats.neither}`);

if (DRY_RUN) console.log(`\n*** DRY RUN ***`);
