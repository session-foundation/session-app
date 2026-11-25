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

  /**
   * A notification's action: marks [conversation] read, and sends [reply] there when it is not
   * null; on the app's own Client when it is open, otherwise on one opened from [dbPath] with
   * [keyHex]. Blocks for up to about 20 seconds.
   */
  @JvmStatic
  external fun act(
      conversation: String,
      reply: String?,
      dbPath: String,
      keyHex: String?,
      netid: String,
  ): ActionOutcome
}

/** What a notification's action came to, as `session_bridge::ActionResult` says it. */
internal class ActionOutcome(
    /** Marked read, and for a reply, the reply accepted by the swarm. */
    val done: Boolean,
    /** Notifications to take down: the conversation's messages are read now. */
    val stale: Array<String>,
)

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
