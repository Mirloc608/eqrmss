// ============================================================
// EQRMSS Summon Warder — Beastlord Signature Ability (2026-10-08)
//
// Calls the beastlord's bonded warder (wolf) via the pet engine.
// The warder is a permanent class companion: pet level equals the
// beastlord's level at summon time (user ruling 2026-10-08).
//
// Pet ID "s01-l001-warder" decodes via decodeWarderId(); the warder
// branch of resolvePetCreature() always uses caster level for the
// pet level, so the encoded level is irrelevant.
// ============================================================

import { summonPet } from "./summon-pet.js";

const MODULE_ID = "eqrmss";
const WARDER_PET_ID = "s01-l001-warder";

/**
 * Resolve an actor's class ID using the same fallbacks as the
 * spell engine (module/spells/spell-mapping.js).
 */
export function getActorClassId(actor) {
    const sys = actor?.system ?? {};
    return String(sys.origin?.classId ?? sys.fixed_info?.classId ?? sys.classId ?? "").toLowerCase();
}

/**
 * True when the actor is a beastlord.
 */
export function isBeastlord(actor) {
    return getActorClassId(actor) === "beastlord";
}

/**
 * Use the Summon Warder signature ability: summon (or re-summon)
 * the beastlord's warder at the beastlord's current level.
 *
 * summonPet() enforces the one-pet limit, so an existing warder is
 * dismissed first ("dismissed to make way for a new companion").
 *
 * @param {object} actor - Beastlord actor
 * @returns {Promise<void>}
 */
export async function useSummonWarder(actor) {
    if (!actor) return;
    if (!isBeastlord(actor)) {
        globalThis.ui?.notifications?.warn("Summon Warder is a Beastlord signature ability.");
        return;
    }
    const casterLevel = Math.max(1, Number(actor?.system?.attributes?.level?.value) || 1);
    // Mana cost 0: signature ability, not a spell. spellLevel is unused
    // by the warder branch (pet level = caster level).
    const note = await summonPet(actor, WARDER_PET_ID, "Summon Warder", 0, casterLevel);
    try {
        await globalThis.ChatMessage.create({
            speaker: globalThis.ChatMessage.getSpeaker({ actor }),
            content: `<h3>Signature Ability — Summon Warder</h3>${note}`,
        });
    } catch (err) {
        console.warn("EQRMSS | useSummonWarder: chat post failed:", err);
    }
}

// Flag key the pet manager / sheets can use to detect the ability.
export const SUMMON_WARDER_FLAG = `${MODULE_ID}.summonWarder`;
