package expo.modules.pearnative

import androidx.core.content.FileProvider

// Une classe à part : deux fournisseurs déclarés avec la même classe entreraient en conflit dans le manifeste.
class PearUpdateProvider : FileProvider()
