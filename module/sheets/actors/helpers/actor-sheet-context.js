// ============================================================================
// EQRMSS Actor Sheet — Context Helper
// ============================================================================

// helpers/ is three levels below module/, hence ../../../
import { RMSS_STAT_KEYS, canonicalStatKey } from "../../../utils/actor/rmss-stats.js";
import { RMSSDerivedValueEngine, calculateArmorAndDefenses } from "../../../data/stats/rmss-derived-values.js";

const STAT_LABELS = {
    ST: "Strength",
    AG: "Agility",
    CO: "Constitution",
    ME: "Memory",
    RE: "Reasoning",
    SD: "Self Discipline",
    EM: "Empathy",
    IN: "Intuition",
    PR: "Presence",
    QU: "Quickness"
};

export class EQRMSSActorContextHelper {

    constructor(sheet) {
        this.sheet = sheet;

        // NOTE: deliberately NOT caching actor/system here. Foundry
        // replaces the .system object reference on every document
        // update, so a constructor-cached reference goes permanently
        // stale (totals stopped recalculating after the first edit).
    }

    get actor() {
        return this.sheet?.actor ?? this.sheet?.document ?? null;
    }

    /** Live system data — always read through, never cached. */
    get system() {
        return this.actor?.system ?? {};
    }

    async prepare(context = {}) {
        if (!this.actor) {
            console.warn("EQRMSS | Actor Context Helper invoked without actor");
            return context;
        }

        context.system ??= this.system ?? {};
        context.system.fixed_info ??= this.system?.fixed_info ?? {};

        await this._resolveRaceName(context);
        await this._resolveProfessionName(context);
        this._annotateStats(context);
        this._categorizeItems(context);
        this._buildProgression(context);

        context.data ??= {};
        context.data.name = this.actor.name ?? "";

        // Sheet header "Player" field: resolved live from the ownership
        // map so GM re-assignments show up without manual edits. Falls
        // back to any stored playerName, then to the owning user's name.
        const ownerUserId = Object.entries(this.actor.ownership ?? {})
            .find(([uid, level]) =>
                uid !== "default" &&
                Number(level) === (CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3)
            )?.[0];
        const ownerUser = ownerUserId ? game.users.get(ownerUserId) : null;
        context.system.playerName =
            this.system?.playerName ||
            ownerUser?.name ||
            "";

        // Header identity fields: role_traits is the template's source,
        // but the wizard/actor layer stores these in fixed_info. Bridge
        // them so Sex / Height / Weight render without double entry.
        context.system.role_traits ??= {};
        const fixed = this.system?.fixed_info ?? {};
        context.system.role_traits.sex ??=
            this.system?.gender ?? fixed.sex ?? "";
        if (!context.system.role_traits.height) {
            context.system.role_traits.height =
                this.system?.physical?.height ?? "";
        }
        if (!context.system.role_traits.weight) {
            context.system.role_traits.weight =
                this.system?.physical?.weight ?? "";
        }

        context.data.raceName =
            this.system?.race?.name ??
            context.system.fixed_info?.race_name ??
            this.system?.raceName ??
            "";

        context.data.professionName =
            this.system?.class?.name ??
            context.system.fixed_info?.profession_name ??
            this.system?.professionName ??
            "";

        context.data.realm =
            this.system?.class?.realm ??
            context.system.fixed_info?.realm ??
            this.system?.realm ??
            "";

        context.data.progression = context.progression ?? { current: {}, next: {} };

        // Canonical RMSS stat records live at system.stats.<KEY>. Older
        // documents may carry them under system.data.stats or
        // system.attributes (pre-canonical wizard output); resolve the
        // first record that actually holds stat-shaped entries.
        const rawStats =
            this.#resolveStatSource();

        context.rmssStats = RMSS_STAT_KEYS.map(key => {
            const foundKey = Object.keys(rawStats).find(
                k => String(k).toUpperCase() === key
            );

            const statData = foundKey ? rawStats[foundKey] : {};

            const temp = Number(statData.temp ?? statData.temporary ?? 0);
            const potential = Number(statData.potential ?? statData.pot ?? 0);
            const basic_bonus = Number(statData.basic_bonus ?? statData.basic ?? 0);
            const racial_bonus = Number(statData.racial_bonus ?? statData.racial ?? 0);
            const special_bonus = Number(statData.special_bonus ?? statData.special ?? 0);

            // Total temporary value: Temp + Basic + Racial + Special bonuses
            const total = temp + basic_bonus + racial_bonus + special_bonus;

            return {
                key,
                label: STAT_LABELS[key] ?? key,
                abbr: key,
                // "temporary" is the property name bound by the sheet template
                temporary: statData.temp ?? statData.temporary ?? "",
                potential: statData.potential ?? statData.pot ?? "",
                basic_bonus,
                racial_bonus,
                special_bonus,
                total
            };
        });

        // --------------------------------------------------------------------
        // INTEGRATED: Compute derived metrics and combat/defense stats
        // --------------------------------------------------------------------
        const engineStatsMap = {};
        for (const s of context.rmssStats) {
            // Map canonical keys to short keys expected by RMSSDerivedValueEngine (St, Ag, Co, etc.)
            const shortKeyMap = { ST: "St", AG: "Ag", CO: "Co", ME: "Me", RE: "Re", SD: "SD", EM: "Em", IN: "In", PR: "Pr", QU: "Qu" };
            const mappedKey = shortKeyMap[s.key] ?? s.key;
            engineStatsMap[mappedKey] = s.total || s.temporary || 50;
        }

        const derivedEngine = new RMSSDerivedValueEngine();
        context.system.derived = derivedEngine.compute(engineStatsMap);

        // Calculate and apply armor, MMP, penalties, quickness bonus, and total DB
        const combatDefenses = calculateArmorAndDefenses(this.actor);
        context.system.combat = Object.assign(context.system.combat || {}, combatDefenses);
        // --------------------------------------------------------------------

        context.actor = this.actor;
        context.rawItems = this.actor.items?.contents ?? [];
        context.level = Number(this.system?.level?.value ?? this.system?.level ?? 1);
        context.name = this.actor.name ?? "";
        context.raceName = context.data.raceName;
        context.professionName = context.data.professionName;
        context.realm = context.data.realm;

        return context;
    }

    async _resolveRaceName(context) {
        if (this.system?.race?.name) return;
        const fixedInfo = context.system?.fixed_info ?? {};
        const raceId = fixedInfo.race;
        if (!raceId) { fixedInfo.race_name ??= ""; return; }
        try {
            const raceItem = await fromUuid(raceId);
            fixedInfo.race_name = raceItem?.name ?? raceId;
        } catch (e) { fixedInfo.race_name = raceId; }
    }

    async _resolveProfessionName(context) {
        if (this.system?.class?.name) return;
        const fixedInfo = context.system?.fixed_info ?? {};
        const professionId = fixedInfo.profession;
        if (!professionId) { fixedInfo.profession_name ??= ""; return; }
        try {
            const professionItem = await fromUuid(professionId);
            fixedInfo.profession_name = professionItem?.name ?? professionId;
        } catch (e) { fixedInfo.profession_name = professionId; }
    }

    _annotateStats(context) {}

    /**
     * Locate the stat record on the document, preferring the canonical
     * system.stats.<KEY> schema and falling back to legacy locations
     * (system.data.stats, then system.attributes) for older actors.
     */
    #resolveStatSource() {
        const candidates = [
            this.system?.stats,
            this.system?.data?.stats,
            this.system?.attributes
        ];

        for (const source of candidates) {
            if (!source || typeof source !== "object") continue;
            const hasStatEntry = Object.keys(source).some(
                key => canonicalStatKey(key) != null &&
                       typeof source[key] === "object" && source[key] !== null
            );
            if (hasStatEntry) return source;
        }

        return {};
    }

    _categorizeItems(context) {
        const items = this.actor?.items?.contents ?? [];
        context.items = {
            all: items,
            weapons: items.filter(i => i?.type === "weapon"),
            armor: items.filter(i => i?.type === "armor"),
            herbs: items.filter(i => i?.type === "herb_or_poison"),
            spells: items.filter(i => i?.type === "spell"),
            songs: items.filter(i => i?.type === "song"),
            skills: items.filter(i => i?.type === "skill"),
            skillCategories: items.filter(i => i?.type === "skillcategory"),
            inventory: items.filter(i => new Set(["item", "consumable", "jewelry", "shield", "transport"]).has(i?.type)),
            languages: items.filter(i => i?.type === "language")
        };
    }

    _buildProgression(context) {
        context.progression = { current: {}, next: {} };
    }
}