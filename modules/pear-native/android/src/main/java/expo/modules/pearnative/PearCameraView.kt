package expo.modules.pearnative

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.widget.ImageView
import android.net.Uri
import android.util.Log
import android.util.Size
import androidx.annotation.OptIn
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.ExperimentalPersistentRecording
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.io.File
import java.io.FileOutputStream

private const val TAG = "PearCamera"
private const val MAX_RETRIES = 3
private const val RETRY_DELAY_MS = 400L
// Le zoom envoyé directement par le geste prime sur la propriété (qui arrive en retard) pendant ce délai.
private const val DIRECT_ZOOM_MS = 300L

// La dernière image de l'aperçu, réduite : montrée floue pendant que la caméra se rallume.
@Volatile
var lastCameraFrame: Bitmap? = null

// CameraX, déjà préparé au lancement de l'app (PearCameraModule) : ici on attend qu'il soit prêt.
suspend fun cameraProvider(context: Context): ProcessCameraProvider = suspendCancellableCoroutine { continuation ->
  val future = ProcessCameraProvider.getInstance(context)
  future.addListener({
    try {
      continuation.resume(future.get())
    } catch (e: Exception) {
      continuation.resumeWithException(e)
    }
  }, ContextCompat.getMainExecutor(context))
}

// L'appareil photo de Pear, directement sur CameraX : aperçu (TextureView, pour que les filtres de vue
// s'appliquent), photo et vidéo branchées ensemble pour passer de l'une à l'autre sans attendre, zoom
// réel (×0,6 sur une caméra multiple), choix d'un objectif précis (ultra grand-angle séparé), et
// vidéo « persistante » qui continue quand on change de caméra.
@SuppressLint("ViewConstructor")
class PearCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onReady by EventDispatcher()
  private val onCameraError by EventDispatcher()
  private val onFrame by EventDispatcher()

  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  // L'aperçu en 4:3, comme la photo : ils voient la même image, et la photo n'a plus qu'à être
  // recadrée comme l'écran (FILL_CENTER) pour être exactement ce qu'on a vu.
  private val preview = Preview.Builder()
    .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY).build())
    .build()
    .also { it.surfaceProvider = previewView.surfaceProvider }
  private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
  // La dernière image de la fois d'avant, floutée (réduite puis agrandie), jusqu'à la première vraie image.
  private val lastFrameView = ImageView(context).apply {
    scaleType = ImageView.ScaleType.CENTER_CROP
    val frame = lastCameraFrame
    if (frame != null) setImageBitmap(frame) else visibility = GONE
  }
  private var streamObserver: Observer<PreviewView.StreamState>? = null
  private var extrasBound = false
  private var bindStartedAt = 0L
  private var directZoomAt = 0L

  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var stateObserver: Observer<CameraState>? = null
  private var imageCapture: ImageCapture? = null
  // Gardée d'un branchement à l'autre : c'est ce qui permet à une vidéo de continuer sur l'autre caméra.
  private var videoCapture: VideoCapture<Recorder>? = null
  private var photoAvailable = true
  private var recording: Recording? = null
  private var recordingPromise: Promise? = null
  private var bindToken = 0
  private var retries = 0

  private var facing = "back"
  private var cameraId: String? = null
  private var zoom = 1f
  private var torch = false
  private var flash = false
  private var active = true
  private var needsBind = true
  var mute = false
  var videoBitrate = 4_000_000

  init {
    addView(previewView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    addView(lastFrameView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  // Le geste de zoom parle directement au natif, sans passer par React.
  fun setZoomDirect(value: Float) {
    zoom = value
    directZoomAt = SystemClock.uptimeMillis()
    applyZoom()
  }

  private fun rememberFrame() {
    try {
      val frame = previewView.bitmap ?: return
      val width = 40
      val height = maxOf(1, frame.height * width / maxOf(1, frame.width))
      lastCameraFrame = Bitmap.createScaledBitmap(frame, width, height, true)
      frame.recycle()
    } catch (e: Exception) {
      Log.w(TAG, "dernière image", e)
    }
  }

  fun setFacing(value: String) {
    if (value == facing) return
    facing = value
    needsBind = true
  }

  fun setCameraId(value: String?) {
    if (value == cameraId) return
    cameraId = value
    needsBind = true
  }

  fun setZoom(value: Float) {
    if (SystemClock.uptimeMillis() - directZoomAt < DIRECT_ZOOM_MS) return
    zoom = value
    applyZoom()
  }

  fun setTorch(value: Boolean) {
    torch = value
    camera?.cameraControl?.enableTorch(value)
  }

  fun setFlash(value: Boolean) {
    flash = value
    imageCapture?.let { photo ->
      try {
        applyFlash(photo)
      } catch (e: Exception) {
        Log.w(TAG, "flash", e)
        photo.flashMode = ImageCapture.FLASH_MODE_OFF
      }
    }
  }

  // Caméra avant : pas de vrai flash, c'est l'écran qui s'allume en blanc à pleine luminosité
  // (le « flash d'écran » de CameraX : PreviewView se couvre de blanc, règle la luminosité, attend
  // que l'exposition suive, puis prend la photo).
  private fun applyFlash(photo: ImageCapture) {
    if (facing == "front") {
      val window = appContext.currentActivity?.window
      if (flash && window != null) {
        previewView.setScreenFlashWindow(window)
        photo.screenFlash = previewView.screenFlash
        photo.flashMode = ImageCapture.FLASH_MODE_SCREEN
        return
      }
      photo.flashMode = ImageCapture.FLASH_MODE_OFF
      return
    }
    photo.flashMode = if (flash) ImageCapture.FLASH_MODE_ON else ImageCapture.FLASH_MODE_OFF
  }

  fun setActive(value: Boolean) {
    if (value == active) return
    active = value
    needsBind = value
    if (!value) {
      rememberFrame()
      unbind()
    }
  }

  // Après chaque lot de propriétés : on (re)branche la caméra s'il le faut, une seule fois.
  fun applyChanges() {
    if (active && needsBind) bind()
  }

  private fun applyZoom() {
    val control = camera ?: return
    val state = control.cameraInfo.zoomState.value
    val min = state?.minZoomRatio ?: 1f
    val max = state?.maxZoomRatio ?: 1f
    control.cameraControl.setZoomRatio(zoom.coerceIn(min, max))
  }

  @OptIn(ExperimentalCamera2Interop::class)
  private fun selector(): CameraSelector {
    val lens = if (facing == "front") CameraSelector.LENS_FACING_FRONT else CameraSelector.LENS_FACING_BACK
    val builder = CameraSelector.Builder().requireLensFacing(lens)
    val wanted = cameraId
    if (wanted != null && facing == "back") {
      // Un objectif précis (l'ultra grand-angle de l'A33) ; s'il n'existe pas, la caméra habituelle.
      builder.addCameraFilter { infos -> infos.filter { Camera2CameraInfo.from(it).cameraId == wanted }.ifEmpty { infos } }
    }
    return builder.build()
  }

  private fun bind() {
    needsBind = false
    val token = ++bindToken
    bindStartedAt = SystemClock.uptimeMillis()
    scope.launch {
      try {
        val cameraProvider = provider ?: cameraProvider(context).also { provider = it }
        if (token != bindToken || !active) return@launch
        val owner = appContext.currentActivity as? LifecycleOwner ?: throw IllegalStateException("L'app n'est pas prête.")

        // Photo : environ 2560 × 1920 (assez pour 2048 px après réduction), en 4:3, prise au plus vite.
        val photo = imageCapture ?: ImageCapture.Builder()
          .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
          .setResolutionSelector(
            ResolutionSelector.Builder()
              .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
              .setResolutionStrategy(ResolutionStrategy(Size(2560, 1920), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
              .build(),
          )
          .build()
          .also { imageCapture = it }
        val video = videoCapture ?: VideoCapture.withOutput(
          Recorder.Builder()
            .setQualitySelector(QualitySelector.from(Quality.HD, FallbackStrategy.lowerQualityOrHigherThan(Quality.HD)))
            .setTargetVideoEncodingBitRate(videoBitrate)
            .build(),
        ).also { videoCapture = it }

        stateObserver?.let { observer -> camera?.cameraInfo?.cameraState?.removeObserver(observer) }
        streamObserver?.let { previewView.previewStreamState.removeObserver(it) }
        extrasBound = false
        cameraProvider.unbindAll()
        // L'aperçu seul d'abord : la première image arrive plus vite. Photo et vidéo se branchent juste
        // après (sauf si une vidéo est en cours : elle doit continuer sur la nouvelle caméra).
        val staged = recording == null
        val bound = if (staged) {
          photoAvailable = true
          cameraProvider.bindToLifecycle(owner, selector(), preview)
        } else {
          bindExtras(cameraProvider, owner, photo, video)
        }
        camera = bound
        if (!staged) extrasBound = true
        try {
          applyFlash(photo)
        } catch (e: Exception) {
          Log.w(TAG, "flash", e)
          photo.flashMode = ImageCapture.FLASH_MODE_OFF
        }
        applyZoom()
        bound.cameraControl.enableTorch(torch)

        var announced = false
        var opening = false
        val observer = Observer<CameraState> { state ->
          if (token != bindToken) return@Observer
          if (state.type == CameraState.Type.OPENING) opening = true
          // Ouverture ratée (caméra occupée, fermée par le système) : on rebranche, quelques fois.
          if (!announced && (state.error != null || (opening && state.type == CameraState.Type.CLOSED)) && retries < MAX_RETRIES && active) {
            retries++
            Log.w(TAG, "caméra fermée à l'ouverture (${state.error?.code}), nouvel essai $retries")
            postDelayed({
              if (token == bindToken && active) {
                needsBind = true
                applyChanges()
              }
            }, RETRY_DELAY_MS)
            return@Observer
          }
          if (announced || state.type != CameraState.Type.OPEN) return@Observer
          announced = true
          retries = 0
          val zoomState = bound.cameraInfo.zoomState.value
          Log.i(TAG, "caméra ouverte après ${SystemClock.uptimeMillis() - bindStartedAt} ms")
          onReady(mapOf("minZoom" to (zoomState?.minZoomRatio ?: 1f).toDouble(), "maxZoom" to (zoomState?.maxZoomRatio ?: 1f).toDouble()))
        }
        stateObserver = observer
        bound.cameraInfo.cameraState.observe(owner, observer)

        // Première vraie image : on retire l'image floue, puis on branche photo et vidéo.
        var streamed = false
        val stream = Observer<PreviewView.StreamState> { state ->
          if (token != bindToken || streamed || state != PreviewView.StreamState.STREAMING) return@Observer
          streamed = true
          val elapsed = SystemClock.uptimeMillis() - bindStartedAt
          Log.i(TAG, "première image après $elapsed ms")
          onFrame(mapOf("ms" to elapsed.toDouble()))
          if (lastFrameView.visibility == VISIBLE) {
            lastFrameView.animate().alpha(0f).setDuration(160).withEndAction {
              lastFrameView.visibility = GONE
              lastFrameView.alpha = 1f
              lastFrameView.setImageDrawable(null)
            }.start()
          }
          if (staged) {
            post {
              if (token != bindToken || !active) return@post
              try {
                val full = bindExtras(cameraProvider, owner, photo, video)
                camera = full
                extrasBound = true
                try {
                  applyFlash(photo)
                } catch (e: Exception) {
                  photo.flashMode = ImageCapture.FLASH_MODE_OFF
                }
                applyZoom()
                full.cameraControl.enableTorch(torch)
                Log.i(TAG, "photo et vidéo branchées après ${SystemClock.uptimeMillis() - bindStartedAt} ms")
              } catch (e: Exception) {
                Log.w(TAG, "photo et vidéo non branchées", e)
              }
            }
          }
        }
        streamObserver = stream
        previewView.previewStreamState.observe(owner, stream)
      } catch (e: Exception) {
        Log.w(TAG, "caméra non branchée", e)
        onCameraError(mapOf("message" to (e.message ?: e.javaClass.simpleName)))
      }
    }
  }

  // Branche photo et vidéo avec l'aperçu. Si le téléphone ne sait pas les faire ensemble, la photo
  // viendra de l'aperçu.
  private fun bindExtras(cameraProvider: ProcessCameraProvider, owner: LifecycleOwner, photo: ImageCapture, video: VideoCapture<Recorder>): Camera {
    return try {
      photoAvailable = true
      cameraProvider.bindToLifecycle(owner, selector(), preview, photo, video)
    } catch (e: IllegalArgumentException) {
      Log.w(TAG, "photo et vidéo ensemble impossibles", e)
      photoAvailable = false
      cameraProvider.bindToLifecycle(owner, selector(), preview, video)
    }
  }

  private fun unbind() {
    bindToken++
    extrasBound = false
    streamObserver?.let { previewView.previewStreamState.removeObserver(it) }
    streamObserver = null
    stateObserver?.let { observer -> camera?.cameraInfo?.cameraState?.removeObserver(observer) }
    stateObserver = null
    camera = null
    // Seulement nos usages : une nouvelle vue de caméra (écran rouvert) a pu déjà se brancher, et
    // unbindAll la coupait juste après son ouverture (caméra noire jusqu'au changement d'onglet).
    val mine = listOfNotNull(preview, imageCapture, videoCapture).toTypedArray()
    try {
      provider?.unbind(*mine)
    } catch (e: Exception) {
      Log.w(TAG, "caméra non détachée", e)
    }
  }

  // La photo, déjà tournée et réduite (le JPEG n'a pas besoin d'orientation EXIF), en un seul passage.
  fun takePicture(maxSize: Int, quality: Int, promise: Promise) {
    val photo = imageCapture
    if (photo == null || !photoAvailable || !extrasBound || camera == null) {
      val frame = previewView.bitmap ?: return promise.reject("ERR_PEAR_CAMERA", "La caméra n'est pas prête.", null)
      save(frame, 0, maxSize, quality, null, promise)
      return
    }
    // Le cadre de l'écran au moment de la prise : la photo sera recadrée à ses proportions.
    val aspect = if (width > 0 && height > 0) width.toFloat() / height else null
    photo.takePicture(
      ContextCompat.getMainExecutor(context),
      object : ImageCapture.OnImageCapturedCallback() {
        override fun onCaptureSuccess(image: ImageProxy) {
          val rotation = image.imageInfo.rotationDegrees
          val bitmap = try {
            image.toBitmap()
          } catch (e: Exception) {
            image.close()
            promise.reject("ERR_PEAR_CAMERA", e.message ?: "Photo illisible", e)
            return
          }
          image.close()
          save(bitmap, rotation, maxSize, quality, aspect, promise)
        }

        override fun onError(exception: ImageCaptureException) {
          promise.reject("ERR_PEAR_CAMERA", exception.message ?: "Photo non prise", exception)
        }
      },
    )
  }

  // aspect : largeur / hauteur de l'écran ; la photo (une fois tournée) est recadrée au centre à ces
  // proportions, comme l'aperçu plein écran. Recadrage, rotation et réduction en un seul passage.
  private fun save(source: Bitmap, rotation: Int, maxSize: Int, quality: Int, aspect: Float?, promise: Promise) {
    scope.launch {
      try {
        val result = withContext(Dispatchers.Default) {
          val sideways = rotation % 180 != 0
          val turnedWidth = if (sideways) source.height else source.width
          val turnedHeight = if (sideways) source.width else source.height
          var keptWidth = turnedWidth
          var keptHeight = turnedHeight
          if (aspect != null && aspect > 0f) {
            if (turnedWidth.toFloat() / turnedHeight > aspect) keptWidth = (turnedHeight * aspect).toInt() else keptHeight = (turnedWidth / aspect).toInt()
          }
          val cropWidth = (if (sideways) keptHeight else keptWidth).coerceIn(1, source.width)
          val cropHeight = (if (sideways) keptWidth else keptHeight).coerceIn(1, source.height)
          val left = (source.width - cropWidth) / 2
          val top = (source.height - cropHeight) / 2
          val scale = minOf(1f, maxSize.toFloat() / maxOf(cropWidth, cropHeight))
          val matrix = Matrix().apply {
            postRotate(rotation.toFloat())
            postScale(scale, scale)
          }
          val cropped = cropWidth != source.width || cropHeight != source.height
          val output = if (rotation == 0 && scale >= 1f && !cropped) source else Bitmap.createBitmap(source, left, top, cropWidth, cropHeight, matrix, true)
          val file = File(context.cacheDir, "photo-${System.currentTimeMillis()}.jpg")
          FileOutputStream(file).use { output.compress(Bitmap.CompressFormat.JPEG, quality, it) }
          val size = Pair(output.width, output.height)
          if (output !== source) output.recycle()
          source.recycle()
          Triple(Uri.fromFile(file).toString(), size.first, size.second)
        }
        promise.resolve(mapOf("uri" to result.first, "width" to result.second, "height" to result.third))
      } catch (e: Exception) {
        promise.reject("ERR_PEAR_CAMERA", e.message ?: "Photo non enregistrée", e)
      }
    }
  }

  // Une vidéo qui survit au changement de caméra : elle n'est arrêtée que par stopRecording.
  @OptIn(ExperimentalPersistentRecording::class)
  @SuppressLint("MissingPermission")
  fun startRecording(promise: Promise) {
    val video = videoCapture
    if (video == null || !extrasBound || camera == null) return promise.reject("ERR_PEAR_CAMERA", "La caméra n'est pas prête.", null)
    if (recording != null) return promise.reject("ERR_PEAR_CAMERA", "Une vidéo est déjà en cours.", null)
    val file = File(context.cacheDir, "video-${System.currentTimeMillis()}.mp4")
    var pending = video.output.prepareRecording(context, FileOutputOptions.Builder(file).build())
    val canHear = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    if (!mute && canHear) pending = pending.withAudioEnabled()
    recordingPromise = promise
    recording = pending.asPersistentRecording().start(ContextCompat.getMainExecutor(context)) { event ->
      if (event !is VideoRecordEvent.Finalize) return@start
      val waiting = recordingPromise
      recordingPromise = null
      recording = null
      val kept = event.error == VideoRecordEvent.Finalize.ERROR_NONE ||
        event.error == VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED ||
        event.error == VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED ||
        (event.error == VideoRecordEvent.Finalize.ERROR_SOURCE_INACTIVE && file.length() > 0)
      if (kept) {
        waiting?.resolve(Uri.fromFile(file).toString())
      } else {
        file.delete()
        waiting?.reject("ERR_PEAR_VIDEO", event.cause?.message ?: "Vidéo non enregistrée", event.cause)
      }
    }
  }

  fun stopRecording() {
    recording?.stop()
  }

  fun release() {
    recording?.stop()
    rememberFrame()
    unbind()
    scope.cancel()
  }
}
