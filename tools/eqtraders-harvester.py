#!/usr/bin/env python3
"""
EQTraders Recipe Harvester for eqrmss.

Scrapes eqtraders.com recipe pages and outputs recipe JSON in the eqrmss schema.
Respects the site's terms: polite pacing, no aggressive retry.

Usage:
    python3 eqtraders-harvester.py --skill brewing --out brewing-fresh.json
    python3 eqtraders-harvester.py --skill tinkering --out tinkering-fresh.json

Supported skills: brewing, baking, smithing, tailoring, jewelcraft (jewelry),
                  fletching, alchemy, pottery, poison, research, fishing, tinkering

Output schema matches module/data/tradeskills/recipes/*.json:
    {
        "id": "slug-of-name",
        "name": "Display Name",
        "skill": "skill-brewing",
        "difficulty": <trivial>,
        "container": "Brew Barrel",
        "components": [{"id": "...", "name": "...", "qty": N, "type": "item"}],
        "product": {"type": "item", "template": "...", "name": "...", "qty": <yield>}
    }
"""

import argparse
import json
import re
import sys
import time
import html as htmlmod
import urllib.request
import urllib.parse

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
GAP = 5.0  # seconds between requests — be polite

# Map eqtraders skill names to eqrmss skill IDs
SKILL_MAP = {
    "brewing": "skill-brewing",
    "baking": "skill-baking",
    "smithing": "skill-smithing",
    "tailoring": "skill-tailoring",
    "jewelcraft": "skill-jewelcrafting",
    "jewelry": "skill-jewelcrafting",
    "fletching": "skill-fletching",
    "alchemy": "skill-alchemy",
    "pottery": "skill-pottery",
    "poison": "skill-poison-making",
    "research": "skill-research",
    "fishing": "skill-fishing",
    "tinkering": "skill-tinkering",
}

# eqtraders recipe index pages per skill (article IDs from eqtraders.com).
# Each skill maps to a LIST of URLs — many skills split recipes across
# subcategory pages (basic, expansion-specific, quest, etc.).
# Add more URLs as they're discovered; the harvester dedupes by recipe ID.
RECIPE_INDEX = {
    "brewing": [
        "http://eqtraders.com/recipes/recipe_page.php?menustr=010000000000&rsa=Brewing&sb=trivial",
    ],
    "baking": [
        # TODO: main baking page URL needed; TOB subpage below
        "http://www.eqtraders.com/recipes/recipe_page.php?article=1761&rsa=Baking&sb=trivial&so=desc&sub=TOB&menustr=010000000000&printer=tree",
    ],
    "smithing": [
        "http://www.eqtraders.com/recipes/recipe_page.php?article=58&rsa=Smithing&sb=trivial&sub=basic&menustr=080100020000",
        "https://eqtraders.com/recipes/recipe_page.php?article=435&rsa=Smithing&sb=item&sub=Sod&menustr=080100000000&printer=tree",
    ],
    "tailoring": [
        # TODO: tailoring page URLs needed
    ],
    "jewelcraft": [
        "http://www.eqtraders.com/recipes/recipe_page.php?article=167&rsa=Jewelcraft&sb=item&so=desc&sub=other&menustr=080070800000&printer=tree",
        "http://www.eqtraders.com/recipes/recipe_page.php?article=420&rsa=Jewelcraft&sb=item&sub=SoF&menustr=010000000000",
    ],
    "jewelry": [
        "http://www.eqtraders.com/recipes/recipe_page.php?article=167&rsa=Jewelcraft&sb=item&so=desc&sub=other&menustr=080070800000&printer=tree",
        "http://www.eqtraders.com/recipes/recipe_page.php?article=420&rsa=Jewelcraft&sb=item&sub=SoF&menustr=010000000000",
    ],
    "fletching": [
        "http://www.eqtraders.com/recipes/recipe_page.php?article=39&rsa=Fletching&sb=trivial&sub=&menustr=080060000000&printer=tree",
        "https://www.eqtraders.com/recipes/recipe_page.php?article=766&rsa=Fletching&sb=item&menustr=080060000000&printer=tree",
    ],
    "alchemy": [
        "http://www.eqtraders.com/recipes/recipe_page.php?article=376&rsa=Alchemy&sb=trivial&sub=other&menustr=080010700000&printer=tree",
        "http://www.eqtraders.com/recipes/recipe_page.php?article=360&rsa=Alchemy&sb=item&so=desc&sub=pop&menustr=010000000000&printer=tree",
    ],
    "pottery": [
        # Note: pottery uses a different script (pottery_recipe_page.php)
        "http://www.eqtraders.com/recipes/pottery_recipe_page.php?article=185&rsa=Pottery&sb=trivial&sub=potion&menustr=080090110000",
    ],
    "poison": [
        "http://www.eqtraders.com/recipes/recipe_page.php?article=52&rsa=Make%20Poison&sb=item&sub=&menustr=080080000000&printer=tree",
    ],
    "research": [
        # TODO: research page URLs needed
    ],
    "fishing": [
        # TODO: fishing page URLs needed
    ],
    "tinkering": [
        "http://www.eqtraders.com/recipes/recipe_page.php?article=66&rsa=Tinkering&sb=item&sub=&menustr=080120000000&printer=tree",
    ],
}

last_req = [0.0]

class Blocked(Exception):
    pass

def fetch(url):
    dt = GAP - (time.time() - last_req[0])
    if dt > 0:
        time.sleep(dt)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        last_req[0] = time.time()
        if e.code in (403, 429, 503):
            raise Blocked(f"HTTP {e.code} on {url}")
        raise
    last_req[0] = time.time()
    txt = data.decode("utf-8", "replace")
    low = txt.lower()
    if ("captcha" in low and "g-recaptcha" in low) or ("attention required" in low and "cloudflare" in low):
        raise Blocked(f"captcha/block page on {url}")
    return txt

def slug(name):
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")

def clean_text(h):
    t = re.sub(r"<br\s*/?>", "\n", h)
    t = re.sub(r"</(tr|div|p|h\d|td|th|li)>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = htmlmod.unescape(t)
    return t

def parse_recipe_lines(lines):
    """Parse line-based recipe entries into eqrmss schema.

    Structure per recipe:
        <trivial>            (number on its own line, or "no fail")
        <Item Name>
        [optional description]
        WT: ... Size: ...
        Class: ...
        Race: ...
        Components: A, B (2), C
        In: Container, ...
        Yield: N
        [optional notes]
    """
    recipes = []
    seen = set()
    i = 0
    n = len(lines)

    while i < n:
        # Look for trivial line (bare number) followed by a name line
        line = lines[i].strip()
        trivial = None
        name_idx = None

        if re.fullmatch(r"\d+", line):
            trivial = int(line)
            name_idx = i + 1
        elif line.lower() == "no fail":
            trivial = 0
            name_idx = i + 1
        else:
            i += 1
            continue

        if name_idx is None or name_idx >= n:
            i += 1
            continue

        name = lines[name_idx].strip()
        # Sanity: name should look like an item name, not a header
        if not name or len(name) > 80 or name.startswith("http"):
            i += 1
            continue

        # Scan forward for Components / In / Yield
        components = []
        container = ""
        yld = 1
        j = name_idx + 1
        while j < n and j < name_idx + 12:
            lj = lines[j].strip()
            # Stop at next recipe (bare number = next trivial)
            if re.fullmatch(r"\d+", lj) and j > name_idx + 3:
                break
            if lj.startswith("Components:"):
                comp_text = lj[len("Components:"):].strip()
                parts = re.split(r",\s*(?![^()]*\))", comp_text)
                for p in parts:
                    p = p.strip()
                    if not p:
                        continue
                    qm = re.match(r"(.+?)\s*\((\d+)\)\s*$", p)
                    if qm:
                        cname, qty = qm.group(1).strip(), int(qm.group(2))
                    else:
                        cname, qty = p, 1
                    cname = re.sub(r"\s*\(\*\)\s*$", "", cname).strip()
                    if cname:
                        components.append({
                            "id": slug(cname),
                            "name": cname,
                            "qty": qty,
                            "type": "item",
                        })
            elif lj.startswith("In:"):
                container = lj[len("In:"):].split(",")[0].strip()
            elif lj.startswith("Yield:"):
                ym = re.search(r"(\d+)", lj)
                if ym:
                    yld = int(ym.group(1))
            elif lj.lower() == "no fail" and trivial is None:
                trivial = 0
            j += 1

        if components and slug(name) not in seen:
            seen.add(slug(name))
            recipes.append({
                "id": slug(name),
                "name": name,
                "difficulty": trivial if trivial is not None else 0,
                "container": container,
                "components": components,
                "product": {
                    "type": "item",
                    "template": slug(name),
                    "name": name,
                    "qty": yld,
                },
            })
        i = j

    return recipes

def harvest_skill(skill):
    skill_id = SKILL_MAP.get(skill.lower())
    if not skill_id:
        print(f"Unknown skill: {skill}", file=sys.stderr)
        sys.exit(1)

    urls = RECIPE_INDEX.get(skill.lower(), [])
    if not urls:
        print(f"No index URLs configured for {skill}; add them to RECIPE_INDEX.", file=sys.stderr)
        sys.exit(1)

    seen = set()
    for url in urls:
        print(f"Fetching {url} ...", file=sys.stderr)
        html = fetch(url)
        text = clean_text(html)
        lines = [l.strip() for l in text.split("\n") if l.strip()]

        for r in parse_recipe_lines(lines):
            if r["id"] in seen:
                continue
            seen.add(r["id"])
            r["skill"] = skill_id
            # Reorder keys to match schema
            yield {
                "id": r["id"],
                "name": r["name"],
                "skill": r["skill"],
                "difficulty": r["difficulty"],
                "container": r["container"],
                "components": r["components"],
                "product": r["product"],
            }

def main():
    ap = argparse.ArgumentParser(description="Harvest eqtraders recipes into eqrmss schema")
    ap.add_argument("--skill", help="Tradeskill name (e.g. brewing)")
    ap.add_argument("--all", action="store_true", help="Harvest all configured skills")
    ap.add_argument("--out", help="Output JSON path (required with --skill; with --all, a directory)")
    args = ap.parse_args()

    if args.all:
        import os
        outdir = args.out or "."
        os.makedirs(outdir, exist_ok=True)
        total = 0
        for skill in sorted(RECIPE_INDEX):
            urls = RECIPE_INDEX[skill]
            if not urls:
                print(f"Skipping {skill}: no URLs configured", file=sys.stderr)
                continue
            try:
                recipes = list(harvest_skill(skill))
            except Blocked as b:
                print(f"STOPPED on {skill}: {b}", file=sys.stderr)
                sys.exit(2)
            path = os.path.join(outdir, f"{skill}-fresh.json")
            with open(path, "w") as f:
                json.dump(recipes, f, indent=2)
            print(f"Wrote {len(recipes)} recipes to {path}", file=sys.stderr)
            total += len(recipes)
        print(f"Total: {total} recipes across all skills", file=sys.stderr)
        return

    if not args.skill or not args.out:
        ap.error("--skill and --out are required (or use --all)")
    try:
        recipes = list(harvest_skill(args.skill))
    except Blocked as b:
        print(f"STOPPED: {b}", file=sys.stderr)
        sys.exit(2)

    with open(args.out, "w") as f:
        json.dump(recipes, f, indent=2)
    print(f"Wrote {len(recipes)} recipes to {args.out}", file=sys.stderr)

if __name__ == "__main__":
    main()
