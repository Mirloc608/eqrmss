// systems/eqrmss/module/data/loaders/origin-loader.js
// ============================================================
// EQRMSS Origin Data Loader (V14, canonical, normalized)
// ============================================================

/**
 * Origin data lives in:
 * systems/eqrmss/module/data/origin/
 *
 * Files:
 *   cities.json
 *   deities.json
 *   factions.json
 *   languages.json
 *
 * This loader:
 *   - fetches each file
 *   - normalizes entries
 *   - guarantees consistent IDs and names
 *   - returns a canonical origin object
 */

const ORIGIN_ROOT = "systems/eqrmss/module/data/origin";

const ORIGIN_FILES = {
  cities:    `${ORIGIN_ROOT}/cities.json`,
  deities:   `${ORIGIN_ROOT}/deities.json`,
  factions:  `${ORIGIN_ROOT}/factions.json`,
  languages: `${ORIGIN_ROOT}/languages.json`
};

// ------------------------------------------------------------
// NORMALIZATION HELPERS
// ------------------------------------------------------------

function normalizeEntry(entry, fallbackKey = null) {
  const out = { ...entry };

  out.id =
    out.id ??
    out._id ??
    out.key ??
    fallbackKey ??
    null;

  out.name =
    out.name ??
    out.label ??
    out.title ??
    out.id ??
    "Unnamed";

  if (out.id !== null) out.id = String(out.id);
  out.name = String(out.name);

  return out;
}

function normalizeCollection(data, collectionName) {
  // Case 1: array of objects
  if (Array.isArray(data)) {
    return data
      .filter(e => e && typeof e === "object")
      .map((e, i) => normalizeEntry(e, `${collectionName}-${i}`));
  }

  // Case 2: { cities: [...] }
  if (data && typeof data === "object" && Array.isArray(data[collectionName])) {
    return data[collectionName]
      .filter(e => e && typeof e === "object")
      .map((e, i) => normalizeEntry(e, `${collectionName}-${i}`));
  }

  // Case 3: { entries: [...] }
  if (data && typeof data === "object" && Array.isArray(data.entries)) {
    return data.entries
      .filter(e => e && typeof e === "object")
      .map((e, i) => normalizeEntry(e, `${collectionName}-${i}`));
  }

  // Case 4: object map
  if (data && typeof data === "object") {
    const values = Object.entries(data)
      .filter(([_, v]) => v && typeof v === "object" && !Array.isArray(v))
      .map(([key, value]) => normalizeEntry(value, key));

    if (values.length) return values;
  }

  // Fallback
  return [];
}

// ------------------------------------------------------------
// JSON LOADER
// ------------------------------------------------------------

async function loadJSON(path, collectionName) {
  try {
    const response = await fetch(path);

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`EQRMSS | Origin data missing: ${path}`);
        return [];
      }
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const raw = await response.json();
    const normalized = normalizeCollection(raw, collectionName);

    console.log(`EQRMSS | Loaded origin ${collectionName}: ${normalized.length}`);
    return normalized;

  } catch (error) {
    console.error(`EQRMSS | Failed to load origin data: ${path}`, error);
    return [];
  }
}

// ------------------------------------------------------------
// ORIGIN DATA LOADER
// ------------------------------------------------------------

export class OriginDataLoader {

  static async load() {
    console.log("EQRMSS | OriginDataLoader.load()");

    const [cities, deities, factions, languages] = await Promise.all([
      loadJSON(ORIGIN_FILES.cities, "cities"),
      loadJSON(ORIGIN_FILES.deities, "deities"),
      loadJSON(ORIGIN_FILES.factions, "factions"),
      loadJSON(ORIGIN_FILES.languages, "languages")
    ]);

    const origin = {
      cities,
      deities,
      factions,
      languages
    };

    console.log("EQRMSS | Origin data loaded", {
      cities: cities.length,
      deities: deities.length,
      factions: factions.length,
      languages: languages.length
    });

    return origin;
  }
}

/**
 * Named export required by subsystem loaders
 * Wraps OriginDataLoader.load() for compatibility
 */
export async function loadOriginData() {
  return await OriginDataLoader.load();
}


export default OriginDataLoader;
