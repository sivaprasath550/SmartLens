import { Server } from 'socket.io';
import { safeEqual } from '../utils/ids.js';
import { logger } from '../utils/logger.js';

export const EVENTS = Object.freeze({
  LOCATION_UPDATED: 'location:updated',
  PLACES_UPDATED: 'places:updated',
  SESSION_UPDATED: 'session:updated',
  CAMERA_FRAME: 'camera:frame',
});

const DASHBOARD_ROOM = 'dashboard';
const sessionRoom = (sessionId) => `session:${sessionId}`;

/** Realtime facade used when no Socket.IO server is attached (e.g. in tests). */
export function createNoopRealtime() {
  const emitted = [];
  return {
    emitted,
    emit(event, sessionId, payload) {
      emitted.push({ event, sessionId, payload });
    },
    clientCount: () => 0,
    close: async () => {},
  };
}

/**
 * Attaches Socket.IO to the HTTP server.
 *
 * Location data is never broadcast to every connected socket. Events go to:
 *   - the "dashboard" room, which a socket joins only after passing the
 *     optional DASHBOARD_ACCESS_KEY check during the handshake, and
 *   - a per-session room ("session:<id>") for clients following one session.
 */
export function createRealtime(httpServer, config) {
  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, methods: ['GET', 'POST'] },
    serveClient: false,
    pingInterval: 20000,
    pingTimeout: 20000,
    maxHttpBufferSize: 16 * 1024, // limits what clients may send; frames only flow server -> dashboard
  });

  io.use((socket, next) => {
    const expected = config.dashboardAccessKey;
    if (!expected) return next();
    const provided = socket.handshake.auth?.dashboardKey;
    if (typeof provided === 'string' && safeEqual(provided, expected)) return next();
    const error = new Error('UNAUTHORIZED');
    error.data = { code: 'UNAUTHORIZED', message: 'Dashboard access key required' };
    return next(error);
  });

  io.on('connection', (socket) => {
    socket.join(DASHBOARD_ROOM);
    logger.debug(`socket connected (${io.engine.clientsCount} clients)`);

    socket.on('session:subscribe', (sessionId, ack) => {
      if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
        if (typeof ack === 'function') ack({ ok: false, error: 'invalid sessionId' });
        return;
      }
      socket.join(sessionRoom(sessionId));
      if (typeof ack === 'function') ack({ ok: true });
    });

    socket.on('session:unsubscribe', (sessionId) => {
      if (typeof sessionId === 'string') socket.leave(sessionRoom(sessionId));
    });

    socket.on('disconnect', () => logger.debug('socket disconnected'));
  });

  return {
    io,
    /** `volatile` events (live-view frames) are dropped for clients that cannot keep up. */
    emit(event, sessionId, payload, { volatile = false } = {}) {
      const target = volatile ? io.volatile : io;
      target.to([DASHBOARD_ROOM, sessionRoom(sessionId)]).emit(event, payload);
    },
    clientCount: () => io.engine.clientsCount,
    close: () => new Promise((resolve) => io.close(() => resolve())),
  };
}
