import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/services/store/memoryStore.js';
import { createNoopRealtime } from '../src/sockets/realtime.js';
import { setLogLevel } from '../src/utils/logger.js';

setLogLevel('silent');

/** Builds an isolated app (fresh memory store, fresh limiters) for one test. */
export function makeTestApp({ env = {}, googleClient, osmClient, now } = {}) {
  // Tests never reach the real OpenStreetMap servers: without a key the default is demo places.
  const defaults = { DEMO_MODE: 'true', LOG_LEVEL: 'silent', PLACES_PROVIDER: env.GOOGLE_PLACES_API_KEY ? 'auto' : 'demo' };
  const config = loadConfig({ ...defaults, ...env });
  const store = createMemoryStore({ locationRetentionHours: config.locationRetentionHours });
  const realtime = createNoopRealtime();
  const app = createApp({ config, store, realtime, googleClient, osmClient, now });
  return { app, config, store, realtime, api: request(app) };
}

export async function createSession(api, body = { deviceName: 'Test phone' }) {
  const res = await api.post('/api/sessions').send(body).expect(201);
  return { sessionId: res.body.data.sessionId, token: res.body.data.sessionToken, body: res.body };
}

export function postLocation(api, token, body) {
  const req = api.post('/api/location');
  if (token) req.set('X-Session-Token', token);
  return req.send(body);
}

export const SAMPLE = { latitude: 12.9716, longitude: 77.5946 };
