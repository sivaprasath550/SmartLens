package com.smartlens.app

import com.smartlens.app.location.DemoLocationProvider
import com.smartlens.app.location.FixSource
import com.smartlens.app.util.Format
import com.smartlens.app.util.Geo
import com.smartlens.app.util.UrlUtils
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UtilsTest {
    @Test
    fun normalizesBackendUrls() {
        assertEquals("http://10.0.2.2:3000/", UrlUtils.normalizeBaseUrl("http://10.0.2.2:3000"))
        assertEquals("http://192.168.1.20:3000/", UrlUtils.normalizeBaseUrl("  http://192.168.1.20:3000/ "))
        assertEquals("http://192.168.1.20:3000/", UrlUtils.normalizeBaseUrl("http://192.168.1.20:3000/api/health"))
        assertEquals("https://api.example.com/", UrlUtils.normalizeBaseUrl("https://api.example.com"))
        assertNull(UrlUtils.normalizeBaseUrl(""))
        assertNull(UrlUtils.normalizeBaseUrl("192.168.1.20:3000"))
        assertNull(UrlUtils.normalizeBaseUrl("ftp://host/"))
        assertNull(UrlUtils.normalizeBaseUrl("http://bad host/"))
    }

    @Test
    fun computesDistancesAndOffsets() {
        val (lat, lng) = Geo.offset(12.823, 80.0444, 500.0, 90.0)
        val distance = Geo.distanceMeters(12.823, 80.0444, lat, lng)
        assertEquals(500.0, distance, 0.5)
        assertEquals(0.0, Geo.distanceMeters(1.0, 1.0, 1.0, 1.0), 0.0001)
    }

    @Test
    fun formatsValues() {
        assertEquals("12.823000° N", Format.coordinate(12.823, true))
        assertEquals("80.044400° W", Format.coordinate(-80.0444, false))
        assertEquals("250 m", Format.distance(249.6))
        assertEquals("1.50 km", Format.distance(1500.0))
        assertEquals("—", Format.distance(null))
        assertEquals("± 8.5 m", Format.accuracy(8.5f))
        assertEquals("± 120 m", Format.accuracy(120f))
        assertEquals("accuracy unknown", Format.accuracy(null))
        assertEquals("just now", Format.age(1000, 2000))
        assertEquals("30 s ago", Format.age(0, 30_000))
        assertEquals("2 min ago", Format.age(0, 125_000))
    }

    @Test
    fun demoProviderEmitsLabelledPointsNearCentre() {
        val provider = DemoLocationProvider(12.823, 80.0444, radiusMeters = 120.0, clock = { 42L })
        repeat(5) {
            val fix = provider.next()
            assertEquals(FixSource.DEMO, fix.source)
            assertEquals(42L, fix.timeMillis)
            val d = Geo.distanceMeters(12.823, 80.0444, fix.latitude, fix.longitude)
            assertTrue("demo point should be ~120 m from centre, was $d", kotlin.math.abs(d - 120.0) < 1.0)
        }
    }
}
