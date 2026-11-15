package expo.modules.pearnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Vue vidéo d'appel aux coins arrondis (voir PearVideoView).
class PearVideoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PearVideo")

    View(PearVideoView::class) {
      Prop("streamURL") { view: PearVideoView, url: String? -> view.setStream(url) }
      Prop("mirror") { view: PearVideoView, mirror: Boolean -> view.setMirror(mirror) }
      Prop("radius") { view: PearVideoView, radius: Double -> view.setRadius(radius) }
      OnViewDestroys { view: PearVideoView -> view.release() }
    }
  }
}
