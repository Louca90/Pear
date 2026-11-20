package expo.modules.pearnative

import android.app.Activity
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log

// Le son d'un appel (vague 5) : mode communication, écouteur ou haut-parleur (un casque branché passe
// avant l'écouteur), écran éteint quand le téléphone est contre l'oreille. Et la sonnerie d'un appel reçu,
// qui respecte le mode silencieux ou vibreur du téléphone.
object CallAudio {
  private var proximity: PowerManager.WakeLock? = null
  private var ringtone: Ringtone? = null
  private var vibrator: Vibrator? = null
  // Route demandée pendant l'appel : réappliquée quand un casque (Bluetooth, filaire, USB) arrive ou part.
  private var route = "off"
  private var watcher: AudioDeviceCallback? = null

  // Sortie choisie à la main (id d'AudioDeviceInfo) : respectée tant que cet appareil reste disponible.
  private var chosenId: Int? = null

  // route : "off", "earpiece", "speaker", ou "auto-earpiece" / "auto-speaker" (un casque d'abord, sinon
  // l'écouteur pour l'audio, le haut-parleur pour la vidéo).
  @Suppress("DEPRECATION")
  fun setRoute(context: Context, route: String) {
    val audio = context.getSystemService(AudioManager::class.java) ?: return
    this.route = route
    watchDevices(context, audio, route != "off")
    try {
      if (route == "off") {
        if (Build.VERSION.SDK_INT >= 31) audio.clearCommunicationDevice() else audio.isSpeakerphoneOn = false
        audio.mode = AudioManager.MODE_NORMAL
        setProximity(context, false)
        return
      }
      audio.mode = AudioManager.MODE_IN_COMMUNICATION
      val auto = route.startsWith("auto")
      val speaker = route == "speaker" || route == "auto-speaker"
      if (Build.VERSION.SDK_INT >= 31) {
        val devices = audio.availableCommunicationDevices
        val headset = devices.firstOrNull { it.type in HEADSETS }
        val chosen = chosenId?.let { id -> devices.firstOrNull { it.id == id } }
        // L'appareil choisi à la main a disparu : retour au choix automatique.
        if (chosenId != null && chosen == null) chosenId = null
        val builtinSpeaker = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
        val earpiece = devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
        val wanted = chosen ?: when {
          auto -> headset ?: (if (speaker) builtinSpeaker else earpiece)
          speaker -> builtinSpeaker
          else -> headset ?: earpiece
        }
        if (wanted != null) audio.setCommunicationDevice(wanted)
        // Le capteur de proximité : seulement sur l'écouteur du téléphone, pas sur le haut-parleur ni un casque.
        setProximity(context, wanted?.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
      } else {
        audio.isSpeakerphoneOn = speaker
        setProximity(context, !speaker)
      }
    } catch (e: Exception) {
      Log.w("PearCall", "son de l'appel", e)
    }
  }

  private fun typeName(type: Int) = when (type) {
    AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
    AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO, 26 -> "bluetooth"
    AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired"
    AudioDeviceInfo.TYPE_USB_HEADSET -> "usb"
    else -> ""
  }

  // Les sorties disponibles : id, type, nom (le vrai nom d'un appareil Bluetooth peut demander
  // BLUETOOTH_CONNECT, sans elle il est vide) et laquelle est active.
  fun outputs(context: Context): List<Map<String, Any>> {
    val audio = context.getSystemService(AudioManager::class.java) ?: return emptyList()
    if (Build.VERSION.SDK_INT >= 31) {
      val active = audio.communicationDevice?.id
      return audio.availableCommunicationDevices.mapNotNull { device ->
        val type = typeName(device.type)
        if (type.isEmpty()) return@mapNotNull null
        val name = if (type == "earpiece" || type == "speaker") "" else (try { device.productName?.toString() ?: "" } catch (e: Exception) { "" })
        mapOf("id" to device.id, "type" to type, "name" to name, "active" to (device.id == active))
      }
    }
    // Avant Android 12 : l'écouteur (-1), le haut-parleur (-2) et un éventuel casque.
    val headset = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { it.type in HEADSETS }
    val list = mutableListOf<Map<String, Any>>(
      mapOf("id" to -1, "type" to "earpiece", "name" to "", "active" to (route != "speaker" && route != "auto-speaker" && headset == null)),
      mapOf("id" to -2, "type" to "speaker", "name" to "", "active" to (route == "speaker" || route == "auto-speaker")),
    )
    if (headset != null) list.add(mapOf("id" to headset.id, "type" to typeName(headset.type), "name" to "", "active" to false))
    return list
  }

  // Choix de l'utilisateur dans la liste des sorties.
  fun setOutput(context: Context, id: Int) {
    val audio = context.getSystemService(AudioManager::class.java) ?: return
    chosenId = id
    if (Build.VERSION.SDK_INT >= 31) {
      route = if (route == "off") route else (if (route.endsWith("speaker")) "speaker" else "earpiece")
      if (route != "off") setRoute(context, route)
    } else {
      setRoute(context, if (id == -2) "speaker" else "earpiece")
    }
  }

  // "bluetooth", "wired" ou "" : le casque que l'appel utilise au lieu de l'écouteur.
  fun headset(context: Context): String {
    val audio = context.getSystemService(AudioManager::class.java) ?: return ""
    val devices = if (Build.VERSION.SDK_INT >= 31) audio.availableCommunicationDevices.toList()
      else audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
    val found = devices.firstOrNull { it.type in HEADSETS } ?: return ""
    return if (found.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || found.type == 26) "bluetooth" else "wired"
  }

  private fun watchDevices(context: Context, audio: AudioManager, on: Boolean) {
    if (!on) {
      watcher?.let { audio.unregisterAudioDeviceCallback(it) }
      watcher = null
      return
    }
    if (watcher != null) return
    val app = context.applicationContext
    watcher = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = reapply()
      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = reapply()
      private fun reapply() {
        if (route != "off") setRoute(app, route)
        onHeadsetChange?.invoke(headset(app))
      }
    }
    audio.registerAudioDeviceCallback(watcher, Handler(Looper.getMainLooper()))
  }

  // Prévenu quand un casque arrive ou part pendant l'appel (le module JS l'envoie à l'écran d'appel).
  var onHeadsetChange: ((String) -> Unit)? = null

  private fun setProximity(context: Context, on: Boolean) {
    if (!on) {
      proximity?.let { if (it.isHeld) it.release() }
      proximity = null
      return
    }
    if (proximity?.isHeld == true) return
    val power = context.getSystemService(PowerManager::class.java) ?: return
    if (!power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
    proximity = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "pear:appel").apply {
      setReferenceCounted(false)
      // Garde-fou : un appel ne dure pas plus de 4 h ; le verrou ne reste jamais pris pour toujours.
      acquire(4 * 3600 * 1000L)
    }
  }

  @Suppress("DEPRECATION")
  fun startRinging(context: Context) {
    stopRinging()
    val audio = context.getSystemService(AudioManager::class.java)
    val mode = audio?.ringerMode ?: AudioManager.RINGER_MODE_NORMAL
    if (mode == AudioManager.RINGER_MODE_SILENT) return
    if (mode == AudioManager.RINGER_MODE_NORMAL) {
      try {
        val uri = RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
          ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        ringtone = RingtoneManager.getRingtone(context, uri)?.apply {
          audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
          if (Build.VERSION.SDK_INT >= 28) isLooping = true
          play()
        }
      } catch (e: Exception) {
        Log.w("PearCall", "sonnerie", e)
      }
    }
    vibrator = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(VibratorManager::class.java)?.defaultVibrator
      else context.getSystemService(Vibrator::class.java)
    // Une seconde de vibration, une seconde de pause, en boucle.
    vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 1000, 1000), 0))
  }

  fun stopRinging() {
    try {
      ringtone?.stop()
    } catch (e: Exception) {
      Log.w("PearCall", "sonnerie", e)
    }
    ringtone = null
    vibrator?.cancel()
    vibrator = null
  }

  // Appel reçu téléphone verrouillé : l'écran de l'appel s'affiche par-dessus le verrou et allume l'écran.
  // Demandé avant même que l'activité existe (app fermée réveillée par un appel) : il est appliqué dès
  // qu'elle passe au premier plan (OnActivityEntersForeground du module).
  @Volatile var overLockWanted = false

  fun showOverLock(activity: Activity, on: Boolean) {
    if (Build.VERSION.SDK_INT >= 27) {
      activity.setShowWhenLocked(on)
      activity.setTurnScreenOn(on)
    }
  }

  private val HEADSETS = setOf(
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    26, // TYPE_BLE_HEADSET (Android 12)
  )
}
