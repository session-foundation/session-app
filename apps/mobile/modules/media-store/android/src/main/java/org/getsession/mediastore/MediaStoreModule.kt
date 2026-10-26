package org.getsession.mediastore

import android.annotation.TargetApi
import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

private const val MAX_ATTEMPTS = 1000
private const val DAY_MS = 24 * 60 * 60 * 1000L
private const val SCAN_TIMEOUT_MS = 5_000L

/** Where a saved file is filed, chosen by the MIME type its name implies, as legacy Android does. */
private enum class Collection(val directory: String) {
  IMAGES(Environment.DIRECTORY_PICTURES),
  VIDEO(Environment.DIRECTORY_MOVIES),
  AUDIO(Environment.DIRECTORY_MUSIC),
  DOWNLOADS(Environment.DIRECTORY_DOWNLOADS);

  val contentUri: Uri
    @TargetApi(Build.VERSION_CODES.Q)
    get() = when (this) {
      IMAGES -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      VIDEO -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
      AUDIO -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
      DOWNLOADS -> MediaStore.Downloads.EXTERNAL_CONTENT_URI
    }
}

private fun mimeTypeOf(name: String): String =
  MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
    ?: "application/octet-stream"

// A media collection refuses a row whose type is not its own, so a name that implies none goes to
// Downloads.
private fun collectionFor(name: String, media: Boolean): Collection {
  val type = mimeTypeOf(name)
  return when {
    !media -> Collection.DOWNLOADS
    type.startsWith("image/") -> Collection.IMAGES
    type.startsWith("video/") -> Collection.VIDEO
    type.startsWith("audio/") -> Collection.AUDIO
    else -> Collection.DOWNLOADS
  }
}

/** `name`, then `name (1)`, `name (2)`, ... with the extension kept, as MediaStore names a duplicate. */
private fun numbered(name: String, attempt: Int): String {
  if (attempt == 0) return name
  val dot = name.lastIndexOf('.')
  return if (dot <= 0) "$name ($attempt)" else "${name.substring(0, dot)} ($attempt)${name.substring(dot)}"
}

/**
 * Android 10 and up: a pending row, which no other app sees until the copy is whole. If the app
 * dies first, the row expires after a day on 10 and a week on 11 and up, and MediaStore's idle
 * maintenance then deletes it. MediaStore numbers a name already taken.
 */
@TargetApi(Build.VERSION_CODES.Q)
private fun saveToMediaStore(context: Context, source: File, name: String, collection: Collection): String {
  val resolver = context.contentResolver
  // 10 neither expires a pending row nor clears the expiry on publish, as 11 and up do: without
  // both halves an abandoned row stays for good, or a finished file is deleted a day later.
  val expiresByHand = Build.VERSION.SDK_INT == Build.VERSION_CODES.Q
  val pending = ContentValues().apply {
    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
    put(MediaStore.MediaColumns.MIME_TYPE, mimeTypeOf(name))
    put(MediaStore.MediaColumns.RELATIVE_PATH, collection.directory)
    put(MediaStore.MediaColumns.IS_PENDING, 1)
    if (expiresByHand) {
      put(MediaStore.MediaColumns.DATE_EXPIRES, (System.currentTimeMillis() + DAY_MS) / 1000)
    }
  }
  val row = resolver.insert(collection.contentUri, pending)
    ?: throw CodedException("ERR_INSERT_REFUSED", "MediaStore refused a row for $name", null)
  try {
    val sink = resolver.openOutputStream(row, "w")
      ?: throw CodedException("ERR_OPEN_REFUSED", "MediaStore refused to open $row", null)
    sink.use { out -> FileInputStream(source).use { it.copyTo(out) } }
    val published = ContentValues().apply {
      put(MediaStore.MediaColumns.IS_PENDING, 0)
      if (expiresByHand) putNull(MediaStore.MediaColumns.DATE_EXPIRES)
    }
    resolver.update(row, published, null, null)
  } catch (failure: Throwable) {
    resolver.delete(row, null, null)
    throw failure
  }
  return row.toString()
}

/**
 * The scanner's `content://` URI for a file it has just filed, which another app may open where
 * a `file://` one is refused; null if it does not answer in time.
 *
 * The listener runs on a binder thread, and may never run: `connect()` ignores whether the bind
 * succeeded and `scanFile` swallows a `RemoteException`.
 */
private suspend fun scanned(context: Context, file: File): Uri? {
  val answer = CompletableDeferred<Uri?>()
  MediaScannerConnection.scanFile(context, arrayOf(file.path), arrayOf(mimeTypeOf(file.name))) { _, uri ->
    answer.complete(uri)
  }
  return withTimeoutOrNull(SCAN_TIMEOUT_MS) { answer.await() }
}

/**
 * Android 9 and below, which needs the storage grant: the public folder directly, under a
 * temporary name renamed once whole, so a copy that dies leaves nothing that looks complete.
 */
@Suppress("DEPRECATION")
private suspend fun saveToPublicFolder(context: Context, source: File, name: String, collection: Collection): String {
  val folder = Environment.getExternalStoragePublicDirectory(collection.directory)
  if (!folder.isDirectory && !folder.mkdirs()) {
    throw CodedException("ERR_NO_FOLDER", "cannot create $folder", null)
  }
  val partial = File.createTempFile(".$name.", ".sessiondl", folder)
  val landed = try {
    FileInputStream(source).use { input -> partial.outputStream().use { input.copyTo(it) } }
    // Picked once the copy is whole, so a same-name save that lands meanwhile is numbered past
    // rather than replaced: `renameTo` replaces whatever holds the name.
    val free = (0 until MAX_ATTEMPTS).asSequence()
      .map { File(folder, numbered(name, it)) }
      .firstOrNull { !it.exists() }
      ?: throw CodedException("ERR_NO_FREE_NAME", "every name up to $MAX_ATTEMPTS is taken", null)
    if (!partial.renameTo(free)) {
      throw CodedException("ERR_RENAME_REFUSED", "cannot move the copy to $free", null)
    }
    free
  } finally {
    partial.delete()
  }
  return (scanned(context, landed) ?: Uri.fromFile(landed)).toString()
}

class MediaStoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MediaStore")

    // Off the shared AsyncFunction queue: a large file would otherwise hold up every other
    // module's async call until it finished.
    AsyncFunction("save") Coroutine { sourcePath: String, name: String, media: Boolean ->
      val context = appContext.reactContext
        ?: throw CodedException("ERR_NO_CONTEXT", "no application context", null)
      val collection = collectionFor(name, media)
      withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          saveToMediaStore(context, File(sourcePath), name, collection)
        } else {
          saveToPublicFolder(context, File(sourcePath), name, collection)
        }
      }
    }
  }
}
