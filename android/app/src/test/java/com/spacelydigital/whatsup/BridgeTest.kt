package com.spacelydigital.whatsup

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// The bridge reads each message as the Fire TV app does (src/App.tsx onMessage).
class BridgeTest {
    private class Host(var visible: Boolean = true) : Bridge.Host {
        val scripts = mutableListOf<String>()
        val fetches = mutableListOf<Triple<String, Long, Boolean>>()
        val chimes = mutableListOf<Double>()
        val awake = mutableListOf<Boolean>()
        val overlays = mutableListOf<Boolean>()
        val refused = mutableListOf<String>()
        var answer: Reply? = null // answered at once when set

        override fun js(script: String) {
            scripts += script
        }

        override fun fetch(url: String, timeoutMs: Long, binary: Boolean, done: (Reply) -> Unit) {
            fetches += Triple(url, timeoutMs, binary)
            answer?.let(done)
        }

        override fun onScreen() = visible
        override fun overlay(open: Boolean) {
            overlays += open
        }

        override fun awake(on: Boolean) {
            awake += on
        }

        override fun chime(volume: Double) {
            chimes += volume
        }

        override fun refused(host: String) {
            refused += host
        }
    }

    private val geo = "https://get.geojs.io/v1/ip/geo.json"

    private fun send(vararg messages: String, host: Host = Host()) = host.also { h -> messages.forEach(Bridge(h)::onMessage) }

    @Test fun getFetchesAndAnswers() {
        val h = Host().apply { answer = Reply(200, "{\"a\":\"b\"}") }
        send("""{"type":"get","id":123456789,"url":"$geo","timeoutMs":8000}""", host = h)
        assertEquals(listOf(Triple(geo, 8000L, false)), h.fetches)
        assertEquals(listOf("""window.__whatsupReply&&window.__whatsupReply(123456789,200,"{\"a\":\"b\"}");true;"""), h.scripts)
    }

    @Test fun binaryOnlyWhenTrue() {
        val h = send(
            """{"type":"get","id":1,"url":"$geo","binary":true}""",
            """{"type":"get","id":2,"url":"$geo","binary":"true"}""",
            """{"type":"get","id":3,"url":"$geo","binary":1}""",
        )
        assertEquals(listOf(true, false, false), h.fetches.map { it.third })
    }

    @Test fun timeoutsAsFireTvReadsThem() {
        // Math.min(12000, Math.max(1000, Number(timeoutMs) || 8000))
        val cases = listOf(
            "" to 8000L, "\"timeoutMs\":0," to 8000L, "\"timeoutMs\":500," to 1000L, "\"timeoutMs\":20000," to 12000L,
            "\"timeoutMs\":\"3000\"," to 3000L, "\"timeoutMs\":\"soon\"," to 8000L, "\"timeoutMs\":null," to 8000L,
            "\"timeoutMs\":true," to 1000L, "\"timeoutMs\":[5000]," to 5000L, "\"timeoutMs\":2500.9," to 2500L,
            "\"timeoutMs\":-4," to 1000L, "\"timeoutMs\":\" 0x7D0 \"," to 2000L,
        )
        for ((field, want) in cases) {
            val h = send("""{"type":"get",$field"id":7,"url":"$geo"}""")
            assertEquals(field, want, h.fetches.single().second)
        }
    }

    @Test fun refusedAddressesAnswerAtOnce() {
        val h = send("""{"type":"get","id":9,"url":"https://geocoding.geo.census.gov/x?address=1 Main St"}""")
        assertTrue(h.fetches.isEmpty())
        assertEquals(listOf("geocoding.geo.census.gov"), h.refused)
        assertEquals(listOf("""window.__whatsupReply&&window.__whatsupReply(9,"blocked","");true;"""), h.scripts)
    }

    @Test fun badGetsAreIgnored() {
        val h = send(
            """{"type":"get","id":"1","url":"$geo"}""", // id not a number
            """{"type":"get","id":1.5,"url":"$geo"}""",
            """{"type":"get","url":"$geo"}""",
            """{"type":"get","id":1}""",
            """{"type":"get","id":1,"url":42}""",
            """{"type":"get","id":1e300,"url":"$geo"}""", // an integer, but past what the page could have sent
            """["get"]""", "not json", "null", "", """{"type":"GET","id":1,"url":"$geo"}""",
        )
        assertTrue(h.fetches.isEmpty())
        assertTrue(h.scripts.isEmpty())
    }

    @Test fun wholeNumberIdsInAnyForm() {
        val h = send("""{"type":"get","id":4.0,"url":"$geo"}""", """{"type":"get","id":-0,"url":"$geo"}""", """{"type":"get","id":9007199254740991,"url":"$geo"}""")
        assertEquals(3, h.fetches.size)
    }

    @Test fun chimeVolumeAndVisibility() {
        // playChime(Number(volume) || 0.55), only while the app is on screen.
        val h = send(
            """{"type":"chime","volume":0.3}""", """{"type":"chime"}""", """{"type":"chime","volume":0}""",
            """{"type":"chime","volume":"0.8"}""", """{"type":"chime","volume":"loud"}""", """{"type":"chime","volume":2}""",
        )
        assertEquals(listOf(0.3, 0.55, 0.55, 0.8, 0.55, 2.0), h.chimes)
        assertTrue(send("""{"type":"chime","volume":0.3}""", host = Host(visible = false)).chimes.isEmpty())
    }

    @Test fun awakeUnlessExactlyFalse() {
        val h = send(
            """{"type":"awake","on":true}""", """{"type":"awake","on":false}""", """{"type":"awake"}""",
            """{"type":"awake","on":"false"}""", """{"type":"awake","on":0}""", """{"type":"awake","on":null}""",
        )
        assertEquals(listOf(true, false, true, true, true, true), h.awake)
    }

    @Test fun overlayOnlyWhenExactlyTrue() {
        val h = send("""{"type":"ui","overlay":true}""", """{"type":"ui","overlay":false}""", """{"type":"ui","overlay":"true"}""", """{"type":"ui"}""", """{"type":"ui","overlay":1}""")
        assertEquals(listOf(true, false, false, false, false), h.overlays)
    }
}

class JsTest {
    @Test fun stringsAsJsonStringifyWritesThem() {
        assertEquals("\"plain\"", Js.string("plain"))
        assertEquals("\"\"", Js.string(""))
        assertEquals("\"a\\\"b\\\\c\"", Js.string("a\"b\\c"))
        assertEquals("\"\\n\\r\\t\\b\\f\"", Js.string("\n\r\t\b\u000C"))
        assertEquals("\"\\u0000\\u001f\\u007f\"".replace("\\u007f", "\u007f"), Js.string("\u0000\u001F\u007F"))
        assertEquals("\"é😀\"", Js.string("é😀"))
        // Lone surrogates as escapes (JSON.stringify since ES2019); U+2028/U+2029 too, which JSON leaves alone.
        assertEquals("\"\\ud83d|\\ude00\"", Js.string("\uD83D|\uDE00"))
        assertEquals("\"\\u2028\\u2029\"", Js.string("\u2028\u2029"))
        assertEquals("\"</script>\"", Js.string("</script>"))
    }

    @Test fun scripts() {
        assertEquals("""window.__whatsupReply&&window.__whatsupReply(42,"oversize","");true;""", Js.reply(42, Reply.OVERSIZE))
        assertEquals("""window.__whatsupReply&&window.__whatsupReply(-3,429,"60");true;""", Js.reply(-3, Reply(429, "60")))
        assertEquals("window.__whatsupActive&&window.__whatsupActive(false);true;", Js.active(false))
        assertEquals("window.__whatsupBack&&window.__whatsupBack();true;", Js.BACK)
        assertTrue(Js.menuKey("keydown", true).contains("new KeyboardEvent('keydown',{key:'ContextMenu',code:'ContextMenu',repeat:true,"))
    }

    @Test fun numbersAsJavaScriptReadsThem() {
        val nan = Double.NaN
        for ((text, want) in listOf(
            "" to 0.0, "  " to 0.0, "12" to 12.0, " 12 " to 12.0, "-1.5e3" to -1500.0, ".5" to 0.5, "5." to 5.0,
            "0x1F" to 31.0, "0o17" to 15.0, "0b101" to 5.0, "-0x1F" to nan, "Infinity" to Double.POSITIVE_INFINITY,
            "infinity" to nan, "1,000" to nan, "1d" to nan, "NaN" to nan, "0x" to nan, "\u00A012\uFEFF" to 12.0,
        )) assertEquals(text, want, JsValue.fromString(text), 0.0)
        assertNull(JsValue.integer("5"))
        assertNull(JsValue.integer(5.5))
        assertEquals(5L, JsValue.integer(5.0))
        assertNull(JsValue.integer(Double.POSITIVE_INFINITY))
    }
}

class PageFilesTest {
    @Test fun routes() {
        val r = PageFiles::route
        assertEquals(PageFiles.Route.PAGE, r("https", "appassets.androidplatform.net"))
        assertEquals(PageFiles.Route.PASS, r("https", "basemap.nationalmap.gov"))
        assertEquals(PageFiles.Route.PASS, r("https", "tiles.maps.eox.at"))
        assertEquals(PageFiles.Route.PASS, r("https", "cdn.planespotters.net"))
        assertEquals(PageFiles.Route.PASS, r("https", "t.plnspttrs.net"))
        assertEquals(PageFiles.Route.PASS, r("data", null))
        assertEquals(PageFiles.Route.REFUSE, r("https", "plnspttrs.net"))
        assertEquals(PageFiles.Route.REFUSE, r("https", "evilplnspttrs.net"))
        assertEquals(PageFiles.Route.REFUSE, r("http", "basemap.nationalmap.gov"))
        assertEquals(PageFiles.Route.REFUSE, r("http", "appassets.androidplatform.net"))
        assertEquals(PageFiles.Route.REFUSE, r("https", "opendata.adsb.fi")) // the bridge's job, with its list
        assertEquals(PageFiles.Route.REFUSE, r("file", null))
        assertEquals(PageFiles.Route.REFUSE, r("https", null))
        assertTrue(PageFiles.mayNavigate("https", "appassets.androidplatform.net"))
        assertTrue(!PageFiles.mayNavigate("https", "ko-fi.com"))
    }

    @Test fun assets() {
        assertEquals("www/index.html", PageFiles.assetFor("/www/index.html"))
        assertEquals("www/layouts/atlas-dark.css", PageFiles.assetFor("/www/layouts/atlas-dark.css"))
        assertEquals("www/fonts/B612Mono-Bold.woff2", PageFiles.assetFor("/www/fonts/B612Mono-Bold.woff2"))
        for (bad in listOf(null, "/", "/www/", "/www", "/index.html", "/www/../x", "/www/./x", "/www//x", "/www/.hidden", "/www/a b", "/WWW/index.html")) {
            assertNull(bad, PageFiles.assetFor(bad))
        }
        assertEquals("text/javascript", PageFiles.mimeType("www/whatsup.js"))
        assertEquals("font/woff2", PageFiles.mimeType("www/fonts/Inter.woff2"))
        assertEquals("image/jpeg", PageFiles.mimeType("www/models/A320.JPG"))
        assertEquals("application/octet-stream", PageFiles.mimeType("www/x"))
        assertEquals("utf-8", PageFiles.encoding("text/html"))
        assertNull(PageFiles.encoding("image/png"))
    }

    @Test fun webViewVersions() {
        assertEquals(131, MainActivity.webViewMajor("131.0.6778.135"))
        assertEquals(0, MainActivity.webViewMajor(""))
        assertEquals(0, MainActivity.webViewMajor("unknown"))
    }
}
