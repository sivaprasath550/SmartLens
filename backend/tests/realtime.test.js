import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connectClient } from 'socket.io-client';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { createMemoryStore } from '../src/services/store/memoryStore.js';
import { createRealtime, EVENTS } from '../src/sockets/realtime.js';
import { setLogLevel } from '../src/utils/logger.js';

setLogLevel('silent');

const servers = [];

async function startServer(env = {}) {
  const config = loadConfig({ DEMO_MODE: 'true', LOG_LEVEL: 'silent', PLACES_PROVIDER: 'demo', ...env });
  const httpServer = http.createServer();
  const realtime = createRealtime(httpServer, config);
  const app = createApp({ config, store: createMemoryStore(), realtime });
  httpServer.on('request', app);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;
  const entry = { httpServer, realtime, url };
  servers.push(entry);
  return entry;
}

after(async () => {
  for (const { httpServer, realtime } of servers) {
    await realtime.close();
    httpServer.close();
  }
});

function once(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function post(url, path, body, headers = {}) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('Socket.IO realtime events', () => {
  it('pushes location:updated and places:updated to dashboard clients', async () => {
    const { url } = await startServer();
    const socket = connectClient(url, { transports: ['websocket'], reconnection: false });
    await once(socket, 'connect');

    const created = await post(url, '/api/sessions', { deviceName: 'Socket test' });
    assert.equal(created.status, 201);
    const { sessionId, sessionToken } = created.body.data;
    const headers = { 'X-Session-Token': sessionToken };

    const locationEvent = once(socket, EVENTS.LOCATION_UPDATED);
    const loc = await post(url, '/api/location', { sessionId, latitude: 12.9, longitude: 77.6, cameraActive: true }, headers);
    assert.equal(loc.status, 201);
    const payload = await locationEvent;
    assert.equal(payload.sessionId, sessionId);
    assert.equal(payload.latitude, 12.9);
    assert.equal(payload.cameraActive, true);
    assert.ok(payload.updatedAt);

    const placesEvent = once(socket, EVENTS.PLACES_UPDATED);
    await post(url, '/api/places/nearby', { sessionId, latitude: 12.9, longitude: 77.6 }, headers);
    const places = await placesEvent;
    assert.equal(places.sessionId, sessionId);
    assert.ok(places.count > 0);
    assert.equal(places.simulated, true);

    const sessionEvent = once(socket, EVENTS.SESSION_UPDATED);
    await post(url, `/api/sessions/${sessionId}/stop`, {}, headers);
    const stopped = await sessionEvent;
    assert.equal(stopped.change, 'stopped');
    assert.equal(stopped.session.status, 'inactive');

    socket.close();
  });

  it('rejects socket connections without the dashboard key when one is configured', async () => {
    const { url } = await startServer({ DASHBOARD_ACCESS_KEY: 'secret-key' });

    const denied = connectClient(url, { transports: ['websocket'], reconnection: false });
    const error = await once(denied, 'connect_error');
    assert.equal(error.message, 'UNAUTHORIZED');
    denied.close();

    const allowed = connectClient(url, {
      transports: ['websocket'],
      reconnection: false,
      auth: { dashboardKey: 'secret-key' },
    });
    await once(allowed, 'connect');
    allowed.close();
  });
});
