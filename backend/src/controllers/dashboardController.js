import { ApiError } from '../utils/ApiError.js';
import { sendSuccess } from '../utils/response.js';
import { haversineMeters } from '../utils/geo.js';

const DEFAULT_SESSION_LIMIT = 10;
const DEFAULT_UPDATE_LIMIT = 50;

/** Recomputes place distances from the device's latest position (it may have moved since the search). */
function withCurrentDistances(places, location) {
  if (!location) return places;
  return places.map((place) => ({
    ...place,
    distanceMeters: Math.round(haversineMeters(location.latitude, location.longitude, place.latitude, place.longitude)),
  }));
}

export async function getLatest(req, res) {
  const { store } = req.app.locals.ctx;
  const { sessionId } = req.valid.query;
  const session = sessionId ? await store.getSession(sessionId) : await store.findLatestSession();
  if (sessionId && !session) {
    throw ApiError.notFound('SESSION_NOT_FOUND', `Session "${sessionId}" does not exist`);
  }

  if (!session) {
    return sendSuccess(
      req,
      res,
      {
        sessionId: null,
        latitude: null,
        longitude: null,
        cameraActive: false,
        nearbyPlaces: [],
        session: null,
        location: null,
        places: null,
      },
      { meta: { updatedAt: null, empty: true } },
    );
  }

  const location = session.lastLocation;
  const snapshot = await store.getSnapshot(session.sessionId);
  const nearbyPlaces = snapshot ? withCurrentDistances(snapshot.places, location) : [];
  const updatedAt = [location?.receivedAt, snapshot?.fetchedAt, session.endedAt, session.lastSeenAt]
    .filter(Boolean)
    .sort()
    .at(-1);

  return sendSuccess(
    req,
    res,
    {
      sessionId: session.sessionId,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      accuracy: location?.accuracy ?? null,
      cameraActive: session.cameraActive,
      status: session.status,
      nearbyPlaces,
      session,
      location,
      places: snapshot
        ? {
            source: snapshot.source,
            simulated: snapshot.simulated,
            attribution: snapshot.attribution,
            radius: snapshot.radius,
            category: snapshot.category,
            center: snapshot.center,
            fetchedAt: snapshot.fetchedAt,
            count: nearbyPlaces.length,
          }
        : null,
    },
    { meta: { updatedAt, empty: false } },
  );
}

export async function getHistory(req, res) {
  const { store } = req.app.locals.ctx;
  const { sessionId, limit } = req.valid.query;

  if (sessionId) {
    const session = await store.getSession(sessionId);
    if (!session) throw ApiError.notFound('SESSION_NOT_FOUND', `Session "${sessionId}" does not exist`);
    const updates = await store.listLocations(sessionId, limit ?? DEFAULT_UPDATE_LIMIT);
    return sendSuccess(req, res, { sessionId, session, count: updates.length, updates });
  }

  const sessions = await store.listSessions(Math.min(limit ?? DEFAULT_SESSION_LIMIT, 50));
  return sendSuccess(req, res, { count: sessions.length, sessions });
}
