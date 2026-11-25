package org.getsession.push

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.util.Log

/**
 * Mark read and Reply on a message's notification: libsession does the work through the bridge,
 * on the app's own Client when it is open and on one of its own otherwise ([PushNative.act]).
 */
internal object NotificationActions {
  private const val TAG = "SessionPush"
  const val MARK_READ = "org.getsession.push.MARK_READ"
  const val REPLY = "org.getsession.push.REPLY"
  const val EXTRA_CONVERSATION = "conversation"
  const val EXTRA_NOTIFICATION = "notification"
  const val REPLY_KEY = "reply"

  fun add(context: Context, builder: Notification.Builder, id: String, conversation: String) {
    val markRead =
        Notification.Action.Builder(
                null as Icon?,
                PushStrings.get(context, "markRead"),
                intent(context, MARK_READ, id, conversation, mutable = false),
            )
            .build()
    val input = RemoteInput.Builder(REPLY_KEY).setLabel(PushStrings.get(context, "reply")).build()
    val reply =
        Notification.Action.Builder(
                null as Icon?,
                PushStrings.get(context, "reply"),
                // Mutable: the system writes the typed reply into it.
                intent(context, REPLY, id, conversation, mutable = true),
            )
            .addRemoteInput(input)
            .build()
    builder.addAction(markRead).addAction(reply)
  }

  private fun intent(
      context: Context,
      action: String,
      id: String,
      conversation: String,
      mutable: Boolean,
  ): PendingIntent {
    val intent =
        Intent(context, NotificationActionReceiver::class.java)
            .setAction(action)
            .putExtra(EXTRA_CONVERSATION, conversation)
            .putExtra(EXTRA_NOTIFICATION, id)
    val flags =
        PendingIntent.FLAG_UPDATE_CURRENT or
            (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
    return PendingIntent.getBroadcast(context, (action + id).hashCode(), intent, flags)
  }

  /** Runs on a thread of its own: it may block for the whole of [PushNative.act]'s deadline. */
  fun handle(context: Context, intent: Intent) {
    val conversation = intent.getStringExtra(EXTRA_CONVERSATION) ?: return
    val notification = intent.getStringExtra(EXTRA_NOTIFICATION) ?: return
    val reply =
        if (intent.action == REPLY)
            RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY_KEY)?.toString()
        else null
    if (intent.action == REPLY && reply.isNullOrBlank()) return
    val db = PushMessages.database(context)
    val done = PushNative.act(conversation, reply, db.path, db.key, db.netid)
    Log.i(TAG, "notification action ${intent.action}: ${if (done) "done" else "not done"}")
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (done) {
      manager.cancel(notification, 0)
    } else if (reply != null) {
      // The reply box would otherwise spin for ever: say it did not go, and keep the notification.
      PushMessages.replyFailed(context, manager, notification)
    }
  }
}

/** Where a notification's action arrives; the work is [NotificationActions.handle]'s. */
class NotificationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val pending = goAsync()
    val app = context.applicationContext
    Thread {
          try {
            NotificationActions.handle(app, intent)
          } finally {
            pending.finish()
          }
        }
        .start()
  }
}
