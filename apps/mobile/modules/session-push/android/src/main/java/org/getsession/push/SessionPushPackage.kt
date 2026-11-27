package org.getsession.push

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener
import java.lang.ref.WeakReference

class SessionPushPackage : Package {
  override fun createReactActivityLifecycleListeners(
      activityContext: Context
  ): List<ReactActivityLifecycleListener> = listOf(TappedLink())
}

/**
 * Keeps a link the activity is handed after it exists as the activity's own intent, so that a
 * notification tapped after the process died still opens its conversation.
 *
 * Android then recreates the activity from the intent that first launched it, and hands it the
 * tap's intent afterwards as a new intent. React Native reads the link from the activity's intent
 * when JavaScript asks for the initial URL, and drops a new intent's link while JavaScript is
 * still loading, so without this the app opens on the conversation list.
 */
private class TappedLink : ReactActivityLifecycleListener {
  private var activity = WeakReference<Activity>(null)

  override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
    this.activity = WeakReference(activity)
  }

  override fun onNewIntent(intent: Intent): Boolean {
    if (intent.data != null) activity.get()?.intent = intent
    return false
  }
}
