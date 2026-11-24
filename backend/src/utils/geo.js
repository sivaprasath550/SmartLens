const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two WGS84 coordinates. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Returns the coordinate reached by moving `meters` from a point on `bearingDeg`. */
export function offsetCoordinate(latitude, longitude, meters, bearingDeg) {
  const angular = meters / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(latitude);
  const lng1 = toRad(longitude);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );
  return {
    latitude: Number(((lat2 * 180) / Math.PI).toFixed(6)),
    longitude: Number(((((lng2 * 180) / Math.PI + 540) % 360) - 180).toFixed(6)),
  };
}

export function roundCoordinate(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
