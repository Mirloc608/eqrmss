// ============================================================
// EQRMSS Critical Conditions — stun pool, bleed, death timer,
// next-swing bonus, action penalty, must-parry capture, Parry,
// first-aid stub, healing-magic hook.
//
// User rulings (2026-09-30):
// - STUN: "stunned", "stun-no-parry" and "down-or-out" rounds are all
//   "stuns". Stuns from multiple criticals are CUMULATIVE. The total
//   decreases by one each round, with the most severe type taking
//   effect first (down-or-out > stun-no-parry > stunned).
// - STUN EFFECTS: stunned = cannot take offensive action;
//   stun-no-parry = no offensive or defensive actions other than
//   base defense. (Plain stun CAN parry — that is the distinction.)
// - BLEED: ticks until stopped — death, heal spell, or first aid.
// - DEATH TIMER: ticks down each round; stabilized ONLY by a direct
//   healing magic spell (even a low-level one); at 0 the foe dies.
//   "Then dies" = death when the stated rounds expire; with no
//   stated rounds the death is immediate.
// - NEXT SWING: +N stored on the attacker's sheet, consumed on their
//   next attack roll.
// - AT -N: applies to ALL actions (tracked with its own duration).
// - PARRY: a Full Parry puts ALL of the combatant's OB into DB —
//   weapon, shield, or martial-arts parry (Monks, Beastlords).
//   Declaration timing and attack-forfeit enforcement are still
//   pending (non-offensive combat mechanics).
// - FIRST AID: stubbed — lands with non-combat actions per round.
// - UNCONSCIOUS (§6.4.1): concussion hits taken EXCEEDING total hits
//   → unconscious; no further action until back under the limit
//   (condition-based — does not tick down).
// - DYING (§3.8): concussion hits taken EXCEEDING total hits + CO stat
//   → dies after the race's roundsToSoulDeparture rounds
//   (Table 15.5.1, module/data/races/base-hits.json); dropping back
//   under the threshold clears the countdown.
// NOT yet ruled — parsed/stored but not mechanically enforced:
// - penalty expiry when the text gives no duration (indefinite now)
// - whether "at -N" touches DB (rolls only, for now)
//
// Parser coverage notes:
// - DOWN-OR-OUT: explicit "down for N rounds" maps at that duration;
//   bare "knocked down" counts as down-or-out for 1 round (ruling
//   2026-10-04).
// - CONDITIONAL CRITS: "If foe has shield/helm/..." branches are
//   adjudicated against the target's worn gear before parsing (see
//   adjudicateCritText); unresolvable conditions stay GM-adjudicated.
//
// State lives under system.status (persistent; never rebuilt by the
// actor prepare pipeline):
//   status.stun           { stunned, stunNoParry, downOrOut } (rounds)
//   status.bleed          { perRound }
//   status.deathTimer     number (rounds left)
//   status.actionPenalty  { value, rounds } (untimed now defaults to 3 rounds per 2026-10-06 ruling)
//   status.mustParry      { rounds, penalty }
//   status.nextSwingBonus number
//   status.parrying       boolean (declared parry, cleared each round)
//   status.parryDB        number (OB allocated to DB by the parry)
//   status.parryMaxOB     number (the parrying weapon's full OB)
//   status.parryWeaponId  string (item id the parry was declared with)
//   status.parryWeaponName string (display name for the parry weapon)
//   status.parryWeaponType string (weapon category for parry limits)
//   status.parryTargetId / parryTargetName: the ONE foe the parry
//     applies against (§4.3: "A combatant may only parry the foe
//     that he attacks") — designated at declaration from the current
//     target, and (re)set to whoever the parrier attacks.
//   status.parryFull      boolean (all of the weapon's OB allocated)
//   status.shieldOpponentId string (opponent the shield DB is assigned to)
//   status.shieldOpponentName string (display name for that opponent)
//   status.shieldOpponentRoundKey string (combat id:round for the assignment)
//   status.attackedThisRound boolean (attack made; blocks a later parry)
//   status.unconscious    boolean (§6.4.1)
//   status.soulTimer      number (rounds left; §3.8 dying countdown)
//   status.soulTimerUnknown boolean (dying, race not in Table 15.5.1 —
//                         GM adjudicates; no invented countdown)
//   status.dead           boolean
// ============================================================

import { WEAPON_TYPE_TO_SKILL_ID } from "./attack-resolver.js";
import { isWorn } from "../utils/equipment/equipment-utils.js";
import { roundExhaustionCost, exhaustionCurrent, exhaustionMaxFor } from "./subdue.js";
import { combatCard } from "./chat-card.js";
import { applyWornRoundEffects } from "../item-effects/worn-engine.js";

function esc(s) {
    return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Most severe first.
export const STUN_ORDER = ["downOrOut", "stunNoParry", "stunned"];
export const STUN_LABEL = {
    stunned: "stunned",
    stunNoParry: "stunned and unable to parry",
    downOrOut: "down or out"
};

const ROUNDS_RE = "r(?:ou)?nds?"; // round, rounds, rnd, rnds

// ------------------------------------------------------------
// Shared weapon OB (attack and parry use the same figure)
// ------------------------------------------------------------

export function computeWeaponOB(actor, weaponItem) {
    const sys = weaponItem?.system ?? {};
    const weaponType = sys.type;
    const skillId = WEAPON_TYPE_TO_SKILL_ID[weaponType];
    const skill = skillId
        ? actor?.items?.find?.(i => i.type === "skill" && i.system?.slug === skillId)
        : null;
    const skillBonus = Number(skill?.system?.bonus) || 0;
    const obMod = Number(sys.obMod) || 0;
    // Prone (user ruling 2026-10-06 Option B): -30 to actions
    const proneRounds = Number(actor?.system?.status?.prone?.rounds) || 0;
    const pronePenalty = proneRounds > 0 ? -30 : 0;
    return { weaponType, skill, skillBonus, obMod, ob: skillBonus + obMod + pronePenalty, pronePenalty };
}

// ------------------------------------------------------------
// Text parsers (crit result -> structured condition)
// ------------------------------------------------------------

// "stunned for 2 rounds", "stunned 3 rnds", "stuns foe for 1 round",
// "stunned next round" (= 1). A number that belongs to a no-parry
// clause ("unable to parry", "cannot parry", "can't parry") is NOT
// plain stun — it is captured by the no-parry branch below. Combined
// clauses state the no-parry rounds INSIDE the stun total ("stunned
// for 4 rounds and cannot parry for 2 rounds" = 2 stun-no-parry +
// 2 plain stun); those are split first so nothing double-counts.
/**
 * Parse "down" / "knocked down" / "knocked out" / "prone" from critical text.
 * Returns rounds of prone (1 if found, 0 if not). Per user ruling 2026-10-06
 * Option B: prone is a separate status, -30 to actions, clears after 1 round
 * (the round spent standing).
 */
export function parseProne(text) {
    if (!text) return 0;
    const t = String(text).toLowerCase();
    // Match: "knocked down", "knocked out", "foe is down", "prone", "down"
    // Avoid false positives like "knocked down to size" (not a thing) or
    // "break down" — require word boundaries and combat context.
    if (/\bknocked\s+(down|out)\b/i.test(t)) return 1;
    if (/\bprone\b/i.test(t)) return 1;
    // "foe is down", "target is down", "opponent down" — but not "lay down" or "sit down"
    if (/\b(foe|target|opponent|enemy|victim)\s+(is\s+)?down\b/i.test(t)) return 1;
    return 0;
}

export function parseStun(text) {
    const out = { stunned: 0, stunNoParry: 0, downOrOut: 0 };
    if (!text) return out;
    let rest = String(text);

    // Combined clause: stun total with a no-parry subset.
    const combRe = new RegExp(
        `stun(?:ned|s)?(?:\\s+foe)?(?:\\s+for)?\\s+(\\d+)\\s+${ROUNDS_RE}\\s+and\\s+(?:cannot|can not|can't|unable to|not able to)\\s+parry(?:\\s+for)?\\s+(\\d+)\\s+${ROUNDS_RE}`,
        "gi"
    );
    rest = rest.replace(combRe, (m, x, y) => {
        const total = Number(x), noParry = Number(y);
        out.stunNoParry += noParry;
        out.stunned += Math.max(0, total - noParry);
        return "";
    });

    const npRe = new RegExp(`(?:unable to|not able to|cannot|can not|can't)\\s+parry\\s+(?:for\\s+)?(?:next\\s+)?(?:(\\d+)\\s+)?(${ROUNDS_RE})`, "gi");
    let m;
    while ((m = npRe.exec(rest))) out.stunNoParry += m[1] ? Number(m[1]) : 1;
    const stRe = new RegExp(`stun(?:ned|s)?(?:\\s+foe)?(?:\\s+for)?\\s+(\\d+)\\s+(${ROUNDS_RE})`, "gi");
    while ((m = stRe.exec(rest))) {
        if (/(?:unable to|not able to|cannot|can not|can't)\s+parry/i.test(m[0])) continue; // duration belongs to the no-parry clause
        out.stunned += Number(m[1]);
    }
    // "stunned next round" (= 1) and its phrasing variants in the
    // tables: "stunned during/for/in the next round", "stunned next
    // rnd", "stunned next 2 rounds" (numbered). "next" blocks the
    // numbered stRe above, so these cannot double-count it;
    // numberless = 1 round.
    const nextRe = new RegExp(`stun(?:ned|s)?(?:\\s+foe)?\\s+(?:during\\s+|in\\s+|for\\s+)?(?:the\\s+)?next\\s+(?:(\\d+)\\s+)?(${ROUNDS_RE})`, "gi");
    while ((m = nextRe.exec(rest))) out.stunned += m[1] ? Number(m[1]) : 1;
    // Spell Law shorthand (Heat and other Spell Law crit tables):
    // "N*" = stunned N rounds, "N@" = cannot parry N rounds,
    // "N*@" = stunned and cannot parry for N rounds (the stun-total /
    // no-parry-subset split puts all of it in the no-parry pool).
    rest = rest.replace(/(\d+)\s?\*@/g, (_m, n) => { out.stunNoParry += Number(n); return ""; });
    rest = rest.replace(/(\d+)\s?@/g, (_m, n) => { out.stunNoParry += Number(n); return ""; });
    rest = rest.replace(/(\d+)\s?\*/g, (_m, n) => { out.stunned += Number(n); return ""; });
    // Explicit "down for N rounds" -> down-or-out pool. Bare "knocked
    // down" (no duration) is still not parsed: no ruling on its length.
    const downRe = new RegExp(`\\bdown\\s+for\\s+(?:for\\s+)?(\\d+)\\s+(${ROUNDS_RE})`, "gi");
    while ((m = downRe.exec(rest))) out.downOrOut += Number(m[1]);
    // Ruling (2026-10-04): bare "knocked down" counts as Down or Out
    // for 1 round when no explicit "down for N rounds" is stated.
    // ("Knocked out" is unconsciousness, a different state.)
    if (out.downOrOut === 0 && /\bknocked\s+down\b/i.test(rest)) out.downOrOut += 1;
    return out;
}

// "bleeds at 1 hit per round", "takes +3 hits per round" -> hits/round.
// Strategic Targeting table rider: "bleed for 2/round".
// Spell Law shorthand: "N!" bleeds N hits per round.
export function parseBleed(text) {
    if (!text) return 0;
    let per = 0;
    let m;
    const re1 = /bleeds?\s+at\s+(\d+)\s+hits?\s+per\s+round/gi;
    const re2 = /takes?\s+\+?(\d+)\s+hits\s+per\s+round/gi;
    const re3 = /(\d+)\s?!/g;
    const re4 = /bleeds?\s+for\s+(\d+)\s*(?:hits?\s*)?\/?\s*round/gi;
    while ((m = re1.exec(text))) per += Number(m[1]);
    while ((m = re2.exec(text))) per += Number(m[1]);
    while ((m = re3.exec(text))) per += Number(m[1]);
    while ((m = re4.exec(text))) per += Number(m[1]);
    return per;
}

// Death timer, in rounds. Returns -1 for "then dies" with no stated
// rounds (immediate death), 0 for no death timer.
// "Then dies" reads as a timeline: the stated rounds before it are the
// countdown ("down for 6 rounds ... then dies" -> 6;
// "stunned 2 rounds, active 4 rounds at -30, then dies" -> 6).
export function parseDeathTimer(text) {
    if (!text) return 0;
    let m = text.match(/\b(?:kills?\s+foe|dies?|dead)\s+(?:in|after)\s+(\d+)\s+r(?:ou)?nds?/i);
    if (m) return Number(m[1]);
    m = text.match(/\bdies?\b[^.;]*?\bin\s+(\d+)\s+r(?:ou)?nds?/i);
    if (m) return Number(m[1]);
    m = text.match(/\bdrops?\s+on\s+round\s+(\d+)/i);
    if (m && /\bthen dies\b/i.test(text)) return Number(m[1]);
    if (/\bthen dies\b/i.test(text)) {
        const before = text.split(/\bthen dies\b/i)[0];
        const rounds = [...before.matchAll(new RegExp(`(\\d+)\\s+${ROUNDS_RE}`, "gi"))].map(x => Number(x[1]));
        if (rounds.length) return rounds.reduce((a, b) => a + b, 0);
        return -1; // "then dies", no countdown stated: immediate
    }
    // Bare immediate death: "he is dead", "he dies", "you kill him",
    // "foe then falls dead". Only reached after every timed pattern.
    if (/\b(?:is\s+dead|falls?\s+dead|he\s+dies|foe\s+dies|you\s+kill|kills?\s+(?:him|foe))\b/i.test(text)) return -1;
    return 0;
}

// ------------------------------------------------------------
// Conditional critical branches ("If foe has shield, ... If not, ...")
// ------------------------------------------------------------
// RM crit tables state equipment-conditional outcomes, and only the
// branch matching the target's worn gear applies. Conditions that
// can be checked from the target's items: shield, helm (incl. full
// and facial variants), leg armor, neck armor, metal chest armor.
// Any other condition returns the text untouched so the GM
// adjudicates, exactly as before. The chat line still shows the
// full book text; a note records which branch was applied.

const FULL_HELM_PRESETS = new Set(["full_helm", "lobster_tail"]);
const FACE_HELM_PRESETS = new Set(["full_helm", "lobster_tail", "visored_helm", "sallet_and_beaver"]);

function wornItemsOf(actor) {
    return [...(actor?.items?.contents ?? actor?.items ?? [])].filter(i => i && isWorn(i));
}

function isHeadPiece(item) {
    return item?.type === "armor"
        && (item.system?.armorLocation === "head" || item.system?.slot === "head");
}

function isFullHelm(piece) {
    const preset = piece?.system?.presetId ?? piece?.system?.helmetId ?? "";
    if (FULL_HELM_PRESETS.has(preset)) return true;
    return /full helm|lobster/i.test(piece?.name ?? "");
}

function coversFace(piece) {
    const preset = piece?.system?.presetId ?? piece?.system?.helmetId ?? "";
    if (FACE_HELM_PRESETS.has(preset)) return true;
    return isFullHelm(piece) || /visored|sallet/i.test(piece?.name ?? "");
}

// Truth of a "has ..." condition phrase, or null when the condition
// is not an equipment check this system can resolve.
function evalCritCondition(rawPhrase, actor) {
    if (!actor) return null;
    let phrase = String(rawPhrase ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    let negated = false;
    if (phrase.startsWith("no ")) { negated = true; phrase = phrase.slice(3); }
    phrase = phrase.replace(/^(?:a|an|the)\s+/, "");
    const worn = wornItemsOf(actor);
    const head = worn.filter(isHeadPiece);
    let has = null;
    if (phrase === "shield") has = worn.some(i => i.type === "shield");
    else if (phrase === "helm") has = head.length > 0;
    else if (phrase === "full helm") has = head.some(isFullHelm);
    else if (phrase === "facial armor") has = head.some(coversFace);
    else if (phrase === "leg armor") has = worn.some(i => i.type === "armor"
        && (i.system?.armorLocation === "legs" || i.system?.slot === "legs"));
    else if (phrase === "chest armor") has = worn.some(i => i.type === "armor"
        && (i.system?.armorLocation === "chest" || i.system?.slot === "chest"));
    else if (phrase === "neck armor") has = head.some(p => p.system?.dfNeckOnly === true
        || ["gorget", "aventail"].includes(p.system?.presetId ?? "")
        || /gorget|aventail/i.test(p.name ?? ""));
    else if (phrase === "metal chest armor") has = worn.some(i => i.type === "armor"
        && (i.system?.armorLocation === "chest" || i.system?.slot === "chest")
        && (Number(i.system?.at ?? i.system?.armorType) || 0) >= 13);
    if (has === null) return null;
    return negated ? !has : has;
}

function negatePhrase(phrase) {
    let p = String(phrase ?? "").trim().toLowerCase().replace(/^(?:a|an)\s+/, "");
    if (p.startsWith("no ")) return p.slice(3).replace(/^(?:a|an)\s+/, "");
    return `no ${p}`;
}

// Leading "If ..." clause of a sentence: { phrase, rest } for a
// has-condition, { ifNot, rest } for "If not, ...", else null.
function parseIfClause(sentence) {
    const s = String(sentence);
    let m = s.match(/^if\s+(.+?),\s*/i);
    if (m) {
        const clause = m[1].trim().toLowerCase();
        if (clause === "not") return { ifNot: true, rest: s.slice(m[0].length) };
        const hm = clause.match(/^(?:foe\s+|he\s+)?has\s+(.+)$/);
        if (hm) return { phrase: hm[1].trim(), rest: s.slice(m[0].length) };
        return null;
    }
    // Comma-less form: "If foe has no helm he is dead."
    m = s.match(/^if\s+(?:foe\s+|he\s+)?has\s+(no\s+)?(shield|full helm|facial armor|leg armor|chest armor|neck armor|metal chest armor|an?\s+helm|helm)\s+(.+)$/i);
    if (m) return { phrase: `${m[1] ?? ""}${m[2]}`, rest: m[3] };
    return null;
}

export function adjudicateCritText(critText, targetActor) {
    const original = String(critText ?? "");
    if (!targetActor || !/\bif\s/i.test(original)) return { text: original, note: null };
    const sentences = original.split(/(?<=\.)\s*/).map(s => s.trim()).filter(Boolean);
    const ifAt = [];
    sentences.forEach((s, i) => { if (parseIfClause(s)) ifAt.push(i); });
    if (ifAt.length === 0 || ifAt.length > 2) return { text: original, note: null };

    if (ifAt.length === 1) {
        const idx = ifAt[0];
        const clause = parseIfClause(sentences[idx]);
        if (clause.ifNot) return { text: original, note: null };
        const truth = evalCritCondition(clause.phrase, targetActor);
        if (truth === null) return { text: original, note: null };
        if (truth) sentences[idx] = clause.rest;
        else sentences.splice(idx, 1);
        const note = truth ? `foe has ${clause.phrase}` : `foe has ${negatePhrase(clause.phrase)}`;
        return { text: sentences.join(" "), note };
    }

    const [i1, i2] = ifAt;
    const c1 = parseIfClause(sentences[i1]);
    const c2 = parseIfClause(sentences[i2]);
    if (c1.ifNot) return { text: original, note: null };
    const t1 = evalCritCondition(c1.phrase, targetActor);
    if (t1 === null) return { text: original, note: null };
    let t2;
    if (c2.ifNot) t2 = !t1;
    else {
        t2 = evalCritCondition(c2.phrase, targetActor);
        if (t2 === null) return { text: original, note: null };
    }
    if (t1 === t2) return { text: original, note: null }; // not an either/or pair
    const keepFirst = t1;
    const chosen = keepFirst ? c1 : c2;
    const note = keepFirst ? `foe has ${c1.phrase}` : (c2.ifNot ? `foe has ${negatePhrase(c1.phrase)}` : `foe has ${c2.phrase}`);
    sentences[keepFirst ? i1 : i2] = chosen.rest;
    sentences.splice(keepFirst ? i2 : i1, 1);
    return { text: sentences.join(" "), note };
}

// Crit result text for display: the trailing machine code
// ("+9H,1*@..", "9*,6!,(-80)") is stripped — every element
// already gets its own human-readable note downstream — and
// terminal punctuation is normalized. Parsing still sees the
// full text, so this is display-only.
export function critDisplayText(text) {
    const tok = String.raw`(?:[+-]?\d+H|@|\d+\s?\*\@?|\d+\s?@|\d+\s?\*|\d+\s?!|\([+-]?\d+\))`;
    const re = new RegExp(`[\\s.,]*${tok}(?:\\s*,\\s*${tok})*\\.*\\s*$`);
    let out = String(text ?? "").replace(re, "").trim();
    if (!out) return String(text ?? "");
    return /[.!?]$/.test(out) ? out : out + ".";
}

// "Add +10 to your next swing." -> bonus.
// Spell Law shorthand: "(+N)" is a bonus on the next swing.
export function parseNextSwing(text) {
    if (!text) return 0;
    const m = text.match(/add\s+\+(\d+)\s+to\s+(?:your\s+)?next\s+(?:swing|attack)/i);
    if (m) return Number(m[1]);
    const sh = String(text).match(/\(\+(\d+)\)/);
    return sh ? Number(sh[1]) : 0;
}

// "at -25", "at -50 for 3 rounds", "operates at -50", "fights at -95".
// Must-parry clauses are stripped first (their "-20" stays descriptive
// on the must-parry record). Sense-specific penalties ("hears at -50",
// "vision at -25") are NOT global action penalties: a match is skipped
// when a sense word precedes it in the same sentence segment, so only
// penalties the text applies to the foe in general count. Returns
// { value, rounds } — rounds 0 = indefinite (no duration stated).
const SENSE_RE = /\b(?:hears?|hearing|vision|sees?|seeing|sight|smells?|smelling|tastes?|tasting|perception)\b/i;

export function parsePenalty(text) {
    const out = { value: 0, rounds: 0 };
    if (!text) return out;
    const stripped = String(text).replace(/must\s+parry[^.]*/gi, "");
    const re = new RegExp(`\\bat\\s+(-\\d+)(?:\\s+for\\s+(\\d+)\\s+${ROUNDS_RE})?`, "gi");
    let m;
    let senseCursor = 0; // a sense word excuses only the next penalty after it
    while ((m = re.exec(stripped))) {
        // Segment prefix: text since the last sentence break before
        // this match. A sense word there (not already consumed by an
        // earlier sense penalty) makes this a sense penalty.
        const segStart = Math.max(stripped.lastIndexOf(".", m.index), stripped.lastIndexOf(";", m.index)) + 1;
        if (SENSE_RE.test(stripped.slice(Math.max(segStart, senseCursor), m.index))) {
            senseCursor = m.index + m[0].length;
            continue;
        }
        const v = Number(m[1]);
        if (v < out.value) {
            out.value = v;
            out.rounds = m[2] ? Number(m[2]) : 0;
        }
    }
    // Spell Law shorthand: "(-N)" is an action penalty with no stated
    // duration (indefinite). "(+N)" is a next-swing bonus, not a penalty.
    const parRe = /\((-?\d+)\)/g;
    while ((m = parRe.exec(stripped))) {
        const v = Number(m[1]);
        if (v < out.value) {
            out.value = v;
            out.rounds = 0;
        }
    }
    return out;
}

// "foe must parry next round", "... at -20" -> { rounds, penalty }.
// Spell Law shorthand: "Nx" = foe must parry for N rounds.
export function parseMustParry(text) {
    const out = { rounds: 0, penalty: 0 };
    if (!text) return out;
    const x = String(text).match(/\b(\d+)\s?x\b/);
    if (x) out.rounds = Number(x[1]);
    if (!/must\s+parry(?:\s+(?:the\s+following|next))?\s+round/i.test(text)) return out;
    out.rounds = Math.max(out.rounds, 1);
    const p = text.match(/must\s+parry[^.]*?at\s+(-\d+)/i);
    if (p) out.penalty = Number(p[1]);
    return out;
}

// ------------------------------------------------------------
// Stun pool
// ------------------------------------------------------------

export function stunTotal(pool) {
    return (Number(pool?.stunned) || 0) + (Number(pool?.stunNoParry) || 0) + (Number(pool?.downOrOut) || 0);
}

// Most severe type with rounds remaining, or null.
export function activeStun(pool) {
    for (const k of STUN_ORDER) {
        const r = Number(pool?.[k]) || 0;
        if (r > 0) return { type: k, rounds: r };
    }
    return null;
}

function roundsWord(n) {
    return `${n} round${n === 1 ? "" : "s"}`;
}

// ------------------------------------------------------------
// Application (called from rollWeaponAttack after a crit lands)
// ------------------------------------------------------------

export async function applyCritConditions(targetActor, attackerActor, critText) {
    if (!critText) return "";
    const notes = [];
    const tName = targetActor?.name ?? "Target";
    const canApply = !!targetActor && (targetActor.isOwner || game.user?.isGM);

    const stun = parseStun(critText);
    const bleed = parseBleed(critText);
    const deathIn = parseDeathTimer(critText);
    const swing = parseNextSwing(critText);
    const pen = parsePenalty(critText);
    const mp = parseMustParry(critText);

    // Next-swing bonus is attacker-side.
    if (swing > 0 && attackerActor) {
        const aName = attackerActor.name;
        if (attackerActor.isOwner || game.user?.isGM) {
            const cur = Number(attackerActor.system?.status?.nextSwingBonus) || 0;
            await attackerActor.update({ "system.status.nextSwingBonus": cur + swing });
            notes.push(`${esc(aName)} gains +${swing} to their next swing.`);
        } else {
            notes.push(`+${swing} to ${esc(aName)}'s next swing — not applied, you don't control them.`);
        }
    }

    const denied = suffix => `${suffix} — not applied, you don't control ${esc(tName)}.`;

    // Prone (Option B): separate from stun, -30 to actions, 1 round
    const proneRounds = parseProne(critText);
    if (proneRounds > 0 && canApply) {
        await targetActor.update({ "system.status.prone": { rounds: proneRounds } });
        notes.push(`${esc(tName)} is knocked prone (-30 to actions, must spend a round standing).`);
    }

    if (stun.stunned > 0 || stun.stunNoParry > 0) {
        if (canApply) {
            const pool = { stunned: 0, stunNoParry: 0, ...(targetActor.system?.status?.stun ?? {}) };
            pool.stunned += stun.stunned;
            pool.stunNoParry += stun.stunNoParry;
            
            await targetActor.update({ "system.status.stun": pool });
            const active = activeStun(pool);
            notes.push(`${esc(tName)} is ${STUN_LABEL[active.type]} (${roundsWord(active.rounds)}; ${stunTotal(pool)} total stun).`);
        } else {
            notes.push(denied(`${esc(tName)} is stunned (${stunTotal(stun)} rounds)`));
        }
    }

    if (bleed > 0) {
        if (canApply) {
            // Ruling needed for stacking: keep the worst rate (single bleeding state).
            const cur = Number(targetActor.system?.status?.bleed?.perRound) || 0;
            const rate = Math.max(cur, bleed);
            await targetActor.update({ "system.status.bleed": { perRound: rate } });
            notes.push(`${esc(tName)} bleeds at ${rate} hit${rate === 1 ? "" : "s"} per round.`);
        } else {
            notes.push(denied(`${esc(tName)} bleeds at ${bleed} per round`));
        }
    }

    if (deathIn !== 0) {
        if (canApply) {
            if (deathIn < 0) {
                await targetActor.update({ "system.status.dead": true });
                notes.push(`<strong>${esc(tName)}</strong> dies.`);
            } else {
                // Ruling needed for overlapping timers: keep the sooner death.
                const cur = Number(targetActor.system?.status?.deathTimer) || 0;
                const timer = cur > 0 ? Math.min(cur, deathIn) : deathIn;
                await targetActor.update({ "system.status.deathTimer": timer });
                notes.push(`${esc(tName)} dies in ${roundsWord(timer)} without healing magic.`);
            }
        } else {
            notes.push(denied(deathIn < 0 ? `${esc(tName)} dies` : `${esc(tName)} dies in ${roundsWord(deathIn)} without healing magic`));
        }
    }

    if (pen.value < 0) {
        if (canApply) {
            const cur = targetActor.system?.status?.actionPenalty ?? { value: 0, rounds: 0 };
            // User ruling 2026-10-06 Option B: untimed penalties (rounds 0)
            // expire after 3 rounds instead of persisting indefinitely.
            const penRounds = (Number(pen.rounds) || 0) > 0 ? Number(pen.rounds) : 3;
            if (pen.value < (Number(cur.value) || 0)) {
                await targetActor.update({ "system.status.actionPenalty": { value: pen.value, rounds: penRounds } });
            }
            const effRounds = pen.value < (Number(cur.value) || 0) ? penRounds : (Number(cur.rounds) || 0);
            const effValue = pen.value < (Number(cur.value) || 0) ? pen.value : cur.value;
            notes.push(`${esc(tName)} is at ${effValue} to all actions for ${roundsWord(effRounds)}.`);
        } else {
            notes.push(denied(`${esc(tName)} is at ${pen.value} to all actions`));
        }
    }

    if (mp.rounds > 0) {
        if (canApply) {
            await targetActor.update({ "system.status.mustParry": { rounds: mp.rounds, penalty: mp.penalty } });
            notes.push(`${esc(tName)} must parry next round${mp.penalty ? ` at ${mp.penalty}` : ""}.`);
        } else {
            notes.push(denied(`${esc(tName)} must parry next round`));
        }
    }

    return notes.length ? `<p>${notes.join("<br>")}</p>` : "";
}

// Shared death cleanup — dead, everything cleared.
function deathCleanup() {
    return {
        "system.status.deathTimer": 0,
        "system.status.bleed": { perRound: 0 },
        "system.status.stun": { stunned: 0, stunNoParry: 0, downOrOut: 0 },
        "system.status.actionPenalty": { value: 0, rounds: 0 },
        "system.status.mustParry": { rounds: 0, penalty: 0 },
        "system.status.parrying": false,
        "system.status.parryDB": 0,
        "system.status.parryMaxOB": 0,
        "system.status.parryWeaponId": "",
        "system.status.parryWeaponName": "",
        "system.status.parryWeaponType": "",
        "system.status.parryTargetId": "",
        "system.status.parryTargetName": "",
        "system.status.parryFull": false,
        "system.status.missileParryDB": 0,
        "system.status.missileParryWeaponId": "",
        "system.status.missileParryWeaponName": "",
        "system.status.missileParrySource": "",
        "system.status.shieldOpponentId": "",
        "system.status.shieldOpponentName": "",
        "system.status.shieldOpponentRoundKey": "",
        "system.status.cqcTargetId": "",
        "system.status.cqcTargetName": "",
        "system.status.unconscious": false,
        "system.status.soulTimer": 0,
        "system.status.soulTimerUnknown": false,
        "system.status.dead": true
    };
}

// ------------------------------------------------------------
// Round tick (GM only, on combat round change)
// ------------------------------------------------------------

/** A maintained song entry stays refreshed while the bard's
 *  song item is still toggled active. */
function songStillActive(entry) {
    const bard = globalThis.game?.actors?.get?.(entry?.casterId);
    if (!bard) return false;
    // Playlist membership is the source of truth (2026-10-07): a song
    // in the bard's twist playlist counts as actively playing, even if
    // the song item's active flag wasn't set (e.g., playlist seeded
    // programmatically without toggleSong).
    const playlist = Array.isArray(bard.system?.status?.songPlaylist)
        ? bard.system.status.songPlaylist : [];
    if (playlist.includes(entry?.songId)) return true;
    // Fallback: check the song item's active flag.
    const items = bard?.items?.get ? [bard.items.get(entry.songId)] : [...(bard?.items?.contents ?? bard?.items ?? [])];
    const song = bard?.items?.get ? items[0] : items.find(i => (i.id ?? i._id) === entry.songId);
    return !!song?.system?.active;
}

/**
 * Bard playlist sync (2026-10-07, user ruling): songs in the twist
 * playlist should be actively playing with maintained effects. If a
 * playlist song isn't marked active (e.g., playlist was seeded without
 * toggleSong), activate it and ensure its maintained effects exist on
 * targets. Called from tickConditions before the maintained-song
 * refresh logic.
 */
async function syncBardPlaylist(bard) {
    const playlist = Array.isArray(bard?.system?.status?.songPlaylist)
        ? bard.system.status.songPlaylist : [];
    if (!playlist.length || !bard?.items) return;

    // Dynamic import to avoid circular dependency
    // (songs.js -> base-spell.js -> crit-conditions.js).
    let applySong;
    try {
        ({ applySong } = await import("../spells/songs.js"));
    } catch (e) {
        console.error("EQRMSS | Bard playlist sync: failed to import songs.js", e);
        return;
    }

    for (const songId of playlist) {
        const song = bard.items.get?.(songId);
        if (!song) continue;

        // Ensure the song item is marked active.
        if (!song.system?.active) {
            try {
                await song.update({ "system.active": true });
            } catch (e) { /* non-fatal */ }
        }

        // Check if maintained entries exist for this song on any actor.
        // Entries carry songId + source "song" (both spellEffects and dots).
        let hasEntries = false;
        const actors = globalThis.game?.actors?.contents ?? [];
        for (const a of actors) {
            const fx = a?.system?.status?.spellEffects ?? [];
            const dots = a?.system?.status?.dots ?? [];
            if (fx.some(e => e?.songId === songId && e?.source === "song") ||
                dots.some(d => d?.songId === songId && d?.source === "song")) {
                hasEntries = true;
                break;
            }
        }

        // No entries exist: apply the song to create them (auto-targets
        // by range/disposition via songAutoTargets).
        if (!hasEntries) {
            try {
                await applySong(bard, song, []);
            } catch (e) {
                console.error("EQRMSS | Bard playlist sync: applySong failed for", song?.name, e);
            }
        }
    }
}

// Cast-time pending casts (Option A) tick here on round change.
import { clearPendingCast } from "../spells/cast-timing.js";

export async function tickConditions(combat) {
    if (!combat) return;
    const notes = [];
    const list = combat.combatants?.contents ?? [...(combat.combatants ?? [])];

    // Bard playlist sync (2026-10-07): ensure playlist songs are active
    // with maintained effects BEFORE the refresh logic below runs.
    // This handles playlists seeded without toggleSong (e.g., by macro).
    for (const c of list) {
        const actor = c.actor;
        if (!actor || actor.system?.status?.dead) continue;
        const playlist = actor.system?.status?.songPlaylist;
        if (Array.isArray(playlist) && playlist.length > 0) {
            await syncBardPlaylist(actor);
        }
    }

    // Tracker -> token marker sync (2026-10-07): stun/prone/bleed show on tokens.
    try {
        const { syncTrackerStatuses } = await import("../spells/status-wiring.js");
        for (const c of list) {
            const actor = c.actor;
            if (!actor || actor.system?.status?.dead) continue;
            await syncTrackerStatuses(actor);
        }
    } catch (e) { /* ignore */ }

    // Damage shield tick (2026-10-07): decrement rounds, expire at 0.
    for (const c of list) {
        const actor = c.actor;
        if (!actor || actor.system?.status?.dead) continue;
        if (!(actor.isOwner || globalThis.game?.user?.isGM)) continue;
        const ds = actor.system?.status?.damageShield;
        if (!ds || typeof ds !== "object") continue;
        const left = (Number(ds.roundsLeft) || 0) - 1;
        if (left > 0) {
            await actor.update({ "system.status.damageShield.roundsLeft": left });
        } else {
            const dsName = String(ds.source ?? "damage shield");
            await actor.update({ "system.status.damageShield": null });
            notes.push(`<em>${esc(actor.name)}'s ${esc(dsName)} damage shield ends.</em>`);
        }
    }

    // Absorb (rune) tick (2026-10-07): decrement roundsLeft, expire at 0.
    for (const c of list) {
        const actor = c.actor;
        if (!actor || actor.system?.status?.dead) continue;
        if (!(actor.isOwner || globalThis.game?.user?.isGM)) continue;
        const ab = actor.system?.status?.absorb;
        if (!ab || typeof ab !== "object") continue;
        const left = (Number(ab.roundsLeft) || 0) - 1;
        if (left > 0) {
            await actor.update({ "system.status.absorb.roundsLeft": left });
        } else {
            const abName = String(ab.source ?? "absorb");
            await actor.update({ "system.status.absorb": null });
            notes.push(`<em>${esc(actor.name)}'s ${esc(abName)} absorb fades.</em>`);
        }
    }

    for (const c of list) {
        const actor = c.actor;
        if (!actor || actor.system?.status?.dead) continue;
        const st = actor.system?.status ?? {};
        const updates = {};

        // Death timer — at 0 the foe dies; only healing magic stabilizes
        // (detection lands with the spell subsystem).
        let dt = Number(st.deathTimer) || 0;
        if (dt > 0) {
            dt -= 1;
            if (dt <= 0) {
                Object.assign(updates, deathCleanup());
                notes.push(`<strong>${esc(actor.name)}</strong> dies.`);
                await actor.update(updates);
                continue;
            }
            updates["system.status.deathTimer"] = dt;
            notes.push(`${esc(actor.name)}: death in ${roundsWord(dt)} — stabilize with healing magic.`);
        }

        // Soul departure (§3.8) — dying countdown; dropping back under
        // the damage threshold clears it (re-checked after bleed below).
        let soul = Number(st.soulTimer) || 0;
        if (soul > 0) {
            soul -= 1;
            if (soul <= 0) {
                Object.assign(updates, deathCleanup());
                notes.push(`<strong>${esc(actor.name)}</strong> dies — soul departs.`);
                await actor.update(updates);
                continue;
            }
            updates["system.status.soulTimer"] = soul;
            notes.push(`${esc(actor.name)}: soul departs in ${roundsWord(soul)}.`);
        }

        // Pending delayed cast (Option A): tick down, fire at 0.
        // Interruption (damage/stun) is handled by the updateActor hook.
        const pending = st.pendingCast;
        if (pending && typeof pending.roundsLeft === "number") {
            const left = pending.roundsLeft - 1;
            if (left <= 0) {
                // Fire! Clear first, then resolve (re-entrant safe).
                await clearPendingCast(actor);
                notes.push(`<strong>${esc(actor.name)}</strong> completes ${esc(pending.spellName || "the spell")}!`);
                // Fire the delayed spell (imports cast-spell dynamically to avoid cycles)
                try {
                    const { fireDelayedCast } = await import("../spells/cast-spell.js");
                    await fireDelayedCast(actor, pending);
                } catch (e) {
                    console.error("EQRMSS | Delayed cast fire failed", e);
                    notes.push(`<em>Delayed cast failed: ${esc(e.message)}</em>`);
                }
            } else {
                updates["system.status.pendingCast.roundsLeft"] = left;
                notes.push(`${esc(actor.name)}: ${esc(pending.spellName || "spell")} fires in ${left} round${left === 1 ? "" : "s"}.`);
            }
        }

        // Clear the "damaged this round" flag (Option B) at round start.
        if (st.damagedThisRound) {
            updates["system.status.damagedThisRound"] = false;
        }

        // Bleed — hits until stopped (death, heal spell, first aid).
        const per = Number(st.bleed?.perRound) || 0;
        if (per > 0) {
            const cur = Number(actor.system?.hits?.value) || 0;
            updates["system.hits.value"] = cur + per;
            notes.push(`${esc(actor.name)} bleeds for ${per} (${cur + per} concussion hits).`);
        }

        // Damage over time (Stage 4 base spells; Stage 5 song
        // damage) — each DoT deals its per-round hits and counts
        // down its own duration. A maintained song DoT refreshes
        // its duration while the bard's song is still active.
        const dots = Array.isArray(st.dots) ? st.dots : [];
        if (dots.length) {
            const remainingDots = [];
            for (const d of dots) {
                const lo = Number(d.min) || 0;
                const hi = Number(d.max) || lo;
                const dmg = hi > lo ? lo + Math.floor(Math.random() * (hi - lo + 1)) : lo;
                if (dmg > 0) {
                    const cur = Number(updates["system.hits.value"] ?? actor.system?.hits?.value) || 0;
                    updates["system.hits.value"] = cur + dmg;
                    notes.push(`${esc(actor.name)} takes ${dmg} from ${esc(d.name || "a spell")} (${cur + dmg} concussion hits).`);
                }
                const maintained = d.source === "song" && d.maintained && songStillActive(d);
                const left = maintained ? (Number(d.roundsLeft) || 1) : (Number(d.roundsLeft) || 1) - 1;
                if (left > 0) remainingDots.push({ ...d, roundsLeft: left });
                else notes.push(`${esc(d.name || "A spell")} ends on ${esc(actor.name)}.`);
            }
            updates["system.status.dots"] = remainingDots;
        }

        // Timed spell effects (Stage 4 controls/debuffs without an
        // engine pool of their own) count down; untimed persist.
        // Stage 5: maintained song entries refresh while the
        // bard's song is active; song regen entries heal each
        // round the song is active.
        const spellEffects = Array.isArray(st.spellEffects) ? st.spellEffects : [];
        if (spellEffects.length) {
            const remainingFx = [];
            for (const e of spellEffects) {
                const songAlive = e.source === "song" && e.maintained && songStillActive(e);
                const regenAlive = songAlive || e.source === "spell"
                    || (typeof e.source === "string" && (e.source.startsWith("triggered:")
                        || e.source.startsWith("proc:") || e.source.startsWith("worn:")));
                if (e.kind === "regen" && Number(e.amount) > 0 && regenAlive) {
                    if (e.pool === "mana") {
                        const mCur = Number(updates["system.attributes.mana.value"] ?? actor.system?.attributes?.mana?.value) || 0;
                        const mMax = Number(actor.system?.attributes?.mana?.max) || 0;
                        const mNext = Math.min(mMax, mCur + Number(e.amount));
                        if (mNext > mCur) {
                            updates["system.attributes.mana.value"] = mNext;
                            notes.push(`${esc(actor.name)} regenerates ${mNext - mCur} mana from ${esc(e.label || e.song || "a spell")} (${mCur} → ${mNext}).`);
                        }
                    } else {
                        const cur = Number(updates["system.hits.value"] ?? actor.system?.hits?.value) || 0;
                        const healed = Math.max(0, cur - Number(e.amount));
                        updates["system.hits.value"] = healed;
                        notes.push(`${esc(actor.name)} regenerates ${Number(e.amount)} from ${esc(e.song || e.label || "a song")} (${cur} → ${healed} concussion hits).`);
                    }
                }
                if (e.roundsLeft == null) { remainingFx.push(e); continue; }
                if (songAlive) { remainingFx.push(e); continue; }
                const left = (Number(e.roundsLeft) || 0) - 1;
                if (left > 0) remainingFx.push({ ...e, roundsLeft: left });
                else {
                    notes.push(`${esc(e.label || "A spell effect")} ends on ${esc(actor.name)}.`);
                    // Remove hasted/slowed visual when the buff expires (2026-10-07).
                    const st = String(e?.scaledTarget ?? "").toLowerCase();
                    if (st === "haste" || st === "slow") {
                        try {
                            const { removeStatusEffect } = await import("../spells/status-wiring.js");
                            await removeStatusEffect(actor, st === "haste" ? "hasted" : "slowed");
                        } catch (err) { /* ignore */ }
                    }
                }
            }
            updates["system.status.spellEffects"] = remainingFx;
        }

        // Worn regen (Flowing Thought line etc.): once per round
        // while the item is worn. The payload caps at the pool max.
        try {
            const wornRes = await applyWornRoundEffects(actor);
            for (const wr of wornRes) {
                for (const r of wr.results ?? []) {
                    if (r?.type === "regen" && (r?.final ?? 0) > 0) {
                        notes.push(`${esc(actor.name)} regenerates ${r.final} mana from ${esc(wr.item)} (worn).`);
                    }
                }
            }
        } catch (err) { console.warn("EQRMSS | worn round effects failed", err); }

        // Stun pool — total decreases by one; most severe type first.
        const pool = { stunned: 0, stunNoParry: 0, ...(st.stun ?? {}) };
        // (downOrOut removed: now handled as separate prone status per 2026-10-06 ruling)
        delete pool.downOrOut;
        if (stunTotal(pool) > 0) {
            for (const k of STUN_ORDER) {
                if (k === "downOrOut") continue;
                if (pool[k] > 0) { pool[k] -= 1; break; }
            }
            updates["system.status.stun"] = pool;
            const active = activeStun(pool);
            notes.push(active
                ? `${esc(actor.name)}: ${STUN_LABEL[active.type]} (${roundsWord(active.rounds)} left).`
                : `${esc(actor.name)} recovers from stun.`);
        }

        // Prone (Option B): ticks down each round; when it clears, the
        // actor has spent the round standing up.
        const proneRounds = Number(st.prone?.rounds) || 0;
        if (proneRounds > 0) {
            const left = proneRounds - 1;
            if (left > 0) {
                updates["system.status.prone"] = { rounds: left };
            } else {
                updates["system.status.prone"] = null;
                notes.push(`${esc(actor.name)} stands up from prone.`);
            }
        }

        // Action penalty — timed penalties tick down; untimed persist.
        const ap = st.actionPenalty ?? { value: 0, rounds: 0 };
        if ((Number(ap.value) || 0) < 0 && (Number(ap.rounds) || 0) > 0) {
            const left = Number(ap.rounds) - 1;
            updates["system.status.actionPenalty"] = { value: Number(ap.value), rounds: left };
            if (left <= 0) {
                updates["system.status.actionPenalty"] = { value: 0, rounds: 0 };
                notes.push(`${esc(actor.name)} recovers from their penalty.`);
            }
        }

        // Must parry — expires after the round.
        const mpr = Number(st.mustParry?.rounds) || 0;
        if (mpr > 0) {
            updates["system.status.mustParry"] = { rounds: mpr - 1, penalty: Number(st.mustParry?.penalty) || 0 };
        }

        // Declared parry lapses at the round change; the round's attack
        // marker clears with it.
        if (st.parrying || (Number(st.parryDB) || 0) > 0 || st.parryWeaponId) {
            updates["system.status.parrying"] = false;
            updates["system.status.parryDB"] = 0;
            updates["system.status.parryMaxOB"] = 0;
            updates["system.status.parryWeaponId"] = "";
            updates["system.status.parryWeaponName"] = "";
            updates["system.status.parryWeaponType"] = "";
            updates["system.status.parryTargetId"] = "";
            updates["system.status.parryTargetName"] = "";
            updates["system.status.parryFull"] = false;
            notes.push(`${esc(actor.name)}'s parry lapses.`);
        }
        if (st.attackedThisRound) {
            updates["system.status.attackedThisRound"] = false;
        }
        // Declared missile parry (§4.3) also lapses at the round change.
        if ((Number(st.missileParryDB) || 0) > 0 || st.missileParryWeaponId) {
            updates["system.status.missileParryDB"] = 0;
            updates["system.status.missileParryWeaponId"] = "";
            updates["system.status.missileParryWeaponName"] = "";
            updates["system.status.missileParrySource"] = "";
            notes.push(`${esc(actor.name)}'s missile parry lapses.`);
        }
        // Shield assignment (§4.2) is per round.
        if (st.shieldOpponentId || st.shieldOpponentName || st.shieldOpponentRoundKey) {
            updates["system.status.shieldOpponentId"] = "";
            updates["system.status.shieldOpponentName"] = "";
            updates["system.status.shieldOpponentRoundKey"] = "";
        }

        // Exhaustion costs (ChL §7.2.3 + Arms Companion armor EF):
        // melee activity plus worn armor/helmet EF accrue per round
        // and deduct as whole points; at 0 the combatant is spent.
        if (!st.unconscious) {
            const cost = roundExhaustionCost(actor);
            if (cost > 0) {
                const frac = (Number(actor.system?.exhaustion?.fraction) || 0) + cost;
                const whole = Math.floor(frac);
                updates["system.exhaustion.fraction"] = Math.round((frac - whole) * 1000) / 1000;
                if (whole > 0) {
                    const curEx = exhaustionCurrent(actor);
                    const afterEx = Math.max(0, curEx - whole);
                    updates["system.exhaustion.value"] = afterEx;
                    if (afterEx <= 0 && !st.exhausted) {
                        updates["system.status.exhausted"] = true;
                        notes.push(`${esc(actor.name)} is exhausted and cannot continue fighting.`);
                    }
                }
            }
            // Fully rested clears the subdued-cost doubling.
            if (st.subdueDoubled && exhaustionCurrent(actor) >= exhaustionMaxFor(actor)) {
                updates["system.status.subdueDoubled"] = false;
            }
        }

        if (Object.keys(updates).length) await actor.update(updates);
        // Bleed (or anything else this tick) may have crossed a
        // concussion-hit threshold — unconsciousness / dying.
        if (!actor.system?.status?.dead) await checkHitThresholds(actor);
    }
    if (notes.length) {
        await ChatMessage.create({
            content: combatCard("Conditions", `<p><em>Condition tick — round ${combat.round}.</em></p><p>${notes.join("<br>")}</p>`)
        });
    }
}

// ------------------------------------------------------------
// Concussion-hit thresholds — unconsciousness (§6.4.1) and the
// §3.8 dying countdown.
// - Damage EXCEEDING total hits → unconscious: no further action
//   until back under the limit (condition-based, does not tick).
// - Damage EXCEEDING total hits + CO stat → dying: the soul departs
//   after the race's roundsToSoulDeparture rounds (Table 15.5.1,
//   module/data/races/base-hits.json). Dropping back under the
//   threshold clears the countdown.
// Call after anything that changes system.hits.value: damage
// application, bleed ticks, hit restoration.
// ------------------------------------------------------------

let _baseHitsCache = null;
async function baseHitsTable() {
    if (!_baseHitsCache) {
        const resp = await fetch("systems/eqrmss/module/data/races/base-hits.json");
        _baseHitsCache = await resp.json();
    }
    return _baseHitsCache;
}

// Lenient race-key match ("Dark Elf" / "dark_elf" -> "dark-elf").
// Returns roundsToSoulDeparture, or null when the race has no Table
// 15.5.1 entry — the GM adjudicates; the number is never invented.
async function soulDepartureRounds(actor) {
    try {
        const races = (await baseHitsTable())?.races ?? {};
        const norm = s => String(s ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-");
        const candidates = [
            norm(actor.system?.fixed_info?.race),
            norm(actor.system?.fixed_info?.race_name)
        ].filter(Boolean);
        for (const want of candidates) {
            for (const [key, v] of Object.entries(races)) {
                if (norm(key) === want) return Number(v.roundsToSoulDeparture);
            }
        }
    } catch (e) {
        console.warn("EQRMSS | base-hits.json unavailable", e);
    }
    return null;
}

export async function checkHitThresholds(actor) {
    if (!actor || actor.system?.status?.dead) return;
    const max = Number(actor.system?.hits?.max) || 0;
    const value = Number(actor.system?.hits?.value) || 0;
    if (max <= 0) return; // no concussion-hit track — nothing to threshold against
    const st = actor.system?.status ?? {};
    const updates = {};
    const notes = [];

    // Unconscious — §6.4.1.
    if (value > max && !st.unconscious) {
        updates["system.status.unconscious"] = true;
        notes.push(`<strong>${esc(actor.name)}</strong> is knocked unconscious (${value} damage exceeds ${max} total hits).`);
    } else if (value <= max && st.unconscious) {
        updates["system.status.unconscious"] = false;
        notes.push(`<strong>${esc(actor.name)}</strong> regains consciousness.`);
    }

    // Dying — §3.8.
    const co = Number(actor.system?.stats?.CO?.total) || 0;
    const dying = value > max + co;
    const timerActive = (Number(st.soulTimer) || 0) > 0 || !!st.soulTimerUnknown;
    if (dying && !timerActive) {
        const rounds = await soulDepartureRounds(actor);
        if (rounds == null) {
            updates["system.status.soulTimerUnknown"] = true;
            const raceLabel = actor.system?.fixed_info?.race_name || actor.system?.fixed_info?.race || "unknown";
            notes.push(`<strong>${esc(actor.name)}</strong> is dying! Race "${esc(raceLabel)}" has no Table 15.5.1 entry — GM adjudicates rounds to soul departure.`);
        } else {
            updates["system.status.soulTimer"] = rounds;
            notes.push(`<strong>${esc(actor.name)}</strong> is dying — soul departs in ${roundsWord(rounds)} unless damage is brought under ${max + co}.`);
        }
    } else if (!dying && timerActive) {
        updates["system.status.soulTimer"] = 0;
        updates["system.status.soulTimerUnknown"] = false;
        notes.push(`<strong>${esc(actor.name)}</strong> is no longer dying.`);
    }

    if (Object.keys(updates).length) await actor.update(updates);
    if (notes.length) await ChatMessage.create({ content: combatCard("Healing", `<p>${notes.join("<br>")}</p>`) });
}

// ------------------------------------------------------------
// Next-swing bonus (attacker-side, consumed by rollWeaponAttack)
// ------------------------------------------------------------

export async function consumeNextSwingBonus(actor) {
    const b = Number(actor?.system?.status?.nextSwingBonus) || 0;
    if (b > 0 && actor) await actor.update({ "system.status.nextSwingBonus": 0 });
    return b;
}

// ------------------------------------------------------------
// Parry — Arms Law §4.3 OB/DB split. A combatant may sacrifice some
// or all of the OB of the weapon in use to increase DB against melee
// attacks. The remainder stays available for an attack with that same
// weapon later in the round. Attack resolution applies the defender's
// allocated DB, the full-parry weapon-as-shield bonus, and the
// two-handed/pole-arm 50% melee-parry limits.
// ------------------------------------------------------------

async function promptParryAllocation(actor, weaponItem, maxOb) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.prompt || maxOb <= 0) return maxOb;
    try {
        // Read the allocation from the live input in the ok callback:
        // this build's prompt resolution shape for form data has proven
        // unreliable (a submitted 5 came back as 0), while the DOM value
        // at click time is authoritative. Fall back to the resolved form
        // data if the callback result is not a usable primitive.
        const result = await DialogV2.prompt({
            window: { title: "Parry: OB Allocation" },
            content: `
                <div class="form-group">
                    <label>OB to move to DB (0-${maxOb})</label>
                    <input type="number" name="allocation" value="${maxOb}" min="0" max="${maxOb}" step="1">
                </div>
                <p class="hint">${esc(actor.name)} may allocate any part of ${esc(weaponItem.name)}'s OB ${maxOb} to DB. The remainder stays available for an attack with that weapon.</p>`,
            ok: {
                label: "Declare Parry",
                callback: (event, button, dialog) => {
                    const input = dialog?.element?.querySelector?.('input[name="allocation"]')
                        ?? button?.form?.elements?.allocation
                        ?? null;
                    return input?.value ?? "";
                }
            }
        });
        if (result == null) return null; // cancelled
        if (typeof result === "number") return result;
        if (typeof result === "string") return result.trim() === "" ? null : Number(result);
        const raw = typeof result.get === "function" ? result.get("allocation") : result.allocation;
        return raw == null || raw === "" ? null : Number(raw);
    } catch (e) {
        console.warn("EQRMSS | Parry allocation prompt failed; declaration cancelled.", e);
        return null;
    }
}

export async function declareParry(actor, weaponItem, allocation = null) {
    if (!actor) {
        ui.notifications?.warn("Declare Parry: no actor.");
        return;
    }
    if (!weaponItem) {
        ui.notifications?.warn("Declare Parry: choose the parrying weapon, shield, or martial-arts item.");
        return;
    }
    // Unconscious: no action at all (§6.4.1).
    if (actor.system?.status?.unconscious) {
        ui.notifications?.warn(`${actor.name} is unconscious and cannot parry.`);
        return;
    }
    // Stun-no-parry / down-or-out: no defensive actions but base defense.
    const st = activeStun(actor.system?.status?.stun);
    if (st && st.type !== "stunned") {
        ui.notifications?.warn(`${actor.name} is ${STUN_LABEL[st.type]} and cannot parry.`);
        return;
    }
    if (actor.system?.status?.parrying) {
        ui.notifications?.warn(`${actor.name} is already parrying this round.`);
        return;
    }
    // The Melee Phase split cannot be declared retroactively after the
    // round's attack has already been made at unreduced OB.
    if (actor.system?.status?.attackedThisRound) {
        ui.notifications?.warn(`${actor.name} has already attacked this round and cannot declare a parry split.`);
        return;
    }
    // Parry split: allocate some or all of this weapon's OB to DB.
    const { ob } = computeWeaponOB(actor, weaponItem);
    const maxOb = Math.max(0, ob);
    if (maxOb <= 0) {
        ui.notifications?.warn(`${actor.name} has no positive OB with ${weaponItem.name} to allocate to parry.`);
        return;
    }
    if (allocation == null) allocation = await promptParryAllocation(actor, weaponItem, maxOb);
    if (allocation == null) return;
    const allocated = Math.max(0, Math.min(maxOb, Math.round(Number(allocation) || 0)));
    if (allocated <= 0) {
        ui.notifications?.warn(`${actor.name} must allocate at least 1 OB to parry with ${weaponItem.name}.`);
        return;
    }
    const full = allocated >= maxOb;
    const remaining = maxOb - allocated;
    // §4.3: the parry applies only against the foe the combatant
    // attacks. Designate that foe now from the current target (the
    // combatant's own attack will (re)set it when made).
    const designated = [...(game.user?.targets ?? [])][0]?.actor ?? null;
    const updates = {
        "system.status.parrying": true,
        "system.status.parryDB": allocated,
        "system.status.parryMaxOB": maxOb,
        "system.status.parryWeaponId": weaponItem.id ?? weaponItem._id ?? "",
        "system.status.parryWeaponName": weaponItem.name ?? "",
        "system.status.parryWeaponType": weaponItem.system?.type ?? "",
        "system.status.parryTargetId": designated?.id ?? "",
        "system.status.parryTargetName": designated?.name ?? "",
        "system.status.parryFull": full
    };
    const mp = actor.system?.status?.mustParry;
    if (mp && (Number(mp.rounds) || 0) > 0) {
        updates["system.status.mustParry"] = { rounds: 0, penalty: 0 };
    }
    await actor.update(updates);
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: combatCard("Parry", `<p><em>${esc(actor.name)} parries with ${esc(weaponItem.name)} — allocates ${allocated} of ${maxOb} OB to DB${full ? " (full parry)" : `; ${remaining} OB remains for attack`}${designated ? ` against ${esc(designated.name)}` : ""}.</em></p>`)
    });
    if (!designated) {
        ui.notifications?.info(`${actor.name}: no foe designated — the parry will apply against the foe ${actor.name} attacks. Target that foe before declaring to cover their earlier attacks.`);
    }
}

// ------------------------------------------------------------
// Missile parry (Arms Law §4.3, "Parrying Missile Fire"): the
// defender shifts part of a weapon's OB to DB against ONE missile
// attack. Requires a shield (a weapon won't do) or suitable
// terrain, awareness of the attack (GM adjudicates), declaration
// before the round's attack, and 50% of the round's activity. The
// OB budget is shared with melee parry and the weapon's attack.
// ------------------------------------------------------------

async function promptMissileParryAllocation(actor, weaponItem, maxOb, hasShield) {
    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    if (!DialogV2?.prompt || maxOb <= 0) {
        return { allocation: maxOb, terrain: !hasShield };
    }
    try {
        const result = await DialogV2.prompt({
            window: { title: "Missile Parry: OB Allocation" },
            content: `
                <div class="form-group">
                    <label>OB to move to DB vs one missile attack (0-${maxOb})</label>
                    <input type="number" name="allocation" value="${maxOb}" min="0" max="${maxOb}" step="1">
                </div>
                <p class="hint">${hasShield ? `${esc(actor.name)} has a shield ready.` : `${esc(actor.name)} has no shield ready — missile parry needs suitable terrain.`}</p>
                <div class="form-group">
                    <label><input type="checkbox" name="terrain"${hasShield ? "" : " checked"}> Suitable terrain (GM adjudicates)</label>
                </div>
                <p class="hint">Declared at the start of the Fire Phase; costs 50% of the round's activity and applies to the next missile attack only.</p>`,
            ok: {
                label: "Declare Missile Parry",
                callback: (event, button, dialog) => {
                    const form = dialog?.element ?? button?.form ?? null;
                    const allocInput = form?.querySelector?.('input[name="allocation"]') ?? button?.form?.elements?.allocation ?? null;
                    const terrainInput = form?.querySelector?.('input[name="terrain"]') ?? button?.form?.elements?.terrain ?? null;
                    return { allocation: allocInput?.value ?? "", terrain: !!terrainInput?.checked };
                }
            }
        });
        if (result == null) return null; // cancelled
        if (typeof result === "object" && !(typeof result.get === "function")) {
            const raw = result.allocation;
            return { allocation: raw == null || raw === "" ? null : Number(raw), terrain: !!result.terrain };
        }
        const raw = typeof result.get === "function" ? result.get("allocation") : result.allocation;
        const terrain = typeof result.get === "function" ? !!result.get("terrain") : !!result.terrain;
        return { allocation: raw == null || raw === "" ? null : Number(raw), terrain };
    } catch (e) {
        console.warn("EQRMSS | Missile parry prompt failed; declaration cancelled.", e);
        return null;
    }
}

export async function declareMissileParry(actor, weaponItem, allocation = null) {
    if (!actor) {
        ui.notifications?.warn("Declare Missile Parry: no actor.");
        return;
    }
    if (!weaponItem) {
        ui.notifications?.warn("Declare Missile Parry: choose the weapon whose OB funds the parry.");
        return;
    }
    if (actor.system?.status?.unconscious) {
        ui.notifications?.warn(`${actor.name} is unconscious and cannot parry.`);
        return;
    }
    const stunState = activeStun(actor.system?.status?.stun);
    if (stunState && stunState.type !== "stunned") {
        ui.notifications?.warn(`${actor.name} is ${STUN_LABEL[stunState.type]} and cannot parry.`);
        return;
    }
    const status = actor.system?.status ?? {};
    if ((Number(status.missileParryDB) || 0) > 0) {
        ui.notifications?.warn(`${actor.name} has already declared a missile parry this round.`);
        return;
    }
    // Declared at the start of the Fire Phase — not retroactively
    // after the round's attack has been made.
    if (status.attackedThisRound) {
        ui.notifications?.warn(`${actor.name} has already attacked this round and cannot declare a missile parry.`);
        return;
    }
    const { ob } = computeWeaponOB(actor, weaponItem);
    const maxOb = Math.max(0, ob);
    if (maxOb <= 0) {
        ui.notifications?.warn(`${actor.name} has no positive OB with ${weaponItem.name} to allocate to missile parry.`);
        return;
    }
    // Shared OB budget (§4.3): melee parry with the same weapon has
    // already claimed part of this weapon's OB.
    const weaponId = weaponItem.id ?? weaponItem._id ?? "";
    const meleeClaim = status.parrying && status.parryWeaponId === weaponId ? (Number(status.parryDB) || 0) : 0;
    const available = Math.max(0, maxOb - meleeClaim);
    if (available <= 0) {
        ui.notifications?.warn(`${actor.name} has already allocated all of ${weaponItem.name}'s OB this round.`);
        return;
    }
    const items = actor.items?.contents ?? actor.items ?? [];
    const hasShield = [...items].some(i => i?.type === "shield" && isWorn(i));
    let terrain = false;
    if (allocation == null) {
        const answer = await promptMissileParryAllocation(actor, weaponItem, available, hasShield);
        if (!answer || answer.allocation == null) return;
        allocation = answer.allocation;
        terrain = answer.terrain;
    }
    if (!hasShield && !terrain) {
        ui.notifications?.warn(`${actor.name} needs a shield or suitable terrain to parry missile fire.`);
        return;
    }
    const allocated = Math.max(0, Math.min(available, Math.round(Number(allocation) || 0)));
    if (allocated <= 0) {
        ui.notifications?.warn(`${actor.name} must allocate at least 1 OB to missile parry with ${weaponItem.name}.`);
        return;
    }
    await actor.update({
        "system.status.missileParryDB": allocated,
        "system.status.missileParryWeaponId": weaponId,
        "system.status.missileParryWeaponName": weaponItem.name ?? "",
        "system.status.missileParrySource": hasShield ? "shield" : "terrain"
    });
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: combatCard("Parry", `<p><em>${esc(actor.name)} declares missile parry (${hasShield ? "shield" : "suitable terrain"}) — +${allocated} DB against the next missile attack (50% activity).</em></p>`)
    });
}

// ------------------------------------------------------------
// Healing magic — stabilized death timer, stopped bleeding.
// TODO(healing): wire to the healing spell subsystem. Per ruling,
// ANY direct healing magic spell triggers this.
// ------------------------------------------------------------

export async function applyHealingSpell(targetActor) {
    if (!targetActor) return;
    const st = targetActor.system?.status ?? {};
    const hadBleed = (Number(st.bleed?.perRound) || 0) > 0;
    const hadTimer = (Number(st.deathTimer) || 0) > 0;
    if (!hadBleed && !hadTimer) return;
    if (!(targetActor.isOwner || game.user?.isGM)) {
        ui.notifications?.warn(`Healing not applied — you don't control ${targetActor.name}.`);
        return;
    }
    await targetActor.update({
        "system.status.bleed": { perRound: 0 },
        "system.status.deathTimer": 0
    });
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
        content: combatCard("Healing", `<p>${esc(targetActor.name)} receives healing magic — bleeding stops${hadTimer ? " and the death timer is stabilized" : ""}.</p>`)
    });
    // Hit restoration (when the spell subsystem lands) may drop the
    // actor back under a concussion-hit threshold — re-check.
    await checkHitThresholds(targetActor);
}

// ------------------------------------------------------------
// First aid — STUB.
// TODO(first-aid): compress/bandage (stops 1–3/round) and tourniquet
// (4–10/round on a limb) mechanics land with the non-combat-actions-
// per-round subsystem. Stub records intent only.
// ------------------------------------------------------------

export async function declareFirstAid(actor, targetActor) {
    if (!actor) {
        ui.notifications?.warn("First aid: no actor.");
        return;
    }
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: combatCard("First Aid", `<p><em>${esc(actor.name)} administers first aid to ${esc(targetActor?.name ?? "their patient")}. (First-aid mechanics pending — stub.)</em></p>`)
    });
}

// Arms Companion §4.7 CLOSE QUARTERS COMBAT: the closer has moved
// to within a foot of a foe, rendering long weapons useless. The
// state is a toggle on the closer (cqcTargetId/cqcTargetName);
// it persists until toggled off (it is positional, not a
// per-round declaration). Approaching uses the Closing skill —
// adjudicated by the GM, not rolled here.
export async function declareCloseQuarters(actor) {
    if (!actor) {
        ui.notifications?.warn("Close Quarters: no actor.");
        return;
    }
    const st = actor.system?.status ?? {};
    if (st.cqcTargetId) {
        const foe = st.cqcTargetName || "their foe";
        await actor.update({
            "system.status.cqcTargetId": "",
            "system.status.cqcTargetName": ""
        });
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: combatCard("Close Quarters", `<p><em>${esc(actor.name)} disengages from close quarters with ${esc(foe)}.</em></p>`)
        });
        return;
    }
    if (actor.system?.status?.unconscious) {
        ui.notifications?.warn(`${actor.name} is unconscious and cannot close.`);
        return;
    }
    const designated = [...(game.user?.targets ?? [])][0]?.actor ?? null;
    if (!designated) {
        ui.notifications?.warn(`${actor.name}: target a foe to close with first.`);
        return;
    }
    await actor.update({
        "system.status.cqcTargetId": designated.id ?? "",
        "system.status.cqcTargetName": designated.name ?? ""
    });
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: combatCard("Close Quarters", `<p><em>${esc(actor.name)} closes to within a foot of ${esc(designated.name)} — Close Quarters Combat (§4.7): +30 OB against them, +30 to Strategic Targeting, and they cannot parry ${esc(actor.name)} (long weapons penalized, half Quickness DB). ${esc(actor.name)} gives up their own Quickness DB while engaged.</em></p>`)
    });
}
