import { ApiError } from '../utils/ApiError.js';
import { hashToken, newSessionId, newSessionToken, safeEqual } from '../utils/ids.js';
import { logger } from '../utils/logger.js';
import { EVENTS } from '../sockets/realtime.js';
import { createLiveFrameStore, isJpeg } from './liveFrameStore.js';

const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

/**
 * Session lifecycle, location recording and nearby-place snapshots. Every
 * successful state change is pushed to dashboards through `realtime`.
 */
export function createSessionService({
  store,
  realtime,
  config,
  liveFrames = createLiveFrameStore(),
  now = () => new Date(),
}) {
  async function requireSession(sessionId) {
    const session = await store.getSession(sessionId);
    if (!session) throw ApiError.notFound('SESSION_NOT_FOUND', `Session "${sessionId}" does not exist`);
    return session;
  }

  /** Checks the per-session write token; `trusted` is used by the in-process demo simulator. */
  async function authorize(sessionId, token, { trusted = false } = {}) {
    const session = await requireSession(sessionId);
    if (trusted) return session;
    if (!token) throw ApiError.unauthorized('Missing X-Session-Token header');
    const expected = await store.getSessionTokenHash(sessionId);
    if (!expected || !safeEqual(hashToken(token), expected)) {
      throw ApiError.forbidden('Session token does not match this session');
    }
    return session;
  }

  function sessionEvent(session, change) {
    realtime.emit(EVENTS.SESSION_UPDATED, session.sessionId, {
      change,
      session,
      serverTime: now().toISOString(),
    });
  }

  return {
    async createSession(input, { simulated = false } = {}) {
      const sessionId = newSessionId();
      const sessionToken = newSessionToken();
      const session = await store.createSession({
        ...input,
        sessionId,
        tokenHash: hashToken(sessionToken),
        simulated,
        now: now(),
      });
      logger.info(`session created ${sessionId} (${session.locationSource}${simulated ? ', simulated' : ''})`);
      sessionEvent(session, 'created');
      return { session, sessionToken };
    },

    authorize,
    requireSession,

    async recordLocation(body, token, options = {}) {
      const existing = await authorize(body.sessionId, token, options);
      // A session the user explicitly stopped stays stopped; one that only
      // timed out (e.g. phone briefly offline) resumes on its next update.
      if (existing.status === 'inactive' && existing.endedReason !== 'timeout') {
        throw ApiError.conflict('SESSION_INACTIVE', 'This session has ended; start a new session');
      }
      const receivedAt = now();
      const result = await store.recordLocation(body.sessionId, {
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy ?? null,
        cameraActive: body.cameraActive,
        source: body.source ?? 'gps',
        clientTimestamp: body.timestamp ?? null,
        receivedAt,
      });
      if (!result) throw ApiError.notFound('SESSION_NOT_FOUND', `Session "${body.sessionId}" does not exist`);

      if (existing.status === 'inactive') sessionEvent(result.session, 'resumed');
      realtime.emit(EVENTS.LOCATION_UPDATED, body.sessionId, {
        sessionId: body.sessionId,
        latitude: result.location.latitude,
        longitude: result.location.longitude,
        accuracy: result.location.accuracy,
        source: result.location.source,
        cameraActive: result.location.cameraActive,
        status: result.session.status,
        simulated: result.session.simulated || result.location.source === 'demo',
        clientTimestamp: result.location.clientTimestamp,
        updatedAt: result.location.receivedAt,
        updateCount: result.session.updateCount,
      });
      return result;
    },

    async stopSession(sessionId, token, { reason = 'user', trusted = false } = {}) {
      const existing = await authorize(sessionId, token, { trusted });
      if (existing.status === 'inactive' && existing.endedReason === reason) return existing;
      const session = await store.stopSession(sessionId, { reason, now: now() });
      liveFrames.delete(sessionId);
      logger.info(`session ${sessionId} stopped (${reason})`);
      sessionEvent(session, 'stopped');
      return session;
    },

    /** Stores the latest nearby-place result for a session and notifies dashboards. */
    async attachPlaces(sessionId, result) {
      const fetchedAt = new Date(result.fetchedAt);
      const snapshot = await store.saveSnapshot({
        sessionId,
        center: result.center,
        radius: result.radius,
        category: result.category,
        source: result.source,
        simulated: result.simulated,
        attribution: result.attribution,
        places: result.places,
        fetchedAt,
        expiresAt: new Date(fetchedAt.getTime() + SNAPSHOT_TTL_MS),
      });
      realtime.emit(EVENTS.PLACES_UPDATED, sessionId, {
        sessionId,
        ...snapshot,
        count: snapshot.places.length,
        updatedAt: now().toISOString(),
      });
      return snapshot;
    },

    /**
     * Opt-in live view: relays one JPEG preview frame to dashboards and keeps
     * it in memory as the session's latest frame. Nothing is persisted.
     */
    async publishFrame(sessionId, token, image, { seq = null, rotation = 0 } = {}) {
      const existing = await authorize(sessionId, token);
      if (existing.status === 'inactive' && existing.endedReason !== 'timeout') {
        throw ApiError.conflict('SESSION_INACTIVE', 'This session has ended; start a new session');
      }
      if (!isJpeg(image)) {
        throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Frame body must be a JPEG image (Content-Type: image/jpeg)');
      }
      // The phone uploads several frames in parallel; never let an older one replace a newer one.
      const previous = liveFrames.get(sessionId);
      if (seq !== null && previous?.seq !== null && previous?.seq !== undefined && seq <= previous.seq) {
        return { ...previous, dropped: true };
      }
      const frame = { image, mimeType: 'image/jpeg', bytes: image.length, rotation, receivedAt: now().toISOString(), seq };
      liveFrames.set(sessionId, frame);
      realtime.emit(EVENTS.CAMERA_FRAME, sessionId, { sessionId, ...frame }, { volatile: true });
      return frame;
    },

    latestFrame(sessionId) {
      return liveFrames.get(sessionId);
    },

    /** Marks active sessions that stopped reporting as inactive ("timeout"). */
    async expireStaleSessions() {
      const cutoff = new Date(now().getTime() - config.sessionTimeoutSeconds * 1000);
      const staleIds = await store.findStaleActiveSessions(cutoff);
      for (const sessionId of staleIds) {
        const session = await store.stopSession(sessionId, { reason: 'timeout', now: now() });
        liveFrames.delete(sessionId);
        if (session) {
          logger.info(`session ${sessionId} timed out after ${config.sessionTimeoutSeconds}s without updates`);
          sessionEvent(session, 'timeout');
        }
      }
      return staleIds.length;
    },
  };
}
