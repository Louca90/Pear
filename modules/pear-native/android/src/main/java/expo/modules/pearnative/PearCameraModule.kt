package expo.modules.pearnative

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.util.Log
import androidx.camera.lifecycle.ProcessCameraProvider
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PearCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PearCamera")

    // CameraX se prépare dès le lancement de l'app : la première ouverture de l'appareil photo gagne ce temps.
    OnCreate {
      appContext.reactContext?.let { context ->
        try {
          ProcessCameraProvider.getInstance(context)
        } catch (e: Exception) {
          Log.w("PearCamera", "préparation de la caméra", e)
        }
      }
    }

    // Une image de la fois d'avant est gardée : l'écran peut s'afficher tout de suite.
    Function("hasLastFrame") { lastCameraFrame != null }

    // Les objectifs que le téléphone ouvre aux applications : côté, plage de zoom et angle de champ
    // (largeur du capteur / focale : plus c'est grand, plus l'image est large).
    Function("lenses") {
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any>>()
      lenses(context)
    }

    View(PearCameraView::class) {
      Events("onReady", "onCameraError", "onFrame")

      Prop("facing") { view: PearCameraView, facing: String -> view.setFacing(facing) }
      Prop("cameraId") { view: PearCameraView, id: String? -> view.setCameraId(id) }
      Prop("zoom") { view: PearCameraView, zoom: Float -> view.setZoom(zoom) }
      Prop("torch") { view: PearCameraView, on: Boolean -> view.setTorch(on) }
      Prop("flash") { view: PearCameraView, on: Boolean -> view.setFlash(on) }
      Prop("mute") { view: PearCameraView, mute: Boolean -> view.mute = mute }
      Prop("videoBitrate") { view: PearCameraView, bitrate: Int -> view.videoBitrate = bitrate }
      Prop("active") { view: PearCameraView, active: Boolean -> view.setActive(active) }

      OnViewDidUpdateProps { view -> view.applyChanges() }
      OnViewDestroys { view -> view.release() }

      AsyncFunction("setZoom") { view: PearCameraView, zoom: Float ->
        view.setZoomDirect(zoom)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("takePicture") { view: PearCameraView, maxSize: Int, quality: Int, promise: Promise ->
        view.takePicture(maxSize, quality, promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("startRecording") { view: PearCameraView, promise: Promise ->
        view.startRecording(promise)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("stopRecording") { view: PearCameraView ->
        view.stopRecording()
      }.runOnQueue(Queues.MAIN)
    }
  }

  private fun lenses(context: Context): List<Map<String, Any>> {
    val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    return manager.cameraIdList.mapNotNull { id ->
      try {
        val info = manager.getCameraCharacteristics(id)
        val facing = when (info.get(CameraCharacteristics.LENS_FACING)) {
          CameraCharacteristics.LENS_FACING_FRONT -> "front"
          CameraCharacteristics.LENS_FACING_BACK -> "back"
          else -> return@mapNotNull null
        }
        val focal = info.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.minOrNull() ?: return@mapNotNull null
        val sensor = info.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE) ?: return@mapNotNull null
        val range = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) info.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE) else null
        mapOf(
          "id" to id,
          "facing" to facing,
          "fieldOfView" to (sensor.width / focal).toDouble(),
          "minZoom" to (range?.lower ?: 1f).toDouble(),
          "maxZoom" to (range?.upper ?: 1f).toDouble(),
        )
      } catch (e: Exception) {
        null
      }
    }
  }
}
