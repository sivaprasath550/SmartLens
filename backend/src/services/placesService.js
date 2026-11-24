import { ApiError } from '../utils/ApiError.js';
import { roundCoordinate } from '../utils/geo.js';
import { PLACE_CATEGORIES } from '../utils/validators.js';
import { createTtlCache } from './ttlCache.js';
import { DEMO_ATTRIBUTION, getDemoPlaces } from './demoPlaces.js';
import { createGooglePlacesClient, GOOGLE_ATTRIBUTION } from './googlePlacesClient.js';
import { createOsmPlacesClient, OSM_ATTRIBUTION } from './osmPlacesClient.js';

/**
 * Resolves PLACES_PROVIDER:
 *   - auto (default) -> Google Places API (New) when GOOGLE_PLACES_API_KEY is
 *                       set, otherwise free OpenStreetMap data (no key)
 *   - google         -> Google; 503 PLACES_NOT_CONFIGURED without a key
 *   - osm            -> OpenStreetMap via the Overpass API
 *   - demo           -> deterministic, clearly simulated places
 *   - none           -> nearby search disabled (503)
 */
export function resolvePlacesProvider(config) {
  switch (config.placesProvider) {
    case 'google':
      return config.googlePlacesApiKey ? 'google' : 'none';
    case 'osm':
    case 'demo':
    case 'none':
      return config.placesProvider;
    default:
      return config.googlePlacesApiKey ? 'google' : 'osm';
  }
}

const ATTRIBUTION = { google: GOOGLE_ATTRIBUTION, osm: OSM_ATTRIBUTION };

/**
 * Nearby-place search. A failing real provider is reported as an error; it is
 * never replaced with simulated data.
 */
export function createPlacesService({ config, googleClient, osmClient, now = () => Date.now() }) {
  const provider = resolvePlacesProvider(config);
  let client = null;
  if (provider === 'google') {
    client = googleClient ?? createGooglePlacesClient({ apiKey: config.googlePlacesApiKey, timeoutMs: config.placesTimeoutMs });
  } else if (provider === 'osm') {
    client = osmClient ?? createOsmPlacesClient({ urls: config.overpassUrls, timeoutMs: config.osmTimeoutMs });
  }
  // Short-lived cache: avoids repeat billed (Google) or slow, shared (OSM) calls while a phone stands still.
  const cache = createTtlCache({ ttlMs: config.placesCacheTtlSeconds * 1000, now });
  // Identical searches already on their way share one upstream request.
  const inFlight = new Map();

  return {
    provider,

    async findNearby({ latitude, longitude, radius, category = 'all', maxResults = 20 }) {
      const fetchedAt = new Date(now()).toISOString();
      const base = { center: { latitude, longitude }, radius, category };

      if (provider === 'demo') {
        return {
          ...base,
          places: getDemoPlaces({ latitude, longitude, radius, category, maxResults }),
          source: 'demo',
          simulated: true,
          attribution: DEMO_ATTRIBUTION,
          cached: false,
          fetchedAt,
        };
      }

      if (provider === 'none') {
        throw ApiError.serviceUnavailable(
          'PLACES_NOT_CONFIGURED',
          'Nearby-place search is not configured: set GOOGLE_PLACES_API_KEY or PLACES_PROVIDER=osm|demo',
        );
      }

      // ~11 m grid so tiny GPS jitter reuses the cached response.
      const key = [roundCoordinate(latitude, 4), roundCoordinate(longitude, 4), radius, category, maxResults].join('|');
      const hit = cache.get(key);
      if (hit) return { ...base, ...hit, cached: true };

      let pending = inFlight.get(key);
      if (!pending) {
        pending = client
          .searchNearby({
            latitude,
            longitude,
            radius,
            category,
            includedTypes: PLACE_CATEGORIES[category] ?? [],
            maxResults,
          })
          .then((places) => {
            const result = { places, source: provider, simulated: false, attribution: ATTRIBUTION[provider], fetchedAt };
            cache.set(key, result);
            return result;
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
      }
      const result = await pending;
      return { ...base, ...result, cached: false };
    },
  };
}
