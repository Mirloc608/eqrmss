// ============================================================
// EQRMSS Party HUD — Data Converter
// ============================================================
// Translates EQRMSS actors/tokens into the generic HUD format:
//   { id, name, img, level, primary, secondary, effects,
//     targeted, initiativeOrder }
//
// Bars: primary = Hits (system.hits), secondary = Mana
// (system.attributes.mana, only when the actor has a mana pool).
// ============================================================

function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function makeBar(name, value, max) {
    value = Math.max(0, num(value));
    max = Math.max(1, num(max, 1));
    return {
        name,
        value,
        max,
        percent: Math.max(0, Math.min(100, Math.round((value / max) * 100))),
    };
}

function actorImage(actor) {
    // Prefer an active token's image, fall back to the actor portrait.
    try {
        const tokens = actor.getActiveTokens?.() ?? [];
        if (tokens.length && tokens[0]?.document?.texture?.src) {
            return tokens[0].document.texture.src;
        }
    } catch (e) { /* fail-open */ }
    return actor.img;
}

function isBuff(effect) {
    return (effect.changes ?? []).some(c => {
        const v = parseFloat(c.value);
        if (Number.isFinite(v)) return v > 0;
        return String(c.value ?? "").includes("+");
    });
}

function isDebuff(effect) {
    return (effect.changes ?? []).some(c => {
        const v = parseFloat(c.value);
        if (Number.isFinite(v)) return v < 0;
        return String(c.value ?? "").includes("-");
    });
}

function translateEffect(effect) {
    return {
        name: effect.label ?? effect.name,
        icon: effect.icon,
        isBuff: isBuff(effect),
        isDebuff: isDebuff(effect),
    };
}

function getEffects(actor) {
    try {
        return [...(actor.effects ?? [])]
            .filter(e => !e.disabled)
            .map(translateEffect);
    } catch (e) { return []; }
}

function tokenIdFor(actor) {
    try {
        const tokens = actor.getActiveTokens?.() ?? [];
        return tokens.length ? tokens[0].id : null;
    } catch (e) { return null; }
}

/**
 * Translate an actor into party-list HUD data.
 */
export function translatePartyActor(actor) {
    const sys = actor.system ?? {};
    const hits = sys.hits ?? {};
    const mana = sys.attributes?.mana ?? {};
    const data = {
        id: actor.id,
        actorId: actor.id,
        name: actor.name,
        img: actorImage(actor),
        level: num(sys.attributes?.level?.value),
        primary: makeBar("Hits", hits.value, hits.max),
        secondary: num(mana.max) > 0 ? makeBar("Mana", mana.value, mana.max) : null,
        effects: getEffects(actor),
        targeted: false,
        initiativeOrder: null,
    };
    const tid = tokenIdFor(actor);
    if (tid) {
        data.tokenId = tid;
        try {
            data.targeted = [...(game.user?.targets ?? [])].some(t => t.id === tid);
        } catch (e) { /* fail-open */ }
    }
    return data;
}

/**
 * Translate a token into enemy-bar HUD data.
 */
export function translateEnemyToken(token) {
    const actor = token.actor;
    const sys = actor?.system ?? {};
    const hits = sys.hits ?? {};
    const data = {
        id: token.id,
        tokenId: token.id,
        actorId: actor?.id,
        name: token.name,
        img: token.document?.texture?.src || actor?.img,
        primary: makeBar("Hits", hits.value, hits.max),
        secondary: null,
        effects: actor ? getEffects(actor) : [],
        bossLocked: !!token.document?.getFlag?.("eqrmss", "hudBoss"),
    };
    return data;
}

/**
 * Assign combat initiative order to party entries (highest first).
 */
export function setInitiatives(party) {
    try {
        const combatants = game.combat?.combatants ?? [];
        for (const member of party) {
            const c = combatants.find(x =>
                x.actorId === member.actorId || x.tokenId === member.tokenId);
            member.initiative = c?.initiative ?? null;
        }
        party.sort((a, b) => (b.initiative ?? -Infinity) - (a.initiative ?? -Infinity));
        party.forEach((m, i) => { m.initiativeOrder = i + 1; });
    } catch (e) { /* fail-open */ }
    return party;
}
