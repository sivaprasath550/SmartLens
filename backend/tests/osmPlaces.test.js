import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, makeTestApp, SAMPLE } from './helpers.js';
import { loadConfig } from '../src/config/env.js';
import { resolvePlacesProvider } from '../src/services/placesService.js';
import {
  buildOverpassQuery,
  createOsmPlacesClient,
  normalizeOsmElement,
  OSM_ATTRIBUTION,
} from '../src/services/osmPlacesClient.js';

const OSM_ENV = { PLACES_PROVIDER: 'osm', OSM_TIMEOUT_MS: '5000' };

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const CAFE = { type: 'node', id: 11, lat: 12.9721, lon: 77.5951, tags: { name: 'Corner Cafe', amenity: 'cafe', 'addr:street': 'MG Road', 'addr:city': 'Bengaluru' } };
const MUSEUM = { type: 'way', id: 22, center: { lat: 12.975, lon: 77.598 }, tags: { name: 'City Museum', tourism: 'museum' } };
const PARKING = { type: 'node', id: 33, lat: 12.9717, lon: 77.5947, tags: { name: 'Lot A', amenity: 'parking' } };
const UNNAMED = { type: 'node', id: 44, lat: 12.9717, lon: 77.5947, tags: { amenity: 'cafe' } };
const FAR = { type: 'node', id: 55, lat: 13.2, lon: 77.9, tags: { name: 'Far Away', shop: 'supermarket' } };

describe('provider selection', () => {
  it('uses OpenStreetMap when no Google key is set, Google when it is', () => {
    assert.equal(resolvePlacesProvider(loadConfig({})), 'osm');
    assert.equal(resolvePlacesProvider(loadConfig({ GOOGLE_PLACES_API_KEY: 'k' })), 'google');
    assert.equal(resolvePlacesProvider(loadConfig({ PLACES_PROVIDER: 'demo', GOOGLE_PLACES_API_KEY: 'k' })), 'demo');
    assert.equal(resolvePlacesProvider(loadConfig({ PLACES_PROVIDER: 'google' })), 'none');
    assert.throws(() => loadConfig({ PLACES_PROVIDER: 'bing' }), /PLACES_PROVIDER/);
  });
});

describe('OpenStreetMap (Overpass) client', () => {
  it('builds a named, category-filtered radius query', () => {
    const query = buildOverpassQuery({ latitude: 12.97, longitude: 77.59, radius: 800, category: 'cafe' });
    assert.match(query, /^\[out:json\]\[timeout:\d+\];/);
    assert.match(query, /nwr\(around:800,12\.97,77\.59\)\[name\]\[amenity=cafe\];/);
    assert.match(query, /out center tags \d+;$/);
  });

  it('normalizes nodes and ways, skipping unnamed and parking-type features', () => {
    const origin = SAMPLE;
    const cafe = normalizeOsmElement(CAFE, origin);
    assert.equal(cafe.id, 'osm:node/11');
    assert.equal(cafe.category, 'Cafe');
    assert.equal(cafe.address, 'MG Road, Bengaluru');
    assert.equal(cafe.mapsUri, 'https://www.openstreetmap.org/node/11');
    assert.equal(cafe.source, 'osm');
    assert.equal(cafe.simulated, false);
    assert.equal(normalizeOsmElement(MUSEUM, origin).latitude, 12.975);
    assert.equal(normalizeOsmElement(PARKING, origin), null);
    assert.equal(normalizeOsmElement(UNNAMED, origin), null);
  });

  it('posts the query with a User-Agent and returns the nearest places inside the radius', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { elements: [MUSEUM, FAR, CAFE, PARKING, CAFE] });
    };
    const client = createOsmPlacesClient({ urls: ['https://overpass.test/api'], fetchImpl });
    const places = await client.searchNearby({ ...SAMPLE, radius: 1000, category: 'all', maxResults: 5 });
    assert.equal(calls[0].url, 'https://overpass.test/api');
    assert.ok(calls[0].init.headers['User-Agent'].startsWith('SmartLens/'));
    assert.match(decodeURIComponent(calls[0].init.body), /^data=\[out:json\]/);
    assert.deepEqual(places.map((p) => p.name), ['Corner Cafe', 'City Museum']);
  });

  it('asks the next server at once when one fails', async () => {
    const urls = [];
    const client = createOsmPlacesClient({
      urls: ['https://a.test', 'https://b.test'],
      hedgeDelayMs: 10000,
      fetchImpl: async (url) => {
        urls.push(url);
        return url === 'https://a.test' ? jsonResponse(502, {}) : jsonResponse(200, { elements: [CAFE] });
      },
    });
    const places = await client.searchNearby({ ...SAMPLE, radius: 500 });
    assert.deepEqual(urls, ['https://a.test', 'https://b.test']);
    assert.equal(places.length, 1);
  });

  it('also asks the next server when the first is slow, and cancels the slow one', async () => {
    const aborted = [];
    const client = createOsmPlacesClient({
      urls: ['https://slow.test', 'https://fast.test'],
      hedgeDelayMs: 20,
      fetchImpl: (url, init) => {
        init.signal.addEventListener('abort', () => aborted.push(url));
        if (url === 'https://fast.test') return Promise.resolve(jsonResponse(200, { elements: [MUSEUM] }));
        return new Promise(() => {});
      },
    });
    const places = await client.searchNearby({ ...SAMPLE, radius: 1000 });
    assert.deepEqual(places.map((p) => p.name), ['City Museum']);
    assert.ok(aborted.includes('https://slow.test'));
  });

  it('gives up with PLACES_TIMEOUT when no server answers in time', async () => {
    const client = createOsmPlacesClient({
      urls: ['https://a.test', 'https://b.test'],
      timeoutMs: 60,
      hedgeDelayMs: 10,
      fetchImpl: (url, init) =>
        new Promise((_, reject) =>
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))),
        ),
    });
    await assert.rejects(client.searchNearby({ ...SAMPLE, radius: 500 }), (error) => error.code === 'PLACES_TIMEOUT');
  });

  it('retries once when every server is at capacity, then reports the error', async () => {
    let calls = 0;
    const flaky = createOsmPlacesClient({
      urls: ['https://a.test', 'https://b.test'],
      retryDelayMs: 5,
      fetchImpl: async () => (++calls <= 2 ? jsonResponse(502, {}) : jsonResponse(200, { elements: [CAFE] })),
    });
    assert.equal((await flaky.searchNearby({ ...SAMPLE, radius: 500 })).length, 1);
    assert.equal(calls, 3);

    calls = 0;
    const down = createOsmPlacesClient({
      urls: ['https://a.test', 'https://b.test'],
      retryDelayMs: 5,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(429, {});
      },
    });
    await assert.rejects(down.searchNearby({ ...SAMPLE, radius: 500 }), (error) => error.code === 'PLACES_RATE_LIMITED');
    assert.equal(calls, 4);
  });

  it('reports an overloaded server that returns an empty runtime-error result', async () => {
    const client = createOsmPlacesClient({
      fetchImpl: async () => jsonResponse(200, { elements: [], remark: 'runtime error: Query timed out in "query" at line 1' }),
    });
    await assert.rejects(client.searchNearby({ ...SAMPLE, radius: 500 }), (error) => error.code === 'PLACES_TIMEOUT');
  });
});

describe('nearby places from OpenStreetMap through the API', () => {
  it('returns real, attributed places, caches them and shares concurrent identical searches', async () => {
    let calls = 0;
    const osmClient = {
      async searchNearby() {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [normalizeOsmElement(CAFE, SAMPLE)];
      },
    };
    const { api } = makeTestApp({ env: OSM_ENV, osmClient });
    const { sessionId, token } = await createSession(api);
    const body = { sessionId, ...SAMPLE, radius: 800, category: 'cafe' };
    const [a, b] = await Promise.all([
      api.post('/api/places/nearby').set('X-Session-Token', token).send(body).expect(200),
      api.post('/api/places/nearby').set('X-Session-Token', token).send(body).expect(200),
    ]);
    assert.equal(calls, 1, 'concurrent identical searches share one upstream request');
    assert.equal(a.body.data.source, 'osm');
    assert.equal(a.body.data.simulated, false);
    assert.equal(a.body.data.attribution, OSM_ATTRIBUTION);
    assert.equal(a.body.meta.mode, 'live');
    assert.equal(b.body.data.places[0].name, 'Corner Cafe');

    const again = await api.post('/api/places/nearby').set('X-Session-Token', token).send(body).expect(200);
    assert.equal(again.body.meta.cached, true);
    assert.equal(calls, 1);

    const health = await api.get('/api/health').expect(200);
    assert.deepEqual(health.body.data.places, { provider: 'osm', configured: true, simulated: false });
  });

  it('passes upstream errors through instead of inventing places', async () => {
    const osmClient = {
      async searchNearby() {
        const { ApiError } = await import('../src/utils/ApiError.js');
        throw new ApiError(503, 'PLACES_RATE_LIMITED', 'slow down');
      },
    };
    const { api } = makeTestApp({ env: OSM_ENV, osmClient });
    const res = await api.post('/api/places/nearby').send(SAMPLE).expect(503);
    assert.equal(res.body.error.code, 'PLACES_RATE_LIMITED');
  });
});
