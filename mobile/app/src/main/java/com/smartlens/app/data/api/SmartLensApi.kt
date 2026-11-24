package com.smartlens.app.data.api

import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path

/** Retrofit definition of the backend endpoints used by the mobile app. */
interface SmartLensApi {
    @GET("api/health")
    suspend fun health(): Response<ApiEnvelope<HealthData>>

    @POST("api/sessions")
    suspend fun createSession(@Body body: CreateSessionRequest): Response<ApiEnvelope<SessionData>>

    @POST("api/sessions/{id}/stop")
    suspend fun stopSession(
        @Path("id") sessionId: String,
        @Header("X-Session-Token") token: String,
    ): Response<ApiEnvelope<StopData>>

    @POST("api/location")
    suspend fun sendLocation(
        @Header("X-Session-Token") token: String,
        @Body body: LocationUpdateRequest,
    ): Response<ApiEnvelope<LocationAck>>

    /** The token header is omitted (null) when searching without a session. */
    @POST("api/places/nearby")
    suspend fun nearbyPlaces(
        @Header("X-Session-Token") token: String?,
        @Body body: NearbyRequest,
    ): Response<ApiEnvelope<NearbyData>>

    /** Opt-in live view: one JPEG preview frame (raw image/jpeg body). */
    @POST("api/sessions/{id}/frame")
    suspend fun uploadFrame(
        @Path("id") sessionId: String,
        @Header("X-Session-Token") token: String,
        @Header("X-Frame-Seq") seq: Long,
        @Header("X-Frame-Rotation") rotationDegrees: Int,
        @Body jpeg: RequestBody,
    ): Response<ApiEnvelope<FrameAck>>
}
