import { ApiError } from '../utils/ApiError.js';
import { haversineMeters, roundCoordinate } from '../utils/geo.js';

// Public servers, fastest first as measured from India (Oct 2026); override with OVERPASS_URL.
export const DEFAULT_OVERPASS_URLS = Object.freeze([
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
]);
export const OSM_ATTRIBUTION = 'Places data © OpenStreetMap contributors (ODbL)';
// The public Overpass servers ask clients to identify themselves.
const USER_AGENT = 'SmartLens/1.0 (self-hosted demo; nearby-places lookup)';

/** Overpass tag filters per app category (each one becomes a `nwr(...)` clause). */
export const OSM_CATEGORY_FILTERS = Object.freeze({
  all: [
    '[~"^(amenity|shop|tourism|leisure|historic|healthcare)$"~"."]',
    '[railway~"^(station|halt)$"]',
    '[public_transport=station]',
  ],
  food: ['[amenity~"^(restaurant|fast_food|food_court)$"]', '[shop=bakery]'],
  cafe: ['[amenity=cafe]'],
  attractions: [
    '[tourism~"^(attraction|museum|gallery|viewpoint|zoo|theme_park|artwork)$"]',
    '[leisure~"^(park|garden)$"]',
    '[historic]',
  ],
  shopping: ['[shop]', '[amenity=marketplace]'],
  transit: ['[amenity=bus_station]', '[railway~"^(station|halt|tram_stop)$"]', '[public_transport=station]', '[highway=bus_stop]'],
  health: ['[amenity~"^(hospital|clinic|doctors|dentist|pharmacy)$"]', '[healthcare]'],
  education: ['[amenity~"^(school|college|university|library|kindergarten)$"]'],
  lodging: ['[tourism~"^(hotel|hostel|guest_house|motel|apartment)$"]'],
});

// Order decides which tag names the place's category.
const CATEGORY_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'historic', 'healthcare', 'railway', 'public_transport', 'highway'];
// Named but not useful as "nearby places".
const IGNORED = new Set([
  'amenity=parking',
  'amenity=parking_space',
  'amenity=parking_entrance',
  'amenity=bicycle_parking',
  'amenity=motorcycle_parking',
  'amenity=bench',
  'amenity=waste_basket',
  'amenity=waste_disposal',
  'amenity=recycling',
  'amenity=shelter',
  'amenity=vending_machine',
  'leisure=pitch',
  'leisure=track',
  'leisure=swimming_pool',
]);
// Fetch extra candidates: Overpass output is not distance-ordered.
const CANDIDATE_LIMIT = 250;

const humanize = (value) => value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function buildOverpassQuery({ latitude, longitude, radius, category = 'all', serverTimeoutSeconds = 25 }) {
  const filters = OSM_CATEGORY_FILTERS[category] ?? OSM_CATEGORY_FILTERS.all;
  const around = `around:${radius},${latitude},${longitude}`;
  const clauses = filters.map((filter) => `nwr(${around})[name]${filter};`).join('');
  return `[out:json][timeout:${serverTimeoutSeconds}];(${clauses});out center tags ${CANDIDATE_LIMIT};`;
}

/** Converts an Overpass element into the app's normalized place shape. */
export function normalizeOsmElement(element, origin) {
  const tags = element?.tags ?? {};
  const latitude = element?.lat ?? element?.center?.lat;
  const longitude = element?.lon ?? element?.center?.lon;
  const name = tags['name:en'] ?? tags.name;
  if (!element?.id || !element?.type || !name || typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }
  const types = CATEGORY_KEYS.filter((key) => tags[key]).map((key) => `${key}=${tags[key]}`);
  if (types.length === 0 || types.some((type) => IGNORED.has(type))) return null;

  const [primaryKey, primaryValue] = types[0].split('=');
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const address = [street, tags['addr:suburb'], tags['addr:city'], tags['addr:postcode']].filter(Boolean).join(', ');

  return {
    id: `osm:${element.type}/${element.id}`,
    name,
    category: humanize(primaryValue === 'yes' ? primaryKey : primaryValue),
    types: types.slice(0, 8),
    address: address || null,
    latitude,
    longitude,
    distanceMeters: Math.round(haversineMeters(origin.latitude, origin.longitude, latitude, longitude)),
    mapsUri: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    businessStatus: null,
    source: 'osm',
    simulated: false,
  };
}

function mapOverpassError(status, retryAfterHeader) {
  if (status === 429) {
    return new ApiError(
      503,
      'PLACES_RATE_LIMITED',
      'OpenStreetMap (Overpass) is rate limiting requests; try again shortly',
      undefined,
      { retryAfterSeconds: Number(retryAfterHeader) || 30 },
    );
  }
  if (status === 504) {
    return new ApiError(504, 'PLACES_TIMEOUT', 'The OpenStreetMap (Overpass) server is overloaded; try again shortly');
  }
  return new ApiError(502, 'PLACES_UPSTREAM_ERROR', `The OpenStreetMap (Overpass) server returned an error (HTTP ${status})`);
}

/**
 * Nearby search against the free OpenStreetMap Overpass API (no API key).
 * https://wiki.openstreetmap.org/wiki/Overpass_API
 * Public servers are shared and are often slow or "at capacity". The query
 * goes to the first server; the next one is also asked when the previous one
 * fails or has not answered within `hedgeDelayMs`. The first answer wins and
 * the other requests are cancelled. `timeoutMs` bounds the whole search.
 */
export function createOsmPlacesClient({
  urls = DEFAULT_OVERPASS_URLS,
  timeoutMs = 45000,
  hedgeDelayMs = 12000,
  retryDelayMs = 4000,
  fetchImpl = globalThis.fetch,
}) {
  const timeoutError = () =>
    new ApiError(504, 'PLACES_TIMEOUT', `OpenStreetMap (Overpass) did not respond within ${Math.round(timeoutMs / 1000)} s`);

  async function queryOnce(url, query, signal) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT, Accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
        signal,
      });
      if (!response.ok) throw mapOverpassError(response.status, response.headers?.get?.('retry-after'));
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        payload = null;
      }
      const elements = Array.isArray(payload?.elements) ? payload.elements : null;
      if (!elements) {
        throw new ApiError(502, 'PLACES_UPSTREAM_ERROR', 'The OpenStreetMap (Overpass) server returned an unreadable response');
      }
      // A query that ran out of server time comes back as HTTP 200 with a remark.
      if (elements.length === 0 && /runtime error|timed out/i.test(payload.remark ?? '')) {
        throw new ApiError(504, 'PLACES_TIMEOUT', 'The OpenStreetMap (Overpass) server is overloaded; try again shortly');
      }
      return elements;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === 'AbortError') throw timeoutError();
      throw new ApiError(502, 'PLACES_UNAVAILABLE', 'Could not reach OpenStreetMap (Overpass) (network error)');
    }
  }

  function hedgedQuery(query) {
    return new Promise((resolve, reject) => {
      const controllers = [];
      let next = 0;
      let running = 0;
      let settled = false;
      let timedOut = false;
      let lastError = null;
      let hedgeTimer = null;

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer);
        clearTimeout(overallTimer);
        controllers.forEach((controller) => controller.abort());
        callback(value);
      };

      const launch = () => {
        clearTimeout(hedgeTimer);
        if (settled || timedOut || next >= urls.length) return;
        const controller = new AbortController();
        controllers.push(controller);
        running += 1;
        queryOnce(urls[next++], query, controller.signal).then(
          (elements) => finish(resolve, elements),
          (error) => {
            running -= 1;
            lastError = error;
            if (!timedOut && next < urls.length) launch();
            else if (running === 0) finish(reject, timedOut ? timeoutError() : lastError);
          },
        );
        if (next < urls.length) hedgeTimer = setTimeout(launch, hedgeDelayMs);
      };

      const overallTimer = setTimeout(() => {
        timedOut = true;
        clearTimeout(hedgeTimer);
        controllers.forEach((controller) => controller.abort());
      }, timeoutMs);

      launch();
    });
  }

  return {
    async searchNearby({ latitude, longitude, radius, category = 'all', maxResults = 20 }) {
      // ~11 m precision is plenty for a radius search and shares less with the public server.
      const query = buildOverpassQuery({
        latitude: roundCoordinate(latitude, 4),
        longitude: roundCoordinate(longitude, 4),
        radius,
        category,
        serverTimeoutSeconds: Math.max(5, Math.floor(timeoutMs / 1000) - 5),
      });

      let elements;
      try {
        elements = await hedgedQuery(query);
      } catch (error) {
        // "At capacity" answers come back within a second or two: back off once and retry.
        if (!['PLACES_RATE_LIMITED', 'PLACES_UPSTREAM_ERROR'].includes(error.code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        elements = await hedgedQuery(query);
      }
      const origin = { latitude, longitude };
      const seen = new Set();
      return elements
        .map((element) => normalizeOsmElement(element, origin))
        .filter((place) => place && place.distanceMeters <= radius && !seen.has(place.id) && seen.add(place.id))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, maxResults);
    },
  };
}
