package com.spacelydigital.whatsup

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class AllowListTest {
    private val ok = listOf(
        "https://opendata.adsb.fi/api/v3/lat/39.10/lon/-84.41/dist/38",
        "https://opendata.adsb.fi/api/v3/lat/-33.87/lon/151.21/dist/250",
        "https://api.adsb.lol/v2/lat/39.10/lon/-84.41/dist/38",
        "https://vrs-standing-data.adsb.lol/routes/DL/DL1234.json",
        "https://get.geojs.io/v1/ip/geo.json",
        "https://geocoding-api.open-meteo.com/v1/search?name=Cincinnati&count=10&language=en&format=json",
        "https://tiles.openfreemap.org/planet",
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=1%20Main%20St&benchmark=Public_AR_Current&format=json",
        "https://nominatim.openstreetmap.org/search?q=10%20Downing%20St&format=jsonv2&limit=5&addressdetails=1",
        "https://api.open-meteo.com/v1/forecast?latitude=39.10&longitude=-84.41&timezone=auto&forecast_days=1",
        "https://tiles.openfreemap.org/planet/20251105_001001_pt/13/2176/3104.pbf",
        "https://api.planespotters.net/pub/photos/hex/a1b2c3",
        "https://api.planespotters.net/pub/photos/reg/N12345",
    )

    @Test fun allowsEachService() = ok.forEach { assertTrue(it, AllowList.allows(it)) }

    @Test fun refusesTheRest() {
        for (url in listOf(
            "http://opendata.adsb.fi/api/v3/lat/39.10/lon/-84.41/dist/38", // not encrypted
            "https://opendata.adsb.fi/api/v3/lat/39.1/lon/-84.41/dist/38", // not rounded to 2 places
            "https://opendata.adsb.fi/api/v3/lat/39.10/lon/-84.41/dist/38\n", // a line break JavaScript's $ refuses
            "https://opendata.adsb.fi/api/v3/lat/39.10/lon/-84.41/dist/38?x=1",
            "https://opendata.adsb.fi.example.com/api/v3/lat/39.10/lon/-84.41/dist/38",
            "https://opendata.adsb.fi@example.com/api/v3/lat/39.10/lon/-84.41/dist/38",
            "https://get.geojs.io/v1/ip/geo.json#x",
            "https://geocoding-api.open-meteo.com/v1/search?name=a&b=c&count=10&language=en&format=json",
            "https://geocoding-api.open-meteo.com/v1/search?name=" + "x".repeat(201) + "&count=10&language=en&format=json",
            "https://api.planespotters.net/pub/photos/hex/A1B2C3", // hex codes are lowercase
            "https://tiles.openfreemap.org/planet/../13/1/1.pbf/x",
            "https://example.com/",
            "",
        )) assertFalse(url, AllowList.allows(url))
    }

    @Test fun logsTheHostOnly() {
        assertEquals("geocoding.geo.census.gov", AllowList.hostOf("https://geocoding.geo.census.gov/geocoder?address=1 Main St"))
        assertEquals("non-http URL", AllowList.hostOf("javascript:alert(1)"))
    }
}

class FetcherTest {
    private val timer = Executors.newSingleThreadScheduledExecutor()

    @After fun stop() {
        timer.shutdownNow()
    }

    // A scripted server: each URL answers with a status, headers and a body, or misbehaves.
    private class Answer(
        val status: Int = 200,
        val headers: Map<String, String> = emptyMap(),
        val body: ByteArray = ByteArray(0),
        val length: Long = -1,
        val fail: IOException? = null,
        val hang: Boolean = false,
    )

    private inner class Fake(private val answers: Map<String, Answer>) : Http {
        val asked = mutableListOf<Pair<String, Map<String, String>>>()
        var closed = 0

        override fun open(url: String) = object : Http.Exchange {
            val a = answers[url] ?: throw IOException("no route to $url")
            val gone = CountDownLatch(1)

            override fun send(headers: Map<String, String>, timeoutMs: Int): Int {
                asked += url to headers
                a.fail?.let { throw it }
                if (a.hang) {
                    gone.await(30, TimeUnit.SECONDS)
                    throw IOException("closed")
                }
                return a.status
            }

            override fun header(name: String) = a.headers[name]
            override fun contentLength() = a.length
            override fun body(): InputStream = ByteArrayInputStream(a.body)
            override fun close() {
                closed++
                gone.countDown()
            }
        }
    }

    private val ua = "WhatsUp-GoogleTV/0.1 (test)"
    private val geo = "https://get.geojs.io/v1/ip/geo.json"
    private val tile = "https://tiles.openfreemap.org/planet/v1/13/2176/3104.pbf"

    private fun fetch(answers: Map<String, Answer>, url: String = geo, binary: Boolean = false, timeoutMs: Long = 8000) =
        Fake(answers).let { it to Fetcher(ua, it, timer).get(url, timeoutMs, binary) }

    @Test fun textComesBackAsIs() {
        val (http, reply) = fetch(mapOf(geo to Answer(body = """{"city":"Zürich"}""".toByteArray())))
        assertEquals(Reply(200, """{"city":"Zürich"}"""), reply)
        assertEquals(mapOf("User-Agent" to ua, "Accept" to "application/json"), http.asked.single().second)
        assertEquals(1, http.closed)
    }

    @Test fun bytesComeBackAsBase64() {
        val bytes = ByteArray(1000) { (it * 7).toByte() }
        val (http, reply) = fetch(mapOf(tile to Answer(body = bytes)), tile, binary = true)
        assertEquals(Reply(200, Base64.getEncoder().encodeToString(bytes)), reply)
        assertEquals("*/*", http.asked.single().second["Accept"])
    }

    @Test fun byteOrderMarkIsDropped() {
        val body = byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "{}".toByteArray()
        assertEquals(Reply(200, "{}"), fetch(mapOf(geo to Answer(body = body))).second)
    }

    @Test fun otherStatusesCarryRetryAfter() {
        assertEquals(Reply(429, "120"), fetch(mapOf(geo to Answer(429, mapOf("Retry-After" to "120")))).second)
        assertEquals(Reply(503, ""), fetch(mapOf(geo to Answer(503))).second)
        assertEquals(Reply(404, ""), fetch(mapOf(geo to Answer(404, body = "missing".toByteArray()))).second)
        // A 3xx with no Location is just a status.
        assertEquals(Reply(302, ""), fetch(mapOf(geo to Answer(302))).second)
    }

    @Test fun redirectsMustStayOnTheList() {
        val other = "https://get.geojs.io/v1/ip/geo.json?x"
        val (http, followed) = fetch(mapOf(
            "https://tiles.openfreemap.org/planet" to Answer(301, mapOf("Location" to "/planet/v1/13/2176/3104.pbf")),
            tile to Answer(body = byteArrayOf(1, 2, 3)),
        ), "https://tiles.openfreemap.org/planet", binary = true)
        assertEquals(Reply(200, "AQID"), followed)
        assertEquals(listOf("https://tiles.openfreemap.org/planet", tile), http.asked.map { it.first })
        // Off the list: refused before anything is asked of the new address.
        val (http2, refused) = fetch(mapOf(geo to Answer(302, mapOf("Location" to other)), other to Answer()))
        assertEquals(Reply.BLOCKED, refused)
        assertEquals(listOf(geo), http2.asked.map { it.first })
        assertEquals(Reply.BLOCKED, fetch(mapOf(geo to Answer(307, mapOf("Location" to "http://get.geojs.io/v1/ip/geo.json")))).second)
        // A loop ends.
        assertEquals(Reply.CONNECTION_ERROR, fetch(mapOf(geo to Answer(308, mapOf("Location" to geo)))).second)
    }

    @Test fun oversizeBodiesAreRefused() {
        val max = Fetcher.MAX_BYTES
        assertEquals(Reply.OVERSIZE, fetch(mapOf(geo to Answer(length = max + 1L))).second)
        assertEquals(Reply.OVERSIZE, fetch(mapOf(tile to Answer(body = ByteArray(max + 1))), tile, binary = true).second)
        assertEquals(200, fetch(mapOf(tile to Answer(body = ByteArray(max))), tile, binary = true).second.status)
        assertEquals(Reply.OVERSIZE, fetch(mapOf(geo to Answer(body = ByteArray(max + 1) { 'a'.code.toByte() }))).second)
        // The page's limit is in characters, as JavaScript counts them: 1 M two-byte letters fit.
        val wide = "é".repeat(max / 2 + 10)
        assertEquals(Reply(200, wide), fetch(mapOf(geo to Answer(body = wide.toByteArray()))).second)
    }

    @Test fun failuresAreConnectionErrors() {
        assertEquals(Reply.CONNECTION_ERROR, fetch(mapOf(geo to Answer(fail = IOException("reset")))).second)
        assertEquals(Reply.CONNECTION_ERROR, fetch(emptyMap()).second)
    }

    @Test fun aStalledRequestEndsAtItsDeadline() {
        val start = System.nanoTime()
        val (http, reply) = fetch(mapOf(geo to Answer(hang = true)), timeoutMs = 300)
        val ms = (System.nanoTime() - start) / 1_000_000
        assertEquals(Reply.CONNECTION_ERROR, reply)
        assertTrue("took $ms ms", ms in 250..5000)
        assertTrue(http.closed >= 1)
    }

    @Test fun noTimerNoRequest() {
        timer.shutdownNow()
        val http = Fake(mapOf(geo to Answer()))
        assertEquals(Reply.CONNECTION_ERROR, Fetcher(ua, http, timer).get(geo, 8000, false))
        assertTrue(http.asked.isEmpty())
    }
}
