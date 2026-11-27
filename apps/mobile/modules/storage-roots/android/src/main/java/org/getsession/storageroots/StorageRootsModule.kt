package org.getsession.storageroots

import android.content.Context
import android.content.pm.ApplicationInfo
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileNotFoundException

/**
 * The directories the app stores anything in.
 *
 * **`filesDir` for the data, the logs and staged picks**, not `noBackupFilesDir`:
 * expo-file-system lets JS write only inside `filesDir` and `cacheDir` (expo-modules-core's
 * `FilePermissionService`), and all three are written from JS. What keeps them out of backups is
 * the manifest: `allowBackup="false"`, and rules that exclude every domain from both Auto Backup
 * and device-to-device transfer. So `inspect` reads the app's own backup flag rather than trusting the
 * location, and a manifest that lost it shows up in the startup block. Exports are in `cacheDir`,
 * which is never backed up and which the OS may clear, as it should an export's copy.
 *
 * Android has nothing per file to set: app-private storage is credential-encrypted, which is
 * iOS's class C -- readable once the device has been unlocked since boot.
 */
class StorageRootsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun roots(): List<File> {
    return listOf(
      File(context.filesDir, "session"),
      File(context.filesDir, "logs"),
      File(context.cacheDir, "exports"),
      // Not the cache: the OS may clear it while a file is still staged, before a send takes it.
      File(context.filesDir, "staged"),
    )
  }

  /**
   * Out of every backup: anywhere when the manifest turns backup off, and the cache directories
   * regardless, since neither Auto Backup nor device transfer ever copies those.
   */
  private fun isExcluded(file: File): Boolean {
    if (context.applicationInfo.flags and ApplicationInfo.FLAG_ALLOW_BACKUP == 0) return true
    val path = file.canonicalPath
    return listOf(context.cacheDir, context.codeCacheDir).any {
      val root = it.canonicalPath
      path == root || path.startsWith(root + File.separator)
    }
  }

  /** What failed, as `path: reason`: one root that cannot be made is no reason to skip the rest. */
  private fun ensureRoots(): List<String> =
    roots().mapNotNull { root ->
      if (root.isDirectory || root.mkdirs()) null else "${root.path}: could not be created"
    }

  override fun definition() = ModuleDefinition {
    Name("StorageRoots")

    // Before JS reads `roots`, which is what creates the module: iOS makes its roots before JS
    // runs, and the startup check inspects them as soon as the log opens.
    OnCreate { ensureRoots() }

    Constant("roots") {
      val (data, logs, exports, staged) = roots()
      mapOf(
        "data" to data.path,
        "logs" to logs.path,
        "exports" to exports.path,
        "staged" to staged.path,
      )
    }

    Constant("location") { "filesDir" }

    // Idempotent; says what failed rather than throwing.
    Function("ensure") { ensureRoots() }

    // Nothing to apply per file: the manifest is the protection. Says whether there was anything
    // there, as iOS's does.
    Function("protect") { path: String ->
      File(path).exists()
    }

    Function("inspect") { path: String ->
      val file = File(path)
      if (!file.exists()) throw FileNotFoundException(path)
      val dataDir = context.dataDir.canonicalPath
      val inAppData = file.canonicalPath.startsWith(dataDir + File.separator)
      mapOf(
        "protection" to if (inAppData) "credentialEncrypted" else "unknown",
        "excludedFromBackup" to isExcluded(file),
      )
    }

    // An uninstall removes these with everything else on Android; kept beside iOS's, whose
    // database can outlive the app. See `PushInstallMarker` in packages/app.
    Function("pushSubscribedThisInstall") {
      installPrefs().getBoolean(PUSH_SUBSCRIBED_KEY, false)
    }

    Function("markPushSubscribedThisInstall") {
      installPrefs().edit().putBoolean(PUSH_SUBSCRIBED_KEY, true).apply()
    }
  }

  private fun installPrefs() = context.getSharedPreferences("install", Context.MODE_PRIVATE)

  private companion object {
    const val PUSH_SUBSCRIBED_KEY = "pushSubscribedThisInstall"
  }
}
