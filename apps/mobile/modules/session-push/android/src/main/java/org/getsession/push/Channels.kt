package org.getsession.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * The notification channels, one per kind of notification, so that each one's sound, vibration and
 * importance can be set in Android's settings, which is where the Notifications page sends people.
 */
internal enum class Channel(val id: String, private val nameKey: String) {
  MESSAGES("messages", "channel"),
  REQUESTS("requests", "requestsChannel");
  // TODO: legacy Android also has channels for group messages and community messages, which wait
  //  on groups and communities in libsession's Client; one for calls, which waits on calls; and a
  //  low-importance one for the lock screen's status, which waits on the app lock.

  /** Creates the channel, or renames it in the current language. Android keeps what was set. */
  fun ensure(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    manager.createNotificationChannel(
        NotificationChannel(
            id,
            PushStrings.get(context, nameKey),
            NotificationManager.IMPORTANCE_HIGH,
        )
    )
  }

  companion object {
    fun named(id: String): Channel? = entries.firstOrNull { it.id == id }
  }
}
