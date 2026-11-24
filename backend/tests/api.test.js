import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, makeTestApp, postLocation, SAMPLE } from './helpers.js';
import { EVENTS } from '../src/sockets/realtime.js';

describe('GET /api/health', () => {
  it('reports status, storage and mode without secrets', async () => {
    const { api } = makeTestApp({ env: { GOOGLE_PLACES_API_KEY: 'super-secret-key' } });
    const res = await api.get('/api/health').expect(200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.status, 'ok');
    assert.equal(res.body.data.database.storage, 'memory');
    assert.equal(res.body.data.database.persistent, false);
    assert.equal(res.body.data.places.provider, 'google');
    assert.equal(res.body.meta.mode, 'live');
    assert.ok(!JSON.stringify(res.body).includes('super-secret-key'), 'API key must not be exposed');
  });

  it('reports demo mode when no Places key is configured', async () => {
    const { api } = makeTestApp();
    const res = await api.get('/api/health').expect(200);
    assert.equal(res.body.meta.mode, 'demo');
    assert.equal(res.body.data.places.simulated, true);
  });
});

describe('sessions', () => {
  it('creates a session and returns an id and write token', async () => {
    const { api, realtime } = makeTestApp();
    const { sessionId, token, body } = await createSession(api);
    assert.match(sessionId, /^ses_/);
    assert.ok(token.length >= 20);
    assert.equal(body.data.session.status, 'active');
    assert.equal(body.data.locationUpdateIntervalSeconds, 5);
    assert.equal(body.data.session.tokenHash, undefined);
    assert.equal(realtime.emitted.at(-1).event, EVENTS.SESSION_UPDATED);
  });

  it('rejects unknown fields when creating a session', async () => {
    const { api } = makeTestApp();
    const res = await api.post('/api/sessions').send({ deviceName: 'x', admin: true }).expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('stops a session and then rejects further location updates', async () => {
    const { api, realtime } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    const stop = await api.post(`/api/sessions/${sessionId}/stop`).set('X-Session-Token', token).expect(200);
    assert.equal(stop.body.data.session.status, 'inactive');
    assert.equal(stop.body.data.session.endedReason, 'user');
    assert.equal(stop.body.data.session.cameraActive, false);
    assert.equal(realtime.emitted.at(-1).payload.change, 'stopped');

    const res = await postLocation(api, token, { sessionId, ...SAMPLE, cameraActive: true }).expect(409);
    assert.equal(res.body.error.code, 'SESSION_INACTIVE');
  });

  it('is idempotent when stopping twice', async () => {
    const { api } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    await api.post(`/api/sessions/${sessionId}/stop`).set('X-Session-Token', token).expect(200);
    await api.post(`/api/sessions/${sessionId}/stop`).set('X-Session-Token', token).expect(200);
  });

  it('returns 404 when stopping an unknown session', async () => {
    const { api } = makeTestApp();
    const res = await api.post('/api/sessions/ses_doesnotexist/stop').set('X-Session-Token', 'x').expect(404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'SESSION_NOT_FOUND');
  });

  it('requires the matching session token to stop', async () => {
    const { api } = makeTestApp();
    const { sessionId } = await createSession(api);
    await api.post(`/api/sessions/${sessionId}/stop`).expect(401);
    const res = await api.post(`/api/sessions/${sessionId}/stop`).set('X-Session-Token', 'wrong').expect(403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });
});

describe('POST /api/location', () => {
  it('accepts a valid location update and emits a realtime event', async () => {
    const { api, realtime } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    const res = await postLocation(api, token, {
      sessionId,
      ...SAMPLE,
      accuracy: 12.5,
      cameraActive: true,
      timestamp: new Date().toISOString(),
    }).expect(201);

    assert.equal(res.body.success, true);
    assert.equal(res.body.data.latitude, SAMPLE.latitude);
    assert.equal(res.body.data.accuracy, 12.5);
    assert.equal(res.body.data.updateCount, 1);
    assert.ok(res.body.meta.updatedAt);

    const event = realtime.emitted.find((e) => e.event === EVENTS.LOCATION_UPDATED);
    assert.ok(event, 'location:updated must be emitted');
    assert.equal(event.sessionId, sessionId);
    assert.equal(event.payload.latitude, SAMPLE.latitude);
    assert.equal(event.payload.cameraActive, true);
    assert.equal(event.payload.status, 'active');
    assert.ok(event.payload.updatedAt);
  });

  it('accepts epoch-millisecond timestamps and demo-sourced coordinates', async () => {
    const { api } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    const res = await postLocation(api, token, {
      sessionId,
      ...SAMPLE,
      cameraActive: false,
      timestamp: Date.now(),
      source: 'demo',
    }).expect(201);
    assert.equal(res.body.data.source, 'demo');
    assert.equal(res.body.data.cameraActive, false);
  });

  for (const [label, coords] of [
    ['latitude above 90', { latitude: 91, longitude: 10 }],
    ['latitude below -90', { latitude: -90.5, longitude: 10 }],
    ['longitude above 180', { latitude: 10, longitude: 180.01 }],
    ['non-numeric latitude', { latitude: '12.9', longitude: 10 }],
  ]) {
    it(`rejects invalid coordinates (${label})`, async () => {
      const { api } = makeTestApp();
      const { sessionId, token } = await createSession(api);
      const res = await postLocation(api, token, { sessionId, ...coords, cameraActive: true }).expect(400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(Array.isArray(res.body.error.details));
    });
  }

  it('rejects requests with missing required fields and lists them', async () => {
    const { api } = makeTestApp();
    const res = await postLocation(api, null, { latitude: 10 }).expect(400);
    const fields = res.body.error.details.map((d) => d.field).sort();
    assert.deepEqual(fields, ['cameraActive', 'longitude', 'sessionId']);
  });

  it('rejects a far-future client timestamp', async () => {
    const { api } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    const res = await postLocation(api, token, {
      sessionId,
      ...SAMPLE,
      cameraActive: true,
      timestamp: new Date(Date.now() + 86400000).toISOString(),
    }).expect(400);
    assert.equal(res.body.error.details[0].field, 'timestamp');
  });

  it('returns 404 for an unknown session', async () => {
    const { api } = makeTestApp();
    const res = await postLocation(api, 'token', { sessionId: 'ses_unknown123', ...SAMPLE, cameraActive: true }).expect(
      404,
    );
    assert.equal(res.body.error.code, 'SESSION_NOT_FOUND');
  });

  it('rejects updates without a valid session token', async () => {
    const { api } = makeTestApp();
    const { sessionId } = await createSession(api);
    await postLocation(api, null, { sessionId, ...SAMPLE, cameraActive: true }).expect(401);
    await postLocation(api, 'not-the-token', { sessionId, ...SAMPLE, cameraActive: true }).expect(403);
  });

  it('resumes a session that only timed out', async () => {
    let clock = Date.now();
    const { api, app } = makeTestApp({ now: () => new Date(clock) });
    const { sessionId, token } = await createSession(api);
    await postLocation(api, token, { sessionId, ...SAMPLE, cameraActive: true }).expect(201);

    clock += 10 * 60 * 1000;
    const expired = await app.locals.ctx.sessionService.expireStaleSessions();
    assert.equal(expired, 1);
    const latest = await api.get('/api/dashboard/latest').expect(200);
    assert.equal(latest.body.data.session.status, 'inactive');
    assert.equal(latest.body.data.session.endedReason, 'timeout');

    const res = await postLocation(api, token, { sessionId, ...SAMPLE, cameraActive: true }).expect(201);
    assert.equal(res.body.data.status, 'active');
  });
});

describe('dashboard endpoints', () => {
  it('returns an explicit empty state when there is no data', async () => {
    const { api } = makeTestApp();
    const res = await api.get('/api/dashboard/latest').expect(200);
    assert.equal(res.body.data.sessionId, null);
    assert.equal(res.body.data.latitude, null);
    assert.deepEqual(res.body.data.nearbyPlaces, []);
    assert.equal(res.body.meta.empty, true);
  });

  it('returns the latest location, session and nearby places', async () => {
    const { api } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    await postLocation(api, token, { sessionId, latitude: 12.8, longitude: 80.0, cameraActive: true }).expect(201);
    await postLocation(api, token, { sessionId, latitude: 12.81, longitude: 80.01, accuracy: 7, cameraActive: true }).expect(
      201,
    );
    await api
      .post('/api/places/nearby')
      .set('X-Session-Token', token)
      .send({ sessionId, latitude: 12.81, longitude: 80.01, radius: 1000 })
      .expect(200);

    const res = await api.get('/api/dashboard/latest').expect(200);
    const data = res.body.data;
    assert.equal(data.sessionId, sessionId);
    assert.equal(data.latitude, 12.81);
    assert.equal(data.longitude, 80.01);
    assert.equal(data.accuracy, 7);
    assert.equal(data.cameraActive, true);
    assert.equal(data.status, 'active');
    assert.equal(data.session.updateCount, 2);
    assert.ok(data.nearbyPlaces.length > 0);
    assert.equal(data.places.simulated, true);
    assert.equal(data.places.source, 'demo');
    assert.equal(res.body.meta.mode, 'demo');
    assert.ok(res.body.meta.updatedAt);
  });

  it('prefers an active session over a more recently stopped one', async () => {
    const { api } = makeTestApp();
    const a = await createSession(api, { deviceName: 'A' });
    const b = await createSession(api, { deviceName: 'B' });
    await postLocation(api, a.token, { sessionId: a.sessionId, ...SAMPLE, cameraActive: true }).expect(201);
    await api.post(`/api/sessions/${b.sessionId}/stop`).set('X-Session-Token', b.token).expect(200);
    const res = await api.get('/api/dashboard/latest').expect(200);
    assert.equal(res.body.data.sessionId, a.sessionId);
  });

  it('returns 404 for latest data of an unknown session', async () => {
    const { api } = makeTestApp();
    await api.get('/api/dashboard/latest?sessionId=ses_nope').expect(404);
  });

  it('returns bounded session history and per-session updates', async () => {
    const { api } = makeTestApp();
    const { sessionId, token } = await createSession(api);
    for (let i = 0; i < 5; i += 1) {
      await postLocation(api, token, { sessionId, latitude: 10 + i / 1000, longitude: 20, cameraActive: true }).expect(201);
    }
    await createSession(api);

    const sessions = await api.get('/api/dashboard/history?limit=1').expect(200);
    assert.equal(sessions.body.data.sessions.length, 1);

    const updates = await api.get(`/api/dashboard/history?sessionId=${sessionId}&limit=3`).expect(200);
    assert.equal(updates.body.data.updates.length, 3);
    assert.equal(updates.body.data.updates[0].latitude, 10.004, 'newest first');

    await api.get('/api/dashboard/history?limit=1000').expect(400);
  });

  it('enforces DASHBOARD_ACCESS_KEY when configured', async () => {
    const { api } = makeTestApp({ env: { DASHBOARD_ACCESS_KEY: 'letmein' } });
    await api.get('/api/dashboard/latest').expect(401);
    await api.get('/api/dashboard/latest').set('X-Dashboard-Key', 'nope').expect(403);
    await api.get('/api/dashboard/latest').set('X-Dashboard-Key', 'letmein').expect(200);
  });
});

describe('request handling', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const { api } = makeTestApp();
    const res = await api.get('/api/nope').expect(404);
    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  });

  it('rejects malformed JSON', async () => {
    const { api } = makeTestApp();
    const res = await api.post('/api/location').set('Content-Type', 'application/json').send('{"bad json').expect(400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });

  it('rejects oversized request bodies', async () => {
    const { api } = makeTestApp();
    const res = await api
      .post('/api/sessions')
      .send({ deviceName: 'x'.repeat(40 * 1024) })
      .expect(413);
    assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('allows configured CORS origins and rejects others', async () => {
    const { api } = makeTestApp({ env: { CORS_ORIGINS: 'http://dash.local:5173' } });
    const ok = await api.get('/api/health').set('Origin', 'http://dash.local:5173').expect(200);
    assert.equal(ok.headers['access-control-allow-origin'], 'http://dash.local:5173');
    await api.get('/api/health').set('Origin', 'http://evil.example').expect(403);
  });
});

describe('demo simulator', () => {
  it('runs a clearly simulated session and can be stopped', async () => {
    const { api, realtime } = makeTestApp();
    const start = await api.post('/api/demo/simulation').expect(201);
    assert.equal(start.body.data.simulated, true);
    assert.equal(start.body.data.session.simulated, true);
    assert.equal(start.body.data.session.locationSource, 'demo');

    await api.post('/api/demo/simulation').expect(409);

    const latest = await api.get('/api/dashboard/latest').expect(200);
    assert.equal(latest.body.data.sessionId, start.body.data.sessionId);
    assert.ok(latest.body.data.latitude !== null);
    assert.ok(latest.body.data.nearbyPlaces.every((p) => p.simulated === true));
    assert.ok(realtime.emitted.some((e) => e.event === EVENTS.PLACES_UPDATED));

    const stop = await api.delete('/api/demo/simulation').expect(200);
    assert.equal(stop.body.data.session.status, 'inactive');
    await api.delete('/api/demo/simulation').expect(404);
  });

  it('is unavailable when demo mode is off', async () => {
    const { api } = makeTestApp({ env: { DEMO_MODE: 'false', GOOGLE_PLACES_API_KEY: 'k' } });
    await api.post('/api/demo/simulation').expect(403);
  });
});
