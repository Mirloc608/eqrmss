#!/usr/bin/env python3
"""
EQRMSS Data Bundler (2026-10-14)
Bundles many small JSON files into fewer larger files for faster boot loading.

- AAs: 1,264 individual files → 4 bundle files (general, archetype, classes, mercenary)
- Spells: 275 chunk files → 16 class bundle files

Usage: python3 tools/bundle-data.py
Output: module/data/aas/bundles/*.json, module/data/spells/bundles/*.json

The loaders check for bundles first, falling back to individual files if missing.
Re-run after adding new AA/spell files.
"""

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
AAS_DIR = REPO_ROOT / "module" / "data" / "aas"
SPELLS_DIR = REPO_ROOT / "module" / "data" / "spells"

def bundle_aas():
    """Bundle AA files by category."""
    print("Bundling AAs...")
    bundles_dir = AAS_DIR / "bundles"
    bundles_dir.mkdir(exist_ok=True)
    
    # Categories: general, archetype, mercenary, and all classes
    categories = {
        "general": ["general"],
        "archetype": ["archetype"],
        "mercenary": ["mercenary"],
        "classes": []  # All class directories
    }
    
    # Find all class directories (excluding the special ones)
    special = {"general", "archetype", "mercenary", "bundles"}
    for d in AAS_DIR.iterdir():
        if d.is_dir() and d.name not in special and not d.name.startswith('.'):
            # Check if it contains AA files
            if list(d.glob("*.json")):
                categories["classes"].append(d.name)
    
    total_files = 0
    for bundle_name, dirs in categories.items():
        bundle_data = []
        for dir_name in dirs:
            dir_path = AAS_DIR / dir_name
            if not dir_path.exists():
                continue
            for json_file in sorted(dir_path.glob("*.json")):
                # Skip non-AA files
                if json_file.name.lower() in {"index.json", "manifest.json"}:
                    continue
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        # Store with source file for debugging
                        bundle_data.append({
                            "_source": str(json_file.relative_to(AAS_DIR)),
                            "data": data
                        })
                        total_files += 1
                except Exception as e:
                    print(f"  Warning: Could not load {json_file}: {e}", file=sys.stderr)
        
        # Write bundle
        bundle_path = bundles_dir / f"{bundle_name}.json"
        with open(bundle_path, 'w', encoding='utf-8') as f:
            json.dump(bundle_data, f, separators=(',', ':'))
        size_kb = bundle_path.stat().st_size / 1024
        print(f"  {bundle_name}.json: {len(bundle_data)} AAs, {size_kb:.1f} KB")
    
    print(f"  Total: {total_files} AA files bundled")
    return total_files

def bundle_spells():
    """Bundle spell chunks by class."""
    print("Bundling spells...")
    bundles_dir = SPELLS_DIR / "bundles"
    bundles_dir.mkdir(exist_ok=True)
    
    total_chunks = 0
    total_spells = 0
    
    for class_dir in sorted(SPELLS_DIR.iterdir()):
        if not class_dir.is_dir() or class_dir.name == "bundles" or class_dir.name.startswith('.'):
            continue
        if class_dir.name in {"backup", "old"}:
            continue
        
        class_name = class_dir.name.lower()
        bundle_data = []
        
        # Load all chunk files for this class
        for json_file in sorted(class_dir.glob("*.json")):
            if json_file.name.lower() in {"index.json", "manifest.json"}:
                continue
            try:
                with open(json_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    # Extract spells from various formats
                    spells = []
                    if isinstance(data, list):
                        spells = data
                    elif isinstance(data, dict):
                        if "spells" in data and isinstance(data["spells"], list):
                            spells = data["spells"]
                        elif "data" in data and isinstance(data["data"], list):
                            spells = data["data"]
                        else:
                            # Single spell or map
                            spells = [data]
                    
                    bundle_data.extend(spells)
                    total_chunks += 1
            except Exception as e:
                print(f"  Warning: Could not load {json_file}: {e}", file=sys.stderr)
        
        if bundle_data:
            # Write bundle
            bundle_path = bundles_dir / f"{class_name}.json"
            with open(bundle_path, 'w', encoding='utf-8') as f:
                json.dump(bundle_data, f, separators=(',', ':'))
            size_kb = bundle_path.stat().st_size / 1024
            print(f"  {class_name}.json: {len(bundle_data)} spells, {size_kb:.1f} KB")
            total_spells += len(bundle_data)
    
    print(f"  Total: {total_chunks} chunks → {total_spells} spells bundled")
    return total_chunks, total_spells

def main():
    print("EQRMSS Data Bundler")
    print("=" * 50)
    
    aa_count = bundle_aas()
    print()
    chunk_count, spell_count = bundle_spells()
    
    print()
    print("=" * 50)
    print(f"Done: {aa_count} AA files → 4 bundles")
    print(f"Done: {chunk_count} spell chunks → 16 class bundles")
    print()
    print("Loaders will use bundles automatically when present.")

if __name__ == "__main__":
    main()
