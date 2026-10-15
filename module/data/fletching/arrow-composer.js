/**
 * EQRMSS Arrow Composer (2026-10-15)
 * Combines head + shaft + fletch + nock into final arrow stats.
 *
 * User rulings (2026-10-15):
 * - Heads: damage bonus
 * - Shafts: damage bonus; ceramic requires pottery, steel requires smithing,
 *   wood/bone fashioned by fletchers directly
 * - Fletch: damage and range modifiers, by class (1-6)
 * - Nock: range modifier
 * - Difficulty: highest trivial among selected components
 */

const HEADS = {};
const SHAFTS = {};
const FLETCHES = {};
const NOCKS = {};

export async function loadArrowData() {
    const base = "systems/eqrmss/module/data/fletching";
    const [hRes, sRes, fRes, nRes] = await Promise.all([
        fetch(`${base}/arrow-heads.json`),
        fetch(`${base}/arrow-shafts.json`),
        fetch(`${base}/arrow-fletches.json`),
        fetch(`${base}/arrow-nocks.json`)
    ]);
    for (const h of await hRes.json()) HEADS[h.id] = h;
    for (const s of await sRes.json()) SHAFTS[s.id] = s;
    for (const f of await fRes.json()) FLETCHES[f.id] = f;
    for (const n of await nRes.json()) NOCKS[n.id] = n;
    console.log(`EQRMSS | Arrows loaded: ${Object.keys(HEADS).length} heads, ${Object.keys(SHAFTS).length} shafts, ${Object.keys(FLETCHES).length} fletches, ${Object.keys(NOCKS).length} nocks`);
}

export function getArrowHead(id) { return HEADS[id] ?? null; }
export function getArrowShaft(id) { return SHAFTS[id] ?? null; }
export function getArrowFletch(id) { return FLETCHES[id] ?? null; }
export function getArrowNock(id) { return NOCKS[id] ?? null; }
export function listArrowHeads() { return Object.values(HEADS); }
export function listArrowShafts() { return Object.values(SHAFTS); }
export function listArrowFletches() { return Object.values(FLETCHES); }
export function listArrowNocks() { return Object.values(NOCKS); }

/**
 * Compose an arrow from head + shaft + fletch + nock.
 * @returns {object} Final arrow stats
 */
export function composeArrow(headId, shaftId, fletchId, nockId, quality = "normal") {
    const head = HEADS[headId];
    const shaft = SHAFTS[shaftId];
    const fletch = FLETCHES[fletchId];
    const nock = NOCKS[nockId];
    if (!head) throw new Error(`Unknown arrow head: ${headId}`);
    if (!shaft) throw new Error(`Unknown arrow shaft: ${shaftId}`);
    if (!fletch) throw new Error(`Unknown fletching: ${fletchId}`);
    if (!nock) throw new Error(`Unknown nock: ${nockId}`);

    // Name: "CLASS 1 Wood Point Arrow" (EQ-style)
    const headName = head.id === "field-point" ? "Point" : head.id === "silver-tip" ? "Silver Tip" : head.name;
    const name = `CLASS ${fletch.class} ${shaft.name} ${headName} Arrow`;

    // Damage: head + shaft + fletch
    const damageBonus = head.damageBonus + shaft.damageBonus + fletch.damageBonus;

    // Range: fletch + nock
    const rangeMod = fletch.rangeMod + nock.rangeMod;

    // Difficulty: highest trivial among components
    const difficulty = Math.max(head.trivial, shaft.trivial, fletch.trivial, nock.trivial);

    const qualityPrefix = quality !== "normal" ? quality.charAt(0).toUpperCase() + quality.slice(1) + " " : "";

    return {
        name: qualityPrefix + name,
        baseName: name,
        headId: head.id,
        shaftId: shaft.id,
        fletchId: fletch.id,
        nockId: nock.id,
        arrowClass: fletch.class,
        damageBonus,
        rangeMod,
        difficulty,
        quality,
        quantity: 5,
        description: `Crafted arrows (${quality}). +${damageBonus} damage, ${rangeMod >= 0 ? "+" : ""}${rangeMod} range.`
    };
}

/**
 * Difficulty for a given component selection (max trivial).
 */
export function arrowDifficulty(headId, shaftId, fletchId, nockId) {
    const head = HEADS[headId];
    const shaft = SHAFTS[shaftId];
    const fletch = FLETCHES[fletchId];
    const nock = NOCKS[nockId];
    return Math.max(
        head?.trivial ?? 16,
        shaft?.trivial ?? 16,
        fletch?.trivial ?? 16,
        nock?.trivial ?? 16
    );
}
