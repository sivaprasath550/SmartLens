package com.smartlens.app.ui

import com.smartlens.app.camera.CameraStatus
import com.smartlens.app.location.LocationFix

data class Place(
    val id: String,
    val name: String,
    val category: String,
    val address: String?,
    val latitude: Double,
    val longitude: Double,
    val distanceMeters: Double?,
    val mapsUri: String?,
    val simulated: Boolean,
)

enum class LocationProblem { PERMISSION_DENIED, PERMISSION_PERMANENTLY_DENIED, SERVICES_DISABLED, UNAVAILABLE }

sealed interface LocationUi {
    data object Idle : LocationUi

    data object Acquiring : LocationUi

    /** [waitingForSignal] = the provider currently reports no location (e.g. indoors). */
    data class Ready(val fix: LocationFix, val waitingForSignal: Boolean = false) : LocationUi

    data class Problem(val kind: LocationProblem, val lastFix: LocationFix? = null) : LocationUi
}

sealed interface BackendUi {
    data object Unknown : BackendUi

    data object Checking : BackendUi

    data class Online(val demoMode: Boolean, val storage: String, val placesSimulated: Boolean) : BackendUi

    data class Offline(val message: String) : BackendUi
}

enum class SyncStatus { IDLE, CONNECTING, SYNCING, ERROR }

data class SessionUi(
    val running: Boolean = false,
    val sessionId: String? = null,
    val syncStatus: SyncStatus = SyncStatus.IDLE,
    val lastSyncAt: Long? = null,
    val syncError: String? = null,
    val updatesSent: Int = 0,
    val intervalSeconds: Int = 5,
)

sealed interface PlacesUi {
    data object Idle : PlacesUi

    data class Loading(val previous: List<Place>) : PlacesUi

    data class Loaded(
        val places: List<Place>,
        val simulated: Boolean,
        val attribution: String?,
        val radius: Int,
        val fetchedAt: Long,
    ) : PlacesUi

    data class Error(val message: String, val previous: List<Place>) : PlacesUi
}

/** Opt-in live view: the camera preview shared with the dashboard as JPEG frames. */
data class LiveViewUi(
    val enabled: Boolean = false,
    val framesSent: Int = 0,
    val fps: Float = 0f,
    val lastFrameAt: Long? = null,
    val error: String? = null,
)

data class MainUiState(
    val cameraStatus: CameraStatus = CameraStatus.OFF,
    val cameraError: String? = null,
    val location: LocationUi = LocationUi.Idle,
    val backend: BackendUi = BackendUi.Unknown,
    val session: SessionUi = SessionUi(),
    val places: PlacesUi = PlacesUi.Idle,
    val category: String = "all",
    val useDemoLocation: Boolean = false,
    val backendUrl: String = "",
    val liveView: LiveViewUi = LiveViewUi(),
)

sealed interface UiEvent {
    data class Message(val text: String) : UiEvent
}
