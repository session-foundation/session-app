package org.getsession.securescreen

import android.app.Activity
import android.app.ActivityManager
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.os.Build
import android.os.PersistableBundle
import android.view.WindowManager
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The app-switcher card is left blank rather than showing the app; this colours the blank black,
// bars included, to match the loading screen. From Android 13: the builder that sets the
// background colour is 13's, and before 13 the secure flag's blank card is the system's own.
private fun coverRecents(activity: Activity) {
  if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
  activity.setRecentsScreenshotEnabled(false)
  activity.setTaskDescription(
    ActivityManager.TaskDescription.Builder()
      .setBackgroundColor(Color.BLACK)
      .setStatusBarColor(Color.BLACK)
      .setNavigationBarColor(Color.BLACK)
      .build()
  )
}

class SecureScreenModule : Module() {
  // Whether a screen has asked for the secure flag (the recovery password), which the app-switcher
  // cover below must not clear when the app comes back.
  private var held = false
  // Whether the activity is in the foreground. Read on the main thread, where the events below
  // write it: the flag a screen releases late, after the app has gone to the background, has to
  // stay on, as before Android 13 it is the only thing covering the app-switcher card.
  private var foreground = true

  override fun definition() = ModuleDefinition {
    Name("SecureScreen")

    // The window's secure flag: kept out of screenshots, recordings and the recents thumbnail.
    // On the main queue, the only thread a window's flags may be changed from, and resolved once
    // it is set: a dialog made after that copies it, and one made before does not.
    AsyncFunction("setSecure") { secure: Boolean ->
      held = secure
      val window = appContext.currentActivity?.window ?: return@AsyncFunction
      if (secure) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      else if (foreground) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }.runOnQueue(Queues.MAIN)

    // What is on screen stays out of the app switcher, always, as on iOS. Two parts, because each
    // covers what the other misses. The secure flag goes on as the app leaves the foreground and
    // comes off when it returns, as legacy Android does: that blanks the live card shown while
    // swiping into recents, but only for the activity's own window. From Android 13 the task is
    // also left out of the recents snapshot, which covers every window in it, a tablet's Settings
    // dialog included, and still allows screenshots in the app.
    // Also when the module is made: it can be made after the first resume, and the cover has to be
    // in place before the app is first put in the background.
    OnCreate {
      val activity = appContext.currentActivity ?: return@OnCreate
      activity.runOnUiThread { coverRecents(activity) }
    }

    // On the main thread, which these events don't arrive on and a window's flags need.
    OnActivityEntersForeground {
      val activity = appContext.currentActivity ?: return@OnActivityEntersForeground
      activity.runOnUiThread {
        foreground = true
        coverRecents(activity)
        if (!held) activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }

    OnActivityEntersBackground {
      val activity = appContext.currentActivity ?: return@OnActivityEntersBackground
      activity.runOnUiThread {
        foreground = false
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }

    // A copy the system preview (Android 13 and later) shows as dots rather than the text.
    // The extra is the documented string before 13, where nothing reads it but some keyboards.
    AsyncFunction("copySensitive") { text: String ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      val clip = ClipData.newPlainText("", text)
      val key =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) ClipDescription.EXTRA_IS_SENSITIVE
        else "android.content.extra.IS_SENSITIVE"
      clip.description.extras = PersistableBundle().apply { putBoolean(key, true) }
      clipboard.setPrimaryClip(clip)
    }
  }
}
