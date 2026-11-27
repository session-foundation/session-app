package org.getsession.push

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import java.io.File
import org.getsession.databasekey.DatabaseKeyStore

/**
 * Where every push service's deliveries arrive, as the push server's key/value payload: handed to
 * libsession, and whatever it decides to show posted.
 *
 * Runs on the push service's own thread, which may block: FCM allows `onMessageReceived` about
 * 20 seconds.
 */
object PushMessages {
  private const val TAG = "SessionPush"
  private const val CHANNEL = "messages"

  /**
   * The conversation on screen while the app is in front, which gets no notification: the app says
   * so (`setOpenConversation`). Null whenever the app is not in front, including in a process the
   * push started.
   */
  @Volatile var openConversation: String? = null

  /**
   * The one network a push comes from: the push server watches the swarms of the network its oxend
   * is on, mainnet, and the app subscribes nowhere else.
   */
  private const val NETWORK = "mainnet"

  fun received(context: Context, data: Map<String, String>) {
    val enc = data["enc_payload"]
    if (enc == null) {
      Log.w(TAG, "push without enc_payload: ${data.keys.sorted().joinToString()}")
      return
    }
    // libsession's root, as modules/storage-roots makes it: a directory per network.
    val root = File(context.filesDir, "session")
    val netid = NETWORK
    val key =
        try {
          DatabaseKeyStore.read(context)
        } catch (e: DatabaseKeyStore.Unavailable) {
          Log.w(TAG, "database key unavailable: ${e.message}")
          null
        }
    val outcome =
        PushNative.handle(
            enc,
            File(root, "$netid/session.db").path,
            key,
            netid,
            PushStrings.get(context, "you"),
            openConversation,
        )
    Log.i(TAG, "push ${outcome.why}")
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    for (id in outcome.stale) manager.cancel(id, 0)
    if (outcome.kind != null && outcome.id != null) post(context, manager, outcome)
  }

  private fun post(context: Context, manager: NotificationManager, outcome: PushOutcome) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
          NotificationChannel(
              CHANNEL,
              PushStrings.get(context, "channel"),
              NotificationManager.IMPORTANCE_HIGH,
          )
      )
    }
    val appName = PushStrings.get(context, "appName")
    val (title, body) =
        when (outcome.kind) {
          "message" ->
              (outcome.sender ?: appName) to (outcome.body ?: placeholder(context, outcome))
          "message_request" -> appName to PushStrings.get(context, "request")
          else -> appName to PushStrings.get(context, "generic")
        }
    val builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL)
        else @Suppress("DEPRECATION") Notification.Builder(context)
    val notification =
        builder
            // Drawn by its alpha alone, so a full-colour launcher icon would be a white square.
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setWhen(outcome.timestampMs.takeIf { it > 0 } ?: System.currentTimeMillis())
            .setShowWhen(true)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setGroup(outcome.thread)
            .setContentIntent(openIntent(context, outcome))
            .build()
    manager.notify(outcome.id, 0, notification)
  }

  /** What a message with no text says instead: its first attachment's kind. */
  private fun placeholder(context: Context, outcome: PushOutcome): String =
      when {
        outcome.attachments > 1 -> PushStrings.get(context, "attachments")
        outcome.attachment != null -> PushStrings.get(context, outcome.attachment)
        else -> PushStrings.get(context, "generic")
      }

  /** Opens the conversation a message notification belongs to, or the app for any other. */
  private fun openIntent(context: Context, outcome: PushOutcome): PendingIntent? {
    val launch =
        context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    if (outcome.kind == "message" && outcome.thread != null) {
      // The app's own scheme and its conversation route (`routes.conversation`).
      launch.action = Intent.ACTION_VIEW
      launch.data = Uri.parse("session:///c/${Uri.encode(outcome.thread)}")
    }
    launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    return PendingIntent.getActivity(
        context,
        outcome.id.hashCode(),
        launch,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
