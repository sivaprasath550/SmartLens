package com.smartlens.app.data

import android.content.Context
import com.smartlens.app.BuildConfig
import com.smartlens.app.util.UrlUtils

data class AppSettings(
    val backendUrl: String,
    /** null = use the interval suggested by the backend. */
    val intervalSecondsOverride: Int?,
    val radiusMeters: Int,
    val useDemoLocation: Boolean,
)

/** Persists user-editable connection and demo settings in SharedPreferences. */
class SettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("smartlens_settings", Context.MODE_PRIVATE)

    fun load(): AppSettings = AppSettings(
        backendUrl = UrlUtils.normalizeBaseUrl(prefs.getString(KEY_URL, null) ?: "")
            ?: BuildConfig.DEFAULT_BACKEND_URL,
        intervalSecondsOverride = prefs.getInt(KEY_INTERVAL, 0).takeIf { it in MIN_INTERVAL..MAX_INTERVAL },
        radiusMeters = prefs.getInt(KEY_RADIUS, DEFAULT_RADIUS).coerceIn(MIN_RADIUS, MAX_RADIUS),
        useDemoLocation = prefs.getBoolean(KEY_DEMO, false),
    )

    fun save(settings: AppSettings) {
        prefs.edit()
            .putString(KEY_URL, settings.backendUrl)
            .putInt(KEY_INTERVAL, settings.intervalSecondsOverride ?: 0)
            .putInt(KEY_RADIUS, settings.radiusMeters)
            .putBoolean(KEY_DEMO, settings.useDemoLocation)
            .apply()
    }

    /** Opt-in: stream the camera preview to the dashboard. Off unless the user turns it on. */
    var shareLiveView: Boolean
        get() = prefs.getBoolean(KEY_LIVE_VIEW, false)
        set(value) = prefs.edit().putBoolean(KEY_LIVE_VIEW, value).apply()

    companion object {
        private const val KEY_LIVE_VIEW = "share_live_view"
        private const val KEY_URL = "backend_url"
        private const val KEY_INTERVAL = "interval_seconds"
        private const val KEY_RADIUS = "radius_meters"
        private const val KEY_DEMO = "use_demo_location"
        const val MIN_INTERVAL = 2
        const val MAX_INTERVAL = 300
        const val MIN_RADIUS = 50
        const val MAX_RADIUS = 5000
        const val DEFAULT_RADIUS = 1000
        const val DEFAULT_INTERVAL = 5
    }
}
