// ============================================================
// Displaced Spell Landing (Spell Law Table 15.7)
//
// When a failed attack spell strays "20 feet left/right of
// target", the book says to roll on the appropriate table for
// effect at the displaced point. This module implements the
// user's ruling (2026-10-05): click-to-place starting at the
// book-directed point, and the GM applies the damage directly
// to whatever is in the splash area.
// ============================================================

import { combatCard } from "../combat/chat-card.js";
import { classifySpell } from "./spell-mapping.js";
import { blastRadiusFt, syntheticBoltWeapon } from "./cast-spell.js";
import { resolveBaseSpellAttack, applyBaseSpellEffect } from "./base-spell.js";
import { resolveBallCast } from "./ball-spell.js";
import { rollWeaponAttack } from "../combat/combat-rolls.js";

const esc = (s) => globalThis.foundry?.utils?.escapeHTML
    ? globalThis.foundry.utils.escapeHTML(String(s ?? ""))
    : String(s ?? "");

function pxPerFoot() {
    const dims = globalThis.canvas?.dimensions ?? {};
    const size = Number(dims.size) || 0;
    const dist = Number(dims.distance) || 0;
    return size > 0 && dist > 0 ? size / dist : 0;
}

/**
 * The book-directed start point: 20 feet left/right of the
 * target, measured perpendicular to the caster's line of aim
 * (left/right from the caster's perspective). Falls back to
 * map east/west when the caster has no token on the canvas.
 */
export function displacementStartPoint(targetToken, casterToken, direction) {
    const t = targetToken?.center ?? { x: 0, y: 0 };
    const ppf = pxPerFoot();
    const off = 20 * ppf;
    const c = casterToken?.center;
    let dx = direction === "left" ? -1 : 1;
    let dy = 0;
    if (c && ppf > 0) {
        const fx = t.x - c.x;
        const fy = t.y - c.y;
        const len = Math.hypot(fx, fy);
        if (len > 1e-6) {
            // Screen coords (y down): caster's right of the aim
            // vector is (-fy, fx), left is (fy, -fx).
            const ux = fx / len;
            const uy = fy / len;
            if (direction === "left") { dx = uy; dy = -ux; }
            else { dx = -uy; dy = ux; }
        }
    }
    return { x: t.x + dx * off, y: t.y + dy * off };
}

function tokensAt() {
    return globalThis.canvas?.tokens?.placeables ?? [];
}

function feetBetween(a, b) {
    const ppf = pxPerFoot();
    if (!(ppf > 0)) return Infinity;
    return Math.hypot(a.x - b.x, a.y - b.y) / ppf;
}

/** Nearest token with an actor within maxFeet of a scene point. */
export function nearestTokenTo(point, maxFeet) {
    let best = null;
    let bestFeet = maxFeet;
    for (const t of tokensAt()) {
        if (!t?.actor || !t?.center) continue;
        const feet = feetBetween(t.center, point);
        if (feet <= bestFeet + 1e-6) { best = t; bestFeet = feet; }
    }
    return best;
}

/** Every token with an actor inside radiusFt of a scene point. */
export function tokensInRadius(point, radiusFt) {
    const seen = new Map();
    for (const t of tokensAt()) {
        const a = t?.actor;
        if (!a || !t?.center || seen.has(a.id)) continue;
        if (feetBetween(t.center, point) <= radiusFt + 1e-6) seen.set(a.id, { token: t, actor: a });
    }
    return [...seen.values()];
}

/**
 * Click-to-place crosshair. Draws the splash marker at the
 * book-directed start point, follows the mouse, locks on
 * left-click, cancels on right-click. Resolves to the locked
 * scene point or null.
 */
export function pickSplashPoint(startX, startY, radiusFt) {
    const canvas = globalThis.canvas;
    const PIXI = globalThis.PIXI;
    if (!canvas || !PIXI || !(pxPerFoot() > 0)) return Promise.resolve(null);
    return new Promise((resolve) => {
        const ppf = pxPerFoot();
        const marker = new PIXI.Graphics();
        const veil = new PIXI.Graphics();
        // Full-scene invisible veil so the click never leaks
        // through to tokens or tools underneath.
        veil.rect(-100000, -100000, 200000, 200000);
        veil.fill({ color: 0x000000, alpha: 0 });
        veil.eventMode = "static";
        veil.cursor = "crosshair";
        const draw = (x, y) => {
            marker.clear();
            const r = radiusFt > 0 ? radiusFt * ppf : 14;
            marker.circle(x, y, r);
            marker.stroke({ color: 0xff3020, width: 2 });
            marker.fill({ color: 0xff3020, alpha: 0.12 });
            marker.circle(x, y, 3);
            marker.fill({ color: 0xff3020, alpha: 0.9 });
        };
        draw(startX, startY);
        const toWorld = (ev) => {
            const p = ev?.global;
            if (!p) return null;
            try { return canvas.stage.toLocal(new PIXI.Point(p.x, p.y)); }
            catch { return null; }
        };
        let done = false;
        const finish = (pt) => {
            if (done) return;
            done = true;
            veil.removeAllListeners();
            canvas.stage.removeChild(veil);
            canvas.stage.removeChild(marker);
            resolve(pt);
        };
        veil.on("pointermove", (ev) => {
            const w = toWorld(ev);
            if (w) draw(w.x, w.y);
        });
        veil.on("click", (ev) => {
            ev.stopPropagation?.();
            const w = toWorld(ev);
            finish(w ?? { x: startX, y: startY });
        });
        veil.on("rightclick", (ev) => {
            ev.stopPropagation?.();
            ev.preventDefault?.();
            finish(null);
        });
        canvas.stage.addChild(marker);
        canvas.stage.addChild(veil);
        ui.notifications?.info("Click to place the stray spell — right-click to cancel.");
    });
}

/** Resolve the stray spell at the locked point, per spell kind. */
export async function resolveDisplacedAt(caster, spellItem, cls, point, direction, targetName) {
    const name = spellItem?.name ?? "stray spell";
    const speaker = ChatMessage.getSpeaker({ actor: caster });
    const landLine = `<p><em>The ${esc(name)} strays ${esc(direction)} of ${esc(targetName)} — the GM places its landing.</em></p>`;

    if (cls.kind === "bolt") {
        const tok = nearestTokenTo(point, 5);
        if (!tok) {
            await ChatMessage.create({ speaker,
                content: combatCard("Spell Failure", `${landLine}<p>The stray bolt strikes the ground — nothing is within 5 feet of the landing.</p>`) });
            return;
        }
        await ChatMessage.create({ speaker,
            content: combatCard("Spell Failure", `${landLine}<p>The stray bolt veers toward <strong>${esc(tok.name)}</strong>. Roll on the appropriate table for effect.</p>`) });
        // The stray spell goes off despite the caster's new stun:
        // the stun governs future actions, not the released spell.
        const synthetic = syntheticBoltWeapon(caster, spellItem, cls);
        await rollWeaponAttack(caster, synthetic, {
            forcedCritType: cls.critType,
            targetToken: tok,
            ignoreCasterState: true
        });
        return;
    }

    if (cls.kind === "base") {
        const tok = nearestTokenTo(point, 5);
        if (!tok?.actor) {
            await ChatMessage.create({ speaker,
                content: combatCard("Spell Failure", `${landLine}<p>The stray spell settles on empty ground — nothing is within 5 feet of the landing.</p>`) });
            return;
        }
        const res = await resolveBaseSpellAttack(caster, spellItem, tok.actor, {});
        if (res.failed) return;
        let effectNote = "";
        if (!res.resisted) {
            effectNote = (tok.actor.isOwner || game.user?.isGM)
                ? await applyBaseSpellEffect(caster, tok.actor, cls, spellItem)
                : `<p><em>Effect not applied — you don't control ${esc(tok.name)}.</em></p>`;
        }
        await ChatMessage.create({ speaker,
            content: combatCard("Base Spell Attack", `${landLine}<h2>Stray ${esc(name)} lands on ${esc(tok.name)}</h2>${res.html}${effectNote}`) });
        return;
    }

    if (cls.kind === "ball") {
        const radius = blastRadiusFt(spellItem);
        const caught = tokensInRadius(point, radius);
        if (!caught.length) {
            await ChatMessage.create({ speaker,
                content: combatCard("Spell Failure", `${landLine}<p>The stray blast detonates on empty ground — nothing is inside its ${radius}-foot radius.</p>`) });
            return;
        }
        const targets = caught.map(c => c.actor);
        // No +20 center: the book's center bonus rewards the aimed
        // target, and a stray spell aimed at no one (house call
        // 2026-10-05, veto welcome).
        const casterTok = caster.getActiveTokens?.()?.[0] ?? null;
        const rangeFeet = casterTok?.center ? feetBetween(casterTok.center, point) : 0;
        const res = await resolveBallCast(caster, spellItem, targets,
            { table: cls.attackTable, critType: cls.critType },
            { rangeFeet, centerId: null });
        if (res.failed && res.error) {
            ui.notifications?.warn(res.error);
            return;
        }
        if (res.failed) return;
        await ChatMessage.create({ speaker,
            content: combatCard("Ball Spell", `${landLine}<h2>Stray ${esc(name)} (${caught.length} in the blast)</h2>${res.html}`) });
        return;
    }
}

/**
 * Open the crosshair for a displaced cast. Called directly when
 * the casting user is the GM, or from the failure card's place
 * button on the GM's client.
 */
export async function openDisplacedCrosshair({ caster, spellItem, kind, startX, startY, direction, targetName }) {
    if (!caster || !spellItem) return;
    if (!globalThis.canvas) {
        ui.notifications?.warn("No canvas — the stray spell cannot be placed.");
        return;
    }
    const cls = kind ? { ...(classifySpell(spellItem) ?? {}), kind } : (classifySpell(spellItem) ?? {});
    const radius = cls.kind === "ball" ? blastRadiusFt(spellItem) : 0;
    const point = await pickSplashPoint(startX, startY, radius);
    if (!point) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: caster }),
            content: combatCard("Spell Failure", `<p><em>The stray ${esc(spellItem.name ?? "spell")} dissipates — the GM cancels its landing.</em></p>`)
        });
        return;
    }
    await resolveDisplacedAt(caster, spellItem, cls, point, direction, targetName);
}

/** Failure-card "Place the stray spell" button (GM only). */
export async function handlePlaceStrayButton(dataset) {
    if (!game.user?.isGM) {
        ui.notifications?.warn("Only the GM can place the stray spell.");
        return;
    }
    const caster = await fromUuid(dataset.casterUuid).catch(() => null);
    const spellItem = await fromUuid(dataset.spellUuid).catch(() => null);
    if (!caster || !spellItem) {
        ui.notifications?.warn("Could not resolve the stray spell's caster or spell.");
        return;
    }
    await openDisplacedCrosshair({
        caster,
        spellItem,
        kind: dataset.kind,
        startX: Number(dataset.x),
        startY: Number(dataset.y),
        direction: dataset.direction,
        targetName: dataset.targetName
    });
}
