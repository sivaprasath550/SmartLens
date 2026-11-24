import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, makeTestApp, SAMPLE } from './helpers.js';
import {
  createGooglePlacesClient,
  FIELD_MASK,
  NEARBY_SEARCH_URL,
  normalizeGooglePlace,
} from '../src/services/googlePlacesClient.js';
import { EVENTS } from '../src/sockets/realtime.js';

const LIVE_ENV = { GOOGLE_PLACES_API_KEY: 'test-key', PLACES_TIMEOUT_MS: '1000' };

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const GOOGLE_PLACE = {
  id: 'ChIJ123',
  displayName: { text: 'Real Coffee House', languageCode: 'en' },
  formattedAddress: '1 Main Road, Bengaluru',
  location: { latitude: 12.972, longitude: 77.595 },
  types: ['cafe', 'food', 'point_of_interest'],
  primaryType: 'cafe',
  primaryTypeDisplayName: { text: 'Cafe' },
  googleMapsUri: 'https://maps.google.com/?cid=1',
  businessStatus: 'OPERATIONAL',
};

describe('demo nearby places', () => {
  it('returns deterministic, explicitly simulated results', async () => {
    const { api } = makeTestApp();
    const first = await api.post('/api/places/nearby').send({ ...SAMPLE, radius: 1000 }).expect(200);
    const second = await api.post('/api/places/nearby').send({ ...SAMPLE, radius: 1000 }).expect(200);

    assert.equal(first.body.data.source, 'demo');
    assert.equal(first.body.data.simulated, true);
    assert.match(first.body.data.attribution, /Simulated/);
    assert.equal(first.body.meta.mode, 'demo');
    assert.ok(first.body.data.count >= 10);
    assert.deepEqual(first.body.data.places, second.body.data.places);
    for (const place of first.body.data.places) {
      assert.equal(place.simulated, true);
      assert.match(place.name, /\(Demo\)$/);
      assert.ok(place.distanceMeters <= 1000, 'demo places fall inside the radius');
    }
    const distances = first.body.data.places.map((p) => p.distanceMeters);
    assert.deepEqual(distances, [...distances].sort((a, b) => a - b), 'sorted by distance');
  });

  it('filters by category and supports the GET form', async () => {
    const { api } = makeTestApp();
    const res = await api.get('/api/places/nearby').query({ ...SAMPLE, radius: 500, category: 'cafe' }).expect(200);
    assert.ok(res.body.data.places.length > 0);
    assert.ok(res.body.data.places.every((p) => ['cafe', 'coffee_shop'].includes(p.types[0])));
  });

  it('validates coordinates, radius and category', async () => {
    const { api } = makeTestApp();
    await api.post('/api/places/nearby').send({ latitude: 95, longitude: 10 }).expect(400);
    await api.post('/api/places/nearby').send({ latitude: 10 }).expect(400);
    await api.post('/api/places/nearby').send({ ...SAMPLE, radius: 10 }).expect(400);
    const res = await api.post('/api/places/nearby').send({ ...SAMPLE, radius: 999999 }).expect(400);
    assert.equal(res.body.error.details[0].field, 'radius');
    await api.post('/api/places/nearby').send({ ...SAMPLE, category: 'casino' }).expect(400);
  });

  it('attaches results to a session and emits places:updated', async () => {
    const { api, realtime } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    await api
      .post('/api/places/nearby')
      .set('X-Session-Token', token)
      .send({ sessionId, ...SAMPLE })
      .expect(200);
    const event = realtime.emitted.find((e) => e.event === EVENTS.PLACES_UPDATED);
    assert.ok(event);
    assert.equal(event.payload.sessionId, sessionId);
    assert.ok(event.payload.count > 0);

    // Attaching to a session requires its token.
    await api.post('/api/places/nearby').send({ sessionId, ...SAMPLE }).expect(401);
    await api.post('/api/places/nearby').set('X-Session-Token', 'x').send({ sessionId: 'ses_missing', ...SAMPLE }).expect(404);
  });

  it('returns 503 when Google is required but no API key is configured', async () => {
    const { api } = makeTestApp({ env: { DEMO_MODE: 'false', PLACES_PROVIDER: 'google' } });
    const res = await api.post('/api/places/nearby').send(SAMPLE).expect(503);
    assert.equal(res.body.error.code, 'PLACES_NOT_CONFIGURED');
  });
});

describe('Google Places API (New) integration', () => {
  it('sends the API key and field mask and normalizes the response', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { places: [GOOGLE_PLACE, { id: 'broken' }] });
    };
    const client = createGooglePlacesClient({ apiKey: 'abc', fetchImpl });
    const places = await client.searchNearby({ ...SAMPLE, radius: 800, includedTypes: ['cafe'], maxResults: 5 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, NEARBY_SEARCH_URL);
    assert.equal(calls[0].init.headers['X-Goog-Api-Key'], 'abc');
    assert.equal(calls[0].init.headers['X-Goog-FieldMask'], FIELD_MASK);
    const sent = JSON.parse(calls[0].init.body);
    assert.deepEqual(sent.includedTypes, ['cafe']);
    assert.equal(sent.maxResultCount, 5);
    assert.equal(sent.locationRestriction.circle.radius, 800);

    assert.equal(places.length, 1, 'malformed places are dropped');
    assert.equal(places[0].name, 'Real Coffee House');
    assert.equal(places[0].category, 'Cafe');
    assert.equal(places[0].source, 'google');
    assert.equal(places[0].simulated, false);
    assert.ok(places[0].distanceMeters > 0 && places[0].distanceMeters < 200);
  });

  it('serves live results through the API and caches identical requests', async () => {
    let count = 0;
    const googleClient = createGooglePlacesClient({
      apiKey: 'k',
      fetchImpl: async () => {
        count += 1;
        return jsonResponse(200, { places: [GOOGLE_PLACE] });
      },
    });
    const { api } = makeTestApp({ env: LIVE_ENV, googleClient });
    const first = await api.post('/api/places/nearby').send(SAMPLE).expect(200);
    assert.equal(first.body.data.source, 'google');
    assert.equal(first.body.data.simulated, false);
    assert.equal(first.body.meta.mode, 'live');
    assert.equal(first.body.meta.cached, false);
    assert.match(first.body.data.attribution, /Google/);

    const second = await api.post('/api/places/nearby').send(SAMPLE).expect(200);
    assert.equal(second.body.meta.cached, true);
    assert.equal(count, 1);
  });

  it('reports upstream failures instead of fabricating results', async () => {
    const googleClient = createGooglePlacesClient({
      apiKey: 'k',
      fetchImpl: async () => jsonResponse(500, { error: { status: 'INTERNAL' } }),
    });
    const { api } = makeTestApp({ env: LIVE_ENV, googleClient });
    const res = await api.post('/api/places/nearby').send(SAMPLE).expect(502);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'PLACES_UPSTREAM_ERROR');
    assert.equal(res.body.data, undefined);
  });

  it('maps auth errors, rate limits, network errors and timeouts', async () => {
    const cases = [
      [async () => jsonResponse(403, { error: { status: 'PERMISSION_DENIED' } }), 502, 'PLACES_AUTH_ERROR'],
      [async () => jsonResponse(429, { error: { status: 'RESOURCE_EXHAUSTED' } }, { 'Retry-After': '12' }), 503, 'PLACES_RATE_LIMITED'],
      [async () => jsonResponse(400, { error: { status: 'INVALID_ARGUMENT', message: 'bad type' } }), 502, 'PLACES_BAD_REQUEST'],
      [async () => { throw new TypeError('fetch failed'); }, 502, 'PLACES_UNAVAILABLE'],
      [
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
        504,
        'PLACES_TIMEOUT',
      ],
    ];
    for (const [fetchImpl, status, code] of cases) {
      const googleClient = createGooglePlacesClient({ apiKey: 'k', timeoutMs: 50, fetchImpl });
      const { api } = makeTestApp({ env: LIVE_ENV, googleClient });
      const res = await api.post('/api/places/nearby').send(SAMPLE).expect(status);
      assert.equal(res.body.error.code, code);
      if (code === 'PLACES_RATE_LIMITED') assert.equal(res.headers['retry-after'], '12');
    }
  });

  it('normalizes missing optional fields safely', () => {
    const place = normalizeGooglePlace(
      { id: 'x', location: { latitude: 1, longitude: 1 }, types: ['tourist_attraction'] },
      { latitude: 1, longitude: 1 },
    );
    assert.equal(place.name, 'Unnamed place');
    assert.equal(place.category, 'Tourist attraction');
    assert.equal(place.address, null);
    assert.equal(place.distanceMeters, 0);
  });
});
