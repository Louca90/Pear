package expo.modules.pearnative

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.RectF
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraEffect
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.effects.OverlayEffect
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

private const val LENS_TAG = "PearLens"
// Un visage plus vieux que ça n'est plus dessiné (tête sortie du cadre).
private const val FACE_STALE_MS = 400L

// Les points du visage utilisés (numérotation du maillage MediaPipe, 478 points).
private const val EYE_OUTER_RIGHT = 33
private const val EYE_OUTER_LEFT = 263
private const val EYE_LOWER_RIGHT = 145
private const val EYE_LOWER_LEFT = 374
private const val FOREHEAD = 10
private const val CHIN = 152
private const val NOSE_TIP = 1
private const val UNDER_NOSE = 164
private const val UPPER_LIP = 13
private const val LOWER_LIP = 14

// Un visage suivi, dans les coordonnées du capteur (communes à l'analyse et aux images dessinées).
class FaceState(val points: FloatArray, val shapes: Map<String, Float>, val at: Long) {
  fun x(index: Int) = points[index * 2]
  fun y(index: Int) = points[index * 2 + 1]
  fun shape(name: String) = shapes[name] ?: 0f
}

// Lentilles (filtres fun) : MediaPipe suit le visage sur une petite image d'analyse ; l'effet est
// dessiné par-dessus chaque image de la caméra (aperçu et vidéo) par OverlayEffect de CameraX.
// Tout se passe dans les coordonnées du capteur : les deux flux n'ont ni la même taille ni la même
// orientation, le capteur est leur repère commun.
class FaceLens(private val context: Context) : AutoCloseable {
  @Volatile var lens: String = "none"
  @Volatile private var face: FaceState? = null
  private var landmarker: FaceLandmarker? = null
  private var lastTimestamp = 0L
  private val analyzer: ExecutorService = Executors.newSingleThreadExecutor()
  private val drawThread = HandlerThread("PearLensDraw").apply { start() }
  private val renderer = LensRenderer()

  val analysis: ImageAnalysis = ImageAnalysis.Builder()
    .setResolutionSelector(
      ResolutionSelector.Builder()
        .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
        .setResolutionStrategy(ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
        .build(),
    )
    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
    .build()
    .also { it.setAnalyzer(analyzer) { image -> analyze(image) } }

  // Dessiné sur l'aperçu et la vidéo (la photo avec lentille est prise sur l'aperçu).
  val effect = OverlayEffect(CameraEffect.PREVIEW or CameraEffect.VIDEO_CAPTURE, 0, Handler(drawThread.looper)) { error ->
    Log.w(LENS_TAG, "effet", error)
  }.also { overlay ->
    overlay.setOnDrawListener { frame ->
      val canvas = frame.overlayCanvas
      canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
      val current = face
      val now = SystemClock.uptimeMillis()
      canvas.save()
      canvas.setMatrix(frame.sensorToBufferTransform)
      renderer.draw(canvas, lens, if (current != null && now - current.at < FACE_STALE_MS) current else null, now)
      canvas.restore()
      true
    }
  }

  // Le modèle se charge à part (une centaine de millisecondes), à la première lentille choisie.
  fun prepare() {
    if (landmarker != null) return
    analyzer.execute {
      if (landmarker != null) return@execute
      landmarker = create(Delegate.GPU) ?: create(Delegate.CPU)
    }
  }

  private fun create(delegate: Delegate): FaceLandmarker? = try {
    val base = BaseOptions.builder().setModelAssetPath("face_landmarker.task").setDelegate(delegate).build()
    val options = FaceLandmarker.FaceLandmarkerOptions.builder()
      .setBaseOptions(base)
      .setRunningMode(RunningMode.VIDEO)
      .setNumFaces(1)
      .setMinFaceDetectionConfidence(0.5f)
      .setMinFacePresenceConfidence(0.5f)
      .setMinTrackingConfidence(0.5f)
      .setOutputFaceBlendshapes(true)
      .build()
    FaceLandmarker.createFromOptions(context, options)
  } catch (e: Throwable) {
    Log.w(LENS_TAG, "suivi du visage indisponible ($delegate)", e)
    null
  }

  private fun analyze(image: androidx.camera.core.ImageProxy) {
    try {
      val tracker = landmarker
      if (tracker == null || lens == "none") return
      val rotation = image.imageInfo.rotationDegrees
      val sensorToBuffer = Matrix(image.imageInfo.sensorToBufferTransformMatrix)
      val buffer = image.toBitmap()
      // L'image remise droite pour le modèle, et le chemin inverse : image droite → image → capteur.
      val turn = Matrix().apply { postRotate(rotation.toFloat()) }
      val bounds = RectF(0f, 0f, buffer.width.toFloat(), buffer.height.toFloat())
      turn.mapRect(bounds)
      turn.postTranslate(-bounds.left, -bounds.top)
      val upright = if (rotation == 0) buffer else Bitmap.createBitmap(buffer, 0, 0, buffer.width, buffer.height, Matrix().apply { postRotate(rotation.toFloat()) }, false)
      val toSensor = Matrix()
      turn.invert(toSensor)
      val bufferToSensor = Matrix()
      sensorToBuffer.invert(bufferToSensor)
      toSensor.postConcat(bufferToSensor)

      var timestamp = SystemClock.uptimeMillis()
      if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 1
      lastTimestamp = timestamp
      val result = tracker.detectForVideo(BitmapImageBuilder(upright).build(), timestamp)
      val landmarks = result.faceLandmarks().firstOrNull()
      if (landmarks == null) {
        face = null
        return
      }
      val points = FloatArray(landmarks.size * 2)
      val width = upright.width.toFloat()
      val height = upright.height.toFloat()
      landmarks.forEachIndexed { index, point ->
        points[index * 2] = point.x() * width
        points[index * 2 + 1] = point.y() * height
      }
      toSensor.mapPoints(points)
      val shapes = HashMap<String, Float>()
      result.faceBlendshapes().ifPresent { all -> all.firstOrNull()?.forEach { shapes[it.categoryName()] = it.score() } }
      face = FaceState(points, shapes, SystemClock.uptimeMillis())
    } catch (e: Throwable) {
      Log.w(LENS_TAG, "analyse", e)
    } finally {
      image.close()
    }
  }

  override fun close() {
    analysis.clearAnalyzer()
    effect.clearOnDrawListener()
    effect.close()
    analyzer.execute {
      landmarker?.close()
      landmarker = null
    }
    analyzer.shutdown()
    drawThread.quitSafely()
  }
}

// Une particule (cœur, étoile, larme…), dans les coordonnées du capteur.
// turn : orientation du visage à la naissance (degrés), pour que la particule soit droite à l'écran.
private class Particle(var x: Float, var y: Float, val vx: Float, val vy: Float, val size: Float, val born: Long, val life: Long, val kind: Int, val spin: Float, val turn: Float)

private const val HEART = 0
private const val KISS = 1
private const val STAR = 2
private const val TEAR = 3

// Les dessins des lentilles. Chaque accessoire est tracé dans un repère du visage : 100 unités = la
// distance entre les coins extérieurs des yeux, x vers la droite de l'image, y vers le menton. Les
// valeurs sont lissées d'une image à l'autre pour que rien ne tremble.
class LensRenderer {
  private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
  private val path = Path()
  private val basis = Matrix()
  private val particles = ArrayList<Particle>()
  private var lastSpawn = 0L
  private var lastDraw = 0L
  // Repère lissé : origine (entre les yeux), axe x (vers la droite), axe y (vers le menton), échelle.
  private var smooth: FloatArray? = null

  fun draw(canvas: Canvas, lens: String, face: FaceState?, now: Long) {
    val dt = if (lastDraw == 0L) 0f else min(0.1f, (now - lastDraw) / 1000f)
    lastDraw = now
    if (face == null || lens == "none") {
      smooth = null
      drawParticles(canvas, now, dt)
      return
    }
    val frame = frameOf(face)
    when (lens) {
      "glasses" -> drawGlasses(canvas, face, frame)
      "crown" -> drawCrown(canvas, face, frame)
      "dog" -> drawDog(canvas, face, frame)
      "cat" -> drawCat(canvas, face, frame)
      "mustache" -> drawMustache(canvas, face, frame)
      "hearts" -> react(face, frame, now, HEART, face.shape("jawOpen") > 0.4f, UPPER_LIP)
      "kisses" -> react(face, frame, now, KISS, face.shape("mouthPucker") > 0.5f, UPPER_LIP)
      "stars" -> react(face, frame, now, STAR, (face.shape("mouthSmileLeft") + face.shape("mouthSmileRight")) / 2f > 0.45f, FOREHEAD)
      "tears" -> react(face, frame, now, TEAR, (face.shape("mouthFrownLeft") + face.shape("mouthFrownRight")) / 2f > 0.25f || face.shape("browInnerUp") > 0.5f, EYE_LOWER_RIGHT)
    }
    drawParticles(canvas, now, dt)
  }

  // [ox, oy, xx, xy, yx, yy] : origine et axes du visage (déjà mis à l'échelle : 1 unité = 1/100 de
  // la distance entre les yeux).
  private fun frameOf(face: FaceState): FloatArray {
    val ax = face.x(EYE_OUTER_RIGHT)
    val ay = face.y(EYE_OUTER_RIGHT)
    val bx = face.x(EYE_OUTER_LEFT)
    val by = face.y(EYE_OUTER_LEFT)
    val eye = hypot(bx - ax, by - ay).coerceAtLeast(1f)
    val unit = eye / 100f
    // Axe x : d'un œil à l'autre. Axe y : du front vers le menton (il suit aussi un éventuel miroir).
    val xx = (bx - ax) / eye
    val xy = (by - ay) / eye
    val dx = face.x(CHIN) - face.x(FOREHEAD)
    val dy = face.y(CHIN) - face.y(FOREHEAD)
    val down = hypot(dx, dy).coerceAtLeast(1f)
    val next = floatArrayOf((ax + bx) / 2f, (ay + by) / 2f, xx * unit, xy * unit, dx / down * unit, dy / down * unit)
    val previous = smooth
    if (previous != null) for (i in next.indices) next[i] = previous[i] + (next[i] - previous[i]) * 0.55f
    smooth = next
    return next
  }

  // Place le repère du visage sur un point du maillage : on dessine ensuite en unités du visage.
  private inline fun at(canvas: Canvas, frame: FloatArray, x: Float, y: Float, block: () -> Unit) {
    canvas.save()
    canvas.translate(x, y)
    basis.setValues(floatArrayOf(frame[2], frame[4], 0f, frame[3], frame[5], 0f, 0f, 0f, 1f))
    canvas.concat(basis)
    block()
    canvas.restore()
  }

  private fun drawGlasses(canvas: Canvas, face: FaceState, frame: FloatArray) = at(canvas, frame, frame[0], frame[1]) {
    fill.color = Color.argb(235, 18, 18, 22)
    canvas.drawRoundRect(RectF(-60f, -20f, -6f, 22f), 16f, 16f, fill)
    canvas.drawRoundRect(RectF(6f, -20f, 60f, 22f), 16f, 16f, fill)
    stroke.color = Color.argb(255, 18, 18, 22)
    stroke.strokeWidth = 5f
    canvas.drawLine(-6f, -8f, 6f, -8f, stroke)
    canvas.drawLine(-60f, -12f, -78f, -16f, stroke)
    canvas.drawLine(60f, -12f, 78f, -16f, stroke)
    // Reflet.
    stroke.color = Color.argb(90, 255, 255, 255)
    stroke.strokeWidth = 4f
    canvas.drawLine(-48f, -10f, -36f, -14f, stroke)
    canvas.drawLine(18f, -10f, 30f, -14f, stroke)
  }

  private fun drawCrown(canvas: Canvas, face: FaceState, frame: FloatArray) = at(canvas, frame, face.x(FOREHEAD), face.y(FOREHEAD)) {
    path.reset()
    path.moveTo(-58f, -18f)
    path.lineTo(-62f, -78f)
    path.lineTo(-32f, -52f)
    path.lineTo(0f, -92f)
    path.lineTo(32f, -52f)
    path.lineTo(62f, -78f)
    path.lineTo(58f, -18f)
    path.close()
    fill.color = Color.rgb(244, 197, 66)
    canvas.drawPath(path, fill)
    stroke.color = Color.rgb(196, 140, 32)
    stroke.strokeWidth = 4f
    canvas.drawPath(path, stroke)
    fill.color = Color.rgb(226, 72, 86)
    canvas.drawCircle(0f, -40f, 9f, fill)
    fill.color = Color.rgb(72, 140, 226)
    canvas.drawCircle(-34f, -34f, 6f, fill)
    canvas.drawCircle(34f, -34f, 6f, fill)
    fill.color = Color.WHITE
    canvas.drawCircle(-62f, -80f, 5f, fill)
    canvas.drawCircle(0f, -94f, 5f, fill)
    canvas.drawCircle(62f, -80f, 5f, fill)
  }

  private fun drawDog(canvas: Canvas, face: FaceState, frame: FloatArray) {
    at(canvas, frame, face.x(FOREHEAD), face.y(FOREHEAD)) {
      for (side in listOf(-1f, 1f)) {
        canvas.save()
        canvas.translate(side * 66f, 4f)
        canvas.rotate(side * 18f)
        fill.color = Color.rgb(122, 78, 40)
        canvas.drawOval(RectF(-20f, -24f, 20f, 64f), fill)
        fill.color = Color.rgb(176, 122, 76)
        canvas.drawOval(RectF(-11f, -12f, 11f, 50f), fill)
        canvas.restore()
      }
    }
    at(canvas, frame, face.x(NOSE_TIP), face.y(NOSE_TIP)) {
      fill.color = Color.rgb(28, 22, 22)
      canvas.drawOval(RectF(-17f, -12f, 17f, 12f), fill)
      fill.color = Color.argb(120, 255, 255, 255)
      canvas.drawOval(RectF(-9f, -8f, -1f, -3f), fill)
    }
    // La langue sort quand la bouche s'ouvre.
    val open = face.shape("jawOpen")
    if (open > 0.25f) at(canvas, frame, face.x(LOWER_LIP), face.y(LOWER_LIP)) {
      fill.color = Color.rgb(236, 110, 130)
      val length = 14f + 46f * min(1f, open)
      canvas.drawRoundRect(RectF(-14f, -6f, 14f, length), 14f, 14f, fill)
      stroke.color = Color.rgb(200, 80, 100)
      stroke.strokeWidth = 2.5f
      canvas.drawLine(0f, 0f, 0f, length - 10f, stroke)
    }
  }

  private fun drawCat(canvas: Canvas, face: FaceState, frame: FloatArray) {
    at(canvas, frame, face.x(FOREHEAD), face.y(FOREHEAD)) {
      for (side in listOf(-1f, 1f)) {
        path.reset()
        path.moveTo(side * 30f, -4f)
        path.lineTo(side * 58f, -70f)
        path.lineTo(side * 76f, -2f)
        path.close()
        fill.color = Color.rgb(60, 60, 66)
        canvas.drawPath(path, fill)
        path.reset()
        path.moveTo(side * 42f, -10f)
        path.lineTo(side * 58f, -52f)
        path.lineTo(side * 68f, -10f)
        path.close()
        fill.color = Color.rgb(240, 160, 180)
        canvas.drawPath(path, fill)
      }
    }
    at(canvas, frame, face.x(NOSE_TIP), face.y(NOSE_TIP)) {
      path.reset()
      path.moveTo(-9f, -4f)
      path.lineTo(9f, -4f)
      path.lineTo(0f, 7f)
      path.close()
      fill.color = Color.rgb(240, 140, 160)
      canvas.drawPath(path, fill)
      stroke.color = Color.argb(230, 40, 40, 40)
      stroke.strokeWidth = 2f
      for (side in listOf(-1f, 1f)) for (row in listOf(-6f, 2f, 10f)) canvas.drawLine(side * 16f, 8f + row * 0.4f, side * 62f, row * 1.4f, stroke)
    }
  }

  private fun drawMustache(canvas: Canvas, face: FaceState, frame: FloatArray) = at(canvas, frame, face.x(UNDER_NOSE), face.y(UNDER_NOSE)) {
    path.reset()
    path.moveTo(0f, -6f)
    path.cubicTo(-14f, -16f, -34f, -14f, -44f, -2f)
    path.cubicTo(-52f, 8f, -62f, 4f, -60f, -8f)
    path.cubicTo(-58f, 10f, -40f, 16f, -26f, 8f)
    path.cubicTo(-16f, 4f, -6f, 4f, 0f, 2f)
    path.cubicTo(6f, 4f, 16f, 4f, 26f, 8f)
    path.cubicTo(40f, 16f, 58f, 10f, 60f, -8f)
    path.cubicTo(62f, 4f, 52f, 8f, 44f, -2f)
    path.cubicTo(34f, -14f, 14f, -16f, 0f, -6f)
    path.close()
    fill.color = Color.rgb(40, 28, 22)
    canvas.drawPath(path, fill)
  }

  // Lentilles qui réagissent : tant que l'expression est faite, des particules naissent au point voulu.
  private fun react(face: FaceState, frame: FloatArray, now: Long, kind: Int, active: Boolean, anchor: Int) {
    if (!active || now - lastSpawn < spawnEvery(kind)) return
    lastSpawn = now
    val unit = hypot(frame[2], frame[3])
    // Vers le haut du visage (opposé au menton), dans le repère du capteur.
    val ux = -frame[4] / unit
    val uy = -frame[5] / unit
    val rx = frame[2] / unit
    val ry = frame[3] / unit
    val spread = (Math.random().toFloat() - 0.5f) * 2f
    // L'axe « vers le menton » du visage, tourné d'un quart de tour : l'angle qui remet la particule droite.
    val turn = Math.toDegrees(atan2(frame[5], frame[4]).toDouble()).toFloat() - 90f
    when (kind) {
      HEART, KISS -> {
        val speed = 260f * unit / 1f
        particles.add(Particle(face.x(anchor), face.y(anchor), (ux + rx * spread * 0.6f) * speed, (uy + ry * spread * 0.6f) * speed, (18f + 10f * Math.random().toFloat()) * unit, now, 1300, kind, 0f, turn))
      }
      STAR -> {
        val angle = Math.random() * Math.PI * 2
        val radius = 70f * unit
        val cx = face.x(FOREHEAD) + (rx * cos(angle).toFloat() + ux * sin(angle).toFloat()) * radius
        val cy = face.y(FOREHEAD) + (ry * cos(angle).toFloat() + uy * sin(angle).toFloat()) * radius
        particles.add(Particle(cx, cy, ux * 40f * unit, uy * 40f * unit, (10f + 10f * Math.random().toFloat()) * unit, now, 900, kind, (Math.random().toFloat() - 0.5f) * 360f, turn))
      }
      TEAR -> for (eye in listOf(EYE_LOWER_RIGHT, EYE_LOWER_LEFT)) {
        particles.add(Particle(face.x(eye), face.y(eye), -ux * 30f * unit, -uy * 30f * unit, 9f * unit, now, 1100, kind, 0f, turn))
      }
    }
    if (particles.size > 60) particles.removeAt(0)
  }

  private fun spawnEvery(kind: Int) = when (kind) {
    HEART -> 110L
    KISS -> 160L
    STAR -> 90L
    else -> 420L
  }

  private fun drawParticles(canvas: Canvas, now: Long, dt: Float) {
    val iterator = particles.iterator()
    while (iterator.hasNext()) {
      val particle = iterator.next()
      val age = (now - particle.born).toFloat() / particle.life
      if (age >= 1f) {
        iterator.remove()
        continue
      }
      particle.x += particle.vx * dt
      // Les larmes accélèrent en coulant.
      val gravity = if (particle.kind == TEAR) 1f + age * 2f else 1f
      particle.y += particle.vy * dt * gravity
      val alpha = (255 * (if (age < 0.15f) age / 0.15f else 1f - max(0f, (age - 0.6f) / 0.4f))).toInt().coerceIn(0, 255)
      val grow = if (age < 0.25f) 0.5f + 2f * age else 1f
      val size = particle.size * grow
      canvas.save()
      canvas.translate(particle.x, particle.y)
      canvas.rotate(particle.turn)
      when (particle.kind) {
        HEART -> heart(canvas, size, Color.argb(alpha, 255, 82, 120))
        KISS -> heart(canvas, size, Color.argb(alpha, 255, 140, 190))
        STAR -> {
          canvas.rotate(particle.spin * age)
          star(canvas, size, Color.argb(alpha, 255, 214, 90))
        }
        TEAR -> tear(canvas, size, Color.argb(alpha, 120, 190, 255))
      }
      canvas.restore()
    }
  }

  private fun heart(canvas: Canvas, size: Float, color: Int) {
    path.reset()
    path.moveTo(0f, size * 0.35f)
    path.cubicTo(-size * 1.1f, -size * 0.4f, -size * 0.4f, -size * 1.1f, 0f, -size * 0.45f)
    path.cubicTo(size * 0.4f, -size * 1.1f, size * 1.1f, -size * 0.4f, 0f, size * 0.35f)
    path.close()
    fill.color = color
    canvas.drawPath(path, fill)
  }

  private fun star(canvas: Canvas, size: Float, color: Int) {
    path.reset()
    for (i in 0 until 10) {
      val r = if (i % 2 == 0) size else size * 0.42f
      val a = Math.PI / 5 * i - Math.PI / 2
      val x = (cos(a) * r).toFloat()
      val y = (sin(a) * r).toFloat()
      if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    path.close()
    fill.color = color
    canvas.drawPath(path, fill)
  }

  private fun tear(canvas: Canvas, size: Float, color: Int) {
    path.reset()
    path.moveTo(0f, -size * 1.4f)
    path.cubicTo(size * 0.9f, -size * 0.2f, size, size, 0f, size)
    path.cubicTo(-size, size, -size * 0.9f, -size * 0.2f, 0f, -size * 1.4f)
    path.close()
    fill.color = color
    canvas.drawPath(path, fill)
  }
}
