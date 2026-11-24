import { ApiError } from '../utils/ApiError.js';
import { haversineMeters } from '../utils/geo.js';

export const NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby';

/** Only the fields the app displays are requested (this also controls billing). */
export const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.types',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
  'places.businessStatus',
].join(',');

export const GOOGLE_ATTRIBUTION = 'Places data © Google';

const humanizeType = (type) =>
  type ? type.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Place';

/** Converts a Places API (New) place into the app's normalized place shape. */
export function normalizeGooglePlace(place, origin) {
  const latitude = place?.location?.latitude;
  const longitude = place?.location?.longitude;
  if (!place?.id || typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  return {
    id: place.id,
    name: place.displayName?.text ?? 'Unnamed place',
    category: place.primaryTypeDisplayName?.text ?? humanizeType(place.primaryType ?? place.types?.[0]),
    types: Array.isArray(place.types) ? place.types.slice(0, 8) : [],
    address: place.formattedAddress ?? null,
    latitude,
    longitude,
    distanceMeters: Math.round(haversineMeters(origin.latitude, origin.longitude, latitude, longitude)),
    mapsUri: place.googleMapsUri ?? null,
    businessStatus: place.businessStatus ?? null,
    source: 'google',
    simulated: false,
  };
}

function mapGoogleError(status, body, retryAfterHeader) {
  const googleStatus = body?.error?.status;
  const googleMessage = body?.error?.message;
  if (status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') {
    const retryAfter = Number(retryAfterHeader) || 30;
    return new ApiError(
      503,
      'PLACES_RATE_LIMITED',
      'The Places API quota or rate limit was exceeded; try again shortly',
      undefined,
      { retryAfterSeconds: retryAfter },
    );
  }
  if (status === 401 || status === 403) {
    return new ApiError(
      502,
      'PLACES_AUTH_ERROR',
      'The Places API rejected the server credentials (check the API key, billing and that Places API (New) is enabled)',
    );
  }
  if (status === 400) {
    return new ApiError(502, 'PLACES_BAD_REQUEST', `The Places API rejected the request: ${googleMessage ?? 'invalid argument'}`);
  }
  return new ApiError(502, 'PLACES_UPSTREAM_ERROR', `The Places API returned an error (HTTP ${status})`);
}

/**
 * Calls Google Places API (New) Nearby Search.
 * https://developers.google.com/maps/documentation/places/web-service/nearby-search
 */
export function createGooglePlacesClient({ apiKey, timeoutMs = 8000, fetchImpl = globalThis.fetch }) {
  return {
    async searchNearby({ latitude, longitude, radius, includedTypes = [], maxResults = 20 }) {
      const body = {
        maxResultCount: maxResults,
        rankPreference: 'DISTANCE',
        languageCode: 'en',
        locationRestriction: {
          circle: { center: { latitude, longitude }, radius },
        },
      };
      if (includedTypes.length > 0) body.includedTypes = includedTypes;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetchImpl(NEARBY_SEARCH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': FIELD_MASK,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new ApiError(504, 'PLACES_TIMEOUT', `The Places API did not respond within ${timeoutMs} ms`);
        }
        throw new ApiError(502, 'PLACES_UNAVAILABLE', 'Could not reach the Places API (network error)');
      } finally {
        clearTimeout(timer);
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        throw mapGoogleError(response.status, payload, response.headers?.get?.('retry-after'));
      }
      if (!payload || typeof payload !== 'object') {
        throw new ApiError(502, 'PLACES_UPSTREAM_ERROR', 'The Places API returned an unreadable response');
      }

      const origin = { latitude, longitude };
      return (payload.places ?? [])
        .map((place) => normalizeGooglePlace(place, origin))
        .filter(Boolean)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);
    },
  };
}
