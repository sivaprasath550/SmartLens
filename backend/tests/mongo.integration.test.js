import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { loadConfig } from '../src/config/env.js';
import { initStore } from '../src/config/database.js';
import { createApp } from '../src/app.js';
import { createNoopRealtime } from '../src/sockets/realtime.js';
import { LocationUpdate } from '../src/models/LocationUpdate.js';
import { setLogLevel } from '../src/utils/logger.js';

setLogLevel('silent');

// Opt-in: TEST_MONGODB_URI=mongodb://127.0.0.1:27017/smartlens_test npm test
const uri = process.env.TEST_MONGODB_URI;

describe('MongoDB persistence', { skip: !uri && 'set TEST_MONGODB_URI to run MongoDB integration tests' }, () => {
  let api;
  let store;

  before(async () => {
    const config = loadConfig({ DEMO_MODE: 'false', MONGODB_URI: uri, GOOGLE_PLACES_API_KEY: 'unused', LOG_LEVEL: 'silent' });
    store = await initStore(config);
    assert.equal(store.kind, 'mongodb');
    await mongoose.connection.db.dropDatabase();
    await store.ensureIndexes();
    api = request(createApp({ config, store, realtime: createNoopRealtime() }));
  });

  after(async () => {
    await mongoose.connection.db?.dropDatabase();
    await store?.close();
  });

  it('persists sessions, location updates and history', async () => {
    const created = await api.post('/api/sessions').send({ deviceName: 'Mongo phone' }).expect(201);
    assert.equal(created.body.meta.storage, 'mongodb');
    const { sessionId, sessionToken } = created.body.data;

    for (let i = 0; i < 3; i += 1) {
      await api
        .post('/api/location')
        .set('X-Session-Token', sessionToken)
        .send({ sessionId, latitude: [12.8, 12.801, 12.802][i], longitude: 80.04, accuracy: 5, cameraActive: true })
        .expect(201);
    }

    const latest = await api.get('/api/dashboard/latest').expect(200);
    assert.equal(latest.body.data.sessionId, sessionId);
    assert.equal(latest.body.data.latitude, 12.802);
    assert.equal(latest.body.data.session.updateCount, 3);

    const history = await api.get(`/api/dashboard/history?sessionId=${sessionId}`).expect(200);
    assert.equal(history.body.data.updates.length, 3);
    assert.equal(await LocationUpdate.countDocuments({ sessionId }), 3);

    await api.post(`/api/sessions/${sessionId}/stop`).set('X-Session-Token', sessionToken).expect(200);
    const stopped = await api.get(`/api/dashboard/latest?sessionId=${sessionId}`).expect(200);
    assert.equal(stopped.body.data.session.status, 'inactive');
  });

  it('never returns the stored token hash and creates the TTL index', async () => {
    const res = await api.get('/api/dashboard/history').expect(200);
    assert.ok(!JSON.stringify(res.body).includes('tokenHash'));
    const indexes = await LocationUpdate.collection.indexes();
    const ttl = indexes.find((index) => index.name === 'receivedAt_ttl');
    assert.equal(ttl.expireAfterSeconds, 24 * 3600);
  });
});
