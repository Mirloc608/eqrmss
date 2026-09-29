// ============================================================
// EQRMSS — Item visibility helpers
// ============================================================
// Recourse / proc sub-components are functional items on the actor
// but should not clutter the spell/song lists:
//
// - Spells: companion "(Recourse)" entries, e.g.
//   "Growl of the Leopard (Recourse)", "Bonemaw's Bite Recourse II".
//   These are the caster-side component applied when the parent
//   spell is cast; they are not castable on their own.
// - Songs: the six Chant-of-X proc songs (Chaos, Flame, Frost,
//   Magic, Plague, Venom) are proc components of Chant of Battle,
//   not ordinary singable songs.
//
// A `system.hidden === true` flag is also honored, so individual
// items can be hidden regardless of name.

const RECOURSE_SPELL_RE = /recourse/i;
const PROC_CHANT_RE = /^chant of (chaos|flame|frost|magic|plague|venom)$/i;

/**
 * True when the item should be hidden from spell/song list displays.
 * The item stays on the actor and remains fully functional.
 */
export function isHiddenFromLists(item) {
  if (!item) return false;
  if (item?.system?.hidden === true) return true;
  const name = item?.name ?? "";
  if (item?.type === "spell" && RECOURSE_SPELL_RE.test(name)) return true;
  if (item?.type === "song" && PROC_CHANT_RE.test(name)) return true;
  return false;
}

/** Spells visible in spell lists (recourse companions excluded). */
export function visibleSpells(items) {
  return (items ?? []).filter(i => i?.type === "spell" && !isHiddenFromLists(i));
}

/** Songs visible in song lists (proc chants excluded). */
export function visibleSongs(items) {
  return (items ?? []).filter(i => i?.type === "song" && !isHiddenFromLists(i));
}
