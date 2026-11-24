package com.smartlens.app.ui

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.smartlens.app.BuildConfig
import com.smartlens.app.camera.CameraStatus
import com.smartlens.app.data.AppSettings
import com.smartlens.app.data.SettingsStore
import com.smartlens.app.data.api.ApiResult
import com.smartlens.app.data.api.BackendClient
import com.smartlens.app.data.api.CreateSessionRequest
import com.smartlens.app.data.api.HealthData
import com.smartlens.app.data.api.LocationUpdateRequest
import com.smartlens.app.data.api.NearbyData
import com.smartlens.app.data.api.NearbyRequest
import com.smartlens.app.location.DemoLocationProvider
import com.smartlens.app.location.LocationEvent
import com.smartlens.app.location.LocationFix
import com.smartlens.app.location.LocationRepository
import com.smartlens.app.util.Geo
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Instant
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Owns the camera-session workflow:
 *  - foreground location updates (real GPS, or explicit demo coordinates),
 *  - creating a backend session and posting throttled location/status updates,
 *  - nearby-place searches through the backend (the Places API key never
 *    reaches the phone).
 * The camera itself is bound by the Activity; it reports status here.
 */
class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val settingsStore = SettingsStore(app)
    private val locationRepo = LocationRepository(app)
    private var settings: AppSettings = settingsStore.load()
    private var client = BackendClient(settings.backendUrl)
    private val demoProvider = DemoLocationProvider(BuildConfig.DEMO_LATITUDE, BuildConfig.DEMO_LONGITUDE)

    private val _state = MutableStateFlow(
        MainUiState(
            useDemoLocation = settings.useDemoLocation,
            backendUrl = settings.backendUrl,
            liveView = LiveViewUi(enabled = settingsStore.shareLiveView),
        ),
    )
    val state: StateFlow<MainUiState> = _state.asStateFlow()

    private val _events = Channel<UiEvent>(Channel.BUFFERED)
    val events = _events.receiveAsFlow()

    // Backend session credentials (kept in memory only).
    @Volatile private var sessionId: String? = null

    @Volatile private var sessionToken: String? = null
    private var serverIntervalSeconds: Int? = null
    private var nextSessionAttemptAt = 0L
    private val sessionMutex = Mutex()

    private var locationJob: Job? = null
    private var placesJob: Job? = null
    @Volatile private var inForeground = true
    private var lastFix: LocationFix? = null
    private var lastSentAt = 0L
    private var lastSentCameraActive: Boolean? = null
    private var lastPlacesFix: LocationFix? = null
    private var syncInFlight = false
    private val framesInFlight = AtomicInteger(0)
    private val framesSentTotal = AtomicInteger(0)
    private val frameSeq = AtomicLong(0)
    private var framesAtLastStats = 0
    private var lastStatsAt = 0L

    @Volatile private var frameError: String? = null

    private val intervalMs: Long
        get() = (settings.intervalSecondsOverride ?: serverIntervalSeconds ?: SettingsStore.DEFAULT_INTERVAL) * 1000L

    init {
        updateIntervalDisplay()
        checkBackend()
    }

    val currentSettings: AppSettings get() = settings

    private fun emit(text: String) {
        _events.trySend(UiEvent.Message(text))
    }

    private fun updateIntervalDisplay() {
        _state.update { it.copy(session = it.session.copy(intervalSeconds = (intervalMs / 1000).toInt())) }
    }

    // ---------------------------------------------------------------- backend

    fun checkBackend() {
        viewModelScope.launch {
            _state.update { it.copy(backend = BackendUi.Checking) }
            applyHealth(client.call { health() })
        }
    }

    private fun applyHealth(result: ApiResult<HealthData>) {
        when (result) {
            is ApiResult.Success -> {
                val data = result.data
                data.locationUpdateIntervalSeconds?.let { serverIntervalSeconds = it }
                updateIntervalDisplay()
                _state.update {
                    it.copy(
                        backend = BackendUi.Online(
                            demoMode = data.demoMode == true,
                            storage = data.database?.storage ?: "unknown",
                            placesSimulated = data.places?.simulated == true,
                        ),
                    )
                }
            }
            is ApiResult.Failure -> _state.update { it.copy(backend = BackendUi.Offline(result.message)) }
        }
    }

    /** Used by the Settings dialog before saving. */
    suspend fun testConnection(url: String): String {
        val result = BackendClient(url).call { health() }
        return when (result) {
            is ApiResult.Success -> {
                val d = result.data
                "Connected · ${if (d.demoMode == true) "demo mode" else "live mode"} · storage: ${d.database?.storage ?: "?"}"
            }
            is ApiResult.Failure -> "Failed: ${result.message}"
        }
    }

    fun saveSettings(newSettings: AppSettings) {
        val urlChanged = newSettings.backendUrl != settings.backendUrl
        val demoChanged = newSettings.useDemoLocation != settings.useDemoLocation
        val intervalChanged = newSettings.intervalSecondsOverride != settings.intervalSecondsOverride
        settings = newSettings
        settingsStore.save(newSettings)
        _state.update { it.copy(useDemoLocation = newSettings.useDemoLocation, backendUrl = newSettings.backendUrl) }
        updateIntervalDisplay()

        if (urlChanged) {
            client = BackendClient(newSettings.backendUrl)
            // A session belongs to one backend; a new one is created on the next update.
            dropBackendSession()
            checkBackend()
        }
        if (demoChanged) {
            lastFix = null
            lastPlacesFix = null
            _state.update { it.copy(location = LocationUi.Idle, places = PlacesUi.Idle) }
            if (sessionId != null) dropBackendSession() // location source is fixed per session
        }
        if ((demoChanged || intervalChanged) && _state.value.session.running && inForeground) startLocationUpdates()
    }

    private fun dropBackendSession() {
        sessionId = null
        sessionToken = null
        nextSessionAttemptAt = 0L
        _state.update { it.copy(session = it.session.copy(sessionId = null, syncStatus = SyncStatus.CONNECTING)) }
    }

    // ---------------------------------------------------------------- session

    /**
     * Starts a camera session. The camera runs if [cameraGranted]; location is
     * synced if permission was granted (or demo location is enabled). The
     * session still starts if the backend is unreachable and keeps retrying.
     */
    fun startSession(cameraGranted: Boolean, locationGranted: Boolean, locationPermanentlyDenied: Boolean) {
        if (_state.value.session.running) return
        _state.update {
            it.copy(
                session = SessionUi(running = true, syncStatus = SyncStatus.CONNECTING, intervalSeconds = (intervalMs / 1000).toInt()),
                cameraStatus = if (cameraGranted) CameraStatus.STARTING else CameraStatus.PERMISSION_DENIED,
                cameraError = null,
            )
        }
        lastSentAt = 0L
        lastSentCameraActive = null
        lastPlacesFix = null

        if (settings.useDemoLocation || locationGranted) {
            startLocationUpdates()
        } else {
            val kind = if (locationPermanentlyDenied) LocationProblem.PERMISSION_PERMANENTLY_DENIED else LocationProblem.PERMISSION_DENIED
            _state.update { it.copy(location = LocationUi.Problem(kind, lastFix)) }
        }
        viewModelScope.launch { ensureBackendSession() }
    }

    fun stopSession() {
        if (!_state.value.session.running) return
        stopLocationUpdates()
        val id = sessionId
        val token = sessionToken
        sessionId = null
        sessionToken = null
        _state.update {
            it.copy(
                session = it.session.copy(running = false, sessionId = null, syncStatus = SyncStatus.IDLE, syncError = null),
                cameraStatus = CameraStatus.OFF,
                cameraError = null,
            )
        }
        if (id != null && token != null) {
            // Best effort: tell the backend the session ended, even if the UI moves on.
            viewModelScope.launch {
                val result = withContext(NonCancellable) {
                    withTimeoutOrNull(8_000) { client.call { stopSession(id, token) } }
                }
                if (result !is ApiResult.Success) emit("Session ended locally; the backend could not be notified")
            }
        }
    }

    private suspend fun ensureBackendSession(): Boolean = sessionMutex.withLock {
        if (sessionId != null) return true
        if (!_state.value.session.running) return false
        val now = System.currentTimeMillis()
        if (now < nextSessionAttemptAt) return false

        val request = CreateSessionRequest(
            deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(80),
            locationSource = if (settings.useDemoLocation) "demo" else "gps",
            cameraActive = currentCameraActive(),
            appVersion = BuildConfig.VERSION_NAME,
        )
        when (val result = client.call { createSession(request) }) {
            is ApiResult.Success -> {
                val id = result.data.sessionId
                val token = result.data.sessionToken
                if (id == null || token == null) {
                    nextSessionAttemptAt = now + RETRY_SESSION_MS
                    return false
                }
                if (!_state.value.session.running) {
                    // The user stopped while the request was in flight: close it right away.
                    client.call { stopSession(id, token) }
                    return false
                }
                sessionId = id
                sessionToken = token
                result.data.locationUpdateIntervalSeconds?.let { serverIntervalSeconds = it }
                updateIntervalDisplay()
                _state.update {
                    it.copy(session = it.session.copy(sessionId = id, syncStatus = SyncStatus.SYNCING, syncError = null))
                }
                if (_state.value.backend !is BackendUi.Online) checkBackend()
                lastFix?.let { fix -> viewModelScope.launch { syncLocation(fix, force = true) } }
                true
            }
            is ApiResult.Failure -> {
                nextSessionAttemptAt = now + RETRY_SESSION_MS
                _state.update {
                    it.copy(
                        session = it.session.copy(syncStatus = SyncStatus.ERROR, syncError = result.message),
                        backend = if (result.isNetworkError) BackendUi.Offline(result.message) else it.backend,
                    )
                }
                false
            }
        }
    }

    private fun currentCameraActive(): Boolean = inForeground && _state.value.cameraStatus == CameraStatus.ACTIVE

    /** Posts a location/status update, throttled to the sync interval unless [force]d. */
    private suspend fun syncLocation(fix: LocationFix, force: Boolean = false) {
        if (!_state.value.session.running || syncInFlight) return
        val cameraActive = currentCameraActive()
        val now = System.currentTimeMillis()
        val due = now - lastSentAt >= intervalMs - THROTTLE_SLACK_MS
        if (!force && !due && cameraActive == lastSentCameraActive) return
        if (!ensureBackendSession()) return
        val id = sessionId ?: return
        val token = sessionToken ?: return

        syncInFlight = true
        try {
            val request = LocationUpdateRequest(
                sessionId = id,
                latitude = fix.latitude,
                longitude = fix.longitude,
                accuracy = fix.accuracyMeters?.toDouble(),
                cameraActive = cameraActive,
                timestamp = Instant.ofEpochMilli(minOf(fix.timeMillis, now)).toString(),
                source = fix.source.apiValue,
            )
            when (val result = client.call { sendLocation(token, request) }) {
                is ApiResult.Success -> {
                    lastSentAt = now
                    lastSentCameraActive = cameraActive
                    _state.update {
                        it.copy(
                            session = it.session.copy(
                                syncStatus = SyncStatus.SYNCING,
                                lastSyncAt = now,
                                syncError = null,
                                updatesSent = it.session.updatesSent + 1,
                            ),
                        )
                    }
                    if (_state.value.backend !is BackendUi.Online) checkBackend()
                }
                is ApiResult.Failure -> handleSyncFailure(result, id)
            }
        } finally {
            syncInFlight = false
        }
    }

    private fun handleSyncFailure(result: ApiResult.Failure, failedSessionId: String) {
        // Unknown/ended/unauthorised session (e.g. backend restarted in demo
        // mode): forget it so a fresh session is created on the next update.
        if (result.code in RECREATE_SESSION_CODES && sessionId == failedSessionId) {
            sessionId = null
            sessionToken = null
            nextSessionAttemptAt = 0L
        }
        _state.update {
            it.copy(
                session = it.session.copy(syncStatus = SyncStatus.ERROR, syncError = result.message),
                backend = if (result.isNetworkError) BackendUi.Offline(result.message) else it.backend,
            )
        }
    }

    /** Called by the Activity whenever the camera state changes. */
    fun onCameraStatus(status: CameraStatus, error: String?) {
        val previous = _state.value.cameraStatus
        _state.update { it.copy(cameraStatus = status, cameraError = error) }
        val wasActive = previous == CameraStatus.ACTIVE
        val isActive = status == CameraStatus.ACTIVE
        if (wasActive != isActive && _state.value.session.running) {
            lastFix?.let { fix -> viewModelScope.launch { syncLocation(fix, force = true) } }
        }
    }

    // ---------------------------------------------------------------- live view

    fun setShareLiveView(enabled: Boolean) {
        if (enabled == _state.value.liveView.enabled) return
        settingsStore.shareLiveView = enabled
        framesSentTotal.set(0)
        framesAtLastStats = 0
        frameError = null
        _state.update { it.copy(liveView = LiveViewUi(enabled = enabled)) }
    }

    /**
     * Called from the camera analysis thread with one JPEG frame (~15 per
     * second). Up to [MAX_FRAMES_IN_FLIGHT] uploads overlap so network latency
     * does not cap the frame rate; beyond that frames are dropped, never
     * queued. UI state is refreshed at most twice a second to keep the preview
     * smooth.
     */
    fun onLiveFrame(jpeg: ByteArray, rotationDegrees: Int) {
        val current = _state.value
        if (!current.liveView.enabled || !current.session.running || !inForeground) return
        val id = sessionId ?: return
        val token = sessionToken ?: return
        if (framesInFlight.incrementAndGet() > MAX_FRAMES_IN_FLIGHT) {
            framesInFlight.decrementAndGet()
            return
        }
        // Capture order: lets the backend discard a frame that overtook a newer one.
        val seq = frameSeq.incrementAndGet()
        viewModelScope.launch {
            try {
                val body = jpeg.toRequestBody(JPEG_MEDIA_TYPE)
                when (val result = client.call { uploadFrame(id, token, seq, rotationDegrees, body) }) {
                    is ApiResult.Success -> {
                        framesSentTotal.incrementAndGet()
                        frameError = null
                    }
                    is ApiResult.Failure -> frameError = result.message
                }
                publishLiveViewStats()
            } finally {
                framesInFlight.decrementAndGet()
            }
        }
    }

    private fun publishLiveViewStats() {
        val now = System.currentTimeMillis()
        val elapsed = now - lastStatsAt
        if (elapsed < LIVE_STATS_INTERVAL_MS && frameError == null) return
        val total = framesSentTotal.get()
        val fps = if (elapsed > 0) ((total - framesAtLastStats) * 1000f / elapsed) else 0f
        lastStatsAt = now
        framesAtLastStats = total
        _state.update {
            it.copy(
                liveView = it.liveView.copy(
                    framesSent = total,
                    fps = fps,
                    lastFrameAt = if (frameError == null) now else it.liveView.lastFrameAt,
                    error = frameError,
                ),
            )
        }
    }

    // ---------------------------------------------------------------- lifecycle

    fun onForeground() {
        inForeground = true
        if (_state.value.session.running && locationJob?.isActive != true) startLocationUpdates()
        refreshLocationProblem()
    }

    /** No background tracking: stop updates and report that the camera is no longer active. */
    fun onBackground() {
        inForeground = false
        stopLocationUpdates()
        val fix = lastFix
        if (_state.value.session.running && fix != null) {
            viewModelScope.launch { syncLocation(fix, force = true) }
        }
    }

    /** Re-evaluates a permission/GPS problem after returning from system settings. */
    private fun refreshLocationProblem() {
        val current = _state.value.location
        if (current !is LocationUi.Problem || settings.useDemoLocation) return
        if (locationRepo.hasAnyPermission() && locationRepo.isLocationEnabled()) {
            if (_state.value.session.running) startLocationUpdates() else locate()
        }
    }

    fun onLocationPermissionResult(granted: Boolean, permanentlyDenied: Boolean) {
        if (granted) {
            if (_state.value.session.running) startLocationUpdates() else locate()
        } else {
            val kind = if (permanentlyDenied) LocationProblem.PERMISSION_PERMANENTLY_DENIED else LocationProblem.PERMISSION_DENIED
            _state.update { it.copy(location = LocationUi.Problem(kind, lastFix)) }
        }
    }

    // ---------------------------------------------------------------- location

    fun retryLocation() {
        if (_state.value.session.running) startLocationUpdates() else locate()
    }

    private fun startLocationUpdates() {
        stopLocationUpdates()
        if (!settings.useDemoLocation) {
            if (!locationRepo.hasAnyPermission()) {
                _state.update { it.copy(location = LocationUi.Problem(LocationProblem.PERMISSION_DENIED, lastFix)) }
                return
            }
            if (!locationRepo.isLocationEnabled()) {
                _state.update { it.copy(location = LocationUi.Problem(LocationProblem.SERVICES_DISABLED, lastFix)) }
                return
            }
        }
        if (_state.value.location !is LocationUi.Ready) _state.update { it.copy(location = LocationUi.Acquiring) }

        val flow = if (settings.useDemoLocation) demoProvider.updates(intervalMs) else locationRepo.updates(intervalMs)
        locationJob = viewModelScope.launch {
            flow.catch {
                _state.update { it.copy(location = LocationUi.Problem(LocationProblem.UNAVAILABLE, lastFix)) }
            }.collect { event ->
                when (event) {
                    is LocationEvent.Fix -> onFix(event.fix)
                    is LocationEvent.Availability -> onAvailability(event.available)
                }
            }
        }
    }

    private fun stopLocationUpdates() {
        locationJob?.cancel()
        locationJob = null
    }

    private fun onAvailability(available: Boolean) {
        val current = _state.value.location
        if (!available && !locationRepo.isLocationEnabled() && !settings.useDemoLocation) {
            _state.update { it.copy(location = LocationUi.Problem(LocationProblem.SERVICES_DISABLED, lastFix)) }
        } else if (current is LocationUi.Ready) {
            _state.update { it.copy(location = current.copy(waitingForSignal = !available)) }
        }
    }

    private suspend fun onFix(fix: LocationFix) {
        lastFix = fix
        _state.update { it.copy(location = LocationUi.Ready(fix)) }
        if (_state.value.session.running) {
            syncLocation(fix)
            maybeAutoRefreshPlaces(fix)
        }
    }

    /** One-shot "Locate" button. Never substitutes a fake position on failure. */
    fun locate() {
        if (settings.useDemoLocation) {
            val fix = demoProvider.next()
            viewModelScope.launch { onFix(fix) }
            if (_state.value.places is PlacesUi.Idle) refreshPlaces()
            return
        }
        if (!locationRepo.hasAnyPermission()) {
            _state.update { it.copy(location = LocationUi.Problem(LocationProblem.PERMISSION_DENIED, lastFix)) }
            return
        }
        if (!locationRepo.isLocationEnabled()) {
            _state.update { it.copy(location = LocationUi.Problem(LocationProblem.SERVICES_DISABLED, lastFix)) }
            return
        }
        viewModelScope.launch {
            if (_state.value.location !is LocationUi.Ready) _state.update { it.copy(location = LocationUi.Acquiring) }
            val fix = try {
                locationRepo.currentLocation()
            } catch (e: SecurityException) {
                null
            } catch (e: IllegalStateException) {
                null
            }
            if (fix == null) {
                _state.update { it.copy(location = LocationUi.Problem(LocationProblem.UNAVAILABLE, lastFix)) }
                return@launch
            }
            onFix(fix)
            if (_state.value.places is PlacesUi.Idle || !_state.value.session.running) refreshPlaces()
        }
    }

    // ---------------------------------------------------------------- places

    fun setCategory(category: String) {
        if (category == _state.value.category) return
        _state.update { it.copy(category = category) }
        if (lastFix != null) refreshPlaces()
    }

    private fun maybeAutoRefreshPlaces(fix: LocationFix) {
        val previous = lastPlacesFix
        val moved = previous?.let { Geo.distanceMeters(it.latitude, it.longitude, fix.latitude, fix.longitude) }
        if (previous == null || (moved != null && moved >= AUTO_REFRESH_DISTANCE_M)) refreshPlaces()
    }

    fun refreshPlaces() {
        val fix = lastFix
        if (fix == null) {
            emit("Location needed first — tap Locate or start a session")
            return
        }
        lastPlacesFix = fix
        placesJob?.cancel()
        val previous = currentPlaces()
        _state.update { it.copy(places = PlacesUi.Loading(previous)) }
        placesJob = viewModelScope.launch {
            val category = _state.value.category
            val radius = settings.radiusMeters
            var result = searchNearby(fix, radius, category, attachToSession = true)
            if (result is ApiResult.Failure && result.code in RECREATE_SESSION_CODES) {
                sessionId = null
                sessionToken = null
                nextSessionAttemptAt = 0L
                result = searchNearby(fix, radius, category, attachToSession = false)
            }
            when (result) {
                is ApiResult.Success -> {
                    val data = result.data
                    _state.update {
                        it.copy(
                            places = PlacesUi.Loaded(
                                places = data.toPlaces(),
                                simulated = data.simulated == true,
                                attribution = data.attribution,
                                radius = data.radius ?: radius,
                                fetchedAt = System.currentTimeMillis(),
                            ),
                        )
                    }
                }
                is ApiResult.Failure -> {
                    _state.update { it.copy(places = PlacesUi.Error(result.message, previous)) }
                    // A slow place search timing out does not mean the backend is down.
                    if (result.isNetworkError && result.code != "TIMEOUT") _state.update { it.copy(backend = BackendUi.Offline(result.message)) }
                }
            }
        }
    }

    private suspend fun searchNearby(fix: LocationFix, radius: Int, category: String, attachToSession: Boolean): ApiResult<NearbyData> {
        // Attaching results to the session lets the dashboard show them; it needs the session token.
        val id = if (attachToSession) sessionId else null
        val token = if (id != null) sessionToken else null
        val request = NearbyRequest(fix.latitude, fix.longitude, radius, category, if (token != null) id else null)
        return client.call(slow = true) { nearbyPlaces(token, request) }
    }

    private fun currentPlaces(): List<Place> = when (val p = _state.value.places) {
        is PlacesUi.Loaded -> p.places
        is PlacesUi.Loading -> p.previous
        is PlacesUi.Error -> p.previous
        PlacesUi.Idle -> emptyList()
    }

    private fun NearbyData.toPlaces(): List<Place> = places.orEmpty().mapNotNull { dto ->
        val lat = dto.latitude ?: return@mapNotNull null
        val lng = dto.longitude ?: return@mapNotNull null
        Place(
            id = dto.id ?: "$lat,$lng",
            name = dto.name ?: "Unnamed place",
            category = dto.category ?: "Place",
            address = dto.address,
            latitude = lat,
            longitude = lng,
            distanceMeters = dto.distanceMeters,
            mapsUri = dto.mapsUri,
            simulated = dto.simulated == true || dto.source == "demo",
        )
    }

    override fun onCleared() {
        stopLocationUpdates()
        super.onCleared()
    }

    companion object {
        private val JPEG_MEDIA_TYPE = "image/jpeg".toMediaType()
        private const val MAX_FRAMES_IN_FLIGHT = 4
        private const val LIVE_STATS_INTERVAL_MS = 500L
        private const val RETRY_SESSION_MS = 10_000L
        private const val THROTTLE_SLACK_MS = 300L
        private const val AUTO_REFRESH_DISTANCE_M = 150.0
        private val RECREATE_SESSION_CODES = setOf("SESSION_NOT_FOUND", "SESSION_INACTIVE", "UNAUTHORIZED", "FORBIDDEN")
    }
}
