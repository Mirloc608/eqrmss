// ============================================================================
// EQRMSS Actor Sheet — Context Helper
// ============================================================================

// helpers/ is three levels below module/, hence ../../../
import { RMSS_STAT_KEYS, canonicalStatKey } from "../../../utils/actor/rmss-stats.js";
import { RMSSDerivedValueEngine, calculateArmorAndDefenses } from "../../../data/stats/rmss-derived-values.js";
import { getSongModifiers } from "../../../spells/songs.js";
import { getSpellModifiers } from "../../../spells/spell-buffs.js";
import { visibleSpells, visibleSongs } from "../../../utils/item-visibility.js";
import { getItemEffect } from "../../../data/item-effects/item-effect-loader.js";
import { isWorn } from "../../../utils/equipment/equipment-utils.js";
import { dedupHighestRank } from "../../../item-effects/worn-engine.js";
import { getFactionLevel, getFactionDisplayName } from "../../../utils/faction/faction.js";

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
        this._buildBuffsDebuffs(context);
        this._buildFactions(context);
        this._buildHateList(context);

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

        // Song modifiers (2026-10-06): EQ stat -> RMSS key
        // Spell modifiers (2026-10-07): same scaling, stacks with song
        const songMods = getSongModifiers(this.actor);
        const spellMods = getSpellModifiers(this.actor);
        const EQ_TO_RMSS = {
            str: "ST", sta: "CO", agi: "AG", dex: "QU",
            wis: "EM", int: "ME", cha: "PR"
        };
        const songBonusFor = (rmssKey) => {
            let total = 0;
            for (const [eqStat, bonus] of Object.entries(songMods.statBonuses)) {
                if (EQ_TO_RMSS[eqStat] === rmssKey) total += bonus;
            }
            for (const [eqStat, bonus] of Object.entries(spellMods.statBonuses)) {
                if (EQ_TO_RMSS[eqStat] === rmssKey) total += bonus;
            }
            return total;
        };

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

            // Total temporary value: Temp + Basic + Racial + Special + Song bonuses
            const song_bonus = songBonusFor(key);
            const total = temp + basic_bonus + racial_bonus + special_bonus + song_bonus;

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
                song_bonus,
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
            spells: visibleSpells(items),
            songs: visibleSongs(items),
            skills: items.filter(i => i?.type === "skill"),
            skillCategories: items.filter(i => i?.type === "skillcategory"),
            inventory: items.filter(i => new Set(["item", "consumable", "jewelry", "shield", "transport"]).has(i?.type)),
            languages: items.filter(i => i?.type === "language")
        };
    }

    _buildProgression(context) {
        context.progression = { current: {}, next: {} };
    }

    // ------------------------------------------------------------
    // BUFFS & DEBUFFS (Status tab)
    //
    // Reads the actor's Foundry ActiveEffects and splits them into
    // two display lists. Category comes from
    // effect.flags.eqrmss.category ("buff" | "debuff"); effects
    // without the flag default to buffs. The spell-casting engine
    // should set the flag when applying spell effects; debuffs are
    // only removable via curative spells, never by hand.
    // ------------------------------------------------------------
    _buildBuffsDebuffs(context) {
        const buffs = [];
        const debuffs = [];
        // Unlinked tokens (2026-10-09): read from base actor. Synthetic
        // token actors don't have the spellEffects written by applyBuff.
        const baseActor = this.actor?.isToken
            ? (globalThis.game?.actors?.get(this.actor?.token?.actorId) ?? this.actor)
            : this.actor;
        for (const effect of baseActor?.effects ?? []) {
            if (effect.disabled) continue;
            const entry = {
                id: effect.id,
                name: effect.name ?? "Unnamed Effect",
                origin: effect.origin ?? null
            };
            if (effect.flags?.eqrmss?.category === "debuff") debuffs.push(entry);
            else buffs.push(entry);
        }
        // Worn item effects (e.g. Flowing Thought) — passive, tied to the
        // item; shown read-only, no dismiss button. Unequip to remove.
        // Non-stacking families (stacking: "highest") display only the
        // highest-ranked worn instance; ties go to the first found item.
        const wornEntries = [];
        for (const item of this.actor?.items ?? []) {
            if (!isWorn(item)) continue;
            const effectId = item.system?.wornEffect;
            if (!effectId) continue;
            const effect = getItemEffect(effectId);
            if (!effect) continue;
            wornEntries.push({ item, effect, effectId });
        }
        const { suppressed: suppressedWorn } = dedupHighestRank(wornEntries);
        for (const { item, effect, effectId } of wornEntries) {
            if (suppressedWorn.has(item)) continue;
            buffs.push({
                id: `worn-${item.id}`,
                name: `${effect.name ?? effectId} (${item.name})`,
                origin: null,
                fromItem: true
            });
        }
        // Timed spell/clicky/proc effects (HoTs, regen, buffs with
        // durations) live in system.status.spellEffects — show them
        // read-only alongside the other buffs.
        const timed = baseActor?.system?.status?.spellEffects;
        if (Array.isArray(timed)) {
            for (const e of timed) {
                const label = e?.name ?? e?.label ?? "Timed Effect";
                const rounds = Number(e?.roundsLeft ?? e?.rounds ?? 0);
                const roundsTxt = rounds > 0 ? ` (${rounds} rounds)` : "";
                // Group ID for dismiss: spellId/songId groups all effects from
                // the same spell/song (2026-10-07). Clicking X removes the whole group.
                const groupId = e?.spellId ?? e?.songId ?? null;
                const entry = {
                    id: `timed-${e?.id ?? label}`,
                    name: `${label}${roundsTxt}`,
                    origin: e?.source ?? null,
                    fromItem: false,
                    timedId: e?.id ?? label,
                    timedSource: e?.source ?? null,
                    groupId: groupId
                };
                if (e?.category === "debuff") debuffs.push(entry);
                else buffs.push(entry);
            }
        }
        context.buffs = buffs;
        context.debuffs = debuffs;

        // Class-based tab visibility: bards get Songs (not Spells);
        // pure melee (warrior, rogue, monk, berserker) get neither.
        const sys = this.actor?.system ?? {};
        const classId = String(sys.origin?.classId ?? sys.fixed_info?.classId ?? "").toLowerCase();
        const PURE_MELEE = new Set(["warrior", "rogue", "monk", "berserker"]);
        context.isBard = classId === "bard";
        context.isPaladin = classId === "paladin";
        context.isShadowknight = classId === "shadowknight";
        context.isBeastlord = classId === "beastlord";
        context.hasSpells = classId !== "" && classId !== "bard" && !PURE_MELEE.has(classId);

        // Era Capstones (2026-10-09, refresh tiers 2026-10-09): available capstones for the Combat tab.
        // Uses game.eqrmss.capstones populated by the capstone loader at boot.
        // Refresh tiers: "combat" (end of combat), "rest" (end of rest), "day" (end of day).
        try {
            const caps = globalThis.game?.eqrmss?.capstones;
            if (caps?.byClass?.[classId]) {
                const actorLevel = Number(sys.attributes?.level?.value) || 1;
                const used = sys.status?.capstonesUsed || [];
                context.capstones = caps.byClass[classId]
                    .filter(c => c.level <= actorLevel)
                    .sort((a, b) => a.level - b.level)
                    .map(c => ({
                        ...c,
                        onCooldown: used.includes(c.id),
                        refresh: c.refresh || "combat",
                    }));
            } else {
                context.capstones = [];
            }
        } catch (err) {
            context.capstones = [];
        }
    }

    // ------------------------------------------------------------
    // FACTIONS (Status tab / NPC sheet)
    //
    // Reads system.factions = { "<faction-id>": <value> } and builds
    // a display list with resolved names, level labels, and colors.
    // Only factions with explicitly stored values are shown.
    // ------------------------------------------------------------
    _buildFactions(context) {
        const FACTION_COLORS = {
            ally: "#2e7d32", warmly: "#43a047", kindly: "#66bb6a",
            amiable: "#9e9d24", indifferent: "#757575",
            apprehensive: "#ef6c00", dubious: "#e65100",
            threatening: "#d84315", scowls: "#b71c1c"
        };
        const stored = this.system?.factions ?? {};
        const list = [];
        for (const [factionId, rawValue] of Object.entries(stored)) {
            const value = Number(rawValue) || 0;
            const level = getFactionLevel(value);
            list.push({
                id: factionId,
                name: getFactionDisplayName(factionId),
                value,
                level: level.label,
                levelKey: level.key,
                color: FACTION_COLORS[level.key] ?? "#757575"
            });
        }
        // Most hostile first, then alphabetical
        list.sort((a, b) => a.value - b.value || a.name.localeCompare(b.name));
        context.factions = list;
    }

    // ------------------------------------------------------------
    // HATE LIST (Status tab / NPC sheet)
    //
    // Reads system.status.aggro = { "<attackerId>": { damage,
    // debuffs, heal, lastRound, name } } (memblur system) and builds a
    // threat-sorted display list.
    // ------------------------------------------------------------
    _buildHateList(context) {
        const aggro = this.system?.status?.aggro ?? {};
        const list = [];
        for (const [attackerId, entry] of Object.entries(aggro)) {
            list.push({
                id: attackerId,
                name: entry?.name ?? "Unknown",
                damage: Number(entry?.damage) || 0,
                debuffs: Number(entry?.debuffs) || 0,
                heal: Number(entry?.heal) || 0,
                lastRound: Number(entry?.lastRound) || 0
            });
        }
        // Highest threat first (damage + heal, then debuffs)
        list.sort((a, b) => (b.damage + b.heal) - (a.damage + a.heal) || b.debuffs - a.debuffs);
        context.hateList = list;
    }
}