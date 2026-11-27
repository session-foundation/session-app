package org.getsession.sessionlogs

import android.Manifest
import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Debug
import android.os.PowerManager
import android.os.StatFs
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.util.zip.GZIPOutputStream

// The device logs' native half: compression off the JS thread, and the facts the export header
// needs that JavaScript cannot read. See the iOS module for why compression is here.
// The manifest entry each product flavour writes; apps/mobile/plugins/withBuildVariants.ts names
// the same key.
private const val BUILD_VARIANT_KEY = "org.getsession.BUILD_VARIANT"

class SessionLogsModule : Module() {
  // The writer's LOG_FILE_NAME in @session/logging, without its groups;
  // packages/app/tests/logFileName.contract.test.ts reads this line and fails when the two differ.
  private val logFile = Regex("^session-\\d{8}T\\d{6}Z-\\d+\\.log$")
  // EXTENSION_LOG_DIRS in @session/logging, checked by the same contract test: the directories
  // beside the logs a part may name, and nothing else. No Android process writes to one yet.
  private val extensionDirs = setOf("notification-service")

  private var memoryCallbacks: ComponentCallbacks2? = null
  // The context the callbacks were registered on, kept so they are unregistered from that same
  // one: the React context can be gone by the time the module is destroyed.
  private var memoryContext: Context? = null

  override fun definition() = ModuleDefinition {
    Name("SessionLogs")

    // The system asking for memory back: React Native's AppState has no memory warning on Android,
    // so this is how a log learns the app was under pressure before it was killed. Only Android 13
    // and below send the levels that mean pressure; see `trimLevelName`.
    Events("onMemoryPressure")

    // The product flavour the APK was built as, by its name in BUILD_VARIANTS in @session/app,
    // which the flavour writes into the manifest; null in an APK built without one. Synchronous,
    // since the ports are built at launch, and the system already holds the manifest.
    Function("buildVariant") {
      val context = appContext.reactContext ?: return@Function null
      applicationMetaData(context)?.getString(BUILD_VARIANT_KEY)
    }

    OnCreate {
      val context = appContext.reactContext?.applicationContext ?: return@OnCreate
      val callbacks =
        object : ComponentCallbacks2 {
          override fun onTrimMemory(level: Int) {
            trimLevelName(level)?.let { sendEvent("onMemoryPressure", mapOf("level" to it)) }
          }

          override fun onConfigurationChanged(newConfig: Configuration) = Unit

          @Deprecated("Superseded by onTrimMemory, still delivered on older versions")
          override fun onLowMemory() {
            sendEvent("onMemoryPressure", mapOf("level" to "low memory"))
          }
        }
      context.registerComponentCallbacks(callbacks)
      memoryCallbacks = callbacks
      memoryContext = context
    }

    OnDestroy {
      memoryCallbacks?.let { memoryContext?.unregisterComponentCallbacks(it) }
      memoryCallbacks = null
      memoryContext = null
    }

    // Parts in order through one gzip stream; a part is a text or a log file name in `directory`,
    // checked to be a bare log file name so it cannot reach outside it. On a background pool rather
    // than the queue every module's async calls share, which would wait behind the whole deflate.
    AsyncFunction("gzip") { parts: List<Map<String, String>>, directory: String, outPath: String ->
      val out = File(outPath)
      try {
        // Two `use`s: GZIPOutputStream writes its header in the constructor, which can throw with
        // the file already open.
        FileOutputStream(out).use { file ->
          GZIPOutputStream(file, 64 * 1024).use { gzip ->
            for (part in parts) {
              val text = part["text"]
              val name = part["file"]
              if (text != null) {
                gzip.write(text.toByteArray(Charsets.UTF_8))
              } else if (name != null) {
                require(logFile.matches(name)) { "not a log file name: $name" }
                val ext = part["extension"]
                require(ext == null || ext in extensionDirs) { "not an extension log directory: $ext" }
                val folder = if (ext == null) File(directory) else File(directory, ext)
                // A file rotated away since the list was taken is skipped rather than failing.
                val log = File(folder, name)
                if (log.exists()) log.inputStream().use { it.copyTo(gzip, 64 * 1024) }
              }
            }
          }
        }
      } catch (error: Exception) {
        // A half-written export is no use to anybody, and it would sit in the cache.
        out.delete()
        throw error
      }
      out.length().toInt()
    }.runOnQueue(appContext.backgroundCoroutineScope)

    // Off the shared queue too: `Debug.getMemoryInfo` walks the process's memory maps.
    AsyncFunction("diagnostics") {
      val context = appContext.reactContext ?: throw IllegalStateException("no context")
      val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val memory = ActivityManager.MemoryInfo().also { activity.getMemoryInfo(it) }
      val process = Debug.MemoryInfo().also { Debug.getMemoryInfo(it) }
      mapOf(
        "model" to "${Build.MANUFACTURER} ${Build.MODEL}",
        "install" to install(context),
        "usedBytes" to process.totalPss.toLong() * 1024,
        "availableBytes" to memory.availMem,
        "totalBytes" to memory.totalMem,
        "freeBytes" to StatFs(context.filesDir.path).availableBytes,
        "lowPowerMode" to (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isPowerSaveMode,
        "permissions" to permissions(context),
      )
    }.runOnQueue(appContext.backgroundCoroutineScope)

    // How the system says the previous process ended, for the startup block's Previous run row:
    // the answer the memory marker cannot give from Android 14, which no longer sends the levels
    // that mean pressure. Null below Android 11, which keeps no record.
    AsyncFunction("previousExit") { previousExit() }.runOnQueue(appContext.backgroundCoroutineScope)
  }

  // The levels worth a line: the ones that mean the system is short of memory. Not BACKGROUND,
  // which means only that the process went onto the cached list, as it does every time the person
  // leaves the app. Android 14 and later send none of these, only UI_HIDDEN and BACKGROUND.
  @Suppress("DEPRECATION")
  private fun trimLevelName(level: Int): String? =
    when (level) {
      ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE -> "running moderate"
      ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW -> "running low"
      ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> "running critical"
      ComponentCallbacks2.TRIM_MEMORY_MODERATE -> "moderate"
      ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> "complete"
      else -> null
    }

  // The most recent exit the system recorded for this package, which at launch is the previous
  // process's: this one has not exited yet.
  private fun previousExit(): Map<String, Any?>? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
    val context = appContext.reactContext ?: return null
    val activity = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val exit =
      activity.getHistoricalProcessExitReasons(context.packageName, 0, 1).firstOrNull()
        ?: return null
    return mapOf(
      "reason" to exitReasonName(exit.reason),
      "description" to exit.description,
      "timestampMs" to exit.timestamp,
    )
  }

  // Constants, inlined at compile time, so naming the newer ones costs nothing on older versions.
  @SuppressLint("InlinedApi")
  private fun exitReasonName(reason: Int): String =
    when (reason) {
      ApplicationExitInfo.REASON_EXIT_SELF -> "exited itself"
      ApplicationExitInfo.REASON_SIGNALED -> "signalled"
      ApplicationExitInfo.REASON_LOW_MEMORY -> "low memory"
      ApplicationExitInfo.REASON_CRASH -> "crash"
      ApplicationExitInfo.REASON_CRASH_NATIVE -> "native crash"
      ApplicationExitInfo.REASON_ANR -> "ANR"
      ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialisation failure"
      ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission change"
      ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive resource usage"
      ApplicationExitInfo.REASON_USER_REQUESTED -> "user requested"
      ApplicationExitInfo.REASON_USER_STOPPED -> "user stopped"
      ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency died"
      ApplicationExitInfo.REASON_OTHER -> "other"
      ApplicationExitInfo.REASON_FREEZER -> "frozen"
      ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "package state change"
      ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "app updated"
      else -> "unknown ($reason)"
    }

  // The installing package, by name where it is a store people know: null is a sideload or adb,
  // since those install with no installer.
  private fun install(context: Context): String {
    val installer =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getInstallerPackageName(context.packageName)
      }
    return when {
      installer == null -> "sideload or adb"
      installer == "com.android.vending" -> "Play Store"
      installer.startsWith("org.fdroid.") -> "F-Droid"
      else -> installer
    }
  }

  private fun applicationMetaData(context: Context): Bundle? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.packageManager
        .getApplicationInfo(
          context.packageName,
          PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()),
        )
        .metaData
    } else {
      @Suppress("DEPRECATION")
      context.packageManager
        .getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        .metaData
    }

  private fun packageInfo(context: Context): PackageInfo =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.packageManager.getPackageInfo(
        context.packageName,
        PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()),
      )
    } else {
      @Suppress("DEPRECATION")
      context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
    }

  // Granted or not: Android cannot tell "never asked" from "denied" without an activity. One the
  // manifest does not request is always refused, so it says so rather than "not granted", which
  // would read as the person having refused it.
  private fun permissions(context: Context): List<List<String>> {
    val declared = packageInfo(context).requestedPermissions?.toSet() ?: emptySet()
    fun state(permission: String) =
      when {
        permission !in declared -> "not declared"
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED -> "granted"
        else -> "not granted"
      }
    val photos =
      if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES
      else Manifest.permission.READ_EXTERNAL_STORAGE
    return listOfNotNull(
      listOf("camera", state(Manifest.permission.CAMERA)),
      listOf("microphone", state(Manifest.permission.RECORD_AUDIO)),
      listOf("photos", state(photos)),
      if (Build.VERSION.SDK_INT >= 33) {
        listOf("notifications", state(Manifest.permission.POST_NOTIFICATIONS))
      } else {
        null
      },
    )
  }
}
