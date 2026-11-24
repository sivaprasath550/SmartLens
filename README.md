# SmartLens: API-Based Smart Camera with Nearby Places and Web Dashboard

SmartLens is a native Android app that shows a live camera preview, reads the phone's GPS position, and lists nearby places. While a camera session runs, it syncs the position and camera status to a Node.js backend. A React web dashboard shows that data on a live map.

```
Android app (CameraX + GPS) ──REST──► Express backend ──Socket.IO──► React dashboard
                                         │        │
                                    MongoDB   Google Places (New) / OpenStreetMap
```

> **Scope:** nearby places are found from the phone's **GPS coordinates and a radius**. SmartLens does **not** recognise the object or building in the camera view. Image recognition and AR are possible future extensions.

---

## 1. Features

**Android app (`mobile/`)**
- Live CameraX preview with full lifecycle handling and an on-device photo capture button (photos are never uploaded).
- Optional **Share live view with dashboard** switch, off by default. While it's on and a session runs, the camera picture is streamed to the web dashboard at up to about 15 frames per second. A yellow SHARING badge shows on the preview.
- Runtime permission handling for camera and location, including "Don't ask again" and a link to the app settings page. The app does not crash on denial.
- Real GPS through the Fused Location Provider, with a fallback to the platform `LocationManager`. Shows latitude, longitude, accuracy, source, and fix age, with warnings for low accuracy, stale fixes, GPS turned off, or no signal.
- An optional, clearly labelled **demo location** for emulators. It is never used silently.
- Start/stop camera sessions. Location and camera status sync to the backend at a configurable interval (default 5 s), only while the app is visible.
- Nearby places through the backend (the API key never ships in the app), with category filters, distances, and loading, empty, and error states.
- Status chips for camera, backend, and sync, plus a settings dialog for the backend URL, interval, radius, and demo location.

**Backend (`backend/`)**
- Express 5 REST API with a consistent response envelope, zod validation, centralised error handling, rate limiting, CORS allow-list, Helmet, 16 KB body limit, and request timeouts.
- Real nearby places without any API key from **OpenStreetMap** (public Overpass API), or from Google Places API (New) Nearby Search when a key is set. Both have category filters, timeouts, error mapping, normalisation, and a short-lived cache.
- MongoDB persistence (Mongoose) with indexes and TTL expiry of location history. In demo mode it falls back to a **clearly labelled temporary** in-memory store.
- Socket.IO push events (`location:updated`, `places:updated`, `session:updated`) sent only to dashboard and session rooms.
- Per-session write tokens (stored hashed), an optional dashboard access key, and a stale-session timeout.
- A demo simulator that drives a simulated session from the dashboard when no phone is available.

**Web dashboard (`web/`)**
- Header with backend/socket status, a DEMO/LIVE data badge, a temporary-storage badge, and the last sync time.
- Summary cards for latitude, longitude, nearby-place count, camera-session status, and last update.
- Leaflet map with OpenStreetMap tiles: device marker, accuracy circle, movement trail, numbered place markers with popups, auto-fit, follow, and recenter.
- **Camera-first layout:** the phone's live camera view is the large main panel (canvas, about 15 fps, with fps and GPS overlay); the map is a compact card beside it.
- Nearby-places panel linked to the map markers, a session panel, recent session history, and demo simulator controls.
- Initial REST load, Socket.IO live updates with reconnection, and REST polling while the socket is down. Responsive down to phone width.

## 2. Architecture

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for Mermaid diagrams of the system, the camera, location flow, data flow, Places flow, database, and dashboard sync. See **[docs/API.md](docs/API.md)** for every endpoint and event.

## 3. Technology stack

| Part | Stack |
|---|---|
| Android | Kotlin 2.0, AGP 8.7, Gradle 8.10.2, compile SDK 35, target SDK 34, min SDK 26, CameraX 1.5.3, Play services location 21.3, Retrofit 2.11 + Gson, OkHttp 4.12, coroutines 1.8, Material 3 (Views + ViewBinding) |
| Backend | Node.js ≥ 20 (tested on 22), Express 5, Mongoose 8, Socket.IO 4.8, zod, helmet, express-rate-limit, dotenv; tests use `node:test` + supertest; ESLint 9 |
| Web | React 18, Vite 6, TypeScript 5.7, Leaflet 1.9 + react-leaflet 4, socket.io-client 4.8 |

## 4. Repository structure

```
smartlens/
├── backend/
│   ├── src/
│   │   ├── config/        env.js (validated config), database.js (Mongo / memory fallback)
│   │   ├── controllers/   health, session, location, places, dashboard, demo
│   │   ├── middleware/    validate, errorHandler, rateLimit, requestTimeout, dashboardAuth
│   │   ├── models/        Session, LocationUpdate, PlaceSnapshot (Mongoose)
│   │   ├── routes/        index.js (all /api routes)
│   │   ├── services/      placesService, googlePlacesClient, demoPlaces, sessionService,
│   │   │                  demoSimulator, ttlCache, store/{memoryStore,mongoStore,shape}
│   │   ├── sockets/       realtime.js (Socket.IO)
│   │   ├── utils/         ApiError, response, validators, geo, ids, logger
│   │   ├── app.js         Express app factory
│   │   └── server.js      HTTP + Socket.IO bootstrap
│   ├── tests/             api, places, realtime, config, mongo.integration
│   ├── package.json
│   └── .env.example
├── web/
│   ├── src/               api/, hooks/, components/, utils/, App.tsx, styles.css
│   ├── public/
│   ├── vite.config.ts     dev/preview proxy for /api and /socket.io
│   ├── package.json
│   └── .env.example
├── mobile/                Android Studio project (Gradle wrapper included)
│   └── app/src/
│       ├── main/java/com/smartlens/app/   MainActivity, camera/, location/, data/, ui/, util/
│       ├── main/res/                      layouts, theme, icons, network security config
│       ├── debug/res/xml/                 debug-only cleartext config for LAN backends
│       └── test/                          JVM unit tests
├── docs/                  ARCHITECTURE.md, API.md
├── docker-compose.yml     optional local MongoDB
├── .gitignore
└── README.md
```

## 5. Prerequisites

- **Node.js 20.10+** and npm.
- **Android Studio** (Ladybug or newer) with Android SDK Platform 35. Android Studio's bundled JDK works; command-line builds need JDK 17+.
- Optional: **MongoDB 6/7** (local install, Atlas, or `docker compose up -d mongo`).
- Optional: a **Google Cloud** project with *Places API (New)* enabled, for live places.

## 6. Environment setup

```bash
cd smartlens/backend
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
npm install

cd ../web
cp .env.example .env          # optional; the defaults work for local development
npm install
```

The defaults (`DEMO_MODE=true`, no API key) run the complete workflow without any credentials. See `backend/.env.example` for every variable and what it does.

## 7. Start the backend

```bash
cd smartlens/backend
npm start          # or: npm run dev   (auto-restart on changes)
```

The startup log prints the URLs to use, for example:

```
SmartLens API listening on http://0.0.0.0:3000
  This computer:     http://localhost:3000/api/health
  Android emulator:  http://10.0.2.2:3000/
  Same Wi-Fi phone:  http://192.168.1.156:3000/
  Storage: memory (TEMPORARY - data is lost on restart)
```

Check it with `curl http://localhost:3000/api/health`.

## 8. Start the web dashboard

```bash
cd smartlens/web
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` and `/socket.io` to `http://localhost:3000` (change this with `VITE_DEV_BACKEND_URL`), so no CORS setup is needed. To open the dashboard from another device on the LAN, run `npm run dev -- --host` and browse to `http://<computer-IP>:5173`.

Production build: `npm run build`, which outputs to `web/dist/`. Preview it with `npm run preview` (port 4173, same proxy). When serving `dist/` from a different origin than the API, set `VITE_API_BASE_URL` at build time and add that origin to the backend's `CORS_ORIGINS`.

If port 5173 is taken, run `npx vite --port 5180`.

## 9. Android Studio setup

1. Open **Android Studio**, choose **File, then Open**, and select `smartlens/mobile`.
2. Let Gradle sync. It uses the included wrapper (Gradle 8.10.2) and downloads dependencies on first sync. If prompted, install *SDK Platform 35*.
3. Select a device or emulator and press **Run**. The debug app installs as **SmartLens** (`com.smartlens.app.debug`).

Command line (JDK 17 on `JAVA_HOME`):

```bash
cd smartlens/mobile
./gradlew assembleDebug            # APK: app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug             # install on a connected device or emulator
./gradlew testDebugUnitTest lintDebug
```

`local.properties` (git-ignored) must point to your SDK. Android Studio creates it automatically. Otherwise, create it with `sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk`.

### Using the app

1. Tap **Start camera session** and allow camera and location access. The live preview starts and the coordinates appear.
2. The backend chip turns green, the session chip shows **Syncing**, and the line under the chips shows the session ID and update count.
3. Nearby places load on the first fix, then again after moving 150 m. Use **Refresh places** or the category chips at any time.
4. Tap the shutter button to save a photo on the phone.
5. To show the camera picture on the dashboard, turn on **Share live view with dashboard**. The dashboard's large **Live camera view** panel then shows the camera at up to about 15 fps.
6. Tap **Stop session**. The backend marks the session inactive and the dashboard shows "Ended".

## 10. Emulator network configuration

- The emulator reaches your computer at **`http://10.0.2.2:3000/`**. This is the app's default, so nothing needs to change.
- **GPS on the emulator:** open *Extended controls (⋯), then Location*, set a point, and press **Set location**. From a terminal you can instead run `adb emu geo fix <longitude> <latitude>`, for example `adb emu geo fix 80.0444 12.8230`.
- If you cannot set a location, open **Settings (⚙)** in the app and turn on **Use demo location (emulator)**. The app then sends fixed coordinates labelled **DEMO LOCATION**, and the dashboard marks them as simulated.
- Some emulator images (especially headless or low-memory ones) never deliver GPS fixes. The app then stays on "Acquiring location…" and never invents a position. Use *Use demo location* for those.
- If the emulator's network is broken (the app shows **Backend: offline** although `http://localhost:3000/api/health` works on your computer), tunnel the port over adb instead: run `adb reverse tcp:3000 tcp:3000` and set the backend URL to `http://127.0.0.1:3000/`. This also works for a **USB-connected phone** without Wi-Fi setup. Re-run it after each emulator or USB reconnect.
- The emulator camera shows a virtual scene or test pattern. Configure it under *AVD Manager, then Edit, then Advanced, then Camera*.

## 11. Physical device on the same Wi-Fi

1. Connect the phone and the computer to the **same Wi-Fi network**. Guest networks with client isolation will not work.
2. Find the computer's LAN IP address:
   - Windows: `ipconfig`, then look for *IPv4 Address* under the Wi-Fi adapter (for example `192.168.1.156`).
   - macOS: `ipconfig getifaddr en0`
   - Linux: `hostname -I`
   - The backend also prints these addresses at startup ("Same Wi-Fi phone: …").
3. Start the backend. It listens on `HOST=0.0.0.0`, so it accepts LAN connections.
4. Allow Node.js through the firewall **for Private networks only**. On Windows, accept the prompt on first run, or run this in an administrator PowerShell:
   `New-NetFirewallRule -DisplayName "SmartLens 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Profile Private -Action Allow`
5. Open the phone's browser at `http://<computer-IP>:3000/api/health`. It should show JSON.
6. In the app, open **Settings**, set **Backend URL** to `http://<computer-IP>:3000/`, tap **Test connection**, then **Save**. Alternatively, build with that default: `./gradlew installDebug -Psmartlens.backendUrl=http://192.168.1.156:3000/`.

Do not port-forward the backend to the internet to make this work. Plain HTTP is allowed **only in debug builds** (`app/src/debug/res/xml/network_security_config.xml`). Release builds allow HTTPS only, so a production deployment needs an HTTPS backend URL.

## 12. Demo mode

With `DEMO_MODE=true`:

- Nearby places are **real** by default: without `GOOGLE_PLACES_API_KEY` the backend asks OpenStreetMap (see section 13). Set `PLACES_PROVIDER=demo` to get 16 **fictional** places instead (named "… (Demo)", flagged `simulated: true`, shown as "Simulated demo data"); this needs no internet.
- If MongoDB is unavailable, data is kept in **temporary memory**. This is reported in `/api/health`, in `meta.storage`, and by the dashboard's "Temporary storage" badge.
- The dashboard's **Run demo simulation** button creates a simulated session that walks around a fictional loop (centre `DEMO_CENTER_LAT/LNG`) for about 3 minutes. It goes through the same backend, Socket.IO, and dashboard pipeline as a real phone.
- The phone can still use real GPS. Demo coordinates are sent only when *Use demo location* is turned on.
- The camera preview works the same in both modes.

**Full demo without credentials:** start the backend and the dashboard, then either start a session on the phone or emulator, or click **Run demo simulation**. The dashboard updates live.

## 13. Live places: OpenStreetMap (default) or Google Places

**OpenStreetMap (no key, used by default).** With no `GOOGLE_PLACES_API_KEY`, `PLACES_PROVIDER=auto` searches the free public [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) for named restaurants, cafes, shops, attractions, transit stops, health, education and lodging around the phone's GPS position. `/api/health` reports `"places": { "provider": "osm" }`.

- The laptop needs internet access. The backend, not the phone, sends the coordinates (rounded to about 11 m) to the public server.
- Public Overpass servers are shared and can take **30 s or more** when busy, so the first search at a spot may be slow. Identical searches within 5 minutes come from the cache, and concurrent identical searches share one request. `OSM_TIMEOUT_MS` (default 45 s) and `OVERPASS_URL` (comma-separated list of servers, tried in order) tune this.
- Coverage depends on what volunteers have mapped; opening hours and ratings are not included.
- Results are labelled "Places data © OpenStreetMap contributors (ODbL)" and link to openstreetmap.org. Heavy or public use should run its own Overpass instance or respect the [usage policy](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).

**Google Places API (New)** gives richer, fresher data but needs a billed key:

1. In the [Google Cloud Console](https://console.cloud.google.com/), create or select a project and **enable billing**.
2. Enable **Places API (New)** (`places.googleapis.com`).
3. Create an **API key** under *APIs & Services, then Credentials*. Restrict it to *Places API (New)* under API restrictions. For a server key, restrict by your server's IP address where possible.
4. Put the key in `backend/.env` only: `GOOGLE_PLACES_API_KEY=your-key`. Restart the backend. `/api/health` should then report `"places": { "provider": "google" }` and `meta.mode` should be `live`.
5. The key is never sent to the phone or the browser. The backend requests only the fields it displays (see `FIELD_MASK` in `googlePlacesClient.js`), caches identical queries for 5 minutes, and keeps per-session snapshots for 30 minutes.
6. **Attribution and policy:** results are labelled "Places data © Google" in the app, the dashboard panel, and the map attribution. Place results link to Google Maps where available. Review the current [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms) and [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies) before any public deployment, including the rules about displaying Places data on non-Google maps.

## 14. MongoDB configuration

- Local install: keep `MONGODB_URI=mongodb://127.0.0.1:27017/smartlens`.
- Docker: `docker compose up -d mongo` from `smartlens/`. This binds to 127.0.0.1 only.
- Atlas: `MONGODB_URI=mongodb+srv://user:pass@cluster.example.mongodb.net/smartlens`. Credentials are redacted in logs.
- Collections and indexes are created at startup. Location history expires after `LOCATION_RETENTION_HOURS` (default 24).
- `DEMO_MODE=false` makes MongoDB mandatory: the server exits if it cannot connect.

## 15. Testing

```bash
# Backend: unit + API + Socket.IO tests (in-memory store, mocked Google API)
cd smartlens/backend
npm test
npm run lint

# Optional: MongoDB integration tests against a real database
#   bash:        TEST_MONGODB_URI=mongodb://127.0.0.1:27017/smartlens_test npm test
#   PowerShell:  $env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017/smartlens_test"; npm test

# Web: type check + production build
cd ../web
npm run build

# Android: JVM unit tests, lint, debug APK
cd ../mobile
./gradlew testDebugUnitTest lintDebug assembleDebug
```

The backend tests cover health, sessions (create, stop, idempotency, tokens), valid and invalid location submissions (coordinates, missing fields, timestamps), unknown sessions, timeout and resume, dashboard latest and history, dashboard key, demo places (deterministic, simulated, category, validation), Google request format, normalisation, caching, and upstream failures (5xx, auth, 429, network, timeout, never replaced by fake data), CORS, body limits, JSON errors, the demo simulator, and real Socket.IO delivery.

## 16. Common errors and solutions

| Symptom | Fix |
|---|---|
| App: **Backend: offline** / "Cannot reach the backend" | Check the backend is running. Use `http://10.0.2.2:3000/` on the emulator, or the computer's LAN IP on a phone. Open `/api/health` in the phone's browser. Allow port 3000 through the firewall (Private profile). Make sure the phone and computer are on the same Wi-Fi. |
| `CLEARTEXT communication … not permitted` | You are running a **release** build against `http://`. Use the debug build for LAN testing, or serve the backend over HTTPS. |
| Location stays "Acquiring…" on the emulator | Set a location in *Extended controls, then Location*, or turn on *Use demo location*. |
| "Location services (GPS) are turned off" | Tap **Turn on location**. |
| Camera shows "Camera unavailable" | Another app is using the camera, or the AVD has no camera. Close the other app and tap Retry, or configure the AVD camera. |
| Permission permanently denied | Tap **Open app settings** and allow Camera / Location. |
| Dashboard: **Backend offline** | Start the backend on port 3000, or set `VITE_DEV_BACKEND_URL`. |
| Dashboard live view says "not sharing" | Turn on **Share live view with dashboard** in the app, and make sure a session is running with the camera active and the app in the foreground. |
| Dashboard: **Polling** instead of **Live** | The WebSocket cannot connect, often because of a proxy. Data still refreshes every 5 s over REST. |
| `403 CORS_REJECTED` | Add the dashboard origin to `CORS_ORIGINS` (only needed when not using the Vite proxy). |
| `Port 5173 is in use` | Close the other process or run `npx vite --port 5180`. |
| `PLACES_AUTH_ERROR` | The key is invalid, Places API (New) is not enabled, or billing is off. |
| `PLACES_NOT_CONFIGURED` | `PLACES_PROVIDER=google` without a key: set `GOOGLE_PLACES_API_KEY`, or use `auto`/`osm`/`demo`. |
| `PLACES_TIMEOUT` / `PLACES_RATE_LIMITED` with OpenStreetMap | The public Overpass server is busy. Retry in a minute, or set `OVERPASS_URL` to another server. |
| Server says MongoDB unreachable | Start MongoDB (`docker compose up -d mongo`). In demo mode the server continues with temporary memory. |
| Camera error "Dynamic range profile cannot be converted" | Happens with CameraX < 1.5 on Android 16+ images. The project uses CameraX 1.5.3. Do not downgrade it. |
| Gradle: `SDK location not found` | Create `mobile/local.properties` with `sdk.dir=…`, or open the project in Android Studio. |
| Data disappeared after a restart | You were on the in-memory store. Configure MongoDB for persistence. |

## 17. Known limitations

- Nearby places come from GPS position and radius only. There is **no object recognition** and no compass or AR alignment with the camera view.
- Live view is a JPEG frame relay (640×480, up to about 15 fps, about 0.2 s delay), not a video codec. In dim light the camera may deliver fewer frames or a darker image. It pauses when the app is in the background.
- No user accounts. Access control is a per-session write token plus an optional shared dashboard key, which is enough for a controlled demonstration but not for public multi-user use.
- Location syncs only while the app is in the foreground, by design. Leaving the app pauses sync and reports `cameraActive: false`. The server marks silent sessions inactive after 2 minutes.
- The in-memory demo store is lost on restart.
- Google Places results are cached for 5 minutes and snapshots expire after 30 minutes, so the dashboard may show an empty places panel for an old, idle session.
- The Android UI is portrait-only and dark-themed.
- Demo place positions are deterministic geometric offsets, so they may appear in lakes or on roads on the map. They are fictional by design.

## 18. Security considerations

- **Secrets stay on the server.** The Google key exists only in `backend/.env`, which is git-ignored. Neither the APK nor the web bundle contains it. Logs never include keys, tokens, request bodies, or query strings. MongoDB credentials are redacted.
- **Validation and limits.** Every input is validated with strict zod schemas (unknown fields rejected, coordinate and radius bounds, timestamp window). Bodies are capped at 16 KB, requests are rate-limited, and handlers time out after 15 s.
- **Session tokens.** Only the SHA-256 hash of each session's write token is stored, and comparisons use constant time. Other clients cannot write to or stop someone else's session.
- **CORS** is an allow-list (`CORS_ORIGINS`). Native apps send no `Origin` header and are unaffected.
- **Least data.** Photos are never uploaded. Camera frames leave the phone only when the user turns on *Share live view*; the backend then keeps just the latest frame in memory, never on disk or in the database, and deletes it when the session ends. No background location. Location history expires automatically (TTL). The dashboard shows a bounded history: at most 50 sessions and 200 updates per session.
- **Socket.IO** sends location only to the `dashboard` room, which requires the dashboard key when configured, and to per-session rooms. It never broadcasts to every socket.
- **Transport.** Cleartext HTTP is allowed only in debug Android builds. Use HTTPS (for example behind a reverse proxy) for any deployment beyond a LAN demo.
- **⚠ Prototype notice:** without `DASHBOARD_ACCESS_KEY`, anyone who can reach the backend can view location data. Run it only on a trusted network for controlled demonstrations. Do not deploy it publicly without real authentication, HTTPS, and a privacy review.
