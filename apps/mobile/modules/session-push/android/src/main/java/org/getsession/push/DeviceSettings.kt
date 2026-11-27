package org.getsession.push

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** The parts of Android's settings the Notifications page shows or opens. */
internal object DeviceSettings {
  fun notificationsAllowed(context: Context): Boolean =
      context.getSystemService(android.app.NotificationManager::class.java)
          ?.areNotificationsEnabled() ?: false

  /** Android's notification settings for the app. */
  fun openNotifications(context: Context) {
    open(
        context,
        Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
    )
  }

  /** One channel's settings: its sound, vibration and importance. */
  fun openChannel(context: Context, channel: Channel) {
    channel.ensure(context)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return openNotifications(context)
    open(
        context,
        Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, channel.id),
    )
  }

  /** Whether Android has exempted the app from battery optimisation. */
  fun backgroundAllowed(context: Context): Boolean =
      context.getSystemService(PowerManager::class.java)
          ?.isIgnoringBatteryOptimizations(context.packageName) ?: false

  /**
   * Asks Android for the exemption, with its own dialog for this app; or, when the app already has
   * it, opens the list where it is taken back, since no dialog does that.
   */
  fun changeBackground(context: Context) {
    if (!backgroundAllowed(context)) {
      val asked =
          open(
              context,
              Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                  .setData(Uri.parse("package:${context.packageName}")),
          )
      if (asked) return
    }
    open(context, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
  }

  private fun open(context: Context, intent: Intent): Boolean =
      try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      } catch (_: ActivityNotFoundException) {
        false
      }
}
