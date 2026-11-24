import { toPublicLocation, toPublicSession, toPublicSnapshot } from './shape.js';

const MAX_SESSIONS = 200;
const MAX_UPDATES_PER_SESSION = 500;

/**
 * Temporary, process-local storage used in demo mode when MongoDB is not
 * reachable. Everything is lost when the server restarts. All methods are
 * async so this store is interchangeable with the MongoDB store.
 */
export function createMemoryStore({ locationRetentionHours = 24 } = {}) {
  const sessions = new Map();
  const updates = new Map();
  const snapshots = new Map();
  const retentionMs = locationRetentionHours * 3600 * 1000;

  const clone = (value) => structuredClone(value);

  function pruneSessions() {
    if (sessions.size <= MAX_SESSIONS) return;
    const ordered = [...sessions.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt);
    for (const session of ordered) {
      if (sessions.size <= MAX_SESSIONS) break;
      if (session.status === 'active') continue;
      sessions.delete(session.sessionId);
      updates.delete(session.sessionId);
      snapshots.delete(session.sessionId);
    }
  }

  function pruneUpdates(list, now) {
    const cutoff = now.getTime() - retentionMs;
    while (list.length > 0 && list[0].receivedAt.getTime() < cutoff) list.shift();
    while (list.length > MAX_UPDATES_PER_SESSION) list.shift();
  }

  return {
    kind: 'memory',
    persistent: false,

    status() {
      return 'memory';
    },

    async ensureIndexes() {},

    async createSession(input) {
      const now = input.now ?? new Date();
      const session = {
        sessionId: input.sessionId,
        tokenHash: input.tokenHash,
        status: 'active',
        endedReason: null,
        cameraActive: input.cameraActive ?? true,
        deviceName: input.deviceName || 'Android device',
        platform: input.platform ?? 'android',
        appVersion: input.appVersion ?? null,
        locationSource: input.locationSource ?? 'gps',
        simulated: Boolean(input.simulated),
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        endedAt: null,
        updateCount: 0,
        lastLocation: null,
      };
      sessions.set(session.sessionId, session);
      updates.set(session.sessionId, []);
      pruneSessions();
      return toPublicSession(session);
    },

    async getSession(sessionId) {
      return toPublicSession(sessions.get(sessionId));
    },

    async getSessionTokenHash(sessionId) {
      return sessions.get(sessionId)?.tokenHash ?? null;
    },

    async recordLocation(sessionId, location) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      const entry = { sessionId, ...location };
      const list = updates.get(sessionId) ?? [];
      list.push(entry);
      pruneUpdates(list, location.receivedAt);
      updates.set(sessionId, list);

      session.lastLocation = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        source: location.source,
        clientTimestamp: location.clientTimestamp,
        receivedAt: location.receivedAt,
      };
      session.cameraActive = location.cameraActive;
      session.lastSeenAt = location.receivedAt;
      session.updatedAt = location.receivedAt;
      session.updateCount += 1;
      if (session.status !== 'active') {
        session.status = 'active';
        session.endedReason = null;
        session.endedAt = null;
      }
      return { session: toPublicSession(session), location: toPublicLocation(clone(entry)) };
    },

    async stopSession(sessionId, { reason, now }) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      session.status = 'inactive';
      session.endedReason = reason;
      session.cameraActive = false;
      session.endedAt = now;
      session.updatedAt = now;
      return toPublicSession(session);
    },

    async findLatestSession() {
      let best = null;
      for (const session of sessions.values()) {
        if (!best) best = session;
        else if (session.status === 'active' && best.status !== 'active') best = session;
        else if (session.status === best.status && session.lastSeenAt > best.lastSeenAt) best = session;
      }
      return toPublicSession(best);
    },

    async listSessions(limit) {
      return [...sessions.values()]
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
        .slice(0, limit)
        .map(toPublicSession);
    },

    async listLocations(sessionId, limit) {
      const list = updates.get(sessionId) ?? [];
      return list.slice(-limit).reverse().map((entry) => toPublicLocation(clone(entry)));
    },

    async saveSnapshot(snapshot) {
      snapshots.set(snapshot.sessionId, clone(snapshot));
      return toPublicSnapshot(snapshot);
    },

    async getSnapshot(sessionId, now = new Date()) {
      const snapshot = snapshots.get(sessionId);
      if (!snapshot) return null;
      if (snapshot.expiresAt <= now) {
        snapshots.delete(sessionId);
        return null;
      }
      return toPublicSnapshot(clone(snapshot));
    },

    async findStaleActiveSessions(cutoff) {
      return [...sessions.values()]
        .filter((session) => session.status === 'active' && session.lastSeenAt < cutoff)
        .map((session) => session.sessionId);
    },

    async close() {},
  };
}
