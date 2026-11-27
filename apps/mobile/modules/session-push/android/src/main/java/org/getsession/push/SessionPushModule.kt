package org.getsession.push

import android.Manifest
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The push token for JavaScript, from whichever provider this build registered (see PushTokens).
class SessionPushModule : Module() {
  private var stopListening: (() -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("SessionPush")
    Events("onTokenChange")

    /** Whether this build has a push service behind it. Fixed for the life of the process. */
    Constant("available") { PushTokens.provider != null }

    /**
     * The token and its service, or null. Asks to post notifications first where Android needs
     * it (13 and later): a token is no use if nothing it delivers can be shown.
     */
    AsyncFunction("token") { promise: Promise ->
      val provider = PushTokens.provider ?: return@AsyncFunction promise.resolve(null)
      val fetch = {
        provider.token { token ->
          promise.resolve(token?.let { mapOf("service" to provider.service, "token" to it) })
        }
      }
      val manager = appContext.permissions
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || manager == null) {
        return@AsyncFunction fetch()
      }
      // The token is fetched whatever the answer: it costs nothing, and permission can be given
      // later in Settings without registering again.
      manager.askForPermissions({ _ -> fetch() }, Manifest.permission.POST_NOTIFICATIONS)
    }

    /** The notification words in the app's language, for pushes handled while it is not running. */
    Function("setStrings") { strings: Map<String, String> ->
      val context = appContext.reactContext ?: return@Function
      PushStrings.save(context, strings)
    }

    /** The conversation on screen while the app is in front, or null: see [PushMessages]. */
    Function("setOpenConversation") { id: String? -> PushMessages.openConversation = id }

    OnStartObserving { stopListening = PushTokens.addListener { sendEvent("onTokenChange") } }
    OnStopObserving {
      stopListening?.invoke()
      stopListening = null
    }
  }
}
