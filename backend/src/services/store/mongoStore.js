import mongoose from 'mongoose';
import { Session } from '../../models/Session.js';
import { LocationUpdate } from '../../models/LocationUpdate.js';
import { PlaceSnapshot } from '../../models/PlaceSnapshot.js';
import { toPublicLocation, toPublicSession, toPublicSnapshot } from './shape.js';

const READY_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

/** Persistent storage backed by MongoDB through Mongoose. */
export function createMongoStore({ locationRetentionHours = 24 } = {}) {
  return {
    kind: 'mongodb',
    persistent: true,

    status() {
      return READY_STATES[mongoose.connection.readyState] ?? 'unknown';
    },

    async ensureIndexes() {
      await Session.syncIndexes();
      await PlaceSnapshot.syncIndexes();
      await LocationUpdate.syncIndexes();
      // TTL index for location history; recreated if the retention period changed.
      const ttlSeconds = locationRetentionHours * 3600;
      const collection = LocationUpdate.collection;
      const indexes = await collection.indexes();
      const existing = indexes.find((index) => index.name === 'receivedAt_ttl');
      if (existing && existing.expireAfterSeconds !== ttlSeconds) {
        await collection.dropIndex('receivedAt_ttl');
      }
      if (!existing || existing.expireAfterSeconds !== ttlSeconds) {
        await collection.createIndex(
          { receivedAt: 1 },
          { name: 'receivedAt_ttl', expireAfterSeconds: ttlSeconds },
        );
      }
    },

    async createSession(input) {
      const now = input.now ?? new Date();
      const doc = await Session.create({
        sessionId: input.sessionId,
        tokenHash: input.tokenHash,
        status: 'active',
        cameraActive: input.cameraActive ?? true,
        deviceName: input.deviceName || 'Android device',
        platform: input.platform ?? 'android',
        appVersion: input.appVersion ?? null,
        locationSource: input.locationSource ?? 'gps',
        simulated: Boolean(input.simulated),
        lastSeenAt: now,
      });
      return toPublicSession(doc.toObject());
    },

    async getSession(sessionId) {
      return toPublicSession(await Session.findOne({ sessionId }).lean());
    },

    async getSessionTokenHash(sessionId) {
      const doc = await Session.findOne({ sessionId }).select('+tokenHash').lean();
      return doc?.tokenHash ?? null;
    },

    async recordLocation(sessionId, location) {
      const session = await Session.findOneAndUpdate(
        { sessionId },
        {
          $set: {
            lastLocation: {
              latitude: location.latitude,
              longitude: location.longitude,
              accuracy: location.accuracy,
              source: location.source,
              clientTimestamp: location.clientTimestamp,
              receivedAt: location.receivedAt,
            },
            cameraActive: location.cameraActive,
            lastSeenAt: location.receivedAt,
            status: 'active',
            endedReason: null,
            endedAt: null,
          },
          $inc: { updateCount: 1 },
        },
        { new: true, lean: true },
      );
      if (!session) return null;
      const entry = await LocationUpdate.create({ sessionId, ...location });
      return { session: toPublicSession(session), location: toPublicLocation(entry.toObject()) };
    },

    async stopSession(sessionId, { reason, now }) {
      const session = await Session.findOneAndUpdate(
        { sessionId },
        { $set: { status: 'inactive', endedReason: reason, cameraActive: false, endedAt: now } },
        { new: true, lean: true },
      );
      return toPublicSession(session);
    },

    async findLatestSession() {
      const active = await Session.findOne({ status: 'active' }).sort({ lastSeenAt: -1 }).lean();
      if (active) return toPublicSession(active);
      return toPublicSession(await Session.findOne({}).sort({ lastSeenAt: -1 }).lean());
    },

    async listSessions(limit) {
      const docs = await Session.find({}).sort({ lastSeenAt: -1 }).limit(limit).lean();
      return docs.map(toPublicSession);
    },

    async listLocations(sessionId, limit) {
      const docs = await LocationUpdate.find({ sessionId }).sort({ receivedAt: -1 }).limit(limit).lean();
      return docs.map(toPublicLocation);
    },

    async saveSnapshot(snapshot) {
      const doc = await PlaceSnapshot.findOneAndUpdate(
        { sessionId: snapshot.sessionId },
        { $set: snapshot },
        { upsert: true, new: true, lean: true },
      );
      return toPublicSnapshot(doc);
    },

    async getSnapshot(sessionId, now = new Date()) {
      const doc = await PlaceSnapshot.findOne({ sessionId, expiresAt: { $gt: now } }).lean();
      return toPublicSnapshot(doc);
    },

    async findStaleActiveSessions(cutoff) {
      const docs = await Session.find({ status: 'active', lastSeenAt: { $lt: cutoff } })
        .select('sessionId')
        .lean();
      return docs.map((doc) => doc.sessionId);
    },

    async close() {
      await mongoose.disconnect();
    },
  };
}
