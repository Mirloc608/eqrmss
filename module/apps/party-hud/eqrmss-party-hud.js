// ============================================================
// EQRMSS Party HUD (native)
// ============================================================
// MMO-style overlay: party frames (top-left) + enemy target bars
// (bottom-center). ApplicationV2, parchment-styled, EQRMSS-native.
//
// Party = users' assigned characters (+ friendly combatants while
// a combat is active). Enemies = targeted tokens outside the party
// + GM boss-locked tokens (flag eqrmss.hudBoss on the token).
// ============================================================

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

import {
    translatePartyActor,
    translateEnemyToken,
    setInitiatives,
} from "./hud-converter.js";

const HUD_FLAG = "hudBoss";

export default class EQRMSSPartyHUD extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "eqrmss-party-hud",
        classes: ["eqrmss-party-hud"],
        position: { width: 320, height: "auto" },
        window: {
            frame: false,
            positioned: false,
        },
        actions: {
            "hud-toggle-target": EQRMSSPartyHUD.#onToggleTarget,
            "hud-open-sheet": EQRMSSPartyHUD.#onOpenSheet,
            "hud-boss-lock": EQRMSSPartyHUD.#onBossLock,
        },
    };

    static PARTS = {
        hud: { template: "systems/eqrmss/templates/apps/party-hud/eqrmss-party-hud.html" },
    };

    // ------------------------------------------------------------
    // Visibility
    // ------------------------------------------------------------

    get visible() {
        const mode = game.settings.get("eqrmss", "partyHudMode");
        if (mode === "never") return false;
        if (mode === "combat" && !game.combat) return false;
        // Hide entirely when there's nothing to show (empty party, no enemies)
        // instead of rendering as a tiny dot.
        const party = this._getPartyActors();
        if (party.length > 0) return true;
        const partyIds = party.map(a => a.id);
        const enemies = this._getEnemyTokens(partyIds);
        return enemies.length > 0;
    }

    // ------------------------------------------------------------
    // Data
    // ------------------------------------------------------------

    _getPartyActors() {
        let users = game.users ?? [];
        if (game.settings.get("eqrmss", "partyHudPartySource") === "loggedin") {
            users = users.filter(u => u.active);
        }
        let party = users.map(u => u.character).filter(a => a);

        if (game.combat) {
            const friendly = (game.combat.combatants ?? [])
                .filter(c => {
                    const disp = c.token?.disposition
                        ?? c.actor?.prototypeToken?.disposition;
                    return disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
                })
                .map(c => c.actor)
                .filter(a => a);
            party = party.concat(friendly);
        }

        // Dedupe by actor id
        const seen = new Set();
        return party.filter(a => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
        });
    }

    _getEnemyTokens(partyIds) {
        const inParty = new Set(partyIds);
        const enemies = [];

        // Targeted tokens not in the party
        for (const t of game.user?.targets ?? []) {
            const actorId = t.actor?.id;
            if (actorId && inParty.has(actorId)) continue;
            enemies.push(t);
        }

        // GM boss-locked tokens
        for (const t of canvas.tokens?.placeables ?? []) {
            if (!t.document?.getFlag?.("eqrmss", HUD_FLAG)) continue;
            if (enemies.some(e => e.id === t.id)) continue;
            const actorId = t.actor?.id;
            if (actorId && inParty.has(actorId)) continue;
            enemies.push(t);
        }

        return enemies;
    }

    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        let party = [];
        let enemies = [];
        let partySize = "";

        if (this.visible) {
            const actors = this._getPartyActors();
            party = actors.map(translatePartyActor);
            if (game.combat) setInitiatives(party);
            partySize = this._partySizeLabel(party.length);
            const partyIds = party.map(p => p.actorId);
            enemies = this._getEnemyTokens(partyIds).map(translateEnemyToken);
        }

        const showEffects = [...party, ...enemies].some(e => e.effects?.length > 0);
        return {
            ...context,
            visible: this.visible,
            party,
            enemies,
            partySize,
            showEffects,
            isGM: game.user?.isGM ?? false,
        };
    }

    _partySizeLabel(n) {
        if (n <= 1) return n === 1 ? "Solo" : "";
        if (n === 2) return "Duo";
        if (n <= 4) return "Light Party";
        if (n <= 8) return "Full Party";
        return "Alliance";
    }

    // ------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------

    /** Click a frame: toggle targeting on that token. */
    static async #onToggleTarget(event, target) {
        event.preventDefault();
        const tokenId = target.dataset.tokenId;
        if (!tokenId) return;
        const token = canvas.tokens?.get(tokenId);
        if (!token) return;
        // releaseTargets=false keeps other targets; shift toggles additively
        const targets = new Set(game.user.targets.map(t => t.id));
        if (targets.has(tokenId)) token.setTarget(false, { releaseOthers: false });
        else token.setTarget(true, { releaseOthers: false });
    }

    /** Click a portrait: open the actor sheet (if viewable). */
    static async #onOpenSheet(event, target) {
        event.preventDefault();
        event.stopPropagation();
        const actor = game.actors?.get(target.dataset.actorId);
        if (actor?.sheet) actor.sheet.render(true);
    }

    /** GM: lock/unlock an enemy bar for everyone. */
    static async #onBossLock(event, target) {
        event.preventDefault();
        event.stopPropagation();
        if (!game.user?.isGM) return;
        const token = canvas.tokens?.get(target.dataset.tokenId);
        if (!token) return;
        const cur = !!token.document.getFlag("eqrmss", HUD_FLAG);
        await token.document.setFlag("eqrmss", HUD_FLAG, !cur);
    }

    // ------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------

    static init() {
        try {
            game.eqrmss = game.eqrmss ?? {};
            if (game.eqrmss.partyHud) return game.eqrmss.partyHud;
            const hud = new EQRMSSPartyHUD();
            game.eqrmss.partyHud = hud;
            hud.render(true);
            console.log("EQRMSS | Party HUD initialized");
            return hud;
        } catch (e) {
            console.warn("EQRMSS | Party HUD init failed", e);
            return null;
        }
    }

    static rerender() {
        try {
            game.eqrmss?.partyHud?.render();
        } catch (e) { /* fail-open */ }
    }
}
