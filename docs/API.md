# SmartLens REST & Socket.IO API

Base URL (local development): `http://<host>:3000`. All REST endpoints are under `/api`.

## Response envelope

Every response uses the same envelope.

**Success**

```json
{
  "success": true,
  "data": { "...": "..." },
  "meta": { "mode": "demo", "storage": "memory", "updatedAt": "2026-10-29T06:30:00.000Z" }
}
```

**Error**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "latitude", "message": "latitude must be between -90 and 90" }]
  },
  "meta": { "mode": "demo", "storage": "memory" }
}
```

| `meta` field | Meaning |
|---|---|
| `mode` | `demo` when nearby places are simulated (`PLACES_PROVIDER=demo`), `live` for Google or OpenStreetMap |
| `storage` | `mongodb` (persistent) or `memory` (temporary, lost on restart) |
| `updatedAt` | Server time of the data returned, where relevant |
| `cached` | Places only: `true` if served from the short-lived server cache |
| `empty` | Dashboard latest only: `true` when no session exists yet |

`details` is present only for validation errors.

### Common error codes

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body or query failed validation (see `details`) |
| 400 | `INVALID_JSON` | Body is not valid JSON |
| 401 | `UNAUTHORIZED` | Missing `X-Session-Token` or `X-Dashboard-Key` |
| 403 | `FORBIDDEN` | Token or key does not match |
| 403 | `CORS_REJECTED` | Browser origin not in `CORS_ORIGINS` |
| 404 | `SESSION_NOT_FOUND` | Unknown session ID |
| 404 | `ROUTE_NOT_FOUND` | Unknown endpoint |
| 409 | `SESSION_INACTIVE` | Location sent to a session the user stopped |
| 413 | `PAYLOAD_TOO_LARGE` | Body larger than 16 KB |
| 429 | `RATE_LIMITED` | Too many requests (with a `Retry-After` header) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `DATABASE_UNAVAILABLE` | MongoDB went away during a request |
| 503 | `REQUEST_TIMEOUT` | Handler did not finish within 15 s |

### Authentication model (prototype)

- **Session token**: `POST /api/sessions` returns a random `sessionToken`. Only its SHA-256 hash is stored. Every write for that session (`/location`, `/sessions/:id/stop`, and `/places/nearby` with a `sessionId`) must send it as `X-Session-Token`.
- **Dashboard key** (optional): if `DASHBOARD_ACCESS_KEY` is set, the dashboard and demo endpoints require the `X-Dashboard-Key` header, and Socket.IO clients must send `auth: { dashboardKey }`. If it is empty, the dashboard is open to anyone who can reach the server.

### Rate limits (per IP, per minute)

| Scope | Limit |
|---|---|
| All `/api` routes | 300 |
| `POST /api/sessions` | 20 |
| `/api/places/nearby` | 30 |

---

## `GET /api/health`

Server status. Contains no secrets.

**200**

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptimeSeconds": 42,
    "startedAt": "2026-10-29T06:29:18.000Z",
    "serverTime": "2026-10-29T06:30:00.000Z",
    "demoMode": true,
    "database": { "status": "not-connected", "storage": "memory", "persistent": false },
    "places": { "provider": "demo", "configured": true, "simulated": true },
    "realtime": { "connectedClients": 1 },
    "dashboardProtected": false,
    "locationUpdateIntervalSeconds": 5,
    "sessionTimeoutSeconds": 120
  },
  "meta": { "mode": "demo", "storage": "memory" }
}
```

`database.status` is a Mongoose connection state (`connected`, `connecting`, `disconnected`, …) when MongoDB is in use, or `not-connected` when the in-memory store is active. `places.provider` is `google`, `demo` or `none`.

## `POST /api/sessions`

Creates a camera/location session.

**Body** (all fields optional; unknown fields are rejected)

| Field | Type | Default |
|---|---|---|
| `deviceName` | string, ≤ 80 chars | `"Android device"` |
| `platform` | `android` \| `ios` \| `web` \| `simulator` | `android` |
| `locationSource` | `gps` \| `network` \| `demo` | `gps` |
| `cameraActive` | boolean | `true` |
| `appVersion` | string, ≤ 32 chars | `null` |

**201**

```json
{
  "success": true,
  "data": {
    "sessionId": "ses_uyZk1TdexsLK",
    "sessionToken": "NHnNlawWhTmBUhl9DOqlDRi3dZswJg_5",
    "session": {
      "sessionId": "ses_uyZk1TdexsLK",
      "status": "active",
      "endedReason": null,
      "cameraActive": true,
      "deviceName": "Pixel 8",
      "platform": "android",
      "appVersion": "1.0.0",
      "locationSource": "gps",
      "simulated": false,
      "createdAt": "2026-10-29T06:30:00.000Z",
      "lastSeenAt": "2026-10-29T06:30:00.000Z",
      "endedAt": null,
      "updateCount": 0,
      "lastLocation": null
    },
    "locationUpdateIntervalSeconds": 5
  },
  "meta": { "mode": "demo", "storage": "memory", "updatedAt": "2026-10-29T06:30:00.000Z" }
}
```

Errors: `400`, `429`.

## `POST /api/location`

Records a location and camera-status update. Header: `X-Session-Token: <sessionToken>`.

**Body**

| Field | Type | Required |
|---|---|---|
| `sessionId` | string | yes |
| `latitude` | number, −90 to 90 | yes |
| `longitude` | number, −180 to 180 | yes |
| `cameraActive` | boolean | yes |
| `accuracy` | number (metres, 0–100000) or null | no |
| `timestamp` | ISO-8601 string or epoch ms; from 7 days ago up to 5 minutes in the future | no |
| `source` | `gps` \| `network` \| `demo` | no (default `gps`) |

**201**

```json
{
  "success": true,
  "data": {
    "sessionId": "ses_uyZk1TdexsLK",
    "latitude": 12.823,
    "longitude": 80.0444,
    "accuracy": 8.5,
    "cameraActive": true,
    "source": "gps",
    "status": "active",
    "updateCount": 12,
    "receivedAt": "2026-10-29T06:30:05.000Z"
  },
  "meta": { "mode": "demo", "storage": "memory", "updatedAt": "2026-10-29T06:30:05.000Z" }
}
```

Errors: `400` validation, `401`/`403` token, `404 SESSION_NOT_FOUND`, `409 SESSION_INACTIVE` (the user stopped the session).

A session that was marked inactive only because it timed out (`endedReason: "timeout"`, no updates for `SESSION_TIMEOUT_SECONDS`) is reactivated by its next update.

On success, the server emits `location:updated` over Socket.IO.

## `POST /api/sessions/:id/stop`

Marks a session inactive (`endedReason: "user"`, `cameraActive: false`). Header: `X-Session-Token`. Calling it again is safe and has no further effect.

**200** `data: { "sessionId": "...", "session": { ...status: "inactive"... } }`

Errors: `401`, `403`, `404`. Emits `session:updated` with `change: "stopped"`.

## `POST /api/places/nearby`

Finds places near a coordinate.

**Body**

| Field | Type | Default |
|---|---|---|
| `latitude` | number, −90 to 90 | required |
| `longitude` | number, −180 to 180 | required |
| `radius` | integer metres, 50–5000 | 1000 |
| `category` | `all` \| `food` \| `cafe` \| `attractions` \| `shopping` \| `transit` \| `health` \| `education` \| `lodging` | `all` |
| `maxResults` | integer, 1–20 | 20 |
| `sessionId` | string (requires `X-Session-Token`) | none |

When `sessionId` is given, the result is stored as that session's latest snapshot (kept for 30 minutes) and `places:updated` is emitted.

**Provider selection**

`PLACES_PROVIDER` (default `auto`):

1. `auto` with `GOOGLE_PLACES_API_KEY` set, or `google`: Google Places API (New) Nearby Search, `source: "google"`, `simulated: false`. `google` without a key: `503 PLACES_NOT_CONFIGURED`.
2. `auto` without a key, or `osm`: OpenStreetMap via the Overpass API, `source: "osm"`, `simulated: false`, ids like `osm:node/123`, `mapsUri` on openstreetmap.org, attribution "Places data © OpenStreetMap contributors (ODbL)". Can take 30 s or more when the public server is busy; the request timeout for this route is `OSM_TIMEOUT_MS + 5 s`.
3. `demo`: deterministic fictional places, `source: "demo"`, `simulated: true`, names ending in "(Demo)".
4. `none`: `503 PLACES_NOT_CONFIGURED`.

If a real provider fails, an error is returned (`PLACES_TIMEOUT`, `PLACES_RATE_LIMITED`, `PLACES_UPSTREAM_ERROR`, `PLACES_UNAVAILABLE`). Simulated data is never substituted.

**200**

```json
{
  "success": true,
  "data": {
    "center": { "latitude": 12.823, "longitude": 80.0444 },
    "radius": 1000,
    "category": "all",
    "count": 16,
    "places": [
      {
        "id": "demo-coffee-ember",
        "name": "Ember Roasters Coffee (Demo)",
        "category": "Coffee shop",
        "types": ["coffee_shop"],
        "address": "198 Demo Avenue — fictional address",
        "latitude": 12.822,
        "longitude": 80.0439,
        "distanceMeters": 120,
        "mapsUri": null,
        "businessStatus": "OPERATIONAL",
        "source": "demo",
        "simulated": true
      }
    ],
    "source": "demo",
    "simulated": true,
    "attribution": "Simulated demo data — these places are fictional",
    "sessionId": null
  },
  "meta": { "mode": "demo", "storage": "memory", "updatedAt": "...", "cached": false, "placesSource": "demo" }
}
```

Places are sorted by `distanceMeters` (straight-line distance from the request coordinate).

**Places errors**

| HTTP | `code` | Cause |
|---|---|---|
| 502 | `PLACES_AUTH_ERROR` | Google rejected the key (401/403) |
| 502 | `PLACES_BAD_REQUEST` | Google rejected the request (400) |
| 502 | `PLACES_UPSTREAM_ERROR` | Other Google error or unreadable response |
| 502 | `PLACES_UNAVAILABLE` | Network error reaching Google |
| 503 | `PLACES_RATE_LIMITED` | Google quota or rate limit (with `Retry-After`) |
| 504 | `PLACES_TIMEOUT` | No response within `PLACES_TIMEOUT_MS` |
| 503 | `PLACES_NOT_CONFIGURED` | No key and demo mode off |

## `GET /api/places/nearby`

Same as `POST`, with parameters in the query string, for example `/api/places/nearby?latitude=12.82&longitude=80.04&radius=500&category=cafe`.

## `GET /api/dashboard/latest`

The state the dashboard shows. Header `X-Dashboard-Key` is required if configured.

**Query:** `sessionId` (optional). Without it, the most recently active session is returned, or else the most recently seen session.

**200**

```json
{
  "success": true,
  "data": {
    "sessionId": "ses_uyZk1TdexsLK",
    "latitude": 12.8242,
    "longitude": 80.0457,
    "accuracy": 9.5,
    "cameraActive": true,
    "status": "active",
    "nearbyPlaces": [ "...places, distances recomputed from the latest location..." ],
    "session": { "...": "full session object" },
    "location": {
      "sessionId": "ses_uyZk1TdexsLK",
      "latitude": 12.8242,
      "longitude": 80.0457,
      "accuracy": 9.5,
      "cameraActive": true,
      "source": "gps",
      "clientTimestamp": "2026-10-29T06:30:04.000Z",
      "receivedAt": "2026-10-29T06:30:05.000Z"
    },
    "places": {
      "source": "demo",
      "simulated": true,
      "attribution": "Simulated demo data — these places are fictional",
      "radius": 1000,
      "category": "all",
      "center": { "latitude": 12.8242, "longitude": 80.0457 },
      "fetchedAt": "2026-10-29T06:30:05.000Z",
      "count": 16
    }
  },
  "meta": { "mode": "demo", "storage": "memory", "updatedAt": "2026-10-29T06:30:05.000Z", "empty": false }
}
```

With no sessions, the response is `200` with `sessionId: null`, `latitude: null`, `nearbyPlaces: []`, `places: null`, and `meta.empty: true`.

Errors: `401`/`403` dashboard key, `404 SESSION_NOT_FOUND` (unknown `sessionId`).

## `GET /api/dashboard/history`

**Query**

| Param | Effect |
|---|---|
| (none) | Up to `limit` recent sessions, default 10, max 50 |
| `sessionId` | Recent location updates for that session, newest first; `limit` default 50, max 200 |

**200** (sessions) `data: { "count": 2, "sessions": [ ...session objects... ] }`

**200** (updates) `data: { "sessionId": "...", "session": {...}, "count": 3, "updates": [ ...location objects... ] }`

Location history is deleted automatically after `LOCATION_RETENTION_HOURS` (MongoDB TTL index). The in-memory store keeps at most 500 updates per session.

## Live view (opt-in camera sharing)

Shared only when the phone user turns on **Share live view with dashboard**. The backend keeps **only the latest frame per session, in memory**. Frames are never written to MongoDB or disk, and they are removed when the session stops or times out.

### `POST /api/sessions/:id/frame`

Headers: `X-Session-Token`, `Content-Type: image/jpeg`. Body: raw JPEG, at most 512 KB. The phone sends up to about 15 frames per second (640×480, quality 60, roughly 5–40 KB each) with up to 4 uploads in flight. Optional headers: `X-Frame-Seq` (increasing number; older frames that arrive late are ignored and answered with `dropped: true`) and `X-Frame-Rotation` (0/90/180/270, the clockwise rotation the viewer applies). Frames have their own rate limit of 1800 per minute and do not count toward the general API limit.

**202** `data: { "sessionId": "...", "bytes": 4941, "receivedAt": "..." }`. Emits `camera:frame` as a Socket.IO volatile message, so slow dashboards drop frames instead of queueing them.

Errors: `401`/`403` token, `404 SESSION_NOT_FOUND`, `409 SESSION_INACTIVE`, `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE` (not a JPEG).

### `GET /api/sessions/:id/frame`

Returns the latest frame as `image/jpeg` with `Cache-Control: no-store` and `X-Frame-Received-At` / `X-Frame-Rotation` headers. Uses the dashboard key when configured. Returns `404 FRAME_NOT_AVAILABLE` if the phone is not sharing. The dashboard uses it for the first paint and while the socket is down.

## Demo simulator (demo mode only)

| Method & path | Effect |
|---|---|
| `GET /api/demo/simulation` | `{ available, running, sessionId?, step?, steps? }` |
| `POST /api/demo/simulation` | Starts a simulated session (`platform: "simulator"`, `simulated: true`, `locationSource: "demo"`) that moves around a fictional loop every `LOCATION_UPDATE_INTERVAL_SECONDS` for 36 steps. Returns `201`. Returns `409 SIMULATION_RUNNING` if one is already running, and `403` if `DEMO_MODE=false`. |
| `DELETE /api/demo/simulation` | Stops it. Returns `404 SIMULATION_NOT_RUNNING` if none is running. |

These routes use the dashboard key when one is configured.

---

## Socket.IO events

Connect to the same origin as the REST API (path `/socket.io`). When `DASHBOARD_ACCESS_KEY` is set, pass `auth: { dashboardKey }`; without it the connection fails with `connect_error` message `UNAUTHORIZED`.

Connected clients join the `dashboard` room. A client can also follow a single session with `socket.emit('session:subscribe', sessionId, ack)` and stop with `session:unsubscribe`. Events go only to the `dashboard` room and that session's room; they are never broadcast to every socket.

### `location:updated`

```json
{
  "sessionId": "ses_uyZk1TdexsLK",
  "latitude": 12.8242,
  "longitude": 80.0457,
  "accuracy": 9.5,
  "source": "gps",
  "cameraActive": true,
  "status": "active",
  "simulated": false,
  "clientTimestamp": "2026-10-29T06:30:04.000Z",
  "updatedAt": "2026-10-29T06:30:05.000Z",
  "updateCount": 12
}
```

### `places:updated`

The full snapshot (`sessionId`, `center`, `radius`, `category`, `source`, `simulated`, `attribution`, `places`, `fetchedAt`, `expiresAt`) plus `count` and `updatedAt`.

### `camera:frame` (live view, opt-in)

```json
{ "sessionId": "ses_…", "image": "<binary JPEG>", "mimeType": "image/jpeg", "bytes": 4941, "rotation": 90, "receivedAt": "..." }
```

`image` arrives as an `ArrayBuffer` in the browser.

### `session:updated`

```json
{ "change": "created | stopped | timeout | resumed", "session": { "...": "full session object" }, "serverTime": "..." }
```
