package com.spacelydigital.whatsup

import android.content.Context
import android.media.AudioAttributes
import android.media.SoundPool
import android.util.Log
import java.io.File
import java.io.IOException

// The alert chime (www/media/chime.mp3, the page's own file), played when the page asks: a plane
// entered the alert zone, or a Settings preview. One short sound on the media volume; it doesn't
// take audio focus, so music or a show playing elsewhere carries on.
class Chime(context: Context) {
    private val pool = SoundPool.Builder()
        .setMaxStreams(1)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
        )
        .build()
    private var sound = 0
    private var ready = false
    private var waiting: Float? = null // a chime asked for before the sound finished loading
    private var stream = 0

    init {
        pool.setOnLoadCompleteListener { _, id, status ->
            if (id == sound && status == 0) {
                ready = true
                waiting?.let(::play)
                waiting = null
            }
        }
        sound = try {
            context.assets.openFd(ASSET).use { pool.load(it, 1) }
        } catch (e: IOException) {
            // Stored compressed: SoundPool needs a plain file.
            try {
                val copy = File(context.cacheDir, "chime.mp3")
                context.assets.open(ASSET).use { input -> copy.outputStream().use { input.copyTo(it) } }
                pool.load(copy.path, 1)
            } catch (e2: IOException) {
                Log.e(TAG, "[chime] ${e2.message}")
                0
            }
        }
    }

    fun play(volume: Float) {
        val v = volume.coerceIn(0f, 1f)
        if (!ready) {
            waiting = v
            return
        }
        if (stream != 0) pool.stop(stream)
        stream = pool.play(sound, v, v, 1, 0, 1f)
    }

    fun release() {
        pool.release()
    }

    private companion object {
        const val ASSET = "www/media/chime.mp3"
        const val TAG = "WhatsUp"
    }
}
