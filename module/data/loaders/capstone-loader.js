/**
 * ============================================================
 * EQRMSS Capstone Loader
 * ============================================================
 * Loads Era Capstone data from module/data/capstones/
 * (one JSON file per level, see module/data/capstones/index.json)
 *
 * Populates: game.eqrmss.capstones = { byId, byLevel, byClass }
 *
 * Foundry VTT V13/V14 Compatible
 * ============================================================
 */

const CAPSTONE_BASE_PATH = "systems/eqrmss/module/data/capstones";

function isValidCapstone(j) {
    if (!j || typeof j !== "object") return false;
    if (typeof j.id !== "string" || !j.id) return false;
    if (typeof j.name !== "string" || !j.name) return false;
    if (typeof j.class !== "string" || !j.class) return false;
    if (typeof j.level !== "number" || j.level < 1) return false;
    return true;
}

export async function loadCapstones() {
    const byId = {};
    const byLevel = {};
    const byClass = {};

    try {
        // Load index
        const indexResp = await fetch(`${CAPSTONE_BASE_PATH}/index.json`);
        if (!indexResp.ok) {
            console.warn("EQRMSS | Capstone Loader | index.json not found, skipping");
            return { byId, byLevel, byClass };
        }
        const index = await indexResp.json();
        const levels = index.levels || [];

        // Capstone icons (2026-10-11): capstone id -> icon path lookup.
        // Mirrors the discipline icon wiring; a missing/unreadable map is
        // non-fatal: capstones load without icons.
        let iconMap = {};
        try {
            const iconResponse = await fetch(`${CAPSTONE_BASE_PATH}/icon-map.json`);
            if (iconResponse.ok) iconMap = await iconResponse.json();
            else console.warn("EQRMSS | Capstone Loader | icon map missing", iconResponse.status);
        } catch (error) {
            console.warn("EQRMSS | Capstone Loader | icon map failed to load", error);
        }

        // Load each level file
        for (const lvl of levels) {
            try {
                const resp = await fetch(`${CAPSTONE_BASE_PATH}/${lvl}.json`);
                if (!resp.ok) continue;
                const data = await resp.json();
                const capstones = data.capstones || [];

                byLevel[lvl] = [];

                for (const c of capstones) {
                    if (!isValidCapstone(c)) {
                        console.warn(`EQRMSS | Capstone Loader | invalid capstone skipped: ${c?.id}`);
                        continue;
                    }
                    const withIcon = {
                        ...c,
                        icon: capstoneIconFor(c.id, iconMap) ?? c.icon ?? null
                    };
                    byId[c.id] = withIcon;
                    byLevel[lvl].push(withIcon);

                    if (!byClass[c.class]) byClass[c.class] = [];
                    byClass[c.class].push(withIcon);
                }
            } catch (err) {
                console.warn(`EQRMSS | Capstone Loader | failed to load level ${lvl}`, err);
            }
        }

        const total = Object.keys(byId).length;
        console.log(`EQRMSS | Capstone Loader | loaded ${total} capstones across ${levels.length} levels`);

    } catch (err) {
        console.error("EQRMSS | Capstone Loader | failed", err);
    }

    return { byId, byLevel, byClass };
}

/**
 * Resolve a capstone id to its full system icon asset path.
 * Returns null when the id has no mapped icon.
 */
export function capstoneIconFor(capstoneId, iconMap) {
    const mapped = iconMap?.[capstoneId];
    if (!mapped) return null;
    if (mapped.startsWith("systems/")) return mapped;
    if (mapped.startsWith("icons/")) return `systems/eqrmss/assets/${mapped}`;
    return `systems/eqrmss/assets/icons/capstones/${mapped}`;
}

/**
 * Get capstones available to an actor based on class and level.
 * Returns capstones where capstone.level <= actorLevel, sorted by level.
 */
export function getAvailableCapstones(actor) {
    const capstones = globalThis.game?.eqrmss?.capstones;
    if (!capstones) return [];

    const classId = actor.system?.origin?.classId?.toLowerCase();
    const actorLevel = Number(actor.system?.attributes?.level?.value) || 1;

    if (!classId) return [];

    const classCaps = capstones.byClass[classId] || [];
    return classCaps
        .filter(c => c.level <= actorLevel)
        .sort((a, b) => a.level - b.level);
}
