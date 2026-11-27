package org.getsession.push

import java.util.concurrent.CopyOnWriteArrayList

/**
 * Where this build's push token comes from: FCM in the Play build, Huawei's push kit in the Huawei
 * build, none in the others.
 *
 * No push service's types appear here, so every build can carry it: the Play build's Firebase code
 * lives in its own source set (`android-play/`) and registers a [Provider] at startup, which is
 * the only way the rest of the app reaches it.
 */
object PushTokens {
  interface Provider {
    /** The push server's name for the service: `firebase`, `huawei`. */
    val service: String

    /** The current token, or null when the service can't issue one now. */
    fun token(callback: (String?) -> Unit)
  }

  @Volatile var provider: Provider? = null

  private val listeners = CopyOnWriteArrayList<() -> Unit>()

  /** Called by the provider when the service issues a new token. */
  fun changed() {
    listeners.forEach { it() }
  }

  fun addListener(listener: () -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }
}
