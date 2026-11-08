package expo.modules.pearnative

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import android.webkit.MimeTypeMap
import android.view.View
import android.view.ViewTreeObserver
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.annotation.OptIn
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsCompat
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.DefaultVideoFrameProcessor
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.RgbMatrix
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
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

private const val DOWNLOAD_TIMEOUT_MS = 20_000
private const val DOWNLOAD_PROGRESS_MS = 250L
private const val DOWNLOAD_ATTEMPTS = 3
private const val DOWNLOAD_BACKOFF_MS = 2_000L
private const val APK_MIME = "application/vnd.android.package-archive"

// Les retouches d'une vidéo, envoyées depuis l'éditeur. Sans valeur : rien ne change.
class VideoEdit : Record {
  @Field var overlayUri: String? = null
  // 4 × 4 par colonnes, appliquée à (R, G, B, 1).
  @Field var matrix: List<Double>? = null
  @Field var startMs: Double? = null
  @Field var endMs: Double? = null
  @Field var mute: Boolean = false
  @Field var speed: Double = 1.0
  @Field var bitrate: Int = 4_000_000
}

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

  // Les marges système, remesurées à chaque mise en page et quand la fenêtre reprend le focus
  // (déverrouillage) : lancée sous l'écran de verrouillage, l'app peut lire des valeurs fausses au départ.
  private var insetsView: View? = null
  private var lastInsets: Map<String, Double>? = null
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { emitInsets() }
  private val focusListener = ViewTreeObserver.OnWindowFocusChangeListener { emitInsets() }

  private fun readInsets(): Map<String, Double>? {
    val activity = appContext.currentActivity ?: return null
    val insets = activity.window?.decorView?.rootWindowInsets ?: return null
    val compat = WindowInsetsCompat.toWindowInsetsCompat(insets)
    val density = activity.resources.displayMetrics.density
    val top = compat.getInsets(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()).top
    val bottom = compat.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
    return mapOf("top" to (top / density).toDouble(), "bottom" to (bottom / density).toDouble())
  }

  private fun emitInsets() {
    val insets = readInsets() ?: return
    if (insets == lastInsets) return
    lastInsets = insets
    sendEvent("onInsetsChange", insets)
  }

  private fun watchInsets() {
    val view = appContext.currentActivity?.window?.decorView ?: return
    if (insetsView === view) return
    unwatchInsets()
    view.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
    view.viewTreeObserver.addOnWindowFocusChangeListener(focusListener)
    insetsView = view
    emitInsets()
  }

  private fun unwatchInsets() {
    insetsView?.viewTreeObserver?.let {
      if (it.isAlive) {
        it.removeOnGlobalLayoutListener(layoutListener)
        it.removeOnWindowFocusChangeListener(focusListener)
      }
    }
    insetsView = null
  }

  private fun sendBack(type: String, event: BackEventCompat?) {
    sendEvent("onBack", mapOf("type" to type, "progress" to (event?.progress ?: 0f), "fromRight" to (event?.swipeEdge == BackEventCompat.EDGE_RIGHT)))
  }

  // React Native garde son retour toujours actif, ce qui empêche l'aperçu d'Android. Il ne propose
  // pas de réglage pour ça (vérifié avec React Native 0.88) : on atteint donc ce champ privé. S'il
  // change un jour, seul cet aperçu est perdu : le retour normal continue de marcher, et l'app le
  // signale dans son journal (backHookAvailable). À revérifier à chaque mise à jour de React Native.
  private fun reactBackCallback(activity: ComponentActivity): OnBackPressedCallback? = try {
    val field = ReactActivity::class.java.getDeclaredField("mBackPressedCallback")
    field.isAccessible = true
    field.get(activity) as? OnBackPressedCallback
  } catch (e: Exception) {
    Log.w("PearNative", "Champ mBackPressedCallback introuvable : aperçu du retour désactivé", e)
    null
  }

  override fun definition() = ModuleDefinition {
    Name("PearNative")

    Events("onBack", "onDownloadProgress", "onInsetsChange", "onShare")

    // Photos et vidéos partagées depuis une autre app (menu « Partager », lot 12) : Pear déjà ouvert
    // reçoit l'intention ici ; au lancement, elle est lue dans celle de l'activité.
    OnNewIntent { intent ->
      if (isShare(intent)) {
        pendingShare = intent
        sendEvent("onShare", emptyMap<String, Any>())
      }
    }

    // Copiées dans le cache de Pear (l'autre app peut retirer son autorisation de lecture), puis
    // l'intention est oubliée pour ne pas être relue au prochain retour dans l'app.
    AsyncFunction("takeSharedMedia") {
      val activity = appContext.currentActivity
      val intent = pendingShare ?: activity?.intent?.takeIf { isShare(it) }
      pendingShare = null
      if (intent == null) return@AsyncFunction emptyList<Map<String, Any>>()
      activity?.intent = Intent(Intent.ACTION_MAIN)
      sharedMedia(intent)
    }

    // "system" : Android montre son propre aperçu pour quitter. "app" : l'app anime elle-même le geste.
    // "default" : retour normal, sans aperçu.
    AsyncFunction("setBackMode") { mode: String -> setBackMode(mode) }.runOnQueue(Queues.MAIN)

    // Faux si la réflexion sur React Native ne marche plus (voir reactBackCallback).
    Function("backHookAvailable") {
      val activity = appContext.currentActivity as? ComponentActivity ?: return@Function true
      reactBackCallback(activity) != null
    }

    // Le geste est allé au bout : le retour repasse par le chemin normal, jusqu'au BackHandler de l'app.
    AsyncFunction("completeBack") { completeBack() }.runOnQueue(Queues.MAIN)

    // Recharge l'interface (changement de langue) : le code JS repart de zéro, l'app reste ouverte.
    AsyncFunction("reloadApp") {
      val app = appContext.currentActivity?.application as? com.facebook.react.ReactApplication
        ?: throw IllegalStateException("Application introuvable.")
      val host = app.reactHost ?: throw IllegalStateException("Hôte React introuvable.")
      host.reload("langue")
      Unit
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      backCallback.remove()
      unwatchInsets()
    }

    // Barre d'état (et encoche) en haut, barre de navigation en bas, en dp. null si l'app n'a pas encore de fenêtre.
    Function("systemInsets") { readInsets() }

    AsyncFunction("watchInsets") { watchInsets() }.runOnQueue(Queues.MAIN)

    OnActivityEntersForeground {
      appContext.currentActivity?.runOnUiThread {
        watchInsets()
        emitInsets()
      }
    }

    // La hauteur réelle de la barre d'Android : fine avec les gestes, plus haute avec les 3 boutons.
    Function("navigationBarHeight") {
      val activity = appContext.currentActivity ?: return@Function null
      val insets = activity.window?.decorView?.rootWindowInsets ?: return@Function null
      val bottom = WindowInsetsCompat.toWindowInsetsCompat(insets).getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      (bottom / activity.resources.displayMetrics.density).toDouble()
    }

    // Le versionCode de l'APK installé, pour le comparer à celui de la dernière release.
    Function("appVersionCode") {
      val context = appContext.reactContext ?: return@Function null
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()).toDouble()
    }

    Function("appVersionName") {
      val context = appContext.reactContext ?: return@Function null
      context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }

    // « Installer des apps inconnues » : Android demande cette autorisation, app par app.
    Function("canRequestPackageInstalls") {
      val context = appContext.reactContext ?: return@Function false
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()
    }

    Function("openUnknownAppSourcesSettings") {
      val activity = appContext.currentActivity ?: return@Function false
      val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
      activity.startActivity(intent)
      true
    }

    // Batterie « sans restriction » : sinon Android retarde les pushs quand le téléphone dort.
    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function false
      val power = context.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    // Fenêtre système « Autoriser Pear à fonctionner en arrière-plan ? ». Si elle n'existe pas sur ce
    // téléphone, on ouvre la liste des optimisations de batterie.
    Function("requestIgnoreBatteryOptimizations") {
      val activity = appContext.currentActivity ?: return@Function false
      try {
        activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${activity.packageName}")))
      } catch (e: Exception) {
        Log.w("PearNative", "Fenêtre de batterie indisponible", e)
        activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
      }
      true
    }

    // Reprend là où le fichier partiel s'est arrêté, si le serveur le permet.
    AsyncFunction("downloadFile") { url: String, fileUri: String -> downloadFile(url, fileUri) }

    AsyncFunction("sha256File") { fileUri: String -> sha256File(fileUri) }

    // Réduit une image (photo de profil) : plus grand côté maxSize, recompressée en JPEG.
    // Taille d'une photo telle qu'on la voit (orientation EXIF appliquée).
    AsyncFunction("imageSize") { uri: String -> imageSize(uri) }

    // Recadre une photo (rect en fractions de la photo vue puis tournée de rotation), la réduit et
    // l'enregistre en JPEG, hors du fil de l'interface : photo de profil.
    AsyncFunction("cropImage") { inputUri: String, outputUri: String, rect: List<Double>, rotation: Int, maxSize: Int, quality: Int ->
      if (rect.size != 4) throw IllegalArgumentException("Cadre invalide.")
      cropImage(inputUri, outputUri, FloatArray(4) { rect[it].toFloat() }, rotation, maxSize, quality)
    }

    AsyncFunction("resizeImage") { inputUri: String, outputUri: String, maxSize: Int, quality: Int -> resizeImage(inputUri, outputUri, maxSize, quality) }

    Function("installApk") { fileUri: String -> installApk(fileUri) }

    // Media3 doit être lancé depuis un fil qui a une boucle de messages : ici, le fil principal.
    // Le débit vient de src/config.ts : le même que l'appareil photo, l'incrustation ne fait pas regonfler la vidéo.
    AsyncFunction("burnOverlay") { videoUri: String, overlayUri: String, bitrate: Int, promise: Promise ->
      try {
        editVideo(videoUri, VideoEdit().also { it.overlayUri = overlayUri; it.bitrate = bitrate }, promise)
      } catch (e: Exception) {
        promise.reject("ERR_PEAR_VIDEO", e.message ?: "Incrustation impossible", e)
      }
    }.runOnQueue(Queues.MAIN)

    // Dessine une vue (et tout ce qu'elle contient) dans une image PNG, agrandie de `scale` : les textes
    // et les traits sont redessinés à cette taille, donc nets. Le fond reste transparent.
    // Luminosité de la fenêtre de Pear (0 à 1), -1 pour revenir au réglage du téléphone : l'écran
    // éclaire le visage quand on filme avec la caméra avant et le flash.
    AsyncFunction("setScreenBrightness") { value: Double ->
      val window = appContext.currentActivity?.window ?: return@AsyncFunction
      window.attributes = window.attributes.apply { screenBrightness = if (value < 0) -1f else value.toFloat().coerceIn(0f, 1f) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("captureView") { tag: Int, outputUri: String, scale: Double ->
      captureView(tag, outputUri, scale)
    }.runOnQueue(Queues.MAIN)

    // Toutes les retouches d'une vidéo en un passage : couleurs (matrice), calque, découpe, son, vitesse.
    AsyncFunction("editVideo") { videoUri: String, edit: VideoEdit, promise: Promise ->
      try {
        editVideo(videoUri, edit, promise)
      } catch (e: Exception) {
        promise.reject("ERR_PEAR_VIDEO", e.message ?: "Retouche impossible", e)
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

  private fun pathOf(fileUri: String) = Uri.parse(fileUri).path ?: throw IllegalArgumentException("Fichier introuvable.")

  // Plusieurs essais : GitHub répond parfois 502/503/504 ou coupe la connexion. Chaque essai reprend
  // là où le précédent s'est arrêté ; si la reprise est refusée (416), on repart de zéro.
  private fun downloadFile(url: String, fileUri: String) {
    val file = File(pathOf(fileUri))
    file.parentFile?.mkdirs()
    var lastError: Exception? = null
    for (attempt in 0 until DOWNLOAD_ATTEMPTS) {
      if (attempt > 0) Thread.sleep(DOWNLOAD_BACKOFF_MS * attempt)
      try {
        downloadOnce(url, file)
        return
      } catch (e: DownloadHttpException) {
        lastError = e
        if (!e.retryable) throw e
      } catch (e: java.io.IOException) {
        lastError = e
      }
    }
    throw lastError ?: IllegalStateException("Téléchargement impossible.")
  }

  private class DownloadHttpException(val code: Int) : IllegalStateException("Téléchargement refusé ($code).") {
    val retryable = code >= 500 || code == 408 || code == 429
  }

  private fun downloadOnce(url: String, file: File) {
    val already = if (file.exists()) file.length() else 0L
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = DOWNLOAD_TIMEOUT_MS
      connection.readTimeout = DOWNLOAD_TIMEOUT_MS
      if (already > 0) connection.setRequestProperty("Range", "bytes=$already-")
      val code = connection.responseCode
      if (code == 416 && already > 0) {
        // Reprise impossible (fichier partiel plus long ou abîmé) : on l'efface, l'essai suivant repart de zéro.
        file.delete()
        throw java.io.IOException("Reprise refusée.")
      }
      if (code != HttpURLConnection.HTTP_OK && code != HttpURLConnection.HTTP_PARTIAL) throw DownloadHttpException(code)
      // Le serveur a ignoré la reprise : on repart de zéro.
      val resume = code == HttpURLConnection.HTTP_PARTIAL
      val start = if (resume) already else 0L
      val total = start + connection.contentLengthLong.coerceAtLeast(0L)
      var received = start
      var lastEvent = 0L
      connection.inputStream.use { input ->
        FileOutputStream(file, resume).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            received += read
            val now = System.currentTimeMillis()
            if (now - lastEvent > DOWNLOAD_PROGRESS_MS) {
              lastEvent = now
              sendEvent("onDownloadProgress", mapOf("received" to received.toDouble(), "total" to total.toDouble()))
            }
          }
        }
      }
      sendEvent("onDownloadProgress", mapOf("received" to received.toDouble(), "total" to total.toDouble()))
    } finally {
      connection.disconnect()
    }
  }

  private fun resizeImage(inputUri: String, outputUri: String, maxSize: Int, quality: Int): String {
    val context = appContext.reactContext ?: throw IllegalStateException("Contexte indisponible.")
    val uri = Uri.parse(inputUri)
    // On lit d'abord la taille seule, pour décoder directement une version réduite (mémoire).
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= maxSize && bounds.outHeight / (sample * 2) >= maxSize) sample *= 2
    val decoded = context.contentResolver.openInputStream(uri).use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: throw IllegalArgumentException("Image illisible.")
    val scale = minOf(1f, maxSize.toFloat() / maxOf(decoded.width, decoded.height))
    val bitmap = if (scale < 1f) Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true) else decoded
    val file = File(pathOf(outputUri))
    file.parentFile?.mkdirs()
    FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }
    return outputUri
  }

  private fun exifDegrees(context: android.content.Context, uri: Uri): Int = try {
    context.contentResolver.openInputStream(uri)?.use { input ->
      when (ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90, ExifInterface.ORIENTATION_TRANSPOSE -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270, ExifInterface.ORIENTATION_TRANSVERSE -> 270
        else -> 0
      }
    } ?: 0
  } catch (e: Exception) {
    0
  }

  private fun imageSize(inputUri: String): Map<String, Int> {
    val context = appContext.reactContext ?: throw IllegalStateException("Contexte indisponible.")
    val uri = Uri.parse(inputUri)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("Image illisible.")
    val sideways = exifDegrees(context, uri) % 180 != 0
    return mapOf("width" to if (sideways) bounds.outHeight else bounds.outWidth, "height" to if (sideways) bounds.outWidth else bounds.outHeight)
  }

  private fun cropImage(inputUri: String, outputUri: String, rect: FloatArray, rotation: Int, maxSize: Int, quality: Int): String {
    val context = appContext.reactContext ?: throw IllegalStateException("Contexte indisponible.")
    val uri = Uri.parse(inputUri)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("Image illisible.")
    // Décodée directement réduite, tant que la partie gardée reste plus grande que maxSize.
    val kept = maxOf(bounds.outWidth, bounds.outHeight) * maxOf(rect[2], rect[3])
    var sample = 1
    while (kept / (sample * 2) >= maxSize) sample *= 2
    val decoded = context.contentResolver.openInputStream(uri).use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: throw IllegalArgumentException("Image illisible.")
    val turn = (exifDegrees(context, uri) + rotation) % 360
    val turned = if (turn == 0) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(turn.toFloat()) }, true)
    if (turned !== decoded) decoded.recycle()
    val left = (rect[0] * turned.width).toInt().coerceIn(0, turned.width - 1)
    val top = (rect[1] * turned.height).toInt().coerceIn(0, turned.height - 1)
    val width = (rect[2] * turned.width).toInt().coerceIn(1, turned.width - left)
    val height = (rect[3] * turned.height).toInt().coerceIn(1, turned.height - top)
    val scale = minOf(1f, maxSize.toFloat() / maxOf(width, height))
    val output = Bitmap.createBitmap(turned, left, top, width, height, Matrix().apply { postScale(scale, scale) }, true)
    val file = File(pathOf(outputUri))
    file.parentFile?.mkdirs()
    FileOutputStream(file).use { output.compress(Bitmap.CompressFormat.JPEG, quality, it) }
    if (output !== turned) output.recycle()
    turned.recycle()
    return outputUri
  }

  private fun sha256File(fileUri: String): String {
    val digest = MessageDigest.getInstance("SHA-256")
    File(pathOf(fileUri)).inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        digest.update(buffer, 0, read)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  private fun installApk(fileUri: String) {
    val activity = appContext.currentActivity ?: throw IllegalStateException("L'app n'est pas prête.")
    val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.pearupdate", File(pathOf(fileUri)))
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, APK_MIME)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    activity.startActivity(intent)
  }

  private var pendingShare: Intent? = null

  private fun isShare(intent: Intent?) = intent?.action == Intent.ACTION_SEND || intent?.action == Intent.ACTION_SEND_MULTIPLE

  @Suppress("DEPRECATION")
  private fun sharedMedia(intent: Intent): List<Map<String, Any>> {
    val context = appContext.reactContext ?: return emptyList()
    val uris: List<Uri> = if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: arrayListOf()
    } else {
      listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
    }
    return uris.mapIndexedNotNull { index, uri ->
      try {
        val mime = context.contentResolver.getType(uri) ?: intent.type ?: return@mapIndexedNotNull null
        if (!mime.startsWith("image/") && !mime.startsWith("video/")) return@mapIndexedNotNull null
        val extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime) ?: if (mime.startsWith("video/")) "mp4" else "jpg"
        val target = File(context.cacheDir, "partage-${System.currentTimeMillis()}-$index.$extension")
        context.contentResolver.openInputStream(uri)?.use { input -> FileOutputStream(target).use { input.copyTo(it) } } ?: return@mapIndexedNotNull null
        mapOf("uri" to Uri.fromFile(target).toString(), "mime" to mime, "size" to target.length().toDouble())
      } catch (e: Exception) {
        Log.w("PearNative", "média partagé illisible", e)
        null
      }
    }
  }

  private fun captureView(tag: Int, outputUri: String, scale: Double): String {
    val context = appContext.reactContext as? ReactContext ?: throw IllegalStateException("L'app n'est pas prête.")
    val view = UIManagerHelper.getUIManagerForReactTag(context, tag)?.resolveView(tag)
      ?: throw IllegalArgumentException("Vue introuvable.")
    if (view.width <= 0 || view.height <= 0) throw IllegalStateException("Vue pas encore mesurée.")
    val factor = scale.toFloat().coerceIn(0.5f, 4f)
    val bitmap = Bitmap.createBitmap((view.width * factor).toInt(), (view.height * factor).toInt(), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.scale(factor, factor)
    view.draw(canvas)
    val path = Uri.parse(outputUri).path ?: throw IllegalArgumentException("Fichier invalide.")
    FileOutputStream(path).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bitmap.recycle()
    return outputUri
  }

  private fun editVideo(videoUri: String, edit: VideoEdit, promise: Promise) {
    val context = appContext.reactContext ?: throw IllegalStateException("L'app n'est pas prête.")
    val videoPath = Uri.parse(videoUri).path ?: throw IllegalArgumentException("Vidéo introuvable.")
    val overlayPath = edit.overlayUri?.let { Uri.parse(it).path ?: throw IllegalArgumentException("Calque introuvable.") }

    val effects = mutableListOf<Effect>()
    // Les couleurs d'abord : le texte et les dessins du calque gardent les leurs.
    edit.matrix?.let { values ->
      if (values.size != 16) throw IllegalArgumentException("Matrice de couleur invalide.")
      val matrix = FloatArray(16) { values[it].toFloat() }
      effects.add(object : RgbMatrix {
        override fun getMatrix(presentationTimeUs: Long, useHdr: Boolean) = matrix
      })
    }
    overlayPath?.let { path ->
      val (width, height) = displayedSize(videoPath)
      val decoded = BitmapFactory.decodeFile(path) ?: throw IllegalArgumentException("Calque illisible.")
      val overlay = Bitmap.createScaledBitmap(decoded, width, height, true)
      effects.add(OverlayEffect(listOf<TextureOverlay>(BitmapOverlay.createStaticBitmapOverlay(overlay))))
    }

    val clipping = MediaItem.ClippingConfiguration.Builder()
      .setStartPositionMs(edit.startMs?.toLong() ?: 0L)
      .setEndPositionMs(edit.endMs?.toLong() ?: C.TIME_END_OF_SOURCE)
      .build()
    val item = MediaItem.Builder().setUri(videoUri).setClippingConfiguration(clipping).build()
    val edited = EditedMediaItem.Builder(item)
      .setEffects(Effects(emptyList(), effects))
      .setRemoveAudio(edit.mute)
    if (edit.speed != 1.0) {
      val speed = edit.speed.toFloat()
      edited.setSpeed(object : SpeedProvider {
        override fun getSpeed(timeUs: Long) = speed
        override fun getNextSpeedChangeTimeUs(timeUs: Long) = C.TIME_UNSET
      })
    }

    val output = File(context.cacheDir, "edited-${System.currentTimeMillis()}.mp4")
    val encoder = DefaultEncoderFactory.Builder(context)
      .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(edit.bitrate).build())
      .build()
    // Couleurs traitées telles qu'enregistrées (sans passer en lumière linéaire), comme l'aperçu SVG.
    val frames = DefaultVideoFrameProcessor.Factory.Builder()
      .setSdrWorkingColorSpace(DefaultVideoFrameProcessor.WORKING_COLOR_SPACE_ORIGINAL)
      .build()

    Transformer.Builder(context)
      .setVideoMimeType(MimeTypes.VIDEO_H264)
      .setEncoderFactory(encoder)
      .setVideoFrameProcessorFactory(frames)
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          overlayPath?.let { File(it).delete() }
          promise.resolve(Uri.fromFile(output).toString())
        }

        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
          overlayPath?.let { File(it).delete() }
          output.delete()
          promise.reject("ERR_PEAR_VIDEO", exportException.message ?: "Retouche impossible", exportException)
        }
      })
      .build()
      .start(edited.build(), output.absolutePath)
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
