package com.smartlens.app.location

enum class FixSource(val apiValue: String) {
    GPS("gps"),
    NETWORK("network"),
    DEMO("demo"),
}

/** One position reading. [approximate] is true when only coarse permission was granted. */
data class LocationFix(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float?,
    val timeMillis: Long,
    val source: FixSource,
    val approximate: Boolean = false,
)

sealed interface LocationEvent {
    data class Fix(val fix: LocationFix) : LocationEvent

    /** The provider reports whether a location can currently be determined. */
    data class Availability(val available: Boolean) : LocationEvent
}
