/** Fields of a session that are safe to return to API clients (never the token hash). */
export function toPublicSession(doc) {
  if (!doc) return null;
  const loc = doc.lastLocation;
  return {
    sessionId: doc.sessionId,
    status: doc.status,
    endedReason: doc.endedReason ?? null,
    cameraActive: Boolean(doc.cameraActive),
    deviceName: doc.deviceName,
    platform: doc.platform,
    appVersion: doc.appVersion ?? null,
    locationSource: doc.locationSource,
    simulated: Boolean(doc.simulated),
    createdAt: toIso(doc.createdAt),
    lastSeenAt: toIso(doc.lastSeenAt),
    endedAt: toIso(doc.endedAt),
    updateCount: doc.updateCount ?? 0,
    lastLocation: loc ? toPublicLocation({ ...loc, sessionId: doc.sessionId, cameraActive: doc.cameraActive }) : null,
  };
}

export function toPublicLocation(doc) {
  if (!doc) return null;
  return {
    sessionId: doc.sessionId,
    latitude: doc.latitude,
    longitude: doc.longitude,
    accuracy: doc.accuracy ?? null,
    cameraActive: Boolean(doc.cameraActive),
    source: doc.source ?? 'gps',
    clientTimestamp: toIso(doc.clientTimestamp),
    receivedAt: toIso(doc.receivedAt),
  };
}

export function toPublicSnapshot(doc) {
  if (!doc) return null;
  return {
    sessionId: doc.sessionId,
    center: { latitude: doc.center.latitude, longitude: doc.center.longitude },
    radius: doc.radius,
    category: doc.category,
    source: doc.source,
    simulated: Boolean(doc.simulated),
    attribution: doc.attribution ?? null,
    places: (doc.places ?? []).map((place) => ({ ...place })),
    fetchedAt: toIso(doc.fetchedAt),
    expiresAt: toIso(doc.expiresAt),
  };
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
