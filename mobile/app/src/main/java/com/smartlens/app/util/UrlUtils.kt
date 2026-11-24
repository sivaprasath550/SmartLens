package com.smartlens.app.util

object UrlUtils {
    private val VALID = Regex("^https?://[A-Za-z0-9.\\-\\[\\]:]+(:\\d{1,5})?(/[^\\s]*)?$")

    /**
     * Normalises a user-entered backend address into a Retrofit base URL
     * ("http://host:port/"). Returns null if the input is not an http(s) URL.
     */
    fun normalizeBaseUrl(input: String): String? {
        var url = input.trim()
        if (url.isEmpty()) return null
        if (!url.startsWith("http://", ignoreCase = true) && !url.startsWith("https://", ignoreCase = true)) {
            return null
        }
        // Users often paste the health URL; strip a trailing /api or /api/... path.
        url = url.replace(Regex("/api(/.*)?$", RegexOption.IGNORE_CASE), "")
        if (!url.endsWith("/")) url += "/"
        return if (VALID.matches(url)) url else null
    }

    fun isCleartext(url: String) = url.startsWith("http://", ignoreCase = true)
}
