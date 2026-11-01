package expo.modules.pearnative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.core.view.WindowInsetsCompat
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import com.facebook.react.ReactActivity
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

// Même débit que l'appareil photo : l'incrustation ne fait pas regonfler la vidéo.
private const val VIDEO_BITRATE = 4_000_000

@OptIn(UnstableApi::class)
class PearNativeModule : Module() {
  // Passe avant le retour de React Native, et transmet à l'app chaque étape du geste.
  private val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackStarted(backEvent: BackEventCompat) = sendBack("started", backEvent)
    override fun handleOnBackProgressed(backEvent: BackEventCompat) = sendBack("progress", backEvent)
    override fun handleOnBackCancelled() = sendBack("cancelled", null)
    override fun handleOnBackPressed() = sendBack("invoked", null)
  }
  private var backRegistered = false

  private fun sendBack(type: String, event: BackEventCompat?) {
    sendEvent("onBack", mapOf("type" to type, "progress" to (event?.progress ?: 0f), "fromRight" to (event?.swipeEdge == BackEventCompat.EDGE_RIGHT)))
  }

  // React Native garde son retour toujours actif, ce qui empêche l'aperçu d'Android. Il ne propose
  // pas de réglage pour ça : on atteint donc ce champ privé. S'il change un jour, seul cet aperçu est perdu.
  private fun reactBackCallback(activity: ComponentActivity): OnBackPressedCallback? = try {
    val field = ReactActivity::class.java.getDeclaredField("mBackPressedCallback")
    field.isAccessible = true
    field.get(activity) as? OnBackPressedCallback
  } catch (e: Exception) {
    null
  }

  override fun definition() = ModuleDefinition {
    Name("PearNative")

    Events("onBack")

    // "system" : Android montre son propre aperçu pour quitter. "app" : l'app anime elle-même le geste.
    // "default" : retour normal, sans aperçu.
    AsyncFunction("setBackMode") { mode: String -> setBackMode(mode) }.runOnQueue(Queues.MAIN)

    // Le geste est allé au bout : le retour repasse par le chemin normal, jusqu'au BackHandler de l'app.
    AsyncFunction("completeBack") { completeBack() }.runOnQueue(Queues.MAIN)

    OnDestroy {
      backCallback.remove()
    }

    // La hauteur réelle de la barre d'Android : fine avec les gestes, plus haute avec les 3 boutons.
    Function("navigationBarHeight") {
      val activity = appContext.currentActivity ?: return@Function null
      val insets = activity.window?.decorView?.rootWindowInsets ?: return@Function null
      val bottom = WindowInsetsCompat.toWindowInsetsCompat(insets).getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      (bottom / activity.resources.displayMetrics.density).toDouble()
    }

    // Media3 doit être lancé depuis un fil qui a une boucle de messages : ici, le fil principal.
    AsyncFunction("burnOverlay") { videoUri: String, overlayUri: String, promise: Promise ->
      try {
        burnOverlay(videoUri, overlayUri, promise)
      } catch (e: Exception) {
        promise.reject("ERR_PEAR_VIDEO", e.message ?: "Incrustation impossible", e)
      }
    }.runOnQueue(Queues.MAIN)
  }

  private fun setBackMode(mode: String) {
    val activity = appContext.currentActivity as? ComponentActivity ?: return
    if (!backRegistered) {
      activity.onBackPressedDispatcher.addCallback(activity, backCallback)
      backRegistered = true
    }
    backCallback.isEnabled = mode == "app"
    reactBackCallback(activity)?.isEnabled = mode != "system"
  }

  private fun completeBack() {
    val activity = appContext.currentActivity as? ComponentActivity ?: return
    val wasEnabled = backCallback.isEnabled
    backCallback.isEnabled = false
    activity.onBackPressedDispatcher.onBackPressed()
    backCallback.isEnabled = wasEnabled
  }

  private fun burnOverlay(videoUri: String, overlayUri: String, promise: Promise) {
    val context = appContext.reactContext ?: throw IllegalStateException("L'app n'est pas prête.")
    val videoPath = Uri.parse(videoUri).path ?: throw IllegalArgumentException("Vidéo introuvable.")
    val overlayPath = Uri.parse(overlayUri).path ?: throw IllegalArgumentException("Calque introuvable.")

    val (width, height) = displayedSize(videoPath)
    val decoded = BitmapFactory.decodeFile(overlayPath) ?: throw IllegalArgumentException("Calque illisible.")
    val overlay = Bitmap.createScaledBitmap(decoded, width, height, true)

    val edited = EditedMediaItem.Builder(MediaItem.fromUri(videoUri))
      .setEffects(Effects(emptyList(), listOf<Effect>(OverlayEffect(listOf<TextureOverlay>(BitmapOverlay.createStaticBitmapOverlay(overlay))))))
      .build()

    val output = File(context.cacheDir, "edited-${System.currentTimeMillis()}.mp4")
    val encoder = DefaultEncoderFactory.Builder(context)
      .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(VIDEO_BITRATE).build())
      .build()

    Transformer.Builder(context)
      .setVideoMimeType(MimeTypes.VIDEO_H264)
      .setEncoderFactory(encoder)
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          File(overlayPath).delete()
          promise.resolve(Uri.fromFile(output).toString())
        }

        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
          File(overlayPath).delete()
          output.delete()
          promise.reject("ERR_PEAR_VIDEO", exportException.message ?: "Incrustation impossible", exportException)
        }
      })
      .build()
      .start(edited, output.absolutePath)
  }

  // La taille telle qu'on la voit : une vidéo filmée en portrait est souvent stockée couchée.
  private fun displayedSize(path: String): Pair<Int, Int> {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(path)
      val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull()
      val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull()
      val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      if (width == null || height == null) throw IllegalArgumentException("Vidéo illisible.")
      return if (rotation % 180 == 0) Pair(width, height) else Pair(height, width)
    } finally {
      retriever.release()
    }
  }
}
