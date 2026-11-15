package expo.modules.pearnative

import android.content.Context
import android.graphics.Outline
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.TextureView
import android.view.View
import android.view.ViewOutlineProvider
import com.facebook.react.bridge.ReactContext
import com.oney.WebRTCModule.PearTrackAccess
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import org.webrtc.EglBase
import org.webrtc.EglRenderer
import org.webrtc.GlRectDrawer
import org.webrtc.VideoTrack
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Une vidéo d'appel dans une vue ordinaire (TextureView) : contrairement à la SurfaceView de RTCView,
// elle se rogne comme n'importe quelle vue (coins arrondis) et se dessine dans l'ordre des vues (une
// vignette au-dessus de la grande image, sans conflit). Remplit son cadre en recadrant (« cover »).
class PearVideoView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val texture = TextureView(context)
  private val renderer = EglRenderer("pear-video")
  private var initialized = false
  private var track: VideoTrack? = null
  private var streamURL: String? = null
  private var radiusPx = 0f
  private val handler = Handler(Looper.getMainLooper())
  private var attempts = 0

  init {
    addView(texture)
    texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        ensureRenderer()
        renderer.createEglSurface(surface)
      }

      override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit

      override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        val done = CountDownLatch(1)
        renderer.releaseEglSurface { done.countDown() }
        done.await(1, TimeUnit.SECONDS)
        return true
      }

      override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
    }
    outlineProvider = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        outline.setRoundRect(0, 0, view.width, view.height, radiusPx)
      }
    }
    clipToOutline = true
  }

  private fun ensureRenderer() {
    if (initialized) return
    renderer.init(PearTrackAccess.eglContext(), EglBase.CONFIG_PLAIN, GlRectDrawer())
    initialized = true
  }

  fun setStream(url: String?) {
    if (url == streamURL) return
    detachTrack()
    streamURL = url
    attempts = 0
    attachTrack()
  }

  fun setMirror(mirror: Boolean) {
    ensureRenderer()
    renderer.setMirror(mirror)
  }

  fun setRadius(radius: Double) {
    radiusPx = (radius * resources.displayMetrics.density).toFloat()
    invalidateOutline()
  }

  // La piste d'un flux tout juste créé n'est pas toujours prête : on réessaie un peu.
  private fun attachTrack() {
    val url = streamURL ?: return
    val context = appContext.reactContext as? ReactContext ?: return
    ensureRenderer()
    val found = try {
      PearTrackAccess.videoTrack(context, url)
    } catch (e: Exception) {
      Log.w("PearVideo", "piste vidéo", e)
      null
    }
    if (found == null) {
      if (attempts++ < 20) handler.postDelayed({ if (streamURL == url && track == null) attachTrack() }, 150)
      return
    }
    track = found
    found.addSink(renderer)
  }

  private fun detachTrack() {
    handler.removeCallbacksAndMessages(null)
    try {
      track?.removeSink(renderer)
    } catch (e: Exception) {
      Log.w("PearVideo", "piste vidéo", e)
    }
    track = null
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    val width = right - left
    val height = bottom - top
    texture.layout(0, 0, width, height)
    if (width > 0 && height > 0) {
      ensureRenderer()
      renderer.setLayoutAspectRatio(width.toFloat() / height)
    }
    invalidateOutline()
  }

  // La vue est détruite : le fil de rendu et ses ressources partent avec elle.
  fun release() {
    detachTrack()
    if (initialized) {
      renderer.release()
      initialized = false
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (track == null) attachTrack()
  }

  override fun onDetachedFromWindow() {
    detachTrack()
    super.onDetachedFromWindow()
  }
}
