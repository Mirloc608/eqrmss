// ============================================================
// EQRMSS AA Advancement
//
// Alternate Advancement purchased with AA points (real-EQ style).
//
// - AA points are an actor currency: system.aa.points (unspent),
//   system.aa.spent (lifetime), system.aa.abilities [{id, rank}].
// - Points are granted by the GM (sheet control + game.eqrmss.aa API).
//   Future earn sources (AA XP conversion) can call grantPoints.
// - purchaseRank() validates class, level, prerequisites, max rank,
//   and affordability, then deducts points and records the rank.
//
// AA definitions come from the runtime AA catalog
// (game.eqrmss.aas.byId), already expansion-gated by the AA loader.
//
// Foundry VTT V13 / V14 Compatible
// ============================================================

const AA_STATE_DEFAULTS = {
    points: 0,
    spent: 0,
    abilities: []
};

export class EQRMSSAAAdvancement {

    // ========================================================
    // STATE
    // ========================================================

    static getAAState(actor) {
        const s = actor?.system?.aa ?? {};
        return {
            points: Math.max(0, Math.floor(Number(s.points) || 0)),
            spent: Math.max(0, Math.floor(Number(s.spent) || 0)),
            abilities: Array.isArray(s.abilities)
                ? s.abilities
                      .filter(a => a && typeof a.id === "string")
                      .map(a => ({ id: a.id, rank: Math.max(0, Math.floor(Number(a.rank) || 0)) }))
                : []
        };
    }

    static getPurchasedRank(actor, aaId) {
        const entry = this.getAAState(actor).abilities.find(a => a.id === aaId);
        return entry ? entry.rank : 0;
    }

    // ========================================================
    // CATALOG
    // ========================================================

    static getAADef(aaId) {
        return game?.eqrmss?.aas?.byId?.[aaId] ?? null;
    }

    static getProfession(actor) {
        return (
            actor?.system?.fixed_info?.profession ??
            actor?.system?.origin?.classId ??
            null
        );
    }

    static getLevel(actor) {
        return (
            Math.floor(Number(
                actor?.system?.attributes?.level?.value ??
                actor?.system?.character?.level ??
                1
            )) || 1
        );
    }

    /**
     * All AAs usable by a profession: class-specific plus general
     * (classes: []). The runtime catalog is already expansion-gated.
     */
    static getClassAAs(profession) {
        const byClass = game?.eqrmss?.aas?.byClass ?? {};
        const specific = profession ? (byClass[profession] ?? []) : [];
        const general = byClass.all ?? [];
        const seen = new Set();
        const out = [];
        for (const aa of [...specific, ...general]) {
            if (!aa?.id || seen.has(aa.id)) continue;
            seen.add(aa.id);
            out.push(aa);
        }
        return out;
    }

    // ========================================================
    // ELIGIBILITY
    // ========================================================

    static checkEligibility(actor, aaDef) {
        if (!aaDef) return { ok: false, reason: "Unknown AA." };

        const sys = aaDef.system ?? {};
        const profession = this.getProfession(actor);
        const classes = sys.classes ?? [];

        if (classes.length > 0 && profession && !classes.includes(profession)) {
            return { ok: false, reason: "Not available to your class." };
        }

        const level = this.getLevel(actor);
        const levelRequired = Number(sys.levelRequired ?? 1);
        if (level < levelRequired) {
            return { ok: false, reason: `Requires level ${levelRequired}.` };
        }

        // Prerequisites: supports "aa-id" or { id, rank }. Current
        // dataset has none; handled defensively for future data.
        for (const pre of sys.prerequisites ?? []) {
            const preId = typeof pre === "string" ? pre : pre?.id;
            const preRank = typeof pre === "object" ? Math.max(1, Math.floor(Number(pre.rank) || 1)) : 1;
            if (!preId || this.getPurchasedRank(actor, preId) < preRank) {
                return { ok: false, reason: "Missing prerequisite." };
            }
        }

        const currentRank = this.getPurchasedRank(actor, aaDef.id);
        const maxRanks = Math.max(1, Math.floor(Number(sys.maxRanks ?? 1)));
        if (currentRank >= maxRanks) {
            return { ok: false, reason: "Already at max rank." };
        }

        return { ok: true, currentRank, maxRanks };
    }

    /** Cost of the NEXT rank, given the current rank (0-based index). */
    static getCost(aaDef, currentRank) {
        const costs = aaDef?.system?.costPerRank ?? [];
        return Math.max(0, Math.floor(Number(costs[currentRank]) || 0));
    }

    static getAvailableAAs(actor) {
        const profession = this.getProfession(actor);
        const state = this.getAAState(actor);
        return this.getClassAAs(profession)
            .map(def => {
                const check = this.checkEligibility(actor, def);
                const currentRank = this.getPurchasedRank(actor, def.id);
                const cost = check.ok ? this.getCost(def, check.currentRank) : null;
                return {
                    id: def.id,
                    name: def.name,
                    category: def.system?.category ?? "",
                    levelRequired: Number(def.system?.levelRequired ?? 1),
                    maxRanks: Math.max(1, Math.floor(Number(def.system?.maxRanks ?? 1))),
                    currentRank,
                    cost,
                    eligible: check.ok,
                    affordable: check.ok && cost > 0 && state.points >= cost,
                    reason: check.reason ?? null
                };
            })
            .sort((a, b) =>
                (a.levelRequired - b.levelRequired) ||
                a.name.localeCompare(b.name)
            );
    }

    static getPurchasedAAs(actor) {
        return this.getAAState(actor).abilities.map(entry => {
            const def = this.getAADef(entry.id);
            return {
                id: entry.id,
                rank: entry.rank,
                name: def?.name ?? entry.id,
                category: def?.system?.category ?? "",
                maxRanks: Math.max(1, Math.floor(Number(def?.system?.maxRanks ?? 1))),
                levelRequired: Number(def?.system?.levelRequired ?? 1)
            };
        });
    }

    // ========================================================
    // ECONOMY
    // ========================================================

    /**
     * Grant AA points. Called by the GM sheet control; also the public
     * API for future earn sources (AA XP conversion, quest rewards).
     * Permission is the caller's responsibility.
     */
    static async grantPoints(actor, amount, { reason } = {}) {
        amount = Math.floor(Number(amount));
        if (!actor) return { ok: false, reason: "No actor." };
        if (!Number.isFinite(amount) || amount <= 0) {
            return { ok: false, reason: "Amount must be a positive whole number." };
        }

        const state = this.getAAState(actor);
        const next = {
            points: state.points + amount,
            spent: state.spent,
            abilities: state.abilities
        };

        await actor.update({ "system.aa": next });

        ui.notifications?.info(
            `EQRMSS | Granted ${amount} AA point(s)` +
            (reason ? ` (${reason})` : "") +
            ` to ${actor.name}. Balance: ${next.points}.`
        );
        return { ok: true, points: next.points };
    }

    /**
     * Purchase the next rank of an AA. Validates eligibility and
     * affordability, deducts points, records the rank.
     */
    static async purchaseRank(actor, aaId) {
        if (!actor) return { ok: false, reason: "No actor." };

        const def = this.getAADef(aaId);
        if (!def) {
            const r = { ok: false, reason: "Unknown AA." };
            ui.notifications?.warn(`EQRMSS | ${r.reason}`);
            return r;
        }

        const check = this.checkEligibility(actor, def);
        if (!check.ok) {
            ui.notifications?.warn(`EQRMSS | Cannot purchase ${def.name}: ${check.reason}`);
            return check;
        }

        const cost = this.getCost(def, check.currentRank);
        if (cost <= 0) {
            const r = { ok: false, reason: "This rank has no defined cost." };
            ui.notifications?.warn(`EQRMSS | ${r.reason}`);
            return r;
        }

        const state = this.getAAState(actor);
        if (state.points < cost) {
            const r = { ok: false, reason: `Needs ${cost} AA points (have ${state.points}).` };
            ui.notifications?.warn(`EQRMSS | ${r.reason}`);
            return r;
        }

        const abilities = state.abilities.map(a => ({ ...a }));
        const entry = abilities.find(a => a.id === aaId);
        if (entry) entry.rank = check.currentRank + 1;
        else abilities.push({ id: aaId, rank: 1 });

        await actor.update({
            "system.aa": {
                points: state.points - cost,
                spent: state.spent + cost,
                abilities
            }
        });

        ui.notifications?.info(
            `EQRMSS | ${actor.name} purchased ${def.name} ` +
            `rank ${check.currentRank + 1}/${check.maxRanks} for ${cost} AA point(s).`
        );
        return { ok: true, rank: check.currentRank + 1 };
    }
}

export default EQRMSSAAAdvancement;
