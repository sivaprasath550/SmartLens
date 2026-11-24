package com.smartlens.app.data.api

import com.google.gson.Gson
import com.google.gson.JsonParseException
import kotlinx.coroutines.CancellationException
import okhttp3.OkHttpClient
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

/** Outcome of a backend call, unwrapped from the response envelope. */
sealed interface ApiResult<out T> {
    data class Success<T>(val data: T, val meta: ApiMeta?) : ApiResult<T>

    data class Failure(val httpStatus: Int, val code: String, val message: String) : ApiResult<Nothing> {
        val isNetworkError get() = httpStatus == 0
    }
}

/**
 * Thin wrapper around Retrofit bound to one base URL. A new instance is
 * created whenever the user changes the backend address in Settings.
 */
class BackendClient(val baseUrl: String, okHttp: OkHttpClient = defaultOkHttp()) {
    private val gson = Gson()

    val api: SmartLensApi = buildApi(okHttp)

    /** Same API with long timeouts, for calls that wait on a slow upstream (free OpenStreetMap search). */
    private val slowApi: SmartLensApi = buildApi(
        okHttp.newBuilder()
            .readTimeout(SLOW_CALL_SECONDS, TimeUnit.SECONDS)
            .callTimeout(SLOW_CALL_SECONDS, TimeUnit.SECONDS)
            .build(),
    )

    private fun buildApi(client: OkHttpClient): SmartLensApi = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(client)
        .addConverterFactory(GsonConverterFactory.create(gson))
        .build()
        .create(SmartLensApi::class.java)

    suspend fun <T> call(slow: Boolean = false, block: suspend SmartLensApi.() -> Response<ApiEnvelope<T>>): ApiResult<T> {
        val response = try {
            (if (slow) slowApi else api).block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: SocketTimeoutException) {
            return ApiResult.Failure(0, "TIMEOUT", "The backend did not respond in time")
        } catch (e: IOException) {
            return ApiResult.Failure(0, "NETWORK_ERROR", "Cannot reach the backend at $baseUrl")
        } catch (e: JsonParseException) {
            return ApiResult.Failure(0, "BAD_RESPONSE", "The backend returned an unexpected response")
        } catch (e: RuntimeException) {
            return ApiResult.Failure(0, "BAD_RESPONSE", "The backend returned an unexpected response")
        }

        val body = response.body()
        if (response.isSuccessful && body != null && body.success && body.data != null) {
            return ApiResult.Success(body.data, body.meta)
        }
        return parseFailure(response.code(), body, response.errorBody()?.string())
    }

    private fun parseFailure(status: Int, body: ApiEnvelope<*>?, errorJson: String?): ApiResult.Failure {
        val error = body?.error ?: errorJson?.let {
            try {
                gson.fromJson(it, ApiEnvelope::class.java)?.error
            } catch (e: JsonParseException) {
                null
            }
        }
        return ApiResult.Failure(
            httpStatus = status,
            code = error?.code ?: "HTTP_$status",
            message = error?.message ?: "Request failed (HTTP $status)",
        )
    }

    companion object {
        private const val SLOW_CALL_SECONDS = 60L

        fun defaultOkHttp(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(12, TimeUnit.SECONDS)
            .writeTimeout(10, TimeUnit.SECONDS)
            .callTimeout(15, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}
