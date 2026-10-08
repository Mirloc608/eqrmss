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
// - Magician: element SUFFIX ("lesser-summoning-air", "aspect-of-fire") ->
//   <element>-elemental (pet level = SPELL level). Excludes monster-summoning-*.
// - Magician servants ("raging-servant", "summon-servant-*") -> earth-elemental
// - Necro: "cavorting-bones", "bone-walk" -> skeleton (pet level = SPELL level)
// - Necro (ID): "PCPetNecS02L008Skel2Ice" -> skeleton, level 8 (decoded from ID)
// - Necro/Shade: "*shade*", "*assassin*", "*shadow*" -> shade
// - Necro/SK: "minion*", undead keywords -> skeleton
// - Wizard: "*blade*", "*sword*" -> animated-armor
// - Aliases: spore -> sporali; companion -> golem; hammer-of-wrath -> animated-armor
// - Shaman: "PCPetShmS07L032WolfGhoRk1" -> wolf, level 32 (decoded from ID)
// - Beastlord: "s02-l008-warder" -> wolf (pet level = BEASTLORD level, levels with owner)
// - Enchanter: "pendrils-animation-pet" -> golem (pet level = SPELL level)
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
 * Decode a Necromancer pet ID: "PCPetNecS02L008Skel2Ice" ->
 * { spellLevel: 2, petLevel: 8, type: "Skel2Ice" }.
 * Format: PCPetNecS<spell>L<level><type>
 * Type prefixes: "Skel" = skeleton (variant number + element suffix
 * like "Ice" are visual-only); "Spect"/"Spectre" = spectre if present.
 */
export function decodeNecromancerPetId(petId) {
    const m = /^PCPetNecS(\d+)L(\d+)([A-Za-z0-9]+)$/i.exec(String(petId ?? ""));
    if (!m) return null;
    return {
        spellLevel: Number(m[1]),
        petLevel: Number(m[2]),
        type: m[3],
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
 * Pet level rules (2026-10-08):
 * - Magician/Enchanter/Necro: pet level = SPELL level (not caster level)
 * - Shaman/Necro (coded IDs): decoded from pet ID (e.g., L032 / L008)
 * - Beastlord warder: levels WITH the beastlord = caster level
 *
 * @param {string} petId - The pet ID from spell data
 * @param {number} casterLevel - Caster's level (warder + fallback)
 * @param {number} spellLevel - Spell's level (mag/ench/necro pet level)
 * @returns {{ creature, creatureId, petLevel, petName, family } | null}
 */
export function resolvePetCreature(petId, casterLevel, spellLevel) {
    const id = String(petId ?? "").toLowerCase();
    const races = globalThis.game?.eqrmss?.races ?? {};
    const cLevel = Math.max(1, Number(casterLevel) || 1);
    const sLevel = Math.max(1, Number(spellLevel) || cLevel);

    // Helper: find creature by ID in the registry
    const findCreature = (cid) => races[cid] ?? null;

    // --- Magician elementals: match the ELEMENT SUFFIX ---
    // "lesser-summoning-air", "greater-vocaration-of-fire", "aspect-fire",
    // "core-of-water", "embodiment-of-earth", ...
    // Pet level = SPELL level (2026-10-08: not caster level).
    // Excludes monster-summoning-* (random monsters, different mechanic).
    let m = null;
    if (!id.startsWith("monster-summoning")) {
        m = /-(?:of-)?(air|earth|fire|water)$/.exec(id);
    }
    if (m) {
        const element = m[1]; // fire, water, earth, air
        const creature = findCreature(`${element}-elemental`);
        if (creature) {
            return {
                creature, creatureId: `${element}-elemental`,
                petLevel: sLevel,
                petName: creature.name ?? `${cap(element)} Elemental`,
                family: "elemental",
            };
        }
    }

    // --- Necromancer (coded ID): "PCPetNecS02L008Skel2Ice" -> skeleton ---
    // Pet level decoded from ID (like Shaman). "Skel" = skeleton;
    // variant number + element suffix ("2Ice") are visual-only.
    const nec = decodeNecromancerPetId(petId);
    if (nec) {
        const t = String(nec.type ?? "").toLowerCase();
        // All coded necro pets in data are skeletons ("Skel2", "Skel2Ice");
        // keep the spectre branch for future variants.
        const cid = t.startsWith("spect") ? "spectre" : "skeleton";
        const creature = findCreature(cid);
        if (creature) {
            return {
                creature, creatureId: cid,
                petLevel: nec.petLevel,
                petName: creature.name ?? "Skeleton",
                family: "undead",
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
        "restless-bones": "skeleton",
        "dark-assassin": "shade",
    };
    // Also try fuzzy: if ID contains "skeleton" or "bone" or "corpse"
    // Pet level = SPELL level (2026-10-08)
    if (necroMap[id] || /skeleton|bone|corpse|zombie/.test(id)) {
        const cid = necroMap[id] ?? (/shade|assassin|wraith/.test(id) ? "shade" : "skeleton");
        const creature = findCreature(cid);
        if (creature) {
            return {
                creature, creatureId: cid,
                petLevel: sLevel,
                petName: creature.name ?? "Skeleton",
                family: "undead",
            };
        }
    }

    // --- Pet-ID coverage rules (2026-10-08) ---
    // Ordered AFTER the necro branch. Undead servants must resolve as
    // skeletons, not get swept into the mage-earth servant rule below.
    {
        // 1. Alias map (EQ pet -> creature). "companion" also matches as a
        //    substring (saryrns-companion).
        const aliasMap = {
            "spore": { cid: "sporali", family: "plant" },
            "companion": { cid: "golem", family: "construct" },
            "summon-companion": { cid: "golem", family: "construct" },
            "hammer-of-wrath": { cid: "animated-armor", family: "construct" },
        };
        const alias = aliasMap[id] ??
            (id.includes("companion") ? { cid: "golem", family: "construct" } : null);
        if (alias) {
            const creature = findCreature(alias.cid);
            if (creature) {
                return {
                    creature, creatureId: alias.cid,
                    petLevel: sLevel,
                    petName: creature.name ?? alias.cid,
                    family: alias.family,
                };
            }
        }
    }

    // 2. Undead keywords -> skeleton. Must precede the servant rule so
    //    noxious-servant / putrescent-servant stay undead. The "skelet"
    //    substring catches skeletal-servant (shadowknight).
    {
        const undeadIds = new Set([
            "summon-dead", "malignant-dead", "invoke-death",
            "son-of-decay", "emissary-of-thule",
            "noxious-servant", "putrescent-servant",
        ]);
        if (undeadIds.has(id) || id.includes("skelet")) {
            const creature = findCreature("skeleton");
            if (creature) {
                return {
                    creature, creatureId: "skeleton",
                    petLevel: sLevel,
                    petName: creature.name ?? "Skeleton",
                    family: "undead",
                };
            }
        }
    }

    // 3. Servants -> earth-elemental. In EQ, magician servant pets are
    //    earth elementals. (Undead servants were caught by rule 2 above;
    //    every remaining *servant* ID is magician.)
    if (id.includes("servant")) {
        const creature = findCreature("earth-elemental");
        if (creature) {
            return {
                creature, creatureId: "earth-elemental",
                petLevel: sLevel,
                petName: creature.name ?? "Earth Elemental",
                family: "elemental",
            };
        }
    }

    // 4. Shades / assassins / shadows -> shade
    if (/shade|assassin|shadow/.test(id)) {
        const creature = findCreature("shade");
        if (creature) {
            return {
                creature, creatureId: "shade",
                petLevel: sLevel,
                petName: creature.name ?? "Shade",
                family: "undead",
            };
        }
    }

    // 5. Minions -> skeleton
    if (id.includes("minion")) {
        const creature = findCreature("skeleton");
        if (creature) {
            return {
                creature, creatureId: "skeleton",
                petLevel: sLevel,
                petName: creature.name ?? "Skeleton",
                family: "undead",
            };
        }
    }

    // 6. Animated blades / swords (wizard sword pets) -> animated-armor
    if (id.includes("blade") || id.includes("sword")) {
        const creature = findCreature("animated-armor");
        if (creature) {
            return {
                creature, creatureId: "animated-armor",
                petLevel: sLevel,
                petName: creature.name ?? "Animated Armor",
                family: "construct",
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

    // --- Beastlord: s02-l008-warder -> wolf ---
    // Warder levels WITH the beastlord (user ruling 2026-10-08) = caster level
    const warder = decodeWarderId(petId);
    if (warder) {
        const creature = findCreature("wolf");
        if (creature) {
            return {
                creature, creatureId: "wolf",
                petLevel: cLevel,
                petName: creature.name ?? "Warder",
                family: "animal",
                isWarder: true,
            };
        }
    }

    // --- Enchanter: "<name>s-animation-pet" -> golem/construct ---
    // Pet level = SPELL level (2026-10-08)
    m = /^(\w+)s-animation-pet$/.exec(id);
    if (m) {
        const creature = findCreature("golem") ?? findCreature("clockwork-gnome");
        if (creature) {
            return {
                creature, creatureId: creature.id ?? "golem",
                petLevel: sLevel,
                petName: `${cap(m[1])}'s Animation`,
                family: "construct",
            };
        }
    }

    // --- Fallback: try the pet ID directly as a creature ID ---
    // Pet level = SPELL level (2026-10-08)
    const direct = findCreature(id);
    if (direct) {
        return {
            creature: direct, creatureId: id,
            petLevel: sLevel,
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
 * Handles both base actors and synthetic token actors: token documents are
 * deleted first (which cascades their combatants and synthetic actors), then
 * the base actor. Non-fatal — a failure to delete one document never blocks
 * the rest, so a dismiss can never leave the game in a half-broken state.
 *
 * @param {object} petActor - Pet actor to dismiss (base or synthetic token actor)
 * @param {string} reason - Reason for dismissal (for chat)
 * @returns {Promise<string>} Chat note
 */
export async function dismissPet(petActor, reason = "dismissed") {
    if (!petActor) return "";
    const name = petActor.name ?? "Pet";
    const game = globalThis.game;
    try {
        // Synthetic token actors (sheet opened from a token) cannot be
        // deleted directly — their parent is the TokenDocument, and deleting
        // the actor throws "ActorDelta ... does not exist".
        let baseActor = petActor;
        const tokenDocs = [];
        if (petActor.isToken) {
            const tok = petActor.parent ?? null;
            if (tok && !tokenDocs.includes(tok)) tokenDocs.push(tok);
            baseActor = game?.actors?.get(petActor.id) ?? null;
        }
        // Sweep every scene for tokens linked to the pet actor.
        const actorId = baseActor?.id ?? petActor.id;
        for (const scene of game?.scenes ?? []) {
            for (const tok of scene.tokens ?? []) {
                if (tok.actorId === actorId && !tokenDocs.includes(tok)) tokenDocs.push(tok);
            }
        }
        // Delete tokens first (cascades combatants + synthetic actors).
        for (const tok of tokenDocs) {
            try { await tok.delete(); }
            catch (err) { console.warn("EQRMSS | dismissPet: token delete failed:", err); }
        }
        // Then delete the base actor.
        if (baseActor && !baseActor.isToken) {
            try { await baseActor.delete(); }
            catch (err) { console.warn("EQRMSS | dismissPet: actor delete failed:", err); }
        }
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
 * @param {number} spellLevel - Spell's level (pet level for mag/ench/necro, 2026-10-08)
 * @returns {Promise<string>} HTML chat note
 */
export async function summonPet(caster, petId, spellName, spellManaCost, spellLevel) {
    const escFn = esc;
    if (!caster) return `<p><em>Pet summon failed: no caster.</em></p>`;

    // Ownership check
    const canControl = caster.isOwner || globalThis.game?.user?.isGM;
    if (!canControl) {
        return `<p><em>Pet not summoned — you don't control ${escFn(caster.name)}.</em></p>`;
    }

    const casterLevel = Number(caster?.system?.attributes?.level?.value) || 1;

    // Resolve pet ID -> creature (pet level from spell level per 2026-10-08)
    const resolved = resolvePetCreature(petId, casterLevel, spellLevel);
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
                // All pets count as magical attackers (user decision 2026-10-08).
                // They can hit creatures requiring magic weapons.
                // HOOK: If a "requires magic weapon" creature mechanic is added,
                // check this flag in the attack resolution pipeline.
                isMagical: true,
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

    // Create token adjacent to the caster when the caster has a token on the
    // viewed scene; otherwise fall back to the viewed scene's center with a
    // visible warning. Prefer the viewed scene so the token always lands
    // where the user can see it (2026-10-08: silent-failure fix).
    let petTokenDoc = null;
    let tokenWarnNote = "";
    try {
        const game = globalThis.game;
        const casterToken = caster.getActiveTokens?.()?.[0] ?? null;
        const viewedScene =
            game?.scenes?.viewed ?? globalThis.canvas?.scene ?? game?.scenes?.active ?? null;
        const scene = casterToken?.scene ?? viewedScene;
        if (!scene) {
            tokenWarnNote = `<p><em>Pet token not created: no scene available.</em></p>`;
        } else {
            const grid = scene.grid?.size ?? 100;
            let tx;
            let ty;
            let disp = 1;
            if (casterToken) {
                const cx = casterToken.document?.x ?? casterToken.x ?? 0;
                const cy = casterToken.document?.y ?? casterToken.y ?? 0;
                // Place to the right of the caster
                tx = cx + grid;
                ty = cy;
                disp = casterToken.document?.disposition ?? 1;
            } else {
                // Fallback: scene center, grid-snapped
                const dim = scene.dimensions ?? {};
                const cx = (dim.sceneX ?? 0) + (dim.sceneWidth ?? 0) / 2;
                const cy = (dim.sceneY ?? 0) + (dim.sceneHeight ?? 0) / 2;
                tx = Math.round(cx / grid) * grid;
                ty = Math.round(cy / grid) * grid;
                tokenWarnNote = `<p><em>Note: ${escFn(caster.name)} has no token on the viewed scene — ${escFn(petName)} placed at scene center.</em></p>`;
            }
            const tokenData = {
                name: petName,
                actorId: petActor.id,
                x: tx,
                y: ty,
                disposition: disp,
            };
            const created = await scene.createEmbeddedDocuments("Token", [tokenData]);
            petTokenDoc = created?.[0] ?? null;
            if (!petTokenDoc) {
                tokenWarnNote += `<p><em>Pet token creation failed: the scene returned no token.</em></p>`;
            }
        }
    } catch (err) {
        console.warn("EQRMSS | summonPet: token creation failed:", err);
        tokenWarnNote += `<p><em>Pet token creation failed: ${escFn(err?.message ?? "unknown error")}.</em></p>`;
    }

    // Combat stats (2026-10-08): set system.combat.totalDB from scaling so
    // the pet defends with its real DB (previously defended at 0).
    try {
        const { syncPetCombatStats } = await import("./pet-equipment.js");
        await syncPetCombatStats(petActor);
    } catch (err) {
        console.warn("EQRMSS | summonPet: combat stat sync failed:", err);
    }

    // Initiative inheritance (2026-10-08): pet acts immediately after the owner.
    await addPetToCombat(caster, petActor, petTokenDoc);

    const summonNote = petTokenDoc
        ? `<p><em>${escFn(caster.name)} summons ${escFn(petName)} (level ${petLevel}).</em></p>`
        : `<p><em>${escFn(caster.name)} summons ${escFn(petName)} (level ${petLevel}), but the pet token could not be placed.</em></p>`;
    return `${dismissNote}${summonNote}${tokenWarnNote}`;
}

/**
 * Add a summoned pet to the caster's combat, inheriting initiative.
 *
 * Per user decision (2026-10-08): "Pets will act on the same turn, after
 * the owner." The pet joins the same combat as the caster with initiative
 * set just below the caster's, so it sorts immediately after the owner in
 * the tracker. Non-fatal: any failure is logged and the summon still stands.
 *
 * If the caster is in combat but has no initiative yet, the pet still joins
 * the combat (unrolled, goes last). Pets summoned outside combat get no
 * combat entry; they join normally when combat starts.
 *
 * @param {object} caster - Caster actor
 * @param {object} petActor - Newly created pet actor
 * @param {object|null} petTokenDoc - Newly created pet token document
 * @returns {Promise<void>}
 */
export async function addPetToCombat(caster, petActor, petTokenDoc) {
    try {
        const game = globalThis.game;
        if (!game?.combats || !petActor) return;
        if (!petTokenDoc) {
            // 2026-10-08: don't silently skip — the caller now reports this in chat.
            console.warn("EQRMSS | addPetToCombat: no pet token document; skipping combat entry.");
            return;
        }

        const casterToken = caster?.getActiveTokens?.()?.[0] ?? null;
        if (!casterToken) return;
        const sceneId = casterToken.scene?.id ?? casterToken.parent?.id ?? null;
        if (!sceneId) return;

        // Find the combat running on the caster's scene (prefer the active one)
        const combats = game.combats?.contents ?? [];
        const combat =
            (game.combat?.scene?.id === sceneId ? game.combat : null) ??
            combats.find((c) => c.scene?.id === sceneId) ??
            null;
        if (!combat) return; // summoned outside combat: no entry needed

        const casterCombatant =
            combat.combatants?.find((c) => c.tokenId === casterToken.id) ?? null;
        if (!casterCombatant) return; // caster not in this combat

        const rawInit = casterCombatant.initiative;
        // Note: Number(null) === 0, so check null/undefined explicitly —
        // an unrolled combatant has initiative null, not 0.
        const petInit =
            rawInit === null || rawInit === undefined || !Number.isFinite(Number(rawInit))
                ? null
                : Number(rawInit) - 0.01;

        // Already in combat? Just fix the initiative.
        const existing = combat.combatants?.find((c) => c.tokenId === petTokenDoc.id) ?? null;
        if (existing) {
            if (petInit !== null && existing.initiative !== petInit) {
                await existing.update({ initiative: petInit });
            }
            return;
        }

        const combatantData = {
            tokenId: petTokenDoc.id,
            actorId: petActor.id,
        };
        if (petInit !== null) combatantData.initiative = petInit;
        await combat.createEmbeddedDocuments("Combatant", [combatantData]);
    } catch (err) {
        console.warn("EQRMSS | addPetToCombat failed:", err);
    }
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
