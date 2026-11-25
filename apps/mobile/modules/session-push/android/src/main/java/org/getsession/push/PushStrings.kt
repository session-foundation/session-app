package org.getsession.push

import android.content.Context

/**
 * The words a notification is made of, in the person's language.
 *
 * The app writes them from its catalogue at every launch (`setStrings`), so that a push handled
 * while it is not running still speaks the language it last spoke. The English here is only for a
 * push that arrives before the app has ever run.
 */
internal object PushStrings {
  private const val PREFS = "session.push.strings"

  private val ENGLISH =
      mapOf(
          "appName" to "Session",
          "channel" to "Message notifications",
          "requestsChannel" to "Message Requests",
          "generic" to "You've got a new message.",
          "request" to "You have a new message request",
          "you" to "You",
          "image" to "Image",
          "animated" to "GIF",
          "video" to "Video",
          "audio" to "Audio",
          "voice" to "Voice Message",
          "file" to "Document",
          "attachments" to "Attachments",
          "markRead" to "Mark read",
          "reply" to "Reply",
          "replyFailed" to "Message delivery failed",
      )

  val KEYS: Set<String> = ENGLISH.keys

  fun save(context: Context, strings: Map<String, String>) {
    val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    for ((key, value) in strings) if (key in KEYS) editor.putString(key, value)
    editor.apply()
  }

  fun get(context: Context, key: String): String =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(key, null)
          ?: ENGLISH.getValue(key)
}
