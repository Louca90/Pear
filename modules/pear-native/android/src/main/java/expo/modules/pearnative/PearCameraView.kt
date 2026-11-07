package expo.modules.pearnative

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Matrix
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

  private val previewView = PreviewView(context).apply {
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  private val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
  private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

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
    zoom = value
    applyZoom()
  }

  fun setTorch(value: Boolean) {
    torch = value
    camera?.cameraControl?.enableTorch(value)
  }

  fun setFlash(value: Boolean) {
    flash = value
    imageCapture?.flashMode = if (value) ImageCapture.FLASH_MODE_ON else ImageCapture.FLASH_MODE_OFF
  }

  fun setActive(value: Boolean) {
    if (value == active) return
    active = value
    needsBind = value
    if (!value) unbind()
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
        photo.flashMode = if (flash) ImageCapture.FLASH_MODE_ON else ImageCapture.FLASH_MODE_OFF
        val video = videoCapture ?: VideoCapture.withOutput(
          Recorder.Builder()
            .setQualitySelector(QualitySelector.from(Quality.HD, FallbackStrategy.lowerQualityOrHigherThan(Quality.HD)))
            .setTargetVideoEncodingBitRate(videoBitrate)
            .build(),
        ).also { videoCapture = it }

        stateObserver?.let { observer -> camera?.cameraInfo?.cameraState?.removeObserver(observer) }
        cameraProvider.unbindAll()
        val bound = try {
          photoAvailable = true
          cameraProvider.bindToLifecycle(owner, selector(), preview, photo, video)
        } catch (e: IllegalArgumentException) {
          // Ce téléphone ne sait pas faire photo et vidéo ensemble : la photo viendra de l'aperçu.
          Log.w(TAG, "photo et vidéo ensemble impossibles", e)
          photoAvailable = false
          cameraProvider.unbindAll()
          cameraProvider.bindToLifecycle(owner, selector(), preview, video)
        }
        camera = bound
        applyZoom()
        bound.cameraControl.enableTorch(torch)

        var announced = false
        val observer = Observer<CameraState> { state ->
          if (announced || token != bindToken || state.type != CameraState.Type.OPEN) return@Observer
          announced = true
          val zoomState = bound.cameraInfo.zoomState.value
          onReady(mapOf("minZoom" to (zoomState?.minZoomRatio ?: 1f).toDouble(), "maxZoom" to (zoomState?.maxZoomRatio ?: 1f).toDouble()))
        }
        stateObserver = observer
        bound.cameraInfo.cameraState.observe(owner, observer)
      } catch (e: Exception) {
        Log.w(TAG, "caméra non branchée", e)
        onCameraError(mapOf("message" to (e.message ?: e.javaClass.simpleName)))
      }
    }
  }

  private fun unbind() {
    bindToken++
    stateObserver?.let { observer -> camera?.cameraInfo?.cameraState?.removeObserver(observer) }
    stateObserver = null
    camera = null
    provider?.unbindAll()
  }

  // La photo, déjà tournée et réduite (le JPEG n'a pas besoin d'orientation EXIF), en un seul passage.
  fun takePicture(maxSize: Int, quality: Int, promise: Promise) {
    val photo = imageCapture
    if (photo == null || !photoAvailable || camera == null) {
      val frame = previewView.bitmap ?: return promise.reject("ERR_PEAR_CAMERA", "La caméra n'est pas prête.", null)
      save(frame, 0, maxSize, quality, promise)
      return
    }
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
          save(bitmap, rotation, maxSize, quality, promise)
        }

        override fun onError(exception: ImageCaptureException) {
          promise.reject("ERR_PEAR_CAMERA", exception.message ?: "Photo non prise", exception)
        }
      },
    )
  }

  private fun save(source: Bitmap, rotation: Int, maxSize: Int, quality: Int, promise: Promise) {
    scope.launch {
      try {
        val result = withContext(Dispatchers.Default) {
          val scale = minOf(1f, maxSize.toFloat() / maxOf(source.width, source.height))
          val matrix = Matrix().apply {
            postRotate(rotation.toFloat())
            postScale(scale, scale)
          }
          val output = if (rotation == 0 && scale >= 1f) source else Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
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
    if (video == null || camera == null) return promise.reject("ERR_PEAR_CAMERA", "La caméra n'est pas prête.", null)
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
    unbind()
    scope.cancel()
  }
}
