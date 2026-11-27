package org.getsession.push.fcm

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.getsession.push.PushTokens

/**
 * Hands FCM to [PushTokens] at startup.
 *
 * Firebase initialises itself from the string resources `withFcm` writes, before any provider of
 * the app's own runs. A build made without a google-services.json has no such resources and so no
 * Firebase app: no provider is set, and Instant is unavailable rather than broken.
 *
 * The resources say only that the build can use FCM. A device without Google Play services (a
 * de-Googled phone, or one with them disabled) never gets a token, so it gets no provider either,
 * and Instant is not offered. microG answers as Play services do.
 */
class FcmInit : ContentProvider() {
  override fun onCreate(): Boolean {
    val context = context ?: return false
    if (FirebaseApp.getApps(context).isEmpty()) return false
    val services = GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context)
    if (services != ConnectionResult.SUCCESS) return false
    PushTokens.provider =
      object : PushTokens.Provider {
        override val service = "firebase"

        override fun token(callback: (String?) -> Unit) {
          FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            callback(if (task.isSuccessful) task.result else null)
          }
        }
      }
    return true
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?,
  ) = 0
}
