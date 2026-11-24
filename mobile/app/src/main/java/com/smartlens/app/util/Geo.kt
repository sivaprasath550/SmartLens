package com.smartlens.app.util

import java.util.Locale
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

object Geo {
    private const val EARTH_RADIUS_M = 6371008.8

    /** Great-circle distance in metres. Pure Kotlin so it is unit-testable off-device. */
    fun distanceMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2).pow(2) +
            cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLng / 2).pow(2)
        return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(a)))
    }

    /** Point reached by moving [meters] from a coordinate on [bearingDeg]. */
    fun offset(lat: Double, lng: Double, meters: Double, bearingDeg: Double): Pair<Double, Double> {
        val angular = meters / EARTH_RADIUS_M
        val bearing = Math.toRadians(bearingDeg)
        val lat1 = Math.toRadians(lat)
        val lng1 = Math.toRadians(lng)
        val lat2 = asin(sin(lat1) * cos(angular) + cos(lat1) * sin(angular) * cos(bearing))
        val lng2 = lng1 + kotlin.math.atan2(
            sin(bearing) * sin(angular) * cos(lat1),
            cos(angular) - sin(lat1) * sin(lat2),
        )
        return Math.toDegrees(lat2) to Math.toDegrees(lng2)
    }
}

object Format {
    fun coordinate(value: Double, isLatitude: Boolean): String {
        val hemisphere = if (isLatitude) {
            if (value >= 0) "N" else "S"
        } else {
            if (value >= 0) "E" else "W"
        }
        return String.format(Locale.US, "%.6f° %s", abs(value), hemisphere)
    }

    fun distance(meters: Double?): String = when {
        meters == null || meters.isNaN() -> "—"
        meters < 1000 -> "${meters.roundToInt()} m"
        meters < 10000 -> String.format(Locale.US, "%.2f km", meters / 1000)
        else -> String.format(Locale.US, "%.1f km", meters / 1000)
    }

    fun accuracy(meters: Float?): String = when {
        meters == null -> "accuracy unknown"
        meters < 10 -> String.format(Locale.US, "± %.1f m", meters)
        else -> "± ${meters.roundToInt()} m"
    }

    /** "just now", "12 s ago", "3 min ago", "2 h ago". */
    fun age(fromMillis: Long, nowMillis: Long): String {
        val seconds = ((nowMillis - fromMillis) / 1000).coerceAtLeast(0)
        return when {
            seconds < 5 -> "just now"
            seconds < 60 -> "$seconds s ago"
            seconds < 3600 -> "${seconds / 60} min ago"
            else -> "${seconds / 3600} h ago"
        }
    }

    fun duration(millis: Long): String {
        val seconds = millis / 1000
        return if (seconds < 120) "$seconds s" else "${seconds / 60} min"
    }
}
