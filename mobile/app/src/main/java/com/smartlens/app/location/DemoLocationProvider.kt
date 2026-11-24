package com.smartlens.app.location

import com.smartlens.app.util.Geo
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Emulator demonstration aid. Emits clearly labelled DEMO coordinates that
 * slowly circle a fixed point, so the dashboard shows movement. It is only
 * used when the user explicitly enables "Use demo location" in Settings and
 * is never used as a silent fallback for a missing GPS fix.
 */
class DemoLocationProvider(
    private val centerLat: Double,
    private val centerLng: Double,
    private val radiusMeters: Double = 120.0,
    private val stepsPerLoop: Int = 40,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private var step = 0

    fun next(): LocationFix {
        val bearing = (step % stepsPerLoop) * 360.0 / stepsPerLoop
        step += 1
        val (lat, lng) = Geo.offset(centerLat, centerLng, radiusMeters, bearing)
        return LocationFix(
            latitude = lat,
            longitude = lng,
            accuracyMeters = 10f,
            timeMillis = clock(),
            source = FixSource.DEMO,
        )
    }

    fun updates(intervalMs: Long): Flow<LocationEvent> = flow {
        emit(LocationEvent.Availability(true))
        while (true) {
            emit(LocationEvent.Fix(next()))
            delay(intervalMs)
        }
    }
}
