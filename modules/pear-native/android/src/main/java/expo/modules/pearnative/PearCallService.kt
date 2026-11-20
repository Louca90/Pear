package expo.modules.pearnative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log

// L'appel en cours (vague 5) : service de premier plan (micro, et caméra en vidéo) avec une notification
// au format « appel » d'Android (CallStyle). C'est ce format, plus la demande « en cours mis en avant »
// d'Android 16, que la Now Bar de Samsung et la puce de la barre d'état affichent : nom, durée, Raccrocher.
class PearCallService : Service() {
  companion object {
    private const val CHANNEL = "appel_en_cours"
    private const val NOTIFICATION_ID = 4207
    const val ACTION_HANG_UP = "pear.call.HANG_UP"
    private const val ACTION_STOP = "pear.call.STOP"

    // Raccrocher depuis la notification ou la Now Bar : le module JS le transmet à l'écran d'appel.
    var onHangUp: (() -> Unit)? = null

    fun start(context: Context, info: Map<String, Any?>) {
      val intent = Intent(context, PearCallService::class.java)
      info.forEach { (key, value) ->
        when (value) {
          is String -> intent.putExtra(key, value)
          is Boolean -> intent.putExtra(key, value)
          is Number -> intent.putExtra(key, value.toLong())
        }
      }
      context.startForegroundService(intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, PearCallService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_HANG_UP) {
      onHangUp?.invoke()
      return START_NOT_STICKY
    }
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    val video = intent?.getBooleanExtra("video", false) ?: false
    val notification = build(intent)
    try {
      if (Build.VERSION.SDK_INT >= 30) {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (video) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        startForeground(NOTIFICATION_ID, notification, types)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // Caméra refusée en arrière-plan, par exemple : on garde au moins le micro.
      Log.w("PearCall", "service de l'appel", e)
      try {
        if (Build.VERSION.SDK_INT >= 30) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } catch (again: Exception) {
        Log.w("PearCall", "service de l'appel", again)
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  private fun build(intent: Intent?): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL) == null) {
      val channel = NotificationChannel(CHANNEL, intent?.getStringExtra("channelName") ?: "Appel en cours", NotificationManager.IMPORTANCE_DEFAULT)
      channel.setSound(null, null)
      channel.enableVibration(false)
      manager.createNotificationChannel(channel)
    }
    val name = intent?.getStringExtra("name") ?: "Pear"
    val startedAt = intent?.getLongExtra("startedAt", 0L) ?: 0L
    val photo = intent?.getStringExtra("photo")
    val person = Person.Builder().setName(name).setImportant(true).apply {
      photoIcon(photo)?.let { setIcon(it) }
    }.build()

    val open = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    }
    val content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val hangUp = PendingIntent.getService(
      this,
      1,
      Intent(this, PearCallService::class.java).setAction(ACTION_HANG_UP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val icon = resources.getIdentifier("ic_stat_pear", "drawable", packageName).takeIf { it != 0 } ?: android.R.drawable.sym_call_outgoing

    val builder = Notification.Builder(this, CHANNEL)
      .setSmallIcon(icon)
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_CALL)
      .setContentIntent(content)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
    if (Build.VERSION.SDK_INT >= 31) {
      builder.setStyle(Notification.CallStyle.forOngoingCall(person, hangUp))
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    } else {
      builder.setContentTitle(name)
      builder.addAction(Notification.Action.Builder(null, intent?.getStringExtra("hangUpLabel") ?: "Raccrocher", hangUp).build())
    }
    builder.setContentText(intent?.getStringExtra("text") ?: "")
    if (startedAt > 0) {
      builder.setUsesChronometer(true).setWhen(startedAt).setShowWhen(true)
    }
    // Android 16 : « en cours mis en avant » (puce de la barre d'état, Now Bar de Samsung).
    builder.extras.putBoolean("android.requestPromotedOngoing", true)
    return builder.build()
  }

  private fun photoIcon(uri: String?): Icon? {
    if (uri.isNullOrEmpty()) return null
    return try {
      val path = Uri.parse(uri).path ?: return null
      BitmapFactory.decodeFile(path)?.let { Icon.createWithBitmap(it) }
    } catch (e: Exception) {
      Log.w("PearCall", "photo du contact", e)
      null
    }
  }
}
