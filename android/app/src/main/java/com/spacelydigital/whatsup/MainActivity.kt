package com.spacelydigital.whatsup

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ThreadFactory

// The whole app: one full-screen web view showing the page (web/, served by PageFiles), and the
// bridge that fetches, chimes, keeps the screen awake and passes Back to the page (Bridge.kt).
class MainActivity : Activity(), Bridge.Host {
    private val main = Handler(Looper.getMainLooper())
    private val net: ExecutorService = Executors.newFixedThreadPool(6, daemon("whatsup-net"))
    private val timer: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor(daemon("whatsup-timer"))
    private val fetcher = Fetcher(BuildConfig.USER_AGENT, UrlHttp(), timer)
    private val bridge = Bridge(this)
    private var chime: Chime? = null
    private var web: WebView? = null
    private var showsPage = false // false while a "can't run here" message is shown instead
    private var started = false // on screen, between onStart and onStop
    private var resumed = false
    private var wantsAwake = false // Settings > Keep screen awake, as the page reports it
    private var overlay = false
    private val losses = ArrayDeque<Long>() // when the page's process was lost, for the last minute

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val problem = webViewProblem()
        if (problem != null) return showProblem(problem)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.WEB_DEBUG)
        chime = Chime(this)
        showsPage = true
        makeWeb()
        if (Build.VERSION.SDK_INT >= 33) Back33.register(this) { back() }
    }

    // Android System WebView draws the page: it must be there, on, and new enough for the page's
    // JavaScript (93 or later) and for the bridge.
    private fun webViewProblem(): String? {
        val pkg = try {
            WebView.getCurrentWebViewPackage()
        } catch (e: RuntimeException) {
            null
        } ?: return getString(R.string.webview_missing)
        val version = pkg.versionName ?: ""
        if (webViewMajor(version) < MIN_WEBVIEW) return getString(R.string.webview_old, version)
        return null
    }

    private fun showProblem(text: String) {
        val view = TextView(this).apply {
            this.text = text
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.BLACK)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            gravity = Gravity.CENTER
            val pad = (resources.displayMetrics.widthPixels * 0.12f).toInt()
            setPadding(pad, 0, pad, 0)
        }
        setContentView(view)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun makeWeb() {
        val view = try {
            WebView(this)
        } catch (e: RuntimeException) {
            // The web view package went missing or was turned off after the check.
            showsPage = false
            return showProblem(getString(R.string.webview_missing))
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            view.destroy()
            showsPage = false
            return showProblem(getString(R.string.webview_old, WebView.getCurrentWebViewPackage()?.versionName ?: ""))
        }
        view.setBackgroundColor(Color.BLACK)
        view.isFocusable = true
        view.isFocusableInTouchMode = true
        view.isVerticalScrollBarEnabled = false
        view.isHorizontalScrollBarEnabled = false
        view.overScrollMode = View.OVER_SCROLL_NEVER
        view.isHapticFeedbackEnabled = false
        view.isLongClickable = false
        view.setOnLongClickListener { true } // a held OK is the page's, not a text-selection menu
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // the page keeps everything in localStorage
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100 // the page sizes its own text for a TV
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = false // no addresses sent to Google; the app reaches a fixed list only
        }
        // The page draws its own dark screens.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(view.settings, false)
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(false)
            setAcceptThirdPartyCookies(view, false)
        }
        // window.WhatsUpHost: only the app's own page, in the top frame, can post to the bridge.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { // checked above; lint looks here
            WebViewCompat.addWebMessageListener(view, "WhatsUpHost", setOf(PageFiles.ORIGIN)) { _, message, origin, isMainFrame, _ ->
                if (isMainFrame && origin.toString() == PageFiles.ORIGIN) Bridge.textOf(message)?.let(bridge::onMessage)
            }
        }
        view.webViewClient = Client()
        setContentView(view)
        web = view
        view.requestFocus()
        view.loadUrl(PageFiles.START)
    }

    private fun dropWeb() {
        val view = web ?: return
        web = null
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
        setOverlay(false)
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            return when (PageFiles.route(url.scheme, url.host, url.port)) {
                PageFiles.Route.PASS -> null
                PageFiles.Route.REFUSE -> empty(403, "Forbidden")
                PageFiles.Route.PAGE -> {
                    val asset = PageFiles.assetFor(url.path) ?: return empty(404, "Not Found")
                    try {
                        val mime = PageFiles.mimeType(asset)
                        WebResourceResponse(mime, PageFiles.encoding(mime), assets.open(asset))
                    } catch (e: IOException) {
                        empty(404, "Not Found")
                    }
                }
            }
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
            !PageFiles.mayNavigate(request.url.scheme, request.url.host, request.url.port)

        // The page loaded: tell it whether it is on screen. Home pressed while it was loading sent it off screen
        // before it could hear that (onPause's message came too early), and it ran its whole first launch hidden.
        override fun onPageFinished(view: WebView, url: String?) {
            if (view === web) js(Js.active(resumed))
        }

        // The page's process ended (out of memory, or a crash): start the page again, now or on return
        // to the app. If that keeps happening, close instead of looping.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.e(TAG, "page process gone (crash: ${detail.didCrash()})")
            if (view !== web) return true
            dropWeb()
            val now = SystemClock.elapsedRealtime()
            losses.addLast(now)
            while (losses.isNotEmpty() && now - losses.first() > 60_000) losses.removeFirst()
            if (losses.size > 3) {
                finish()
            } else if (resumed) {
                makeWeb()
            }
            return true
        }
    }

    private fun empty(code: Int, reason: String) =
        WebResourceResponse("text/plain", "utf-8", code, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

    override fun onStart() {
        super.onStart()
        started = true
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (showsPage && web == null) makeWeb()
        web?.onResume()
        // Undoes onStop's pauseTimers (process-wide), also for a web view made again just above.
        web?.resumeTimers()
        js(Js.active(true))
        applyAwake()
    }

    override fun onPause() {
        resumed = false
        // The page pauses its polling while the app is off screen, and resumes on return.
        js(Js.active(false))
        web?.onPause()
        applyAwake()
        super.onPause()
    }

    override fun onStop() {
        started = false
        // Off screen nothing on the page runs: onPause told it to stop polling and to hold any other request (the
        // replies to earlier ones still run it), and this also holds its timers (a map retry, the clock), so a hidden
        // app sends no requests at all.
        web?.pauseTimers()
        super.onStop()
    }

    override fun onDestroy() {
        dropWeb()
        chime?.release()
        chime = null
        net.shutdownNow()
        timer.shutdownNow()
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // The Menu key never reaches the page in Android's web view, so the app hands it over.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_MENU && web != null) {
            when (event.action) {
                KeyEvent.ACTION_DOWN -> js(Js.menuKey("keydown", event.repeatCount > 0))
                KeyEvent.ACTION_UP -> js(Js.menuKey("keyup", false))
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    // Back: while a screen is open over the map, the page closes it. Otherwise the app goes to the background, as
    // Home does, and comes back as it was. (Android 12 and later do that by themselves only for a phone launcher
    // activity; this TV launcher activity they would close, and every return after Back would load the page again.)
    private fun setOverlay(open: Boolean) {
        overlay = open
    }

    private fun back() {
        when {
            overlay && web != null -> js(Js.BACK)
            showsPage && moveTaskToBack(true) -> Unit
            else -> finish()
        }
    }

    // Android 12 and earlier only: the manifest opts in to Android 13's back callbacks (registered in onCreate),
    // so newer versions never call this.
    @SuppressLint("GestureBackNavigation", "MissingSuperCall")
    @Deprecated("Android 12 and earlier; Android 13 and later use the callback registered in onCreate")
    override fun onBackPressed() = back()

    @RequiresApi(33)
    private object Back33 {
        fun register(activity: Activity, back: () -> Unit) {
            activity.onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
        }
    }

    // Keep screen awake holds off the screensaver while the app is on screen, through the window's
    // own flag: nothing runs for it, and it ends by itself when the app leaves the screen.
    private fun applyAwake() {
        if (wantsAwake && resumed) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    // --- Bridge.Host
    override fun js(script: String) {
        web?.evaluateJavascript(script, null)
    }

    override fun fetch(url: String, timeoutMs: Long, binary: Boolean, done: (Reply) -> Unit) {
        val posted = System.nanoTime() // the page's wait starts now, even if no network thread is free yet
        try {
            net.execute {
                val reply = fetcher.get(url, timeoutMs, binary, posted)
                main.post { done(reply) }
            }
        } catch (e: RuntimeException) {
            done(Reply.CONNECTION_ERROR) // closing
        }
    }

    override fun onScreen() = started

    override fun overlay(open: Boolean) = setOverlay(open)

    override fun awake(on: Boolean) {
        wantsAwake = on
        applyAwake()
    }

    override fun chime(volume: Double) {
        chime?.play(volume.toFloat())
    }

    // Erase all data: the page has removed what it stored and reloads. The web view's own disk cache still holds the
    // satellite pictures around home and the aircraft photos it loaded, which the privacy policy says Erase deletes.
    override fun erase() {
        web?.clearCache(true)
    }

    override fun refused(host: String) {
        Log.w(TAG, "[bridge] refused $host")
    }

    companion object {
        private const val TAG = "WhatsUp"
        const val MIN_WEBVIEW = 93

        /** The major version in a WebView version name ("131.0.6778.135" -> 131); 0 if there is none. */
        fun webViewMajor(versionName: String) = versionName.substringBefore('.').trim().toIntOrNull() ?: 0

        private fun daemon(name: String) = ThreadFactory { r -> Thread(r, name).apply { isDaemon = true } }
    }
}
