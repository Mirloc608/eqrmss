// ============================================================
// EQRMSS Faction Utilities
// ============================================================

export const FACTION_STANDINGS = [

    {
        key:"ally",
        label:"Ally",
        min:1051,
        max:2000
    },

    {
        key:"warmly",
        label:"Warmly",
        min:701,
        max:1050
    },

    {
        key:"kindly",
        label:"Kindly",
        min:451,
        max:700
    },

    {
        key:"amiable",
        label:"Amiable",
        min:51,
        max:450
    },

    {
        key:"indifferent",
        label:"Indifferent",
        min:-49,
        max:50
    },

    {
        key:"apprehensive",
        label:"Apprehensive",
        min:-449,
        max:-50
    },

    {
        key:"dubious",
        label:"Dubious",
        min:-699,
        max:-450
    },

    {
        key:"threatening",
        label:"Threatening",
        min:-1049,
        max:-700
    },

    {
        key:"scowls",
        label:"Scowls",
        min:-2000,
        max:-1050
    }

];

export function getFactionStanding(a, b)
{

    // Overload (2026-10-07):
    //   getFactionStanding(value) -> level lookup (legacy numeric form)
    //   getFactionStanding(viewer, target) -> viewer's standing detail
    if (b !== undefined)
        return getViewerFactionStanding(a, b);

    return getFactionLevel(a);

}

export function getEffectiveFaction(actor, faction)
{

    const modifiers =
        actor?.system?.faction?.modifiers ?? {};

    return Number(
        faction +
        (modifiers[faction] ?? 0)
    );

}

// ============================================================
// FACTION STANDINGS ON ACTORS (2026-10-07)
//
// Actors track faction standings at:
//   system.factions = { "<faction-id>": <value> }
// Values range -2000 (Scowls) to +2000 (Ally).
//
// Illusion interaction (user ruling 2026-10-07): if the viewer
// has an active illusion (system.status.illusion.race), faction
// checks use the illusory race instead of the viewer's real race.
// ============================================================

/** Clamp a faction value to the official -2000..2000 range. */
export function clampFaction(value)
{
    return Math.max(-2000, Math.min(2000, Math.round(Number(value) || 0)));
}

/**
 * Get the faction level for a numeric value (official EQ thresholds).
 * @param {number} value - faction standing (-2000 to 2000)
 * @returns {object} standing entry { key, label, min, max }
 */
export function getFactionLevel(value)
{
    const standing = Number(value ?? 0);
    return (
        FACTION_STANDINGS.find(
            s =>
            standing >= s.min &&
            standing <= s.max
        )
        ??
        FACTION_STANDINGS[4]
    );
}

/**
 * Get an actor's numeric standing with a faction.
 * Lookup chain (2026-10-08):
 *   1. Stored value at system.factions[factionId] (player-modified via
 *      Alliance, quests, kills, etc.)
 *   2. Starting reputation from faction_reputations.json for the actor's
 *      race starting city (lazy — no character-creation changes needed)
 *   3. 0 (Indifferent)
 * @param {Actor} actor
 * @param {string} factionId - slugified faction id (see slugifyFactionName)
 * @returns {number}
 */
export function getFactionValue(actor, factionId)
{
    if (!actor || !factionId) return 0;
    const stored = actor.system?.factions?.[factionId];
    if (stored !== undefined && stored !== null)
        return clampFaction(stored);
    const starting = getStartingFactionValue(actor, factionId);
    if (starting !== null)
        return clampFaction(starting);
    return 0;
}

// ============================================================
// FACTION DATA REGISTRY (2026-10-08)
//
// Wires module/data/origin/factions.json (full EQ faction list)
// and faction_reputations.json (city-based starting values) to
// the runtime. Data is lazy-loaded from game.eqrmss.origin and
// cached; no character-creation changes needed.
// ============================================================

let _factionRegistry = null;
let _factionRegistryKey = null;

/**
 * Slugify a faction name into a stable ID.
 * "Guards of Qeynos" -> "guards-of-qeynos"
 * @param {string} name
 * @returns {string}
 */
export function slugifyFactionName(name)
{
    return String(name ?? "")
        .toLowerCase()
        .replace(/['']/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Build (and cache) the faction registry from loaded origin data.
 * @returns {{ bySlug: Map, byName: Map, reputations: object, raceAvailability: object }|null}
 */
export function getFactionRegistry()
{
    const origin = globalThis.game?.eqrmss?.origin ?? null;
    const factions = origin?.factions ?? [];
    const reputations = origin?.factionReputations ?? {};
    const raceAvailability = origin?.raceAvailability ?? {};
    const key = `${factions.length}:${Object.keys(reputations).length}`;
    if (_factionRegistry && _factionRegistryKey === key)
        return _factionRegistry;

    const bySlug = new Map();
    const byName = new Map();
    for (const f of factions)
    {
        if (!f || !f.name) continue;
        const slug = slugifyFactionName(f.name);
        if (!slug || bySlug.has(slug)) continue;
        bySlug.set(slug, f);
        byName.set(String(f.name).toLowerCase(), slug);
    }

    _factionRegistry = { bySlug, byName, reputations, raceAvailability };
    _factionRegistryKey = key;
    return _factionRegistry;
}

/** Clear the cached faction registry (e.g., after data reload). */
export function clearFactionRegistry()
{
    _factionRegistry = null;
    _factionRegistryKey = null;
}

/**
 * Resolve a faction slug to its display name from factions.json.
 * Returns the slug itself if not found.
 * @param {string} factionId
 * @returns {string}
 */
export function getFactionDisplayName(factionId)
{
    if (!factionId) return "";
    const reg = getFactionRegistry();
    const entry = reg?.bySlug?.get(String(factionId));
    return entry?.name ?? String(factionId);
}

/**
 * Convert a race id ("dark-elf") to the display name used in
 * race_city_availability.json ("Dark Elf").
 * @param {string|null} raceId
 * @returns {string|null}
 */
export function raceIdToDisplayName(raceId)
{
    if (!raceId) return null;
    return String(raceId)
        .split(/[-_]+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
}

/**
 * Get the starting city for a race (first entry in race_city_availability).
 * @param {string|null} raceId
 * @returns {string|null} city name, or null
 */
export function getStartingCityForRace(raceId)
{
    const displayName = raceIdToDisplayName(raceId);
    if (!displayName) return null;
    const reg = getFactionRegistry();
    const cities = reg?.raceAvailability?.[displayName];
    if (Array.isArray(cities) && cities.length)
        return cities[0];
    return null;
}

/**
 * Look up the starting reputation value for an actor with a faction,
 * based on the actor's race starting city.
 * @param {Actor} actor
 * @param {string} factionId - slugified faction id
 * @returns {number|null} starting value, or null if no data
 */
export function getStartingFactionValue(actor, factionId)
{
    if (!actor || !factionId) return null;
    const reg = getFactionRegistry();
    if (!reg) return null;

    const effectiveRace = getEffectiveRace(actor);
    const city = getStartingCityForRace(effectiveRace);
    if (!city) return null;

    const cityReps = reg.reputations?.[city];
    if (!cityReps || typeof cityReps !== "object") return null;

    // Match by slug: reputation keys are display names ("Guards of Qeynos")
    const targetSlug = String(factionId).toLowerCase();
    for (const [repName, value] of Object.entries(cityReps))
    {
        if (slugifyFactionName(repName) === targetSlug)
            return Number(value) || 0;
    }
    return null;
}

/**
 * Get the viewer's effective race for faction purposes.
 * An active illusion overrides the real race (2026-10-07 ruling).
 * @param {Actor} viewer
 * @returns {string|null} race id, or null if unknown
 */
export function getEffectiveRace(viewer)
{
    const illusionRace = viewer?.system?.status?.illusion?.race ?? null;
    if (illusionRace) return String(illusionRace);
    return viewer?.system?.fixed_info?.race
        ?? viewer?.system?.details?.race
        ?? null;
}

/**
 * Get the viewer's standing with the target's faction.
 * Overload: getFactionStanding(value) -> level lookup (legacy).
 *           getFactionStanding(viewer, target) -> standing detail.
 * @param {Actor|number} a - viewer actor, or numeric value (legacy)
 * @param {Actor} [b] - target actor
 * @returns {object|null} { faction, value, level, viaIllusion, effectiveRace }
 *                        or standing entry for the legacy form; null if
 *                        the target has no faction.
 */
export function getViewerFactionStanding(viewer, target)
{
    const factionId = target?.system?.npc?.faction ?? null;
    if (!factionId) return null;
    const effectiveRace = getEffectiveRace(viewer);
    const viaIllusion = !!(viewer?.system?.status?.illusion?.race);
    const value = getFactionValue(viewer, factionId);
    return {
        faction: factionId,
        factionName: getFactionDisplayName(factionId),
        value,
        level: getFactionLevel(value),
        viaIllusion,
        effectiveRace
    };
}

/**
 * Adjust an actor's standing with a faction.
 * Values are clamped to -2000..2000.
 * Note: does NOT post chat itself — the caller displays the note.
 * @param {Actor} actor
 * @param {string} factionId
 * @param {number} amount - positive improves, negative worsens
 * @returns {Promise<string>} plain-text note of what happened
 */
export async function modifyFaction(actor, factionId, amount)
{
    if (!actor || !factionId) return "";
    const amt = Number(amount) || 0;
    const before = getFactionValue(actor, factionId);
    const after = clampFaction(before + amt);
    try
    {
        await actor.update({ [`system.factions.${factionId}`]: after });
    }
    catch (e) { /* ignore */ }
    const beforeLabel = getFactionLevel(before).label;
    const afterLabel = getFactionLevel(after).label;
    const dir = amt >= 0 ? "improves" : "worsens";
    const displayName = getFactionDisplayName(factionId);
    let note = `${actor.name}'s standing with ${displayName} ${dir} by ${Math.abs(amt)} (${before} to ${after}, ${afterLabel}).`;
    if (beforeLabel !== afterLabel)
        note += ` [${beforeLabel} -> ${afterLabel}]`;
    return note;
}