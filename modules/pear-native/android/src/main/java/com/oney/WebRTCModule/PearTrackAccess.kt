package com.oney.WebRTCModule

import com.facebook.react.bridge.ReactContext
import org.webrtc.EglBase
import org.webrtc.VideoTrack

// Placé dans le paquet de react-native-webrtc : getStreamForReactTag n'est visible que depuis ce paquet.
// Sert à PearVideoView (expo.modules.pearnative), qui dessine une piste vidéo dans une vue ordinaire.
object PearTrackAccess {
  fun videoTrack(context: ReactContext, streamURL: String): VideoTrack? {
    val module = context.getNativeModule(WebRTCModule::class.java) ?: return null
    return module.getStreamForReactTag(streamURL)?.videoTracks?.firstOrNull()
  }

  fun eglContext(): EglBase.Context? = EglUtils.getRootEglBaseContext()
}
