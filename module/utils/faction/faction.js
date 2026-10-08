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
 * Falls back to 0 (Indifferent) when no stored value exists.
 * @param {Actor} actor
 * @param {string} factionId
 * @returns {number}
 */
export function getFactionValue(actor, factionId)
{
    if (!actor || !factionId) return 0;
    const stored = actor.system?.factions?.[factionId];
    if (stored !== undefined && stored !== null)
        return clampFaction(stored);
    return 0;
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
    let note = `${actor.name}'s standing with ${factionId} ${dir} by ${Math.abs(amt)} (${before} to ${after}, ${afterLabel}).`;
    if (beforeLabel !== afterLabel)
        note += ` [${beforeLabel} -> ${afterLabel}]`;
    return note;
}