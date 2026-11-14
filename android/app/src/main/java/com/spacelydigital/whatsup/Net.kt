package com.spacelydigital.whatsup

import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Base64
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

// The page asks the app to fetch for it (adsb.fi sends no CORS header, so the page can't read it
// itself). Only these read-only GETs are reachable, each with the app's own User-Agent, and the
// answers mean what the Fire TV app's answers mean (src/App.tsx): an HTTP status with the body or
// the Retry-After header, or one of the words below.

/** The answer to one "get": an HTTP status (Int) or a word (String), and the text that goes with it. */
data class Reply(val status: Any, val text: String) {
    init {
        require(status is Int || status is String)
    }

    companion object {
        val BLOCKED = Reply("blocked", "")
        val OVERSIZE = Reply("oversize", "")
        val CONNECTION_ERROR = Reply("connection_error", "")
    }
}

/** The web addresses the page may have fetched: the Fire TV app's list (src/App.tsx), same order (tests/test-android.mjs). */
object AllowList {
    val PATTERNS = listOf(
        """^https://opendata\.adsb\.fi/api/v3/lat/-?\d{1,2}\.\d{2}/lon/-?\d{1,3}\.\d{2}/dist/\d{1,3}$""",
        """^https://api\.adsb\.lol/v2/lat/-?\d{1,2}\.\d{2}/lon/-?\d{1,3}\.\d{2}/dist/\d{1,3}$""",
        """^https://vrs-standing-data\.adsb\.lol/routes/[A-Z0-9-]{2}/[A-Z0-9-]{2,10}\.json$""",
        """^https://get\.geojs\.io/v1/ip/geo\.json$""",
        """^https://geocoding-api\.open-meteo\.com/v1/search\?name=[^&#]{1,200}&count=\d{1,2}&language=en&format=json$""",
        """^https://tiles\.openfreemap\.org/planet$""",
        """^https://geocoding\.geo\.census\.gov/geocoder/locations/onelineaddress\?address=[^&#]{1,300}&benchmark=Public_AR_Current&format=json$""",
        """^https://nominatim\.openstreetmap\.org/search\?q=[^&#]{1,300}&format=jsonv2&limit=5&addressdetails=1$""",
        """^https://api\.open-meteo\.com/v1/forecast\?latitude=-?\d{1,2}\.\d{2}&longitude=-?\d{1,3}\.\d{2}&timezone=auto&forecast_days=1$""",
        """^https://tiles\.openfreemap\.org/planet/[\w.-]+/\d{1,2}/\d{1,6}/\d{1,6}\.pbf$""",
        """^https://api\.planespotters\.net/pub/photos/(hex/[0-9a-f]{6}|reg/[A-Z0-9-]{2,10})$""",
    )
    private val regexes = PATTERNS.map(::Regex)
    private val HOST = Regex("""^https?://([^/?#]+)""")

    // The whole address must match, as in JavaScript: in Java a bare "$" also matches before a final line break.
    fun allows(url: String) = regexes.any { it.matches(url) }

    // For the log, the host only: a refused geocoder address could carry a typed street address.
    fun hostOf(url: String) = HOST.find(url)?.groupValues?.get(1) ?: "non-http URL"
}

/** One HTTP exchange; the app uses HttpURLConnection, the tests a fake. close() may come from another thread. */
interface Http {
    fun open(url: String): Exchange

    interface Exchange {
        /** Sends the GET and returns the status code. */
        fun send(headers: Map<String, String>, timeoutMs: Int): Int
        fun header(name: String): String?
        fun contentLength(): Long
        fun body(): InputStream
        fun close()
    }
}

class UrlHttp : Http {
    override fun open(url: String): Http.Exchange = Conn(URL(url).openConnection() as HttpURLConnection)

    private class Conn(private val c: HttpURLConnection) : Http.Exchange {
        override fun send(headers: Map<String, String>, timeoutMs: Int): Int {
            c.requestMethod = "GET"
            c.instanceFollowRedirects = false // each hop is checked against the list first
            c.useCaches = false
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            for ((k, v) in headers) c.setRequestProperty(k, v)
            return c.responseCode
        }

        override fun header(name: String): String? = c.getHeaderField(name)
        override fun contentLength() = c.contentLengthLong
        override fun body(): InputStream = c.inputStream
        override fun close() = c.disconnect()
    }
}

class Fetcher(
    private val userAgent: String,
    private val http: Http,
    private val timer: ScheduledExecutorService,
) {
    companion object {
        const val MAX_BYTES = 2 * 1024 * 1024
        private const val MAX_HOPS = 5
        private val REDIRECTS = setOf(301, 302, 303, 307, 308)
    }

    /** Fetches [url] (already allowed) within [timeoutMs] in all, redirects and body included. Never throws. */
    fun get(url: String, timeoutMs: Long, binary: Boolean): Reply {
        val start = System.nanoTime()
        val headers = mapOf("User-Agent" to userAgent, "Accept" to if (binary) "*/*" else "application/json")
        // No timer (the app is closing): no request either.
        val watch = try {
            Watch(timeoutMs)
        } catch (e: RuntimeException) {
            return Reply.CONNECTION_ERROR
        }
        try {
            var where = url
            repeat(MAX_HOPS + 1) {
                val left = timeoutMs - (System.nanoTime() - start) / 1_000_000
                if (left <= 0) return Reply.CONNECTION_ERROR
                val ex = http.open(where)
                if (!watch.attach(ex)) {
                    ex.close()
                    return Reply.CONNECTION_ERROR
                }
                try {
                    val status = ex.send(headers, left.toInt())
                    val location = if (status in REDIRECTS) ex.header("Location") else null
                    if (location != null) {
                        // A redirect may only lead to another allowed address.
                        val next = try {
                            URL(URL(where), location).toString()
                        } catch (e: IOException) {
                            return Reply.BLOCKED
                        }
                        if (!AllowList.allows(next)) return Reply.BLOCKED
                        where = next
                        return@repeat
                    }
                    // Tell the page how long the service asked it to wait (429/503), so it backs off.
                    if (status != 200) return Reply(status, ex.header("Retry-After") ?: "")
                    // Refuse an announced oversize body before downloading it.
                    if (ex.contentLength() > MAX_BYTES) return Reply.OVERSIZE
                    return if (binary) {
                        val bytes = ex.body().use { readAtMost(it, MAX_BYTES) } ?: return Reply.OVERSIZE
                        Reply(200, Base64.getEncoder().encodeToString(bytes))
                    } else {
                        // The page's limit counts characters, as JavaScript's text.length does; UTF-8 takes at
                        // most 3 bytes for each of them.
                        val bytes = ex.body().use { readAtMost(it, 3 * MAX_BYTES) } ?: return Reply.OVERSIZE
                        val text = utf8(bytes)
                        if (text.length > MAX_BYTES) Reply.OVERSIZE else Reply(200, text)
                    }
                } finally {
                    ex.close()
                }
            }
            return Reply.CONNECTION_ERROR // more redirects than a browser would follow here
        } catch (e: IOException) {
            return Reply.CONNECTION_ERROR
        } catch (e: RuntimeException) {
            return Reply.CONNECTION_ERROR
        } finally {
            watch.done()
        }
    }

    // The whole request shares one deadline: when it passes, the open connection is closed, which
    // ends a stalled connect or read at once (like the Fire TV app's AbortController).
    private inner class Watch(timeoutMs: Long) {
        private var expired = false
        private var current: Http.Exchange? = null
        private val task = timer.schedule({ expire() }, timeoutMs, TimeUnit.MILLISECONDS)

        @Synchronized
        private fun expire() {
            expired = true
            current?.close()
        }

        @Synchronized
        fun attach(ex: Http.Exchange): Boolean {
            if (expired) return false
            current = ex
            return true
        }

        fun done() {
            task.cancel(false)
        }
    }
}

/** The stream's bytes, or null when there are more than [max]. */
fun readAtMost(input: InputStream, max: Int): ByteArray? {
    val out = java.io.ByteArrayOutputStream(minOf(max, 64 * 1024))
    val buf = ByteArray(16 * 1024)
    var total = 0
    while (true) {
        val n = input.read(buf)
        if (n < 0) return out.toByteArray()
        total += n
        if (total > max) return null
        out.write(buf, 0, n)
    }
}

/** UTF-8 text as fetch's text() reads it: a leading byte order mark is dropped, bad bytes become U+FFFD. */
fun utf8(bytes: ByteArray): String {
    val bom = bytes.size >= 3 && bytes[0] == 0xEF.toByte() && bytes[1] == 0xBB.toByte() && bytes[2] == 0xBF.toByte()
    return if (bom) String(bytes, 3, bytes.size - 3, Charsets.UTF_8) else String(bytes, Charsets.UTF_8)
}
