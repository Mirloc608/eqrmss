// ============================================================
// TELEPORT (2026-10-07). EQ teleport mechanics for FoundryVTT.
//
// Teleport types (user spec 2026-10-07):
// - teleport-self / teleport (Wizard Gate, Druid Circle): caster -> destination
// - teleport-group (Wizard Portal): all allies in range -> destination
// - teleport-anchor (Primary/Secondary Anchor): caster -> anchor destination
// - teleport-to-caster (Call of the Hero): target -> caster's position
// - translocate (Wizard): target -> destination, caster stays
// - translocate-bind: target -> target's bind point
// - translocate-bind-group: group -> target's bind point
// - evacuate-group / evacuate-self / evacuate-single: -> safe point
// - gate: caster -> caster's bind point
// - bind / bind-affinity: store bind point on caster
//
// Destinations live in module/data/teleports/destinations.json.
// Each maps a destination ID to { name, module, scene, x, y }.
// module = which world module provides this destination
//   ("norrath", "kuaa", "luclin", "planes", or null for special/contextual).
// scene/x/y are null until configured —
// teleporting to an unconfigured destination posts a chat note.
//
// World modules (separate Foundry modules) bind scenes at runtime via:
//   game.eqrmss.teleports.registerScene(destId, sceneId, x, y)
// Scene bindings are stored in a runtime registry, separate from the JSON,
// so world modules can provide maps without modifying core data.
// Resolution order: runtime binding → JSON scene → GM prompt.
// ============================================================

import { combatCard } from "../combat/chat-card.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

// ----------------------------------------------------------------
// Destination database (loaded lazily, cached)
// ----------------------------------------------------------------

let _destinations = null;

// Runtime scene bindings from world modules.
// Key: destination ID → { sceneId, x, y, module }
// Separate from destinations.json so world modules can bind
// scenes without modifying core data files.
const _sceneBindings = new Map();

async function loadDestinations() {
    if (_destinations) return _destinations;
    try {
        const resp = await fetch("systems/eqrmss/module/data/teleports/destinations.json");
        _destinations = await resp.json();
    } catch {
        _destinations = {};
    }
    return _destinations;
}

/**
 * Look up a destination by ID.
 * @returns {object|null} { name, module, scene, x, y } or null
 */
export async function getDestination(destId) {
    if (!destId) return null;
    const dests = await loadDestinations();
    // Case-insensitive lookup (2026-10-08): spell data has Barindu/barindu variants.
    // Skip the _meta key.
    if (dests[destId] && !destId.startsWith("_")) return dests[destId];
    const lower = String(destId).toLowerCase();
    for (const [key, val] of Object.entries(dests)) {
        if (key.startsWith("_")) continue;
        if (key.toLowerCase() === lower) return val;
    }
    return null;
}

/**
 * Register a scene binding for a destination.
 * Called by world modules (norrath, kuaa, luclin, planes) at init.
 * @param {string} destId - Destination ID from destinations.json
 * @param {string} sceneId - Foundry scene ID or name
 * @param {number} x - X coordinate (pixels)
 * @param {number} y - Y coordinate (pixels)
 * @param {string} moduleName - World module name (for logging)
 */
export function registerScene(destId, sceneId, x, y, moduleName = "unknown") {
    if (!destId || !sceneId) {
        console.warn(`EQRMSS | Teleport | registerScene: missing destId or sceneId`);
        return false;
    }
    _sceneBindings.set(destId, { sceneId, x: x ?? null, y: y ?? null, module: moduleName });
    console.log(`EQRMSS | Teleport | scene bound: ${destId} → ${sceneId} (${moduleName})`);
    return true;
}

/**
 * Get the scene binding for a destination.
 * Checks runtime bindings first, then falls back to JSON scene field.
 * @returns {object|null} { sceneId, x, y, source } or null
 */
export async function getSceneBinding(destId) {
    // Runtime binding from world module takes precedence
    if (_sceneBindings.has(destId)) {
        const b = _sceneBindings.get(destId);
        return { sceneId: b.sceneId, x: b.x, y: b.y, source: `world module (${b.module})` };
    }
    // Fall back to JSON scene field (GM-configured)
    const dest = await getDestination(destId);
    if (dest?.scene) {
        return { sceneId: dest.scene, x: dest.x, y: dest.y, source: "destinations.json" };
    }
    return null;
}

/**
 * List all destinations for a world module.
 * @param {string} moduleName - "norrath", "kuaa", "luclin", "planes", or null
 * @returns {Promise<Array>} Destination entries
 */
export async function getDestinationsByModule(moduleName) {
    const dests = await loadDestinations();
    return Object.entries(dests)
        .filter(([k]) => !k.startsWith("_"))
        .map(([id, d]) => ({ id, ...d }))
        .filter(d => d.module === moduleName);
}

// Runtime safe-spot registry: scene ID → { x, y, module }.
// Evacuate moves targets to the safe spot on their CURRENT scene.
// World modules register these; fallback is scene center.
const _safeSpots = new Map();

/**
 * Register a safe spot (evacuation point) for a scene.
 * Called by world modules at init, or by the GM for custom maps.
 * @param {string} sceneId - Foundry scene ID or name
 * @param {number} x - X coordinate (pixels)
 * @param {number} y - Y coordinate (pixels)
 * @param {string} moduleName - World module name (for logging)
 */
export function registerSafeSpot(sceneId, x, y, moduleName = "unknown") {
    if (!sceneId) {
        console.warn(`EQRMSS | Teleport | registerSafeSpot: missing sceneId`);
        return false;
    }
    _safeSpots.set(sceneId, { x: x ?? null, y: y ?? null, module: moduleName });
    console.log(`EQRMSS | Teleport | safe spot: ${sceneId} (${moduleName})`);
    return true;
}

/**
 * Get the safe spot for a scene.
 * Checks runtime registry first, falls back to scene center.
 * @param {string} sceneId - Foundry scene ID
 * @returns {object|null} { x, y, source } or null if scene not found
 */
export function getSafeSpot(sceneId) {
    const scene = globalThis.game?.scenes?.find(s => s.name === sceneId || s.id === sceneId);
    if (!scene) return null;
    if (_safeSpots.has(sceneId) || _safeSpots.has(scene.id) || _safeSpots.has(scene.name)) {
        const s = _safeSpots.get(sceneId) ?? _safeSpots.get(scene.id) ?? _safeSpots.get(scene.name);
        return {
            x: s.x ?? (scene.width / 2),
            y: s.y ?? (scene.height / 2),
            source: `safe spot (${s.module})`
        };
    }
    // Fallback: scene center
    return { x: scene.width / 2, y: scene.height / 2, source: "scene center (no safe spot registered)" };
}

// Expose on game.eqrmss for world modules
if (typeof game !== "undefined") {
    game.eqrmss = game.eqrmss || {};
    game.eqrmss.teleports = {
        registerScene,
        getSceneBinding,
        getDestination,
        getDestinationsByModule,
        registerSafeSpot,
        getSafeSpot,
    };
}

// ----------------------------------------------------------------
// Shadow Step: short-range blink (30ft in facing direction)
// ----------------------------------------------------------------

/**
 * Shadow Step: step through shadow, reappearing a short distance away.
 * Moves the token 30 feet in its facing direction (or a random direction
 * if facing is unknown). Same scene only.
 */
async function shadowStep(actor, spellName = "Shadow Step") {
    if (!canControl(actor)) {
        return `<p><em>${esc(spellName)} not applied — you don't control ${esc(actor.name)}.</em></p>`;
    }
    const tok = activeTokenOf(actor);
    if (!tok) {
        return `<p><em>${esc(actor.name)} steps through shadow, but has no token on the scene.</em></p>`;
    }
    try {
        // 30 feet in pixels
        const pxPerFt = globalThis.canvas?.dimensions?.distancePixels
            ? (globalThis.canvas.dimensions.size / globalThis.canvas.dimensions.distance)
            : 10;
        const distPx = 30 * pxPerFt;

        // Facing direction from token rotation (Foundry rotation is degrees, 0 = up/south?)
        // Default to a random direction if rotation is 0/unset
        let angle = (tok.document.rotation ?? 0) * Math.PI / 180;
        if (!tok.document.rotation) {
            angle = Math.random() * Math.PI * 2;
        }
        // Foundry rotation: 0 = facing down (south on screen), clockwise
        const dx = Math.sin(angle) * distPx;
        const dy = Math.cos(angle) * distPx;

        const newX = tok.document.x + dx;
        const newY = tok.document.y + dy;
        await tok.document.update({ x: newX, y: newY });
        return `<p><em>${esc(actor.name)} steps through shadow, reappearing a short distance away.</em></p>`;
    } catch (err) {
        console.error("eqrmss shadow step failed:", err);
        return `<p><em>Shadow Step failed: ${esc(err?.message ?? "unknown error")}.</em></p>`;
    }
}

// ----------------------------------------------------------------
// Token helpers
// ----------------------------------------------------------------

function activeTokenOf(actor) {
    try {
        return actor?.getActiveTokens?.()?.[0] ?? null;
    } catch { return null; }
}

function canControl(actor) {
    return actor && (actor.isOwner || globalThis.game?.user?.isGM);
}

/**
 * Move an actor's token to a destination.
 * Same scene: update token position.
 * Different scene: create token on target scene, delete from current.
 * @returns {Promise<string>} chat note HTML
 */
export async function teleportActor(actor, destId, spellName = "Teleport") {
    if (!actor) return "";
    // Shadow Step: short-range blink, not a zone teleport
    if (destId === "shadow-step") {
        return await shadowStep(actor, spellName);
    }
    const dest = await getDestination(destId);
    if (!dest) {
        return `<p><em>${esc(actor.name)} tries to teleport, but the destination "${esc(destId)}" is unknown.</em></p>`;
    }
    const binding = await getSceneBinding(destId);
    if (!binding) {
        const moduleHint = dest.module ? ` (world module: ${esc(dest.module)})` : "";
        return `<p><em>${esc(actor.name)} casts ${esc(spellName)} — destination "${esc(dest.name)}"${moduleHint} has no scene bound. GM: install the world module or set scene/coordinates in module/data/teleports/destinations.json.</em></p>`;
    }
    if (!canControl(actor)) {
        return `<p><em>Teleport not applied — you don't control ${esc(actor.name)}.</em></p>`;
    }

    const tok = activeTokenOf(actor);
    const targetScene = globalThis.game?.scenes?.find(s => s.name === binding.sceneId || s.id === binding.sceneId);

    if (!targetScene) {
        return `<p><em>${esc(actor.name)} casts ${esc(spellName)} — no scene "${esc(binding.sceneId)}" found (bound via ${esc(binding.source)}). GM: check the scene exists.</em></p>`;
    }

    const x = binding.x ?? (targetScene.width / 2);
    const y = binding.y ?? (targetScene.height / 2);

    try {
        if (!tok) {
            // No active token — just announce
            return `<p><em>${esc(actor.name)} vanishes in a flash of light, bound for ${esc(dest.name)}.</em></p>`;
        }

        const currentScene = tok.parent;
        if (currentScene?.id === targetScene.id) {
            // Same scene: move token
            await tok.document.update({ x, y });
            return `<p><em>${esc(actor.name)} vanishes in a flash of light and reappears in ${esc(dest.name)}.</em></p>`;
        }

        // Cross-scene: create token on target scene, remove from current
        const tokenData = tok.document.toObject();
        tokenData.x = x;
        tokenData.y = y;
        await targetScene.createEmbeddedDocuments("Token", [tokenData]);
        await tok.document.delete();
        // Navigate the GM/player to the new scene
        if (globalThis.game?.user?.isGM) {
            await targetScene.activate();
        }
        return `<p><em>${esc(actor.name)} vanishes in a flash of light and appears in ${esc(dest.name)}.</em></p>`;
    } catch (err) {
        console.error("eqrmss teleport failed:", err);
        return `<p><em>Teleport failed: ${esc(err?.message ?? "unknown error")}.</em></p>`;
    }
}

/**
 * Teleport all allies of the caster within range to a destination.
 * Allies = same logic as song auto-targeting (disposition/ownership).
 */
export async function teleportGroup(caster, destId, spellName = "Teleport", rangeFt = 100) {
    if (!caster) return "";
    const dest = await getDestination(destId);
    if (!dest) {
        return `<p><em>${esc(caster.name)} tries to teleport the group, but the destination "${esc(destId)}" is unknown.</em></p>`;
    }

    const casterTok = activeTokenOf(caster);
    if (!casterTok) {
        return await teleportActor(caster, destId, spellName);
    }

    const bardDisp = casterTok.document?.disposition ?? casterTok.disposition ?? 1;
    const bx = casterTok.center?.x ?? casterTok.x;
    const by = casterTok.center?.y ?? casterTok.y;
    const pxPerFt = globalThis.canvas?.dimensions?.distancePixels
        ? (globalThis.canvas.dimensions.size / globalThis.canvas.dimensions.distance)
        : 10; // default 10px per foot
    const rangePx = rangeFt * pxPerFt;

    const notes = [];
    for (const tok of globalThis.canvas?.tokens?.placeables ?? []) {
        if (!tok?.actor) continue;
        const dx = (tok.center?.x ?? tok.x) - bx;
        const dy = (tok.center?.y ?? tok.y) - by;
        if (Math.hypot(dx, dy) > rangePx + 1) continue;

        const disp = tok.document?.disposition ?? tok.disposition ?? 0;
        const isAlly = tok.id === casterTok.id || disp === bardDisp;
        const explicitlyHostile = disp === -1 && bardDisp !== -1;
        if (!isAlly || explicitlyHostile) continue;

        if (!canControl(tok.actor)) {
            notes.push(`<p><em>${esc(tok.actor.name)} — you don't control them.</em></p>`);
            continue;
        }
        notes.push(await teleportActor(tok.actor, destId, spellName));
    }
    return notes.join("");
}

/**
 * Translocate: move the TARGET to a destination. Caster stays put.
 */
export async function translocateTarget(caster, target, destId, spellName = "Translocate") {
    if (!target) {
        return `<p><em>${esc(spellName)} needs a target.</em></p>`;
    }
    return await teleportActor(target, destId, spellName);
}

/**
 * Call of the Hero: summon the TARGET to the caster's current position.
 */
export async function callOfHero(caster, target, spellName = "Call of the Hero") {
    if (!caster || !target) {
        return `<p><em>${esc(spellName)} needs a caster and a target.</em></p>`;
    }
    if (!canControl(target)) {
        return `<p><em>${esc(spellName)} not applied — you don't control ${esc(target.name)}.</em></p>`;
    }
    const casterTok = activeTokenOf(caster);
    const targetTok = activeTokenOf(target);
    if (!casterTok || !targetTok) {
        return `<p><em>${esc(target.name)} is summoned toward ${esc(caster.name)}, but no tokens are on the scene.</em></p>`;
    }
    try {
        const cx = casterTok.document.x;
        const cy = casterTok.document.y;
        // Place target adjacent to caster (offset to avoid overlap)
        await targetTok.document.update({ x: cx + 50, y: cy + 50 });
        return `<p><em>${esc(target.name)} is summoned to ${esc(caster.name)} in a flash of light.</em></p>`;
    } catch (err) {
        console.error("eqrmss call of hero failed:", err);
        return `<p><em>Summon failed: ${esc(err?.message ?? "unknown error")}.</em></p>`;
    }
}

// ----------------------------------------------------------------
// Bind Affinity / Gate
// ----------------------------------------------------------------

/**
 * Bind Affinity: store the caster's current location as their bind point.
 */
export async function bindAffinity(caster, spellName = "Bind Affinity") {
    if (!caster) return "";
    if (!canControl(caster)) {
        return `<p><em>Bind not applied — you don't control ${esc(caster.name)}.</em></p>`;
    }
    const tok = activeTokenOf(caster);
    const scene = tok?.parent ?? globalThis.game?.scenes?.current;
    const bindPoint = {
        sceneId: scene?.id ?? null,
        sceneName: scene?.name ?? "unknown",
        x: tok ? tok.document.x : null,
        y: tok ? tok.document.y : null,
        name: scene?.name ?? "unknown location"
    };
    try {
        await caster.update({ "system.status.bindPoint": bindPoint });
        return `<p><em>${esc(caster.name)} binds their essence to ${esc(bindPoint.name)}.</em></p>`;
    } catch (err) {
        console.error("eqrmss bind affinity failed:", err);
        return `<p><em>Bind failed: ${esc(err?.message ?? "unknown error")}.</em></p>`;
    }
}

/**
 * Gate: teleport the caster to their bind point.
 */
export async function gateToBind(caster, spellName = "Gate") {
    if (!caster) return "";
    const bindPoint = caster.system?.status?.bindPoint;
    if (!bindPoint?.sceneId) {
        return `<p><em>${esc(caster.name)} tries to gate, but has not bound their essence anywhere.</em></p>`;
    }
    if (!canControl(caster)) {
        return `<p><em>Gate not applied — you don't control ${esc(caster.name)}.</em></p>`;
    }
    const tok = activeTokenOf(caster);
    try {
        const targetScene = globalThis.game?.scenes?.get(bindPoint.sceneId);
        if (!targetScene) {
            return `<p><em>${esc(caster.name)} tries to gate, but the bound scene is not available.</em></p>`;
        }
        if (!tok) {
            return `<p><em>${esc(caster.name)} vanishes, bound for ${esc(bindPoint.name)}.</em></p>`;
        }
        const currentScene = tok.parent;
        if (currentScene?.id === targetScene.id) {
            await tok.document.update({ x: bindPoint.x, y: bindPoint.y });
        } else {
            const tokenData = tok.document.toObject();
            tokenData.x = bindPoint.x;
            tokenData.y = bindPoint.y;
            await targetScene.createEmbeddedDocuments("Token", [tokenData]);
            await tok.document.delete();
            if (globalThis.game?.user?.isGM) {
                await targetScene.activate();
            }
        }
        return `<p><em>${esc(caster.name)} gates back to ${esc(bindPoint.name)}.</em></p>`;
    } catch (err) {
        console.error("eqrmss gate failed:", err);
        return `<p><em>Gate failed: ${esc(err?.message ?? "unknown error")}.</em></p>`;
    }
}

// ----------------------------------------------------------------
// Main dispatch: route a spell effect to the right teleport function
// ----------------------------------------------------------------

/**
 * Evacuate to the safe spot on the caster's current scene (2026-10-09).
 * Does not change zones — moves target(s) to safety within the same scene.
 * @param {object} caster - the evacuating caster
 * @param {object|null} target - for "single": the target; otherwise null
 * @param {string} spellName - display name
 * @param {string} mode - "self", "single", or "group"
 * @returns {Promise<string>} chat note HTML
 */
async function evacuateToSafeSpot(caster, target, spellName = "Evacuate", mode = "self") {
    const casterTok = activeTokenOf(caster);
    if (!casterTok) {
        return `<p><em>${esc(caster?.name ?? "Caster")} tries to evacuate, but has no token on the scene.</em></p>`;
    }
    const scene = casterTok.parent;
    const sceneId = scene?.id;
    if (!sceneId) {
        return `<p><em>${esc(caster?.name ?? "Caster")} tries to evacuate, but is not on a scene.</em></p>`;
    }

    const spot = getSafeSpot(sceneId);
    if (!spot) {
        return `<p><em>${esc(caster?.name ?? "Caster")} casts ${esc(spellName)}, but the current scene is not available.</em></p>`;
    }

    // Determine who moves
    let movers = [];
    if (mode === "self") {
        movers = [caster];
    } else if (mode === "single") {
        movers = target ? [target] : [caster];
    } else {
        // group: caster + allies on the same scene
        movers = [caster];
        try {
            const { getAlliesInRange } = await import("./songs.js").catch(() => ({}));
            if (getAlliesInRange) {
                const allies = await getAlliesInRange(caster, 100) ?? [];
                for (const a of allies) {
                    if (a?.id !== caster?.id && !movers.some(m => m?.id === a?.id)) movers.push(a);
                }
            }
        } catch { /* allies unavailable: just the caster */ }
    }

    let moved = 0;
    for (const m of movers) {
        if (!m || !canControl(m)) continue;
        const tok = activeTokenOf(m);
        if (!tok || tok.parent?.id !== sceneId) continue; // must be on the same scene
        try {
            await tok.document.update({ x: spot.x, y: spot.y });
            moved++;
        } catch { /* skip failures */ }
    }

    const who = mode === "group" ? "the group" : esc(movers[0]?.name ?? "Caster");
    if (moved === 0) {
        return `<p><em>${who} tries to evacuate, but no tokens could be moved.</em></p>`;
    }
    const spotNote = spot.source.includes("no safe spot") ? " (GM: no safe spot registered for this scene — used center)" : "";
    return `<p><em>${mode === "group" ? esc(caster?.name ?? "Caster") + " evacuates the group" : who + " evacuates"} to a safe spot${spotNote}.</em></p>`;
}

/**
 * Handle a teleport-type spell effect.
 * @param {object} opts - { effect, caster, target, spellName }
 * @returns {Promise<string>} chat note HTML
 */
export async function applyTeleport({ effect, caster, target, spellName }) {
    const kind = String(effect?.effect ?? "").toLowerCase();
    const dest = effect?.destination;

    switch (kind) {
        case "teleport-self":
        case "teleport":
        case "teleport-anchor":
            return await teleportActor(caster, dest, spellName);

        case "teleport-group":
            return await teleportGroup(caster, dest, spellName);

        case "teleport-to-caster":
            return await callOfHero(caster, target, spellName);

        case "translocate":
            return await translocateTarget(caster, target, dest, spellName);

        case "translocate-bind": {
            const bp = target?.system?.status?.bindPoint;
            if (!bp?.sceneId) {
                return `<p><em>${esc(target?.name ?? "Target")} has not bound their essence anywhere.</em></p>`;
            }
            // Teleport target to their own bind point
            if (!canControl(target)) {
                return `<p><em>Translocate not applied — you don't control ${esc(target?.name)}.</em></p>`;
            }
            const targetScene = globalThis.game?.scenes?.get(bp.sceneId);
            if (!targetScene) {
                return `<p><em>${esc(target?.name)}'s bind point is not available.</em></p>`;
            }
            const tok = activeTokenOf(target);
            if (tok) {
                const currentScene = tok.parent;
                if (currentScene?.id === targetScene.id) {
                    await tok.document.update({ x: bp.x, y: bp.y });
                } else {
                    const tokenData = tok.document.toObject();
                    tokenData.x = bp.x; tokenData.y = bp.y;
                    await targetScene.createEmbeddedDocuments("Token", [tokenData]);
                    await tok.document.delete();
                }
            }
            return `<p><em>${esc(target?.name ?? "Target")} is translocated to their bind point (${esc(bp.name)}).</em></p>`;
        }

        case "translocate-bind-group": {
            // Teleport group to the TARGET's bind point
            const bp = target?.system?.status?.bindPoint;
            if (!bp?.sceneId) {
                return `<p><em>${esc(target?.name ?? "Target")} has not bound their essence anywhere.</em></p>`;
            }
            // Use teleportGroup but override destination to bind point
            // For simplicity, teleport each ally via the bind point directly
            const casterTok = activeTokenOf(caster);
            if (!casterTok) return await teleportActor(caster, dest, spellName);
            const notes = [];
            const bardDisp = casterTok.document?.disposition ?? 1;
            const bx = casterTok.center?.x ?? casterTok.x;
            const by = casterTok.center?.y ?? casterTok.y;
            const targetScene = globalThis.game?.scenes?.get(bp.sceneId);
            for (const tok of globalThis.canvas?.tokens?.placeables ?? []) {
                if (!tok?.actor) continue;
                const dx = (tok.center?.x ?? tok.x) - bx;
                const dy = (tok.center?.y ?? tok.y) - by;
                if (Math.hypot(dx, dy) > 1000) continue; // ~100ft default
                const disp = tok.document?.disposition ?? 0;
                if (disp !== bardDisp && tok.id !== casterTok.id) continue;
                if (!canControl(tok.actor) || !targetScene) continue;
                const tdata = tok.document.toObject();
                tdata.x = bp.x; tdata.y = bp.y;
                if (tok.parent?.id === targetScene.id) {
                    await tok.document.update({ x: bp.x, y: bp.y });
                } else {
                    await targetScene.createEmbeddedDocuments("Token", [tdata]);
                    await tok.document.delete();
                }
                notes.push(`<p><em>${esc(tok.actor.name)} is translocated to ${esc(bp.name)}.</em></p>`);
            }
            return notes.join("") || `<p><em>No allies in range to translocate.</em></p>`;
        }

        case "evacuate-group":
            if (dest === "current-zone" || !dest) {
                // Evac to safe spot on the caster's CURRENT scene (2026-10-09).
                return await evacuateToSafeSpot(caster, null, spellName, "group");
            }
            return await teleportGroup(caster, dest, spellName);

        case "evacuate-self":
            if (!dest) {
                return await evacuateToSafeSpot(caster, null, spellName, "self");
            }
            return await teleportActor(caster, dest, spellName);

        case "evacuate-single":
            if (!dest) {
                return await evacuateToSafeSpot(caster, target, spellName, "single");
            }
            return await teleportActor(target, dest, spellName);

        case "gate":
            return await gateToBind(caster, spellName);

        case "bind":
        case "bind-affinity":
            return await bindAffinity(caster, spellName);

        default:
            return `<p><em>Unknown teleport type: ${esc(kind)}.</em></p>`;
    }
}
