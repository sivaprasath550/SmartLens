package com.smartlens.app

import com.smartlens.app.data.api.ApiResult
import com.smartlens.app.data.api.BackendClient
import com.smartlens.app.data.api.LocationUpdateRequest
import com.smartlens.app.data.api.NearbyRequest
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Verifies the mobile client against the backend's documented response envelope. */
class BackendClientTest {
    private lateinit var server: MockWebServer
    private lateinit var client: BackendClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = BackendClient(server.url("/").toString())
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun json(code: Int, body: String) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun parsesSuccessfulLocationResponseAndSendsToken() = runTest {
        server.enqueue(
            json(
                201,
                """{"success":true,"data":{"sessionId":"ses_1","status":"active","updateCount":3,"receivedAt":"2026-10-29T06:30:00.000Z"},"meta":{"mode":"demo","storage":"memory"}}""",
            ),
        )
        val result = client.call {
            sendLocation("tok", LocationUpdateRequest("ses_1", 12.8, 80.0, 5.0, true, "2026-10-29T06:30:00Z", "gps"))
        }
        assertTrue(result is ApiResult.Success)
        val success = result as ApiResult.Success
        assertEquals(3, success.data.updateCount)
        assertEquals("demo", success.meta?.mode)

        val recorded = server.takeRequest()
        assertEquals("/api/location", recorded.path)
        assertEquals("tok", recorded.getHeader("X-Session-Token"))
        val body = recorded.body.readUtf8()
        assertTrue(body.contains("\"cameraActive\":true"))
        assertTrue(body.contains("\"source\":\"gps\""))
    }

    @Test
    fun parsesErrorEnvelope() = runTest {
        server.enqueue(
            json(404, """{"success":false,"error":{"code":"SESSION_NOT_FOUND","message":"Session \"x\" does not exist"},"meta":{"mode":"demo"}}"""),
        )
        val result = client.call {
            sendLocation("tok", LocationUpdateRequest("x", 1.0, 1.0, null, false, "2026-10-29T06:30:00Z", "gps"))
        }
        val failure = result as ApiResult.Failure
        assertEquals(404, failure.httpStatus)
        assertEquals("SESSION_NOT_FOUND", failure.code)
        assertFalse(failure.isNetworkError)
    }

    @Test
    fun omitsSessionFieldsWhenSearchingWithoutSession() = runTest {
        server.enqueue(
            json(
                200,
                """{"success":true,"data":{"radius":1000,"count":1,"places":[{"id":"demo-a","name":"A (Demo)","latitude":1.0,"longitude":1.0,"distanceMeters":12,"source":"demo","simulated":true}],"source":"demo","simulated":true},"meta":{"mode":"demo"}}""",
            ),
        )
        val result = client.call { nearbyPlaces(null, NearbyRequest(1.0, 1.0, 1000, "all", null)) }
        val data = (result as ApiResult.Success).data
        assertEquals(true, data.simulated)
        assertEquals("A (Demo)", data.places?.first()?.name)

        val recorded = server.takeRequest()
        assertNull(recorded.getHeader("X-Session-Token"))
        assertFalse(recorded.body.readUtf8().contains("sessionId"))
    }

    @Test
    fun reportsNetworkFailures() = runTest {
        server.shutdown()
        val result = client.call { health() }
        val failure = result as ApiResult.Failure
        assertTrue(failure.isNetworkError)
        assertEquals("NETWORK_ERROR", failure.code)
    }
}
