package expo.modules.pearnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Chronomètre natif de la fenêtre flottante (voir PearChronometerView).
class PearChronometerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PearChronometer")

    View(PearChronometerView::class) {
      Prop("elapsedMs") { view: PearChronometerView, ms: Double -> view.setElapsed(ms) }
      Prop("color") { view: PearChronometerView, color: String? -> view.setColor(color) }
    }
  }
}
