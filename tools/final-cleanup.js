#!/usr/bin/env node
/**
 * Final Cleanup - Phase 4
 * Cleans remaining 5 both-exist + copy files + bak files
 * From your last run:
 * - outer-madness has "encounter-tables copy" etc (Finder duplicate bug)
 * - 4 zones have both zone.json and <zone>.json
 * - shadowhaven region missing
 */

const fs = require('fs');
const path = require('path');

const GEO_BASE = process.env.GEO_BASE || 'module/data/geography/worlds';
const DRY_RUN = process.argv.includes('--dry-run');

console.log(`\n=== Phase 4 Final Cleanup ===`);
console.log(`Base: ${GEO_BASE}, Dry: ${DRY_RUN}\n`);

let removed=0;

function walk() {
  const worlds = fs.readdirSync(GEO_BASE, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
  for (const world of worlds) {
    const worldPath = path.join(GEO_BASE, world);
    const regions = fs.readdirSync(worldPath, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
    for (const region of regions) {
      if (['continents','realms'].includes(region)) continue;
      const regionPath = path.join(worldPath, region);
      
      // Fix shadowhaven region
      if (region === 'shadowhaven') {
        const regionFiles = fs.readdirSync(regionPath).filter(f=>f.endsWith('.json')).map(f=>path.basename(f, '.json'));
        const expected = ['factions','influence','lore','region','travel'];
        const missing = expected.filter(f=>!regionFiles.includes(f));
        if (missing.length>0) {
          console.log(`✗ ${world}/${region}: missing ${missing.join(', ')} - creating stubs`);
          if (!DRY_RUN) {
            // Use akheva-ruins as template structure
            const stubs = {
              'region': {
                id: 'shadowhaven',
                name: 'Shadowhaven',
                world: 'luclin',
                type: 'city-region',
                tier: '45-60',
                summary: 'Neutral trading city in Luclin, refuge from light.',
                eqrmss: { loader: 'region-v2', autoRegister: true, version: '2.2.0' }
              },
              'factions': { factions: [
                { id: 'shadowhaven-citizens', importance: 1, description: 'Citizens and merchants of Shadowhaven', allies: [], enemies: [] }
              ]},
              'influence': { influence: {} },
              'lore': { overview: 'Shadowhaven is...', history: '', hooks: [] },
              'travel': { connections: [] }
            };
            for (const mf of missing) {
              const filePath = path.join(regionPath, `${mf}.json`);
              if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, JSON.stringify(stubs[mf] || {}, null, 2) + '\n');
                console.log(`  ✓ Created ${mf}.json`);
                removed++; // count as fixed
              }
            }
          }
        }
      }
      
      const zonesPath = path.join(regionPath, 'zones');
      if (!fs.existsSync(zonesPath)) continue;
      const zones = fs.readdirSync(zonesPath, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
      for (const zone of zones) {
        const zonePath = path.join(zonesPath, zone);
        const files = fs.readdirSync(zonePath);
        
        // Remove Finder " copy" files and .bak files
        const copyFiles = files.filter(f => f.includes(' copy') || f.endsWith('.bak') || f.endsWith('.bak-phase1') || f.endsWith('.corrupted.bak') || f.includes('.json.bak'));
        for (const cf of copyFiles) {
          console.log(`✗ ${world}/${region}/${zone}: removing junk file ${cf}`);
          if (!DRY_RUN) {
            try { fs.unlinkSync(path.join(zonePath, cf)); removed++; } catch(e){}
          }
        }
        
        // Remove legacy <zone>.json where zone.json exists
        const legacyFile = `${zone}.json`;
        if (files.includes('zone.json') && files.includes(legacyFile)) {
          console.log(`✗ ${world}/${region}/${zone}: removing legacy ${legacyFile} (zone.json exists)`);
          if (!DRY_RUN) {
            try { fs.unlinkSync(path.join(zonePath, legacyFile)); removed++; } catch(e){}
          }
        }
        
        // Also check for files that are just zone name without .json extension (legacy folder names that became files?)
        // e.g., outer-madness has file named "zone" (no extension) and "outer-madness" (no extension)
        const noExtFiles = files.filter(f => !f.includes('.') && f !== 'zone' && !f.startsWith('.'));
        // Actually zone folder may have file named exactly zone name without extension from earlier bug
        // e.g., ascendant-causeway file
        const legacyNoExt = files.filter(f => f === zone);
        for (const lf of legacyNoExt) {
          if (files.includes('zone.json')) {
            console.log(`✗ ${world}/${region}/${zone}: removing legacy no-ext file ${lf}`);
            if (!DRY_RUN) {
              try { fs.unlinkSync(path.join(zonePath, lf)); removed++; } catch(e){}
            }
          }
        }
      }
    }
  }
}

walk();
console.log(`\nRemoved/fixed: ${removed} files`);
if (DRY_RUN) console.log('*** DRY RUN ***');
