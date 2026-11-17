package com.spacelydigital.whatsup

// The page (web/, built into the app's assets under www/) is served from inside the app at
// https://appassets.androidplatform.net/www/, a secure address no server answers for: the page gets
// a real https origin (its own storage, its Content-Security-Policy 'self') and nothing leaves the TV.
// Every other request the web view makes is refused, except the pictures the page's
// Content-Security-Policy names (img-src), which the web view loads itself.
object PageFiles {
    const val HOST = "appassets.androidplatform.net"
    const val ORIGIN = "https://$HOST"
    const val START = "$ORIGIN/www/index.html"
    private const val PREFIX = "/www/"

    // img-src in web/index.html, less 'self' and data: (tests/test-android.mjs keeps them the same).
    val PICTURE_HOSTS = listOf("basemap.nationalmap.gov", "tiles.maps.eox.at", "cdn.planespotters.net", "*.plnspttrs.net")

    enum class Route { PAGE, PASS, REFUSE }

    // [port] as android.net.Uri gives it: -1 when the address names none. Only https's own port is served or passed.
    fun route(scheme: String?, host: String?, port: Int = -1): Route {
        if (scheme == "data" || scheme == "blob" || scheme == "about") return Route.PASS
        if (scheme != "https" || host == null || !defaultPort(port)) return Route.REFUSE
        if (host == HOST) return Route.PAGE
        val pictures = PICTURE_HOSTS.any { if (it.startsWith("*.")) host.endsWith(it.substring(1)) else host == it }
        return if (pictures) Route.PASS else Route.REFUSE
    }

    /** May the web view go to this address? Only the page itself (a reload after Erase all data). */
    fun mayNavigate(scheme: String?, host: String?, port: Int = -1) = scheme == "https" && host == HOST && defaultPort(port)

    private fun defaultPort(port: Int) = port == -1 || port == 443

    private val SEGMENT = Regex("""[A-Za-z0-9_][A-Za-z0-9._-]*""")

    /** The asset for a request path ("/www/fonts/Inter.woff2" -> "www/fonts/Inter.woff2"), or null. */
    fun assetFor(path: String?): String? {
        if (path == null || !path.startsWith(PREFIX)) return null
        val parts = path.substring(PREFIX.length).split('/')
        if (parts.any { !SEGMENT.matches(it) }) return null
        return "www/" + parts.joinToString("/")
    }

    private val TYPES = mapOf(
        "html" to "text/html", "js" to "text/javascript", "mjs" to "text/javascript", "css" to "text/css",
        "txt" to "text/plain", "json" to "application/json", "svg" to "image/svg+xml",
        "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "webp" to "image/webp", "gif" to "image/gif",
        "woff2" to "font/woff2", "woff" to "font/woff", "ttf" to "font/ttf", "otf" to "font/otf",
        "mp3" to "audio/mpeg", "wav" to "audio/wav", "ogg" to "audio/ogg", "mp4" to "video/mp4",
    )

    fun mimeType(asset: String): String = TYPES[asset.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"

    /** "utf-8" for text, which the page's files all are; null for the rest. */
    fun encoding(mime: String): String? =
        if (mime.startsWith("text/") || mime == "application/json" || mime == "image/svg+xml") "utf-8" else null
}
