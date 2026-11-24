package com.smartlens.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.chip.Chip
import com.google.android.material.snackbar.Snackbar
import com.smartlens.app.camera.CameraController
import com.smartlens.app.camera.CameraStatus
import com.smartlens.app.databinding.ActivityMainBinding
import com.smartlens.app.location.FixSource
import com.smartlens.app.ui.BackendUi
import com.smartlens.app.ui.LocationProblem
import com.smartlens.app.ui.LocationUi
import com.smartlens.app.ui.MainUiState
import com.smartlens.app.ui.MainViewModel
import com.smartlens.app.ui.Place
import com.smartlens.app.ui.PlacesAdapter
import com.smartlens.app.ui.PlacesUi
import com.smartlens.app.ui.SettingsDialog
import com.smartlens.app.ui.SyncStatus
import com.smartlens.app.ui.UiEvent
import com.smartlens.app.util.Format
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private lateinit var camera: CameraController
    private val viewModel: MainViewModel by viewModels()
    private val placesAdapter = PlacesAdapter(::onPlaceClicked)

    private enum class PendingAction { START_SESSION, LOCATE, CAMERA }

    private var pendingAction: PendingAction? = null
    private var cameraPermanentlyDenied = false
    private var lastSessionRunning = false

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { onPermissionsResult() }

    private val categories = listOf(
        "all" to R.string.category_all,
        "food" to R.string.category_food,
        "cafe" to R.string.category_cafe,
        "attractions" to R.string.category_attractions,
        "shopping" to R.string.category_shopping,
        "transit" to R.string.category_transit,
        "health" to R.string.category_health,
        "education" to R.string.category_education,
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        camera = CameraController(this, this, binding.previewView) { status, error ->
            viewModel.onCameraStatus(status, error)
        }

        binding.recyclerPlaces.layoutManager = LinearLayoutManager(this)
        binding.recyclerPlaces.adapter = placesAdapter
        setupCategoryChips()
        setupClicks()

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                // Re-render every second as well, so "x s ago" labels stay current.
                val ticker = flow {
                    while (true) {
                        emit(System.currentTimeMillis())
                        delay(1000)
                    }
                }
                launch { viewModel.state.combine(ticker) { state, now -> state to now }.collect { (s, now) -> render(s, now) } }
                launch {
                    viewModel.events.collect { event ->
                        if (event is UiEvent.Message) Snackbar.make(binding.root, event.text, Snackbar.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        viewModel.onForeground()
        // Permission may have been granted from system settings while we were away.
        if (viewModel.state.value.session.running && hasCameraPermission() && !camera.isStarted) camera.start()
    }

    override fun onStop() {
        viewModel.onBackground()
        super.onStop()
    }

    override fun onDestroy() {
        camera.release()
        super.onDestroy()
    }

    // ------------------------------------------------------------------ setup

    private fun setupClicks() {
        binding.btnSettings.setOnClickListener { SettingsDialog.show(this, viewModel) }
        binding.btnSession.setOnClickListener { onSessionButton() }
        binding.btnLocate.setOnClickListener { onLocateButton() }
        binding.btnRefreshPlaces.setOnClickListener { viewModel.refreshPlaces() }
        binding.btnPlacesRetry.setOnClickListener { viewModel.refreshPlaces() }
        binding.chipBackend.setOnClickListener { viewModel.checkBackend() }
        binding.btnCapture.setOnClickListener { capturePhoto() }
        binding.btnCameraAction.setOnClickListener { onCameraAction() }
        binding.btnLocationAction.setOnClickListener { onLocationAction() }
        binding.switchLiveView.setOnCheckedChangeListener { _, checked -> viewModel.setShareLiveView(checked) }
    }

    private fun setupCategoryChips() {
        categories.forEach { (key, label) ->
            val chip = Chip(this, null, com.google.android.material.R.attr.chipStyle).apply {
                id = View.generateViewId()
                tag = key
                text = getString(label)
                isCheckable = true
                isCheckedIconVisible = false
                isChecked = key == viewModel.state.value.category
                chipBackgroundColor = ContextCompat.getColorStateList(this@MainActivity, R.color.chip_category_bg)
                setTextColor(ContextCompat.getColorStateList(this@MainActivity, R.color.chip_category_text))
                chipStrokeColor = ColorStateList.valueOf(ContextCompat.getColor(this@MainActivity, R.color.sl_border))
            }
            binding.categoryChips.addView(chip)
        }
        binding.categoryChips.setOnCheckedStateChangeListener { group, checkedIds ->
            val key = checkedIds.firstOrNull()?.let { group.findViewById<Chip>(it)?.tag as? String } ?: return@setOnCheckedStateChangeListener
            viewModel.setCategory(key)
        }
    }

    // ------------------------------------------------------------ permissions

    private fun hasCameraPermission() = granted(Manifest.permission.CAMERA)

    private fun hasLocationPermission() =
        granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private val locationPermissions = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

    private fun onSessionButton() {
        if (viewModel.state.value.session.running) {
            viewModel.stopSession()
            return
        }
        val needed = buildList {
            if (!hasCameraPermission()) add(Manifest.permission.CAMERA)
            if (!viewModel.currentSettings.useDemoLocation && !hasLocationPermission()) addAll(locationPermissions)
        }
        if (needed.isEmpty()) {
            viewModel.startSession(cameraGranted = true, locationGranted = true, locationPermanentlyDenied = false)
        } else {
            pendingAction = PendingAction.START_SESSION
            permissionLauncher.launch(needed.toTypedArray())
        }
    }

    private fun onLocateButton() {
        if (viewModel.currentSettings.useDemoLocation || hasLocationPermission()) {
            viewModel.locate()
        } else {
            pendingAction = PendingAction.LOCATE
            permissionLauncher.launch(locationPermissions)
        }
    }

    private fun onPermissionsResult() {
        val action = pendingAction
        pendingAction = null
        val cameraOk = hasCameraPermission()
        val locationOk = hasLocationPermission()
        // After a denial, "no rationale" means the user chose "Don't ask again".
        val locationPermanentlyDenied = !locationOk && !shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)
        if (!cameraOk) cameraPermanentlyDenied = !shouldShowRequestPermissionRationale(Manifest.permission.CAMERA)

        when (action) {
            PendingAction.START_SESSION ->
                viewModel.startSession(cameraOk, locationOk || viewModel.currentSettings.useDemoLocation, locationPermanentlyDenied)
            PendingAction.LOCATE -> viewModel.onLocationPermissionResult(locationOk, locationPermanentlyDenied)
            PendingAction.CAMERA -> if (cameraOk && viewModel.state.value.session.running) camera.start()
            null -> Unit
        }
    }

    private fun onCameraAction() {
        when (viewModel.state.value.cameraStatus) {
            CameraStatus.PERMISSION_DENIED -> if (cameraPermanentlyDenied) {
                openAppSettings()
            } else {
                pendingAction = PendingAction.CAMERA
                permissionLauncher.launch(arrayOf(Manifest.permission.CAMERA))
            }
            CameraStatus.ERROR -> {
                camera.stop()
                if (viewModel.state.value.session.running) camera.start()
            }
            else -> Unit
        }
    }

    private fun onLocationAction() {
        when (val location = viewModel.state.value.location) {
            is LocationUi.Problem -> when (location.kind) {
                LocationProblem.PERMISSION_DENIED -> {
                    pendingAction = PendingAction.LOCATE
                    permissionLauncher.launch(locationPermissions)
                }
                LocationProblem.PERMISSION_PERMANENTLY_DENIED -> openAppSettings()
                LocationProblem.SERVICES_DISABLED -> safeStart(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
                LocationProblem.UNAVAILABLE -> viewModel.retryLocation()
            }
            else -> Unit
        }
    }

    private fun openAppSettings() {
        safeStart(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
    }

    private fun safeStart(intent: Intent): Boolean = try {
        startActivity(intent)
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    // ---------------------------------------------------------------- actions

    private fun capturePhoto() {
        binding.btnCapture.isEnabled = false
        camera.capturePhoto { result ->
            binding.btnCapture.isEnabled = true
            val message = result.fold(
                onSuccess = { "Photo saved on this device (Pictures/SmartLens). It is not uploaded." },
                onFailure = { "Could not capture photo: ${it.message ?: "unknown error"}" },
            )
            Snackbar.make(binding.root, message, Snackbar.LENGTH_LONG).show()
        }
    }

    private fun onPlaceClicked(place: Place) {
        if (place.simulated) {
            Snackbar.make(binding.root, "${place.name} is a simulated demo place, not a real location.", Snackbar.LENGTH_LONG).show()
            return
        }
        val uri = place.mapsUri?.let(Uri::parse)
            ?: Uri.parse("geo:${place.latitude},${place.longitude}?q=${place.latitude},${place.longitude}(${Uri.encode(place.name)})")
        if (!safeStart(Intent(Intent.ACTION_VIEW, uri))) {
            Snackbar.make(binding.root, "No maps app available", Snackbar.LENGTH_SHORT).show()
        }
    }

    // ---------------------------------------------------------------- render

    private fun render(state: MainUiState, now: Long) {
        driveCamera(state)
        renderCamera(state)
        renderSessionControls(state)
        renderChips(state, now)
        renderLocation(state, now)
        renderPlaces(state, now)
        renderLiveView(state, now)
    }

    private fun renderLiveView(state: MainUiState, now: Long) {
        val live = state.liveView
        if (binding.switchLiveView.isChecked != live.enabled) binding.switchLiveView.isChecked = live.enabled
        val sharing = live.enabled && state.session.running && state.cameraStatus == CameraStatus.ACTIVE
        binding.sharingBadge.isVisible = sharing && live.lastFrameAt != null
        binding.textLiveView.text = when {
            !live.enabled -> getString(R.string.live_view_off)
            live.error != null && state.session.running -> getString(R.string.live_view_error, live.error)
            sharing && live.lastFrameAt != null ->
                getString(R.string.live_view_sharing, live.fps.roundToInt(), live.framesSent)
            else -> getString(R.string.live_view_waiting)
        }
    }

    /** Starts the camera when a session starts and stops it when the session ends. */
    private fun driveCamera(state: MainUiState) {
        val running = state.session.running
        if (running && !lastSessionRunning && hasCameraPermission() && !camera.isStarted) camera.start()
        if (!running && camera.isStarted) camera.stop()
        lastSessionRunning = running
        // Frames are only encoded while live view is on and a session is running.
        val wantFrames = running && state.liveView.enabled
        if (wantFrames && camera.frameListener == null) camera.frameListener = viewModel::onLiveFrame
        if (!wantFrames && camera.frameListener != null) camera.frameListener = null
    }

    private fun renderCamera(state: MainUiState) {
        val status = state.cameraStatus
        val showPreview = status == CameraStatus.ACTIVE
        binding.cameraPlaceholder.isVisible = !showPreview
        binding.liveBadge.isVisible = showPreview
        binding.btnCapture.isVisible = showPreview
        binding.cameraProgress.isVisible = status == CameraStatus.STARTING
        binding.cameraPlaceholderIcon.isVisible = status != CameraStatus.STARTING

        val (title, body) = when (status) {
            CameraStatus.STARTING -> getString(R.string.camera_starting) to ""
            CameraStatus.PERMISSION_DENIED -> getString(R.string.camera_permission_title) to getString(R.string.camera_permission_body)
            CameraStatus.ERROR -> getString(R.string.camera_error_title) to (state.cameraError ?: "")
            CameraStatus.PAUSED -> getString(R.string.camera_starting) to ""
            else -> getString(R.string.camera_off_title) to getString(R.string.camera_off_body)
        }
        binding.cameraPlaceholderTitle.text = title
        binding.cameraPlaceholderBody.text = body
        binding.cameraPlaceholderBody.isVisible = body.isNotEmpty()

        binding.btnCameraAction.isVisible = status == CameraStatus.PERMISSION_DENIED || status == CameraStatus.ERROR
        binding.btnCameraAction.text = when {
            status == CameraStatus.ERROR -> getString(R.string.retry)
            cameraPermanentlyDenied -> getString(R.string.open_app_settings)
            else -> getString(R.string.grant_permission)
        }
    }

    private fun renderSessionControls(state: MainUiState) {
        val running = state.session.running
        binding.btnSession.text = getString(if (running) R.string.stop_session else R.string.start_session)
        binding.btnSession.setIconResource(if (running) R.drawable.ic_stop else R.drawable.ic_play)
        val bg = if (running) R.color.sl_error_container else R.color.sl_primary
        val fg = if (running) R.color.sl_error else R.color.sl_primary_ink
        binding.btnSession.backgroundTintList = ContextCompat.getColorStateList(this, bg)
        binding.btnSession.setTextColor(ContextCompat.getColor(this, fg))
        binding.btnSession.iconTint = ContextCompat.getColorStateList(this, fg)
        binding.btnRefreshPlaces.isEnabled = state.places !is PlacesUi.Loading
    }

    private fun renderChips(state: MainUiState, now: Long) {
        binding.chipCamera.text = getString(
            when (state.cameraStatus) {
                CameraStatus.ACTIVE -> R.string.chip_camera_active
                CameraStatus.STARTING, CameraStatus.PAUSED -> R.string.chip_camera_starting
                CameraStatus.PERMISSION_DENIED -> R.string.chip_camera_denied
                CameraStatus.ERROR -> R.string.chip_camera_error
                CameraStatus.OFF -> R.string.chip_camera_off
            },
        )
        binding.chipCamera.chipIconTint = tint(
            when (state.cameraStatus) {
                CameraStatus.ACTIVE -> R.color.sl_ok
                CameraStatus.PERMISSION_DENIED, CameraStatus.ERROR -> R.color.sl_error
                else -> R.color.sl_muted
            },
        )

        val backend = state.backend
        binding.chipBackend.text = getString(
            when (backend) {
                BackendUi.Checking -> R.string.chip_backend_checking
                is BackendUi.Online -> R.string.chip_backend_online
                is BackendUi.Offline -> R.string.chip_backend_offline
                BackendUi.Unknown -> R.string.chip_backend_unknown
            },
        )
        binding.chipBackend.setChipIconResource(if (backend is BackendUi.Offline) R.drawable.ic_cloud_off else R.drawable.ic_cloud)
        binding.chipBackend.chipIconTint = tint(
            when (backend) {
                is BackendUi.Online -> R.color.sl_ok
                is BackendUi.Offline -> R.color.sl_error
                else -> R.color.sl_muted
            },
        )
        binding.chipServerDemo.isVisible = backend is BackendUi.Online && backend.placesSimulated

        val session = state.session
        binding.chipSession.text = when {
            !session.running -> getString(R.string.chip_session_none)
            session.syncStatus == SyncStatus.SYNCING -> getString(R.string.chip_session_syncing)
            session.syncStatus == SyncStatus.ERROR -> getString(R.string.chip_session_error)
            else -> getString(R.string.chip_session_connecting)
        }
        binding.chipSession.chipIconTint = tint(
            when {
                !session.running -> R.color.sl_muted
                session.syncStatus == SyncStatus.SYNCING -> R.color.sl_ok
                session.syncStatus == SyncStatus.ERROR -> R.color.sl_error
                else -> R.color.sl_warn
            },
        )

        binding.syncDetail.isVisible = session.running || backend is BackendUi.Offline
        binding.syncDetail.text = when {
            session.running && session.syncStatus == SyncStatus.ERROR ->
                "Sync problem: ${session.syncError ?: "unknown"} — retrying automatically. Backend: ${state.backendUrl}"
            session.running && session.sessionId != null -> buildString {
                append("Session ").append(session.sessionId)
                append(" · ").append(session.updatesSent).append(" updates")
                session.lastSyncAt?.let { append(" · last sync ").append(Format.age(it, now)) }
                append(" · every ").append(session.intervalSeconds).append(" s")
            }
            session.running -> "Connecting to ${state.backendUrl}…"
            backend is BackendUi.Offline -> "Backend unreachable at ${state.backendUrl}: ${backend.message}. Tap the backend chip to retry."
            else -> ""
        }
    }

    private fun renderLocation(state: MainUiState, now: Long) {
        val location = state.location
        val fix = when (location) {
            is LocationUi.Ready -> location.fix
            is LocationUi.Problem -> location.lastFix
            else -> null
        }
        binding.textLatitude.text = fix?.let { Format.coordinate(it.latitude, true) } ?: "—"
        binding.textLongitude.text = fix?.let { Format.coordinate(it.longitude, false) } ?: "—"
        binding.badgeDemoLocation.isVisible = fix?.source == FixSource.DEMO || state.useDemoLocation
        binding.badgeApproximate.isVisible = fix?.approximate == true

        binding.textLocationMeta.text = when {
            fix != null -> buildString {
                append(Format.accuracy(fix.accuracyMeters))
                append(" · ").append(if (fix.source == FixSource.DEMO) "DEMO (simulated)" else fix.source.name)
                append(" · ").append(Format.age(fix.timeMillis, now))
            }
            location is LocationUi.Idle -> getString(R.string.location_idle)
            else -> ""
        }
        binding.textLocationMeta.isVisible = binding.textLocationMeta.text.isNotEmpty()

        val waiting = location is LocationUi.Ready && location.waitingForSignal
        binding.locationProgressRow.isVisible = location is LocationUi.Acquiring || waiting
        binding.textLocationProgress.setText(if (waiting) R.string.location_waiting_signal else R.string.location_acquiring)

        // Problems and quality warnings
        var note: String? = null
        var action: String? = null
        if (location is LocationUi.Problem) {
            when (location.kind) {
                LocationProblem.PERMISSION_DENIED -> {
                    note = getString(R.string.location_permission_denied); action = getString(R.string.grant_permission)
                }
                LocationProblem.PERMISSION_PERMANENTLY_DENIED -> {
                    note = getString(R.string.location_permission_permanently_denied); action = getString(R.string.open_app_settings)
                }
                LocationProblem.SERVICES_DISABLED -> {
                    note = getString(R.string.location_disabled); action = getString(R.string.open_location_settings)
                }
                LocationProblem.UNAVAILABLE -> {
                    note = getString(R.string.location_unavailable); action = getString(R.string.retry)
                }
            }
        } else if (fix != null) {
            val accuracy = fix.accuracyMeters
            val age = now - fix.timeMillis
            note = when {
                accuracy != null && accuracy > LOW_ACCURACY_M -> getString(R.string.low_accuracy_warning, Format.accuracy(accuracy))
                age > STALE_FIX_MS -> getString(R.string.stale_location_warning, Format.duration(age))
                else -> null
            }
        }
        binding.locationNote.isVisible = note != null
        binding.textLocationNote.text = note
        binding.btnLocationAction.isVisible = action != null
        binding.btnLocationAction.text = action
    }

    private fun renderPlaces(state: MainUiState, now: Long) {
        val places = state.places
        val list = when (places) {
            is PlacesUi.Loaded -> places.places
            is PlacesUi.Loading -> places.previous
            is PlacesUi.Error -> places.previous
            PlacesUi.Idle -> emptyList()
        }
        placesAdapter.submitList(list)
        binding.textPlacesCount.text = if (places is PlacesUi.Loaded) list.size.toString() else if (list.isEmpty()) "–" else list.size.toString()

        binding.textPlacesSource.isVisible = places is PlacesUi.Loaded
        if (places is PlacesUi.Loaded) {
            binding.textPlacesSource.setBackgroundResource(if (places.simulated) R.drawable.bg_note_demo else R.drawable.bg_note_info)
            val head = if (places.simulated) getString(R.string.places_simulated_note) else (places.attribution ?: "Live results")
            binding.textPlacesSource.text = "$head · radius ${places.radius} m · ${Format.age(places.fetchedAt, now)}"
        }

        val categoryChip = binding.categoryChips.findViewWithTag<Chip>(state.category)
        if (categoryChip != null && !categoryChip.isChecked) categoryChip.isChecked = true

        binding.placesProgress.isVisible = places is PlacesUi.Loading
        binding.btnPlacesRetry.isVisible = places is PlacesUi.Error
        val stateText = when (places) {
            PlacesUi.Idle -> getString(R.string.places_idle)
            is PlacesUi.Loading -> getString(R.string.places_loading)
            is PlacesUi.Error -> "Could not load places: ${places.message}"
            is PlacesUi.Loaded -> if (places.places.isEmpty()) getString(R.string.places_empty, places.radius) else null
        }
        binding.textPlacesState.text = stateText
        binding.textPlacesState.isVisible = stateText != null
        binding.placesStateBox.isVisible = stateText != null || places is PlacesUi.Loading
    }

    private fun tint(colorRes: Int) = ColorStateList.valueOf(ContextCompat.getColor(this, colorRes))

    companion object {
        private const val LOW_ACCURACY_M = 100f
        private const val STALE_FIX_MS = 2 * 60 * 1000L
    }
}
