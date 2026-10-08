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
  languages: `${ORIGIN_ROOT}/languages.json`,
  continents: `${ORIGIN_ROOT}/origins/continents.json`,
  regions:   `${ORIGIN_ROOT}/origins/regions.json`,
  settlements: `${ORIGIN_ROOT}/origins/settlements.json`,
  raceAvailability: `${ORIGIN_ROOT}/race_city_availability.json`,
  factionReputations: `${ORIGIN_ROOT}/faction_reputations.json`
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

    const [cities, deities, factions, languages, continents, regions, settlements] = await Promise.all([
      loadJSON(ORIGIN_FILES.cities, "cities"),
      loadJSON(ORIGIN_FILES.deities, "deities"),
      loadJSON(ORIGIN_FILES.factions, "factions"),
      loadJSON(ORIGIN_FILES.languages, "languages"),
      loadJSON(ORIGIN_FILES.continents, "continents"),
      loadJSON(ORIGIN_FILES.regions, "regions"),
      loadJSON(ORIGIN_FILES.settlements, "settlements")
    ]);

    // race_city_availability.json is a plain { raceName: [cityNames] } map, NOT a
    // collection — load it raw. normalizeCollection would discard every entry
    // because its Case 4 object-map branch filters out array values.
    let raceAvailability = {};
    try {
      const raceResp = await fetch(ORIGIN_FILES.raceAvailability);
      if (raceResp.ok) raceAvailability = await raceResp.json();
      else console.warn(`EQRMSS | Origin data missing: ${ORIGIN_FILES.raceAvailability}`);
    } catch (e) {
      console.error("EQRMSS | Failed to load race availability", e);
    }

    // faction_reputations.json is a plain { cityName: { factionName: value } }
    // map, NOT a collection — load it raw like raceAvailability.
    let factionReputations = {};
    try {
      const repResp = await fetch(ORIGIN_FILES.factionReputations);
      if (repResp.ok) factionReputations = await repResp.json();
      else console.warn(`EQRMSS | Origin data missing: ${ORIGIN_FILES.factionReputations}`);
    } catch (e) {
      console.error("EQRMSS | Failed to load faction reputations", e);
    }

    const origin = {
      cities,
      deities,
      factions,
      languages,
      continents,
      regions,
      settlements,
      raceAvailability: (raceAvailability && typeof raceAvailability === "object" && !Array.isArray(raceAvailability))
        ? raceAvailability
        : {},
      factionReputations: (factionReputations && typeof factionReputations === "object" && !Array.isArray(factionReputations))
        ? factionReputations
        : {}
    };

    // Build lookup maps for hierarchical navigation
    origin.continentById = Object.fromEntries(continents.map(c => [c.id, c]));
    origin.regionById = Object.fromEntries(regions.map(r => [r.id, r]));
    origin.settlementById = Object.fromEntries(settlements.map(s => [s.id, s]));
    origin.cityById = Object.fromEntries(cities.map(c => [c.id ?? c.name, c]));

    // Helper: get regions for a continent
    origin.getRegionsForContinent = (continentId) => {
      return regions.filter(r => r.continent === continentId);
    };

    // Helper: get settlements for a region
    origin.getSettlementsForRegion = (regionId) => {
      return settlements.filter(s => s.parent === regionId);
    };

    // Helper: get available cities for a race
    origin.getCitiesForRace = (raceName) => {
      const allowed = origin.raceAvailability[raceName];
      if (!allowed || allowed.length === 0) return cities;
      return cities.filter(c => allowed.includes(c.name));
    };

    // Helper: get the full origin path for display
    origin.getOriginPath = (originId) => {
      const city = origin.cityById[originId];
      if (city) {
        return {
          type: "city",
          continent: city.system?.continent ?? "Unknown",
          region: city.system?.region ?? city.name,
          name: city.name,
          data: city
        };
      }
      const settlement = origin.settlementById[originId];
      if (settlement) {
        const region = origin.regionById[settlement.parent];
        const continent = region ? origin.continentById[region.continent] : null;
        return {
          type: "settlement",
          continent: continent?.name ?? "Unknown",
          region: region?.name ?? "Unknown",
          name: settlement.name,
          data: settlement
        };
      }
      return null;
    };

    console.log("EQRMSS | Origin data loaded", {
      cities: cities.length,
      deities: deities.length,
      factions: factions.length,
      languages: languages.length,
      continents: continents.length,
      regions: regions.length,
      settlements: settlements.length
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
