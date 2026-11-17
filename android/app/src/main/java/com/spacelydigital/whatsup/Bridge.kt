package com.spacelydigital.whatsup

import androidx.webkit.WebMessageCompat
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.math.BigDecimal
import java.math.BigInteger

// The page and the app talk as on Fire TV (src/App.tsx), so web/ runs unchanged. The page posts one
// JSON string per message to window.WhatsUpHost:
//   {type:'get', id, url, timeoutMs, binary}   fetch an allowed address; answered with
//                                              window.__whatsupReply(id, status, text)
//   {type:'chime', volume}                     play the alert chime, unless the app is off screen
//   {type:'awake', on}                         Settings > Keep screen awake
//   {type:'ui', overlay}                       a screen is open over the map: Back goes to the page
//   {type:'erase'}                             Erase all data: the page has cleared its storage and reloads; the
//                                              app clears what the web view keeps for it (its cache of pictures)
// The app calls window.__whatsupBack() for Back while a screen is open, and
// window.__whatsupActive(true|false) when the app comes on or goes off screen.

class Bridge(private val host: Host) {
    /** What the bridge needs from the app. Called on the main thread. */
    interface Host {
        fun js(script: String)
        fun fetch(url: String, timeoutMs: Long, binary: Boolean, done: (Reply) -> Unit)
        fun onScreen(): Boolean
        fun overlay(open: Boolean)
        fun awake(on: Boolean)
        fun chime(volume: Double)
        fun erase()
        fun refused(host: String)
    }

    fun onMessage(raw: String) {
        // The page's messages are well under a kilobyte; a much longer one is refused unread. org.json reads nested
        // arrays and objects recursively, and on a TV a message nested 100,000 deep overflowed the main thread's stack:
        // a StackOverflowError, which is no JSONException, closed the app. 16 KB holds at most 16,384 levels (30,000
        // read fine there); the catch is for a device with a smaller stack.
        if (raw.length > MAX_MESSAGE) return
        val m = try {
            JSONObject(raw)
        } catch (e: JSONException) {
            return
        } catch (e: StackOverflowError) {
            return
        }
        // A message the bridge can't read is ignored, as one that isn't JSON is: anything thrown here would
        // close the app, since messages arrive on the main thread.
        try {
            when (m.opt("type")) {
                "chime" -> if (host.onScreen()) host.chime(JsValue.number(m.opt("volume")).orIfFalsy(0.55))
                "awake" -> host.awake(m.opt("on") != false)
                "ui" -> host.overlay(m.opt("overlay") == true)
                "erase" -> host.erase()
                "get" -> get(m)
            }
        } catch (e: RuntimeException) {
        } catch (e: StackOverflowError) {
        }
    }

    private fun get(m: JSONObject) {
        val id = JsValue.integer(m.opt("id")) ?: return
        val url = m.opt("url") as? String ?: return
        // Answer a refused address at once, so the page never waits out its timeout.
        if (!AllowList.allows(url)) {
            host.refused(AllowList.hostOf(url))
            host.js(Js.reply(id, Reply.BLOCKED))
            return
        }
        val timeoutMs = JsValue.number(m.opt("timeoutMs")).orIfFalsy(8000.0).coerceIn(1000.0, 12000.0).toLong()
        host.fetch(url, timeoutMs, m.opt("binary") == true) { host.js(Js.reply(id, it)) }
    }

    // JavaScript's `x || fallback` for a number: 0 and NaN are falsy.
    private fun Double.orIfFalsy(fallback: Double) = if (isNaN() || this == 0.0) fallback else this

    companion object {
        /** The longest message read, in characters. */
        const val MAX_MESSAGE = 16 * 1024

        /** A message's text; null for an ArrayBuffer, whose data can't be read as text (that throws). */
        fun textOf(message: WebMessageCompat): String? =
            if (message.type == WebMessageCompat.TYPE_STRING) message.data else null
    }
}

/** Scripts the app runs in the page. Each ends with "true;", as on Fire TV. */
object Js {
    const val BACK = "window.__whatsupBack&&window.__whatsupBack();true;"

    fun active(on: Boolean) = "window.__whatsupActive&&window.__whatsupActive($on);true;"

    fun reply(id: Long, r: Reply): String {
        val status = when (val s = r.status) {
            is Int -> s.toString()
            else -> string(s.toString())
        }
        val text = string(r.text)
        return StringBuilder(text.length + 80).append("window.__whatsupReply&&window.__whatsupReply(")
            .append(id).append(',').append(status).append(',').append(text).append(");true;").toString()
    }

    // The remote's Menu key, which Android's web view keeps from the page: the page opens Settings on it.
    fun menuKey(type: String, repeat: Boolean) =
        "document.dispatchEvent(new KeyboardEvent('$type',{key:'ContextMenu',code:'ContextMenu',repeat:$repeat,bubbles:true,cancelable:true}));true;"

    /** A string literal as JSON.stringify writes it; also escapes U+2028/U+2029 and lone surrogates. */
    fun string(s: String): String {
        val out = StringBuilder(s.length + 2).append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> out.append("\\\"")
                c == '\\' -> out.append("\\\\")
                c == '\n' -> out.append("\\n")
                c == '\r' -> out.append("\\r")
                c == '\t' -> out.append("\\t")
                c == '\b' -> out.append("\\b")
                c == '\u000C' -> out.append("\\f")
                c < ' ' || c == '\u2028' || c == '\u2029' -> out.append(hex(c))
                Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> {
                    out.append(c).append(s[i + 1])
                    i++
                }
                Character.isSurrogate(c) -> out.append(hex(c))
                else -> out.append(c)
            }
            i++
        }
        return out.append('"').toString()
    }

    private fun hex(c: Char) = "\\u" + Integer.toHexString(c.code).padStart(4, '0')
}

/** JavaScript's view of the values in a message (org.json's types). */
object JsValue {
    private const val MAX_SAFE = 9007199254740991L // Number.MAX_SAFE_INTEGER

    /** Number.isInteger(v), for the ids JavaScript writes exactly; else null. */
    fun integer(v: Any?): Long? = when (v) {
        is Int, is Long, is Short, is Byte -> (v as Number).toLong().takeIf { it in -MAX_SAFE..MAX_SAFE }
        is BigInteger -> if (v.bitLength() < 63) v.toLong().takeIf { it in -MAX_SAFE..MAX_SAFE } else null
        is BigDecimal -> try {
            v.toBigIntegerExact().let { if (it.bitLength() < 63) it.toLong().takeIf { n -> n in -MAX_SAFE..MAX_SAFE } else null }
        } catch (e: ArithmeticException) {
            null
        }
        is Double, is Float -> (v as Number).toDouble().let { d ->
            if (d.isFinite() && d == Math.floor(d) && Math.abs(d) <= MAX_SAFE) d.toLong() else null
        }
        else -> null
    }

    /** Number(v); a missing value (undefined) is NaN. */
    fun number(v: Any?): Double = when (v) {
        null -> Double.NaN
        JSONObject.NULL -> 0.0
        is Boolean -> if (v) 1.0 else 0.0
        is Number -> v.toDouble()
        is String -> fromString(v)
        is JSONArray -> arrayText(v)?.let(::fromString) ?: Double.NaN
        else -> Double.NaN
    }

    // String(array) for the arrays Number() can read: "" for [] or [null], the one element's text for
    // [x]. Anything longer joins with commas and reads as NaN anyway.
    private fun arrayText(a: JSONArray): String? = when (a.length()) {
        0 -> ""
        1 -> when (val x = a.opt(0)) {
            null, JSONObject.NULL -> ""
            is String -> x
            is Number -> if (x is Double || x is Float || x is BigDecimal) x.toDouble().toString() else x.toString()
            is JSONArray -> arrayText(x)
            else -> null
        }
        else -> null
    }

    // ASCII digits only: on Android \d is any Unicode digit, which toDouble() then refuses with an exception. And no
    // two parts may take the same digits, or a long string that doesn't match takes quadratic time to refuse
    // (16,000 digits held the main thread for seconds).
    internal val DECIMAL = Regex("""[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?""")
    private val RADIX = Regex("""0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)""")

    /** JavaScript's StringToNumber. */
    fun fromString(raw: String): Double {
        val s = raw.trim { isJsSpace(it) }
        if (s.isEmpty()) return 0.0
        when (s) {
            "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY
            "-Infinity" -> return Double.NEGATIVE_INFINITY
        }
        if (RADIX.matches(s)) {
            val radix = when (s[1]) {
                'x', 'X' -> 16
                'o', 'O' -> 8
                else -> 2
            }
            return BigInteger(s.substring(2), radix).toDouble()
        }
        return if (DECIMAL.matches(s)) s.toDouble() else Double.NaN
    }

    // WhiteSpace and LineTerminator in JavaScript: tab, VT, FF, space, NBSP, BOM, the Zs spaces, LF, CR, LS, PS.
    private fun isJsSpace(c: Char) = c == '\t' || c == '\u000B' || c == '\u000C' || c == ' ' || c == '\u00A0' ||
        c == '\uFEFF' || c == '\n' || c == '\r' || c == '\u2028' || c == '\u2029' ||
        Character.getType(c) == Character.SPACE_SEPARATOR.toInt()
}
