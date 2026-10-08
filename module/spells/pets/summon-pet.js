// ============================================================
// EQRMSS Pet Summoning Engine (2026-10-08)
//
// Phase 1+2: Pet templates (derived from creature registry with
// level scaling) + summoning.
//
// User decisions (2026-10-08):
// 1. Pet stats derived from the 358 creature files, scaled by level
// 2. Pet acts on the same initiative turn, AFTER the owner
// 3. One pet limit enforced; swarm pets are DoTs, not pet actors
// 4. (Phase 5) Poof on logout unless persistence AA
// 5. Familiars use the same system, petType "familiar", no combat turn
// 6. Pets can receive heals/buffs as party members
// 7. Beastlord warder IDs decode programmatically; warder levels
//    with the beastlord (class companion, not a summon)
//
// Pet ID formats:
// - Magician: "elementalkin-fire", "elemental-fire" -> fire-elemental
// - Necro: "cavorting-bones", "bone-walk" -> skeleton
// - Shaman: "PCPetShmS07L032WolfGhoRk1" -> wolf, level 32
// - Beastlord: "s02-l008-warder" -> wolf, level 8
// - Enchanter: "pendrils-animation-pet" -> golem
// - Swarm: "swarm-*" -> DoT, NOT a pet actor
// ============================================================

const MODULE_ID = "eqrmss";

/**
 * Decode a Beastlord warder ID: "s02-l008-warder" ->
 * { spellLevel: 2, petLevel: 8 }.
 * The warder levels with the beastlord (class companion).
 */
export function decodeWarderId(petId) {
    const m = /^s(\d+)-l(\d+)-warder$/i.exec(String(petId ?? ""));
    if (!m) return null;
    return { spellLevel: Number(m[1]), petLevel: Number(m[2]) };
}

/**
 * Decode a Shaman pet ID: "PCPetShmS07L032WolfGhoRk1" ->
 * { spellLevel: 7, petLevel: 32, type: "wolf", rank: 1 }.
 * Format: PCPetShmS<spell>L<level>WolfGho[Rk<rank>]
 */
export function decodeShamanPetId(petId) {
    const m = /^PCPetShmS(\d+)L(\d+)WolfGho(?:Rk(\d+))?$/i.exec(String(petId ?? ""));
    if (!m) return null;
    return {
        spellLevel: Number(m[1]),
        petLevel: Number(m[2]),
        type: "wolf",
        rank: m[3] ? Number(m[3]) : 0,
    };
}

/**
 * Check if a pet ID is a swarm pet (DoT, not a real pet).
 * Swarm IDs start with "swarm-" (e.g., "swarm-s21-l105-warder").
 */
export function isSwarmPet(petId) {
    return String(petId ?? "").toLowerCase().startsWith("swarm-");
}

/**
 * Resolve a pet ID to a creature registry entry + pet level.
 *
 * @param {string} petId - The pet ID from spell data
 * @param {number} casterLevel - Caster's level (fallback for pet level)
 * @returns {{ creature, creatureId, petLevel, petName, family } | null}
 */
export function resolvePetCreature(petId, casterLevel) {
    const id = String(petId ?? "").toLowerCase();
    const races = globalThis.game?.eqrmss?.races ?? {};
    const level = Math.max(1, Number(casterLevel) || 1);

    // Helper: find creature by ID in the registry
    const findCreature = (cid) => races[cid] ?? null;

    // --- Magician elementals: "elementalkin-fire", "elemental-fire" ---
    let m = /^(elementalkin|elemental|child|conjuration|construct|conscription|convocation|aspect)-(\w+)$/.exec(id);
    if (m) {
        const element = m[2]; // fire, water, earth, air
        const creature = findCreature(`${element}-elemental`);
        if (creature) {
            return {
                creature, creatureId: `${element}-elemental`,
                petLevel: level,
                petName: creature.name ?? `${cap(element)} Elemental`,
                family: "elemental",
            };
        }
    }

    // --- Necromancer: descriptive names -> skeleton/shade ---
    // Map known necro pet IDs to creatures
    const necroMap = {
        "cavorting-bones": "skeleton",
        "leering-corpse": "skeleton",
        "bone-walk": "skeleton",
        "cackling-bones": "skeleton",
        "call-skeleton": "skeleton",
        "animate-dead": "skeleton",
        "dark-assassin": "shade",
    };
    // Also try fuzzy: if ID contains "skeleton" or "bone" or "corpse"
    if (necroMap[id] || /skeleton|bone|corpse|zombie/.test(id)) {
        const cid = necroMap[id] ?? (/shade|assassin|wraith/.test(id) ? "shade" : "skeleton");
        const creature = findCreature(cid);
        if (creature) {
            return {
                creature, creatureId: cid,
                petLevel: level,
                petName: creature.name ?? "Skeleton",
                family: "undead",
            };
        }
    }

    // --- Shaman: PCPetShmS07L032WolfGhoRk1 -> wolf ---
    const shm = decodeShamanPetId(petId);
    if (shm) {
        const creature = findCreature("wolf");
        if (creature) {
            return {
                creature, creatureId: "wolf",
                petLevel: shm.petLevel,
                petName: creature.name ?? "Spirit Wolf",
                family: "animal",
            };
        }
    }

    // --- Beastlord: s02-l008-warder -> wolf (warder levels with beastlord) ---
    const warder = decodeWarderId(petId);
    if (warder) {
        const creature = findCreature("wolf");
        if (creature) {
            return {
                creature, creatureId: "wolf",
                petLevel: warder.petLevel,
                petName: creature.name ?? "Warder",
                family: "animal",
                isWarder: true,
            };
        }
    }

    // --- Enchanter: "<name>s-animation-pet" -> golem/construct ---
    m = /^(\w+)s-animation-pet$/.exec(id);
    if (m) {
        const creature = findCreature("golem") ?? findCreature("clockwork-gnome");
        if (creature) {
            return {
                creature, creatureId: creature.id ?? "golem",
                petLevel: level,
                petName: `${cap(m[1])}'s Animation`,
                family: "construct",
            };
        }
    }

    // --- Fallback: try the pet ID directly as a creature ID ---
    const direct = findCreature(id);
    if (direct) {
        return {
            creature: direct, creatureId: id,
            petLevel: level,
            petName: direct.name ?? id,
            family: direct.creatureType ?? "animal",
        };
    }

    return null;
}

/**
 * Scale creature stats to a pet's level (RMSS-native).
 *
 * Uses the creature's `chart` (RMSS stats) if present, scaled by
 * level ratio. Otherwise falls back to level-based defaults.
 *
 * @param {object} creature - Creature registry entry
 * @param {number} petLevel - Target pet level
 * @returns {{ hits, defense, ob, level }}
 */
export function scalePetStats(creature, petLevel) {
    const level = Math.max(1, Math.round(Number(petLevel) || 1));
    const chart = creature?.chart ?? {};
    const chartLevel = Math.max(1, Number(chart.level) || 1);
    const ratio = level / chartLevel;

    // Hits: scale chart hits by level ratio, or level * 8 fallback
    // (d10-ish average, reasonable for a combat pet)
    const hits = chart.hits
        ? Math.max(10, Math.round(Number(chart.hits) * ratio))
        : Math.max(10, level * 8);

    // Defense: scale chart DB (capped at 2x to avoid runaway),
    // or 15 + level fallback
    const defense = chart.db
        ? Math.round(Number(chart.db) * Math.min(ratio, 2))
        : 15 + level;

    // OB: pet level * 1.5 + 10 (simple, scales with level)
    const ob = Math.round(level * 1.5) + 10;

    return { hits, defense, ob, level };
}

/**
 * Find the caster's current active pet (one-pet limit).
 *
 * @param {object} caster - Caster actor
 * @returns {object|null} Pet actor or null
 */
export function findCasterPet(caster) {
    if (!caster) return null;
    const casterId = caster.id;
    try {
        const pets = (globalThis.game?.actors ?? []).filter(a =>
            a?.type === "pet" &&
            (a?.system?.pet?.owner === casterId || a?.getFlag(MODULE_ID, "ownerId") === casterId)
        );
        return pets[0] ?? null;
    } catch { return null; }
}

/**
 * Dismiss a pet (delete the actor + its tokens).
 *
 * @param {object} petActor - Pet actor to dismiss
 * @param {string} reason - Reason for dismissal (for chat)
 * @returns {Promise<string>} Chat note
 */
export async function dismissPet(petActor, reason = "dismissed") {
    if (!petActor) return "";
    const name = petActor.name ?? "Pet";
    try {
        await petActor.delete();
    } catch (err) {
        console.warn("EQRMSS | dismissPet failed:", err);
    }
    return `<p><em>${esc(name)} ${esc(reason)}.</em></p>`;
}

/**
 * Summon a pet for the caster.
 *
 * 1. Resolves petId -> creature + level
 * 2. Enforces one-pet limit (dismisses existing pet)
 * 3. Creates pet actor (type "pet")
 * 4. Creates token adjacent to caster
 * 5. Sets ownership
 *
 * @param {object} caster - Caster actor
 * @param {string} petId - Pet ID from spell data
 * @param {string} spellName - Name of the summoning spell
 * @param {number} spellManaCost - Mana cost (stored for Reclaim Energy)
 * @returns {Promise<string>} HTML chat note
 */
export async function summonPet(caster, petId, spellName, spellManaCost) {
    const escFn = esc;
    if (!caster) return `<p><em>Pet summon failed: no caster.</em></p>`;

    // Ownership check
    const canControl = caster.isOwner || globalThis.game?.user?.isGM;
    if (!canControl) {
        return `<p><em>Pet not summoned — you don't control ${escFn(caster.name)}.</em></p>`;
    }

    const casterLevel = Number(caster?.system?.attributes?.level?.value) || 1;

    // Resolve pet ID -> creature
    const resolved = resolvePetCreature(petId, casterLevel);
    if (!resolved) {
        return `<p><em>Pet summon failed: unknown pet "${escFn(petId)}".</em></p>`;
    }

    const { creature, petLevel, petName, family } = resolved;
    const stats = scalePetStats(creature, petLevel);

    // One-pet limit: dismiss existing pet first
    let dismissNote = "";
    const existing = findCasterPet(caster);
    if (existing) {
        dismissNote = await dismissPet(existing, "is dismissed to make way for a new companion");
    }

    // Build pet actor data
    const petData = {
        name: petName,
        type: "pet",
        img: creature.img && creature.img !== "PLACEHOLDER" ? creature.img : "icons/svg/pawprint.svg",
        system: {
            hits: { base: stats.hits, value: 0, max: stats.hits },
            attributes: { level: { value: petLevel } },
            details: { creatureType: creature.creatureType ?? family },
            pet: {
                petType: "combat",
                family,
                owner: caster.id,
                ownerLevel: casterLevel,
                summonSpell: spellName ?? "",
                summonManaCost: Number(spellManaCost) || 0,
                command: "follow",
                scaling: {
                    hits: stats.hits,
                    defense: stats.defense,
                    ob: stats.ob,
                },
            },
        },
        flags: {
            [MODULE_ID]: {
                ownerId: caster.id,
                petCreatureId: resolved.creatureId,
            },
        },
    };

    let petActor;
    try {
        petActor = await globalThis.Actor.create(petData);
    } catch (err) {
        console.error("EQRMSS | summonPet: Actor.create failed:", err);
        return `<p><em>Pet summon failed: ${escFn(err?.message ?? "unknown error")}.</em></p>`;
    }
    if (!petActor) {
        return `<p><em>Pet summon failed: could not create pet actor.</em></p>`;
    }

    // Set Foundry ownership so the caster's player controls the pet
    try {
        const casterOwners = caster.ownership ?? {};
        const newOwnership = { ...casterOwners };
        // Ensure at least the caster's owners carry over
        await petActor.update({ ownership: newOwnership });
    } catch (err) {
        console.warn("EQRMSS | summonPet: ownership update failed:", err);
    }

    // Create token adjacent to caster on the caster's scene
    try {
        const casterToken = caster.getActiveTokens?.()?.[0] ?? null;
        const scene = casterToken?.scene ?? globalThis.game?.scenes?.active ?? null;
        if (scene && casterToken) {
            const cx = casterToken.document?.x ?? casterToken.x ?? 0;
            const cy = casterToken.document?.y ?? casterToken.y ?? 0;
            const grid = scene.grid?.size ?? 100;
            // Place to the right of the caster
            const tokenData = {
                name: petName,
                actorId: petActor.id,
                x: cx + grid,
                y: cy,
                disposition: casterToken.document?.disposition ?? 1,
            };
            await scene.createEmbeddedDocuments("Token", [tokenData]);
        }
    } catch (err) {
        console.warn("EQRMSS | summonPet: token creation failed:", err);
    }

    return `${dismissNote}<p><em>${escFn(caster.name)} summons ${escFn(petName)} (level ${petLevel}).</em></p>`;
}

/**
 * Handle a swarm pet effect as a DoT (NOT a pet actor).
 *
 * Per user decision (2026-10-08): "Swarm pets are basically just dots."
 * Creates a DoT entry on the target instead of a pet actor.
 *
 * @param {object} caster - Caster actor
 * @param {object} target - Target actor
 * @param {string} petId - Swarm pet ID (e.g., "swarm-s21-l105-warder")
 * @param {number} duration - Duration in rounds
 * @param {string} spellName - Spell name
 * @returns {Promise<string>} HTML chat note
 */
export async function swarmPetAsDot(caster, target, petId, duration, spellName) {
    const tgt = target ?? caster;
    if (!tgt) return `<p><em>Swarm failed: no target.</em></p>`;

    // Extract level from ID for damage scaling (e.g., l105 -> 105)
    let petLevel = 1;
    const lm = /l(\d+)/i.exec(String(petId ?? ""));
    if (lm) petLevel = Math.max(1, Number(lm[1]));

    // DoT damage: pet level / 5 per round (placeholder, clearly marked)
    // TODO(EQ canon): get real swarm pet DPS values
    const dmgPerRound = Math.max(1, Math.round(petLevel / 5));
    const rounds = Math.max(1, Number(duration) || 3);

    const dot = {
        name: spellName ?? "Swarm",
        element: "physical",
        min: dmgPerRound,
        max: dmgPerRound,
        roundsLeft: rounds,
        source: "spell",
        isSwarm: true,
    };

    try {
        const dots = Array.isArray(tgt.system?.status?.dots) ? [...tgt.system.status.dots] : [];
        dots.push(dot);
        await tgt.update({ "system.status.dots": dots });
    } catch (err) {
        console.warn("EQRMSS | swarmPetAsDot failed:", err);
        return `<p><em>Swarm failed: ${esc(err?.message ?? "unknown error")}.</em></p>`;
    }

    return `<p><em>${esc(tgt.name)} is swarmed (${dmgPerRound}/round for ${rounds} rounds).</em></p>`;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function cap(s) {
    s = String(s ?? "");
    return s.charAt(0).toUpperCase() + s.slice(1);
}

const esc = (s) => globalThis.foundry?.utils?.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
