package com.smartlens.app.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import android.os.CancellationSignal
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Foreground location access. Uses the Google Play services Fused Location
 * Provider when available and falls back to the platform LocationManager on
 * devices without Play services. No background location is requested.
 */
class LocationRepository(private val context: Context) {
    private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    private val playServicesAvailable: Boolean by lazy {
        GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
    }

    private val fused by lazy { LocationServices.getFusedLocationProviderClient(context) }

    fun hasFinePermission() = granted(Manifest.permission.ACCESS_FINE_LOCATION)

    fun hasAnyPermission() = hasFinePermission() || granted(Manifest.permission.ACCESS_COARSE_LOCATION)

    fun isLocationEnabled(): Boolean = LocationManagerCompat.isLocationEnabled(locationManager)

    val providerName: String get() = if (playServicesAvailable) "Fused" else "Platform"

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun Location.toFix(): LocationFix = LocationFix(
        latitude = latitude,
        longitude = longitude,
        accuracyMeters = if (hasAccuracy()) accuracy else null,
        timeMillis = time,
        source = if (provider == LocationManager.NETWORK_PROVIDER) FixSource.NETWORK else FixSource.GPS,
        approximate = !hasFinePermission(),
    )

    /** Continuous updates while collected. Collection must stop when the UI is not visible. */
    @SuppressLint("MissingPermission")
    fun updates(intervalMs: Long): Flow<LocationEvent> =
        if (playServicesAvailable) fusedUpdates(intervalMs) else platformUpdates(intervalMs)

    @SuppressLint("MissingPermission")
    private fun fusedUpdates(intervalMs: Long): Flow<LocationEvent> = callbackFlow {
        check(hasAnyPermission()) { "Location permission not granted" }
        val priority = if (hasFinePermission()) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
        val request = LocationRequest.Builder(priority, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs / 2)
            .setWaitForAccurateLocation(false)
            .build()
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { trySend(LocationEvent.Fix(it.toFix())) }
            }

            override fun onLocationAvailability(availability: LocationAvailability) {
                trySend(LocationEvent.Availability(availability.isLocationAvailable))
            }
        }
        fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
            .addOnFailureListener { close(it) }
        awaitClose { fused.removeLocationUpdates(callback) }
    }

    @SuppressLint("MissingPermission")
    private fun platformUpdates(intervalMs: Long): Flow<LocationEvent> = callbackFlow {
        check(hasAnyPermission()) { "Location permission not granted" }
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                trySend(LocationEvent.Fix(location.toFix()))
            }

            override fun onProviderDisabled(provider: String) {
                trySend(LocationEvent.Availability(isLocationEnabled()))
            }

            override fun onProviderEnabled(provider: String) {
                trySend(LocationEvent.Availability(true))
            }
        }
        val providers = buildList {
            if (hasFinePermission() && locationManager.allProviders.contains(LocationManager.GPS_PROVIDER)) {
                add(LocationManager.GPS_PROVIDER)
            }
            if (locationManager.allProviders.contains(LocationManager.NETWORK_PROVIDER)) {
                add(LocationManager.NETWORK_PROVIDER)
            }
        }
        if (providers.isEmpty()) {
            trySend(LocationEvent.Availability(false))
        }
        providers.forEach { provider ->
            locationManager.requestLocationUpdates(provider, intervalMs, 0f, listener, Looper.getMainLooper())
        }
        awaitClose { locationManager.removeUpdates(listener) }
    }

    /** One-shot current position, or null if none could be obtained within [timeoutMs]. */
    @SuppressLint("MissingPermission")
    suspend fun currentLocation(timeoutMs: Long = 15_000): LocationFix? {
        if (!hasAnyPermission()) return null
        return withTimeoutOrNull(timeoutMs) {
            if (playServicesAvailable) {
                val cts = CancellationTokenSource()
                try {
                    val request = CurrentLocationRequest.Builder()
                        .setPriority(
                            if (hasFinePermission()) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY,
                        )
                        .setMaxUpdateAgeMillis(10_000)
                        .setDurationMillis(timeoutMs)
                        .build()
                    fused.getCurrentLocation(request, cts.token).await()?.toFix()
                } finally {
                    cts.cancel()
                }
            } else {
                platformCurrentLocation()
            }
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun platformCurrentLocation(): LocationFix? {
        val provider = when {
            hasFinePermission() && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> return null
        }
        return suspendCancellableCoroutine { continuation ->
            val signal = CancellationSignal()
            continuation.invokeOnCancellation { signal.cancel() }
            LocationManagerCompat.getCurrentLocation(
                locationManager,
                provider,
                signal,
                ContextCompat.getMainExecutor(context),
            ) { location -> if (continuation.isActive) continuation.resume(location?.toFix()) }
        }
    }
}
