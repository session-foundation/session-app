package org.getsession.push

/**
 * libsession's push handling, in the bridge's native library:
 * `packages/bridge-rn/android/PushJni.cpp`.
 */
internal object PushNative {
  init {
    System.loadLibrary("SessionBridgeRN")
  }

  /**
   * Handles one push and decides what to post: on the app's own Client when it is open, otherwise
   * on one opened from [dbPath] with [keyHex]. [openConversation], the one on screen, gets no
   * notification. Blocks for up to about 20 seconds.
   */
  @JvmStatic
  external fun handle(
      encPayload: String,
      dbPath: String,
      keyHex: String?,
      netid: String,
      you: String,
      openConversation: String?,
  ): PushOutcome
}

/** What a push came to, as `session_bridge::PushResult` says it. */
internal class PushOutcome(
    /** For the log: never message content. */
    val why: String,
    /** `message`, `message_request` or `generic`; null to post nothing. */
    val kind: String?,
    /** The notification's identifier, which a later [stale] names. */
    val id: String?,
    /** The conversation it belongs to, or a shared thread for requests and generic ones. */
    val thread: String?,
    val sender: String?,
    val body: String?,
    /** The first attachment's kind, for a message with no text. */
    val attachment: String?,
    val attachments: Int,
    val timestampMs: Long,
    /** The unread count, or -1. */
    val badge: Long,
    /** Notifications to take down: their messages were read or deleted. */
    val stale: Array<String>,
)
