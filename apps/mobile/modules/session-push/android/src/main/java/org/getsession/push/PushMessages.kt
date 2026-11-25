package org.getsession.push

import android.app.Notification
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

  /**
   * The conversation on screen while the app is in front, which gets no notification: the app says
   * so (`setOpenConversation`). Null whenever the app is not in front, including in a process the
   * push started.
   */
  @Volatile var openConversation: String? = null

  /** Whether the app is in front, and whether a notification then makes its sound. */
  @Volatile var inFront = false
  @Volatile var soundWhenOpen = true

  /** The networks a database may be under, in the order a push is tried against them. */
  private val NETWORKS = listOf("mainnet", "testnet")

  fun received(context: Context, data: Map<String, String>) {
    val enc = data["enc_payload"]
    if (enc == null) {
      Log.w(TAG, "push without enc_payload: ${data.keys.sorted().joinToString()}")
      return
    }
    val db = database(context)
    val outcome =
        PushNative.handle(
            enc,
            db.path,
            db.key,
            db.netid,
            PushStrings.get(context, "you"),
            openConversation,
        )
    Log.i(TAG, "push ${outcome.why}")
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    for (id in outcome.stale) manager.cancel(id, 0)
    if (outcome.kind != null && outcome.id != null) post(context, manager, outcome)
  }

  /** Where the database is, under which network, and the key it opens with, when it can be read. */
  internal class Database(val path: String, val netid: String, val key: String?)

  internal fun database(context: Context): Database {
    // libsession's root, as modules/storage-roots makes it: a directory per network.
    val root = File(context.filesDir, "session")
    val netid = NETWORKS.firstOrNull { File(root, "$it/session.db").exists() } ?: "mainnet"
    val key =
        try {
          DatabaseKeyStore.read(context)
        } catch (e: DatabaseKeyStore.Unavailable) {
          Log.w(TAG, "database key unavailable: ${e.message}")
          null
        }
    return Database(File(root, "$netid/session.db").path, netid, key)
  }

  /**
   * A notification for a message that arrived while the app runs, as the bridge decided it
   * (`IncomingNotification`): posted as a push's would be, so the two look the same and a later
   * removal finds either by its id.
   */
  fun postIncoming(context: Context, notification: Map<String, Any?>) {
    val id = notification["id"] as? String ?: return
    val request = notification["kind"] == "request"
    val outcome =
        PushOutcome(
            why = "arrived while open",
            kind = if (request) "message_request" else "message",
            id = id,
            thread = if (request) REQUESTS_THREAD else notification["conversationId"] as? String,
            sender = notification["sender"] as? String,
            body = notification["body"] as? String,
            attachment = notification["attachment"] as? String,
            attachments = (notification["attachments"] as? Number)?.toInt() ?: 0,
            timestampMs = (notification["timestamp"] as? Number)?.toLong() ?: 0,
            badge = -1,
            stale = emptyArray(),
        )
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    post(context, manager, outcome)
  }

  /**
   * Replaces a notification whose reply did not go with one saying so, so the reply box stops
   * waiting; tapping it opens the conversation as before.
   */
  fun replyFailed(context: Context, manager: NotificationManager, id: String) {
    Channel.MESSAGES.ensure(context)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val notification =
        builder(
                context,
                Channel.MESSAGES,
                PushStrings.get(context, "appName"),
                PushStrings.get(context, "replyFailed"),
            )
            .setWhen(System.currentTimeMillis())
            .setContentIntent(
                launch?.let {
                  PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE)
                }
            )
            .build()
    manager.notify(id, 0, notification)
  }

  /**
   * Takes down a notification just replied to from. Android 15 keeps one alive after a direct
   * reply and ignores a cancel until the app has updated it, so it is updated, silently, first; and
   * the cancel waits a moment, as the system applies both in its own time and a cancel that
   * overtakes the update is ignored. Blocks for that moment: call it off the main thread.
   */
  fun dismissAfterReply(context: Context, manager: NotificationManager, id: String) {
    Channel.MESSAGES.ensure(context)
    val update =
        builder(context, Channel.MESSAGES, PushStrings.get(context, "appName"), "")
            .setOnlyAlertOnce(true)
            .build()
    manager.notify(id, 0, update)
    Thread.sleep(UPDATE_SETTLE_MS)
    manager.cancel(id, 0)
  }

  private const val UPDATE_SETTLE_MS = 750L

  /** Takes down notifications by id, posted here or by a push. */
  fun remove(context: Context, ids: List<String>) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    for (id in ids) manager.cancel(id, 0)
  }

  /** The thread libsession groups every message request under (`REQUESTS_THREAD`). */
  private const val REQUESTS_THREAD = "message-requests"

  private fun post(context: Context, manager: NotificationManager, outcome: PushOutcome) {
    val channel = if (outcome.kind == "message_request") Channel.REQUESTS else Channel.MESSAGES
    channel.ensure(context)
    val appName = PushStrings.get(context, "appName")
    val (title, body) =
        when (outcome.kind) {
          "message" ->
              (outcome.sender ?: appName) to (outcome.body ?: placeholder(context, outcome))
          "message_request" -> appName to PushStrings.get(context, "request")
          else -> appName to PushStrings.get(context, "generic")
        }
    val built =
        builder(context, channel, title, body)
            .setWhen(outcome.timestampMs.takeIf { it > 0 } ?: System.currentTimeMillis())
            .setGroup(outcome.thread)
            .setContentIntent(openIntent(context, outcome))
    // A message's notification can be read or answered where it is, as legacy Android's can; a
    // request's opens the requests, where it is approved first.
    val thread = outcome.thread
    val id = outcome.id
    if (outcome.kind == "message" && thread != null && id != null)
      NotificationActions.add(context, built, id, thread)
    manager.notify(outcome.id, 0, built.build())
  }

  /**
   * A sample of what a message notification shows with the current settings, for the Notifications
   * page. Replaces the previous one; tapping it opens the app.
   */
  fun preview(context: Context, title: String, body: String) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    Channel.MESSAGES.ensure(context)
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val notification =
        builder(context, Channel.MESSAGES, title, body)
            .setWhen(System.currentTimeMillis())
            .setContentIntent(
                launch?.let {
                  PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE)
                }
            )
            .build()
    manager.notify(PREVIEW_TAG, 0, notification)
  }

  private const val PREVIEW_TAG = "preview"

  /** The group a notification silenced while the app is in front goes in, when it has none. */
  private const val SILENT_GROUP = "silent"

  private fun builder(
      context: Context,
      channel: Channel,
      title: String,
      body: String,
  ): Notification.Builder {
    val builder =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          Notification.Builder(context, channel.id)
        } else {
          @Suppress("DEPRECATION") Notification.Builder(context)
        }
    // Silenced as the support library's setSilent does it: in a group, a notification that alerts
    // only for the summary makes no sound itself, and these have no summary.
    if (inFront && !soundWhenOpen && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      builder.setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY)
      builder.setGroup(SILENT_GROUP)
    }
    return builder
        // TODO: a monochrome notification icon. The launcher icon draws as a white square on
        // Android 5 and later, which tint every small icon to one colour.
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(Notification.BigTextStyle().bigText(body))
        .setShowWhen(true)
        .setAutoCancel(true)
        .setCategory(Notification.CATEGORY_MESSAGE)
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
    } else if (outcome.kind == "message_request") {
      // The requests list (`routes.requests`): a request is opened from there.
      launch.action = Intent.ACTION_VIEW
      launch.data = Uri.parse("session:///requests")
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
