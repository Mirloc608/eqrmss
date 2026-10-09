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
                    byId[c.id] = c;
                    byLevel[lvl].push(c);

                    if (!byClass[c.class]) byClass[c.class] = [];
                    byClass[c.class].push(c);
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
