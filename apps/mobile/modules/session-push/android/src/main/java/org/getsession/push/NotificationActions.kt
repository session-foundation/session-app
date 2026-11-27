package org.getsession.push

import android.app.Notification
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.PersistableBundle
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

  /**
   * Carries out an action [NotificationActionJob] was given: runs on a thread of its own, since it
   * may block for the whole of [PushNative.act]'s deadline.
   */
  /** Whether a notification of [conversation] posted after [notification] is still showing. */
  private fun newerShowing(
      manager: NotificationManager,
      conversation: String,
      notification: String,
  ): Boolean {
    val showing = manager.activeNotifications
    val answeredAt =
        showing.firstOrNull { it.tag == notification }?.notification?.`when` ?: return false
    return showing.any {
      it.tag != notification &&
          it.notification.extras.getString(PushMessages.EXTRA_CONVERSATION) == conversation &&
          it.notification.`when` > answeredAt
    }
  }

  fun handle(context: Context, conversation: String, notification: String, reply: String?) {
    val db = PushMessages.database(context)
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    // A reply leaves the conversation unread while a newer notification of it is still up, so the
    // rest can be answered one by one.
    val markRead = reply == null || !newerShowing(manager, conversation, notification)
    val outcome = PushNative.act(conversation, reply, markRead, db.path, db.key, db.netid)
    val done = outcome.done
    Log.i(TAG, "notification action ${if (reply == null) "mark read" else "reply"}: " +
        if (done) "done" else "not done")
    // Here rather than left to the app: a process woken only for this may be frozen again before
    // the app's own refresh would run.
    for (id in outcome.stale) if (id != notification || done) manager.cancel(id, 0)
    if (done && reply != null) {
      PushMessages.dismissAfterReply(context, manager, notification)
    } else if (done) {
      manager.cancel(notification, 0)
    } else if (reply != null) {
      // The reply box would otherwise spin for ever: say it did not go, and keep the notification.
      PushMessages.replyFailed(context, manager, notification)
    }
  }
}

/**
 * Where a notification's action arrives. A notification's broadcast must be over in about ten
 * seconds, and a reply can take longer to reach the swarm, so this only reads the action, the typed
 * reply included, and leaves the work to [NotificationActionJob].
 */
class NotificationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val conversation = intent.getStringExtra(NotificationActions.EXTRA_CONVERSATION) ?: return
    val notification = intent.getStringExtra(NotificationActions.EXTRA_NOTIFICATION) ?: return
    val reply =
        if (intent.action == NotificationActions.REPLY)
            RemoteInput.getResultsFromIntent(intent)
                ?.getCharSequence(NotificationActions.REPLY_KEY)
                ?.toString()
        else null
    if (intent.action == NotificationActions.REPLY && reply.isNullOrBlank()) return
    NotificationActionJob.schedule(context, conversation, notification, reply)
  }
}

/** Runs a notification's action, which a broadcast has no time for: see the receiver. */
class NotificationActionJob : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    val extras = params.extras
    val conversation = extras.getString(NotificationActions.EXTRA_CONVERSATION)
    val notification = extras.getString(NotificationActions.EXTRA_NOTIFICATION)
    if (conversation == null || notification == null) return false
    val reply = extras.getString(NotificationActions.REPLY_KEY)
    Thread {
          try {
            NotificationActions.handle(applicationContext, conversation, notification, reply)
          } finally {
            jobFinished(params, false)
          }
        }
        .start()
    return true
  }

  // Not run again if stopped: a mark read happens on the next open anyway, and a reply sent twice
  // would be worse than one left to be typed again.
  override fun onStopJob(params: JobParameters): Boolean = false

  companion object {
    fun schedule(context: Context, conversation: String, notification: String, reply: String?) {
      val extras =
          PersistableBundle().apply {
            putString(NotificationActions.EXTRA_CONVERSATION, conversation)
            putString(NotificationActions.EXTRA_NOTIFICATION, notification)
            if (reply != null) putString(NotificationActions.REPLY_KEY, reply)
          }
      val job =
          JobInfo.Builder(
                  (notification + (reply ?: "")).hashCode(),
                  ComponentName(context, NotificationActionJob::class.java),
              )
              .setExtras(extras)
              // Run now, as the person is waiting on the notification.
              .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setExpedited(true) }
              .build()
      context.getSystemService(JobScheduler::class.java)?.schedule(job)
    }
  }
}
