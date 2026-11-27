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
     * The token and its service, or null. Permission to post is asked for separately, whatever
     * the delivery mode (`requestPermission`): a token costs nothing without it, and permission
     * can be given later in Settings without registering again.
     */
    AsyncFunction("token") { promise: Promise ->
      val provider = PushTokens.provider ?: return@AsyncFunction promise.resolve(null)
      provider.token { token ->
        promise.resolve(token?.let { mapOf("service" to provider.service, "token" to it) })
      }
    }

    /**
     * Asks to post notifications where Android needs asking (13 and later), and answers whether
     * they may be posted. Android shows the question only while nothing has been decided.
     */
    AsyncFunction("requestPermission") { promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.resolve(false)
      val manager = appContext.permissions
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || manager == null) {
        return@AsyncFunction promise.resolve(DeviceSettings.notificationsAllowed(context))
      }
      manager.askForPermissions(
          { _ -> promise.resolve(DeviceSettings.notificationsAllowed(context)) },
          Manifest.permission.POST_NOTIFICATIONS,
      )
    }

    /** The notification words in the app's language, for pushes handled while it is not running. */
    Function("setStrings") { strings: Map<String, String> ->
      val context = appContext.reactContext ?: return@Function
      PushStrings.save(context, strings)
    }

    /** The conversation on screen while the app is in front, or null: see [PushMessages]. */
    Function("setOpenConversation") { id: String? -> PushMessages.openConversation = id }

    /** Whether a notification makes its sound while the app is in front. */
    Function("setSoundWhenOpen") { on: Boolean -> PushMessages.soundWhenOpen = on }

    Function("setInFront") { inFront: Boolean -> PushMessages.inFront = inFront }

    AsyncFunction("notificationsAllowed") {
      appContext.reactContext?.let { DeviceSettings.notificationsAllowed(it) } ?: false
    }

    Function("openNotificationSettings") {
      appContext.reactContext?.let { DeviceSettings.openNotifications(it) }
    }

    /** One channel's settings: `messages` or `requests`. */
    Function("openChannelSettings") { id: String ->
      val context = appContext.reactContext ?: return@Function
      Channel.named(id)?.let { DeviceSettings.openChannel(context, it) }
    }

    AsyncFunction("backgroundAllowed") {
      appContext.reactContext?.let { DeviceSettings.backgroundAllowed(it) } ?: false
    }

    Function("changeBackground") {
      appContext.reactContext?.let { DeviceSettings.changeBackground(it) }
    }

    /** A notification for a message that arrived while the app is open. */
    Function("post") { notification: Map<String, Any?> ->
      appContext.reactContext?.let { PushMessages.postIncoming(it, notification) }
    }

    Function("remove") { ids: List<String> ->
      appContext.reactContext?.let { PushMessages.remove(it, ids) }
    }

    Function("preview") { title: String, body: String ->
      appContext.reactContext?.let { PushMessages.preview(it, title, body) }
    }

    OnStartObserving { stopListening = PushTokens.addListener { sendEvent("onTokenChange") } }
    OnStopObserving {
      stopListening?.invoke()
      stopListening = null
    }
  }
}
