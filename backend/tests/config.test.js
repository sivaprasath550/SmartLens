import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeConfig, loadConfig } from '../src/config/env.js';
import { redactMongoUri } from '../src/config/database.js';
import { haversineMeters, offsetCoordinate } from '../src/utils/geo.js';
import { createTtlCache } from '../src/services/ttlCache.js';

describe('configuration', () => {
  it('applies defaults', () => {
    const config = loadConfig({});
    assert.equal(config.port, 3000);
    assert.equal(config.demoMode, true);
    assert.equal(config.locationUpdateIntervalSeconds, 5);
    assert.ok(config.corsOrigins.includes('http://localhost:5173'));
  });

  it('rejects malformed values', () => {
    assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT/);
    assert.throws(() => loadConfig({ DEMO_MODE: 'maybe' }), /DEMO_MODE/);
    assert.throws(() => loadConfig({ LOCATION_UPDATE_INTERVAL_SECONDS: '0' }), /LOCATION_UPDATE_INTERVAL_SECONDS/);
  });

  it('parses CORS origins and never describes secrets', () => {
    const config = loadConfig({
      CORS_ORIGINS: 'http://a.local:5173/, http://b.local',
      GOOGLE_PLACES_API_KEY: 'shh',
      DASHBOARD_ACCESS_KEY: 'also-secret',
    });
    assert.deepEqual(config.corsOrigins, ['http://a.local:5173', 'http://b.local']);
    const summary = JSON.stringify(describeConfig(config));
    assert.ok(!summary.includes('shh'));
    assert.ok(!summary.includes('also-secret'));
  });

  it('redacts credentials from MongoDB URIs', () => {
    assert.equal(redactMongoUri('mongodb+srv://user:pass@cluster/db'), 'mongodb+srv://***@cluster/db');
    assert.equal(redactMongoUri('mongodb://127.0.0.1:27017/smartlens'), 'mongodb://127.0.0.1:27017/smartlens');
  });
});

describe('utilities', () => {
  it('computes distances and offsets consistently', () => {
    const moved = offsetCoordinate(12.9716, 77.5946, 500, 45);
    const distance = haversineMeters(12.9716, 77.5946, moved.latitude, moved.longitude);
    assert.ok(Math.abs(distance - 500) < 1, `expected ~500 m, got ${distance}`);
  });

  it('expires TTL cache entries', () => {
    let clock = 0;
    const cache = createTtlCache({ ttlMs: 100, maxEntries: 2, now: () => clock });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    assert.equal(cache.get('a'), undefined, 'oldest entry evicted');
    assert.equal(cache.get('c'), 3);
    clock = 200;
    assert.equal(cache.get('c'), undefined);
  });
});
