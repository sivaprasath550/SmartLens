package com.smartlens.app.data.api

/*
 * DTOs for the SmartLens backend (see docs/API.md). Every response uses the
 * envelope { success, data, meta } or { success: false, error, meta }.
 * Fields are nullable because Gson does not enforce Kotlin nullability.
 */

data class ApiEnvelope<T>(
    val success: Boolean = false,
    val data: T? = null,
    val error: ApiErrorBody? = null,
    val meta: ApiMeta? = null,
)

data class ApiErrorBody(
    val code: String? = null,
    val message: String? = null,
)

data class ApiMeta(
    val mode: String? = null,
    val storage: String? = null,
    val updatedAt: String? = null,
    val cached: Boolean? = null,
)

data class HealthData(
    val status: String? = null,
    val demoMode: Boolean? = null,
    val database: DatabaseInfo? = null,
    val places: PlacesProviderInfo? = null,
    val locationUpdateIntervalSeconds: Int? = null,
)

data class DatabaseInfo(
    val status: String? = null,
    val storage: String? = null,
    val persistent: Boolean? = null,
)

data class PlacesProviderInfo(
    val provider: String? = null,
    val configured: Boolean? = null,
    val simulated: Boolean? = null,
)

data class CreateSessionRequest(
    val deviceName: String,
    val platform: String = "android",
    val locationSource: String,
    val cameraActive: Boolean,
    val appVersion: String,
)

data class SessionData(
    val sessionId: String? = null,
    val sessionToken: String? = null,
    val locationUpdateIntervalSeconds: Int? = null,
)

data class LocationUpdateRequest(
    val sessionId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double?,
    val cameraActive: Boolean,
    val timestamp: String,
    val source: String,
)

data class LocationAck(
    val sessionId: String? = null,
    val status: String? = null,
    val updateCount: Int? = null,
    val receivedAt: String? = null,
)

data class NearbyRequest(
    val latitude: Double,
    val longitude: Double,
    val radius: Int,
    val category: String,
    val sessionId: String?,
)

data class NearbyData(
    val radius: Int? = null,
    val category: String? = null,
    val count: Int? = null,
    val places: List<PlaceDto>? = null,
    val source: String? = null,
    val simulated: Boolean? = null,
    val attribution: String? = null,
)

data class PlaceDto(
    val id: String? = null,
    val name: String? = null,
    val category: String? = null,
    val address: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val distanceMeters: Double? = null,
    val mapsUri: String? = null,
    val source: String? = null,
    val simulated: Boolean? = null,
)

data class StopData(
    val sessionId: String? = null,
)

data class FrameAck(
    val sessionId: String? = null,
    val bytes: Int? = null,
    val receivedAt: String? = null,
)
