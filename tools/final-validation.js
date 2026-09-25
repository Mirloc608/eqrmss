#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const GEO_BASE = process.env.GEO_BASE || 'module/data/geography/worlds';

console.log('\n=== FINAL VALIDATION ===\n');

let total=0, correct=0, both=0, legacyOnly=0, noMain=0, corrupted=0;

function walk() {
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
        total++;
        const zonePath = path.join(zonesPath, zone);
        const files = fs.readdirSync(zonePath);
        const hasZone = files.includes('zone.json');
        const hasLegacy = files.includes(`${zone}.json`);
        
        if (hasZone && !hasLegacy) {
          try {
            JSON.parse(fs.readFileSync(path.join(zonePath, 'zone.json'), 'utf8'));
            correct++;
          } catch {
            corrupted++;
            console.log(`✗ CORRUPTED: ${world}/${region}/${zone}/zone.json`);
          }
        } else if (hasZone && hasLegacy) {
          both++;
        } else if (!hasZone && hasLegacy) {
          legacyOnly++;
        } else {
          noMain++;
        }
      }
    }
  }
}

walk();

console.log(`Total zone folders: ${total}`);
console.log(`✓ Correct (zone.json literally): ${correct}`);
console.log(`⚠ Both exist: ${both}`);
console.log(`✗ Legacy only: ${legacyOnly}`);
console.log(`✗ No main: ${noMain}`);
console.log(`✗ Corrupted: ${corrupted}`);
console.log(`\nProgress: ${correct}/${total} = ${(correct/total*100).toFixed(1)}%`);

if (correct === total) {
  console.log('\n🎉 ALL ZONES MIGRATED TO zone.json LITERALLY!');
} else {
  console.log('\nRemaining work:');
  if (both>0) console.log(`- Run cleanup to remove ${both} legacy files`);
  if (legacyOnly>0) console.log(`- Run migration for ${legacyOnly} legacy-only`);
  if (noMain>0) console.log(`- Create ${noMain} missing zone.json`);
  if (corrupted>0) console.log(`- Fix ${corrupted} corrupted files`);
}
