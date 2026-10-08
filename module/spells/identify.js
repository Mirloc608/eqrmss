/**
 * Identify (2026-10-08): EQ Identify. Reveals magical information about
 * the item the target is holding — its true name, bonuses, effects, and
 * requirements.
 *
 * Sets `system.identified = true` on the item (foundation for a future
 * unidentified-item system; currently all items default to identified).
 */

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

/**
 * Find the item the target is "holding": prefer an equipped weapon,
 * then any equipped item with magical effects/bonuses, then any
 * equipped item at all.
 */
export function findHeldItem(target) {
    const items = Array.from(target?.items ?? []);
    if (!items.length) return null;
    const equipped = items.filter(i => i?.system?.equipped);
    if (!equipped.length) return null;
    // Prefer equipped weapons (the "held" item).
    const weapon = equipped.find(i => {
        const t = String(i?.type ?? "").toLowerCase();
        return t.includes("weapon");
    });
    if (weapon) return weapon;
    // Then equipped items with magical effects or bonuses.
    const magical = equipped.find(i => {
        const fx = i?.system?.effects;
        const bo = i?.system?.bonuses;
        return (Array.isArray(fx) && fx.length > 0)
            || (bo && (Object.keys(bo.stats ?? {}).length > 0
                || Object.keys(bo.resistances ?? {}).length > 0
                || Object.keys(bo.skills ?? {}).length > 0));
    });
    if (magical) return magical;
    return equipped[0];
}

/** Build an HTML summary of an item's magical properties. */
function itemInfoHtml(item) {
    const sys = item?.system ?? {};
    const parts = [];
    parts.push(`<strong>${esc(item?.name ?? "Unknown item")}</strong>`);
    const cat = sys.category ?? sys.item?.category;
    if (cat) parts.push(`<br>Type: ${esc(cat)}`);
    const rarity = sys.item?.rarity;
    if (rarity && rarity !== "common") parts.push(`<br>Rarity: ${esc(rarity)}`);

    const bonuses = sys.bonuses ?? {};
    const statEntries = Object.entries(bonuses.stats ?? {}).filter(([, v]) => Number(v) !== 0);
    const resEntries = Object.entries(bonuses.resistances ?? {}).filter(([, v]) => Number(v) !== 0);
    const skillEntries = Object.entries(bonuses.skills ?? {}).filter(([, v]) => Number(v) !== 0);
    if (statEntries.length) {
        parts.push(`<br>Stats: ${statEntries.map(([k, v]) => `${esc(k)} ${v > 0 ? "+" : ""}${v}`).join(", ")}`);
    }
    if (resEntries.length) {
        parts.push(`<br>Resists: ${resEntries.map(([k, v]) => `${esc(k)} ${v > 0 ? "+" : ""}${v}`).join(", ")}`);
    }
    if (skillEntries.length) {
        parts.push(`<br>Skills: ${skillEntries.map(([k, v]) => `${esc(k)} ${v > 0 ? "+" : ""}${v}`).join(", ")}`);
    }

    const skillMods = sys.skillModifiers ?? {};
    const modEntries = Object.entries(skillMods).filter(([, v]) => Number(v) !== 0);
    if (modEntries.length) {
        parts.push(`<br>Skill mods: ${modEntries.map(([k, v]) => `${esc(k)} ${v > 0 ? "+" : ""}${v}`).join(", ")}`);
    }

    const effects = Array.isArray(sys.effects) ? sys.effects : [];
    if (effects.length) {
        const fxLines = effects.map(fx => {
            const label = fx?.label ?? fx?.name ?? fx?.type ?? "effect";
            const detail = fx?.note ?? fx?.description ?? "";
            return `&bull; ${esc(label)}${detail ? ` — ${esc(detail)}` : ""}`;
        });
        parts.push(`<br>Effects:<br>${fxLines.join("<br>")}`);
    }

    const req = sys.requirements ?? {};
    const reqBits = [];
    if (Number(req.level) > 0) reqBits.push(`level ${req.level}`);
    for (const k of ["race", "class", "profession"]) {
        const v = req[k];
        if (Array.isArray(v) && v.length) reqBits.push(`${k}: ${v.map(esc).join(", ")}`);
    }
    if (reqBits.length) parts.push(`<br>Requires: ${reqBits.join("; ")}`);

    if (parts.length <= 1) parts.push("<br><em>No magical properties.</em>");
    return parts.join("");
}

/**
 * Identify the item the target is holding. Returns HTML for the chat card.
 */
export async function applyIdentify(caster, target, { sourceName = "Identify" } = {}) {
    const casterName = caster?.name ?? "Someone";
    const targetName = target?.name ?? "Target";
    if (!target) {
        return `<p><em>${esc(casterName)} tries to identify, but there is no target.</em></p>`;
    }
    const item = findHeldItem(target);
    if (!item) {
        return `<p><em>${esc(targetName)} is not holding anything to identify.</em></p>`;
    }
    // Mark identified (foundation for a future unidentified-item system).
    try {
        if (typeof item.update === "function") {
            await item.update({ "system.identified": true });
        } else if (item.system) {
            item.system.identified = true;
        }
    } catch { /* non-fatal */ }
    return `<p><strong>${esc(casterName)}</strong> identifies what ${esc(targetName)} is holding (${esc(sourceName)}):<br>${itemInfoHtml(item)}</p>`;
}
