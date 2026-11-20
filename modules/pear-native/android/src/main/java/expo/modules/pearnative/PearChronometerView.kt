package expo.modules.pearnative

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.widget.Chronometer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// La durée de l'appel dans la fenêtre flottante : un chronomètre natif qui se met à jour tout seul, sans
// passer par JavaScript (les minuteurs JS s'arrêtent quand Pear n'est plus au premier plan). Le départ est
// donné en durée déjà écoulée ; le système fait le reste, à la seconde près.
class PearChronometerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val chronometer = Chronometer(context).apply {
    gravity = Gravity.CENTER
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
  }

  init {
    addView(chronometer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    chronometer.layout(0, (height - chronometer.measuredHeight) / 2, width, (height + chronometer.measuredHeight) / 2)
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    chronometer.measure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED))
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), maxOf(chronometer.measuredHeight, MeasureSpec.getSize(heightMeasureSpec)))
  }

  fun setElapsed(ms: Double) {
    chronometer.base = SystemClock.elapsedRealtime() - ms.toLong()
    chronometer.start()
  }

  fun setColor(color: String?) {
    try {
      chronometer.setTextColor(Color.parseColor(color ?: "#8E8E93"))
    } catch (e: Exception) {
      chronometer.setTextColor(Color.GRAY)
    }
  }

  override fun onDetachedFromWindow() {
    chronometer.stop()
    super.onDetachedFromWindow()
  }
}
