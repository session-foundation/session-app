package org.getsession.push.hms

import android.content.Context
import android.os.Bundle
import com.huawei.hms.push.HmsMessageService
import com.huawei.hms.push.RemoteMessage
import org.getsession.push.PushMessages
import org.getsession.push.PushTokens

/** Huawei's deliveries, passed on without Huawei's types to the code every build shares. */
class HmsService : HmsMessageService() {
  // Both forms: EMUI versions differ in which they call. Kept, as legacy Android keeps it, since
  // on some of them `getToken` answers empty and this is the only place the token arrives.
  override fun onNewToken(token: String?) = received(token)

  override fun onNewToken(token: String?, bundle: Bundle?) = received(token)

  private fun received(token: String?) {
    if (token.isNullOrEmpty()) return
    remember(applicationContext, token)
    PushTokens.changed()
  }

  override fun onMessageReceived(message: RemoteMessage?) {
    val data = message?.dataOfMap ?: return
    PushMessages.received(applicationContext, data)
  }

  companion object {
    private const val PREFS = "session.push.hms"
    private const val TOKEN_KEY = "token"

    /** Kept across processes, since the push that delivers it may start one of its own. */
    fun remember(context: Context, token: String) {
      context
          .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
          .edit()
          .putString(TOKEN_KEY, token)
          .apply()
    }

    /** The token `onNewToken` last delivered, or null. */
    fun remembered(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(TOKEN_KEY, null)
  }
}
